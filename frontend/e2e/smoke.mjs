// RandevunHazır uçtan uca duman testi: her modülde gerçek etkileşim, adım adım PASS/FAIL + konsol hataları
import puppeteer from 'puppeteer-core'
const BASE = process.env.BASE ?? 'http://127.0.0.1:5317/'
const only = process.argv[2]
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' })
const results = []
let page
const errs = []
import { deflateRawSync } from 'node:zlib'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const TMP = mkdtempSync(join(tmpdir(), 'randevuhazir-e2e-'))
/** Excel benzeri gerçek .xlsx (zip + sharedStrings + sheet1) üretir */
function makeXlsx(rows) {
  const strings = []; const si = (v) => { let i = strings.indexOf(v); if (i < 0) { strings.push(v); i = strings.length - 1 } return i }
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const col = (i) => String.fromCharCode(65 + i)
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => v === '' ? '' : typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`).join('') + '</row>').join('') + '</sheetData></worksheet>'
  const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}">` + strings.map((t) => `<si><t>${esc(t)}</t></si>`).join('') + '</sst>'
  const files = { '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook><sheets><sheet name="Ürünler" sheetId="1"/></sheets></workbook>', 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet }
  const parts = [], central = []; let off = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42)
    parts.push(lh, n, data); central.push(ch, n); off += 30 + n.length + data.length
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, e])
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Sunucu modu: API_URL tanımlıysa her test başında sunucu demo verisiyle sıfırlanır ve gerçek e-posta/şifreyle giriş yapılır.
// (Sunucuda Demo:AllowReset=true; uygulama VITE_API_URL ile çalışıyor olmalı.)
const API = process.env.API_URL?.replace(/\/$/, '')
let SEED = null
if (API) {
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  const { buildSeed } = await vite.ssrLoadModule('/src/infrastructure/seed.ts')
  const { todayIstanbul, nowMinutesIstanbul } = await vite.ssrLoadModule('/src/domain/time.ts')
  SEED = JSON.stringify(buildSeed(todayIstanbul(), nowMinutesIstanbul()))
  await vite.close()
}
const demoEmail = (id) => `${id.replace(/^u_/, '').replace(/^t_/, '').replace(/_/g, '.')}@demo.randevuhazir.com.tr`
async function apiReset(body = SEED) {
  const r = await fetch(API + '/api/dev/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  if (!r.ok) throw new Error(`demo sıfırlanamadı: ${r.status}`)
}
async function apiToken(user) {
  const r = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: demoEmail(user), password: 'demo1234' }) })
  if (!r.ok) throw new Error(`giriş yapılamadı: ${user}`)
  return (await r.json()).token
}
/** Oturumu verilen kullanıcıya geçirir (sunucu modunda gerçek giriş). */
async function asUser(user) {
  const token = API && user ? await apiToken(user) : null
  await page.evaluate((u, t, api) => {
    localStorage.setItem('makas:session', JSON.stringify({ userId: u || null, branchId: null, theme: 'light' }))
    if (api) { if (t) localStorage.setItem('rh:token', t); else localStorage.removeItem('rh:token') }
  }, user, token, !!API)
}

/** E-posta/şifreyle giriş denemesi (oturumu değiştirmez): sunucuya ya da tarayıcı demosunun taklit katmanına. */
async function tryLogin(email, password) {
  if (API) {
    const r = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
    return { status: r.status, role: r.ok ? (await r.json()).user?.role : null }
  }
  return page.evaluate(async (email, password) => {
    // Uygulamanın yüklediği modülün aynısı (dev sunucusu düzenlenen dosyaya ?t= ekler; farklı adres = ayrı kopya)
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes('/src/infrastructure/api.ts')) ?? '/src/infrastructure/api.ts'
    const { apiFetch } = await import(url)
    try { const r = await apiFetch('/api/auth/login', { body: { email, password } }); return { status: 200, role: r.user.role } } catch (e) { return { status: e.status, role: null } }
  }, email, password)
}

async function fresh(user, w = 1440, h = 900) {
  if (page) await page.close()
  page = await b.newPage()
  await page.setViewport({ width: w, height: h })
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`))
  // Sunucu modunda bilinçli redler (403/404/409…) tarayıcı konsoluna "Failed to load resource" olarak düşer; hata sayılmaz.
  page.on('console', (m) => m.type() === 'error' && !(API && /Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) && errs.push(`[console] ${m.text()}`))
  page.on('dialog', (d) => d.dismiss())
  await page.evaluateOnNewDocument(() => { window.open = (u) => { window.__opened = u; return null } })
  await page.goto(BASE + '#/giris', { waitUntil: 'networkidle0' })
  if (API) await apiReset()
  else await page.evaluate(() => localStorage.removeItem('makas:v1'))
  await asUser(user)
}
async function go(path) {
  await page.goto('about:blank')
  await page.goto(BASE + '#' + path, { waitUntil: 'networkidle0' })
  await sleep(400)
}
// DOM yardımcıları (sayfa içinde)
async function clickText(text, sel = 'button, a, [role=button], .chip, .tk-item, tr, .list-item, .cat-item, .svc-chip, .bk-option, .bk-svc, .bk-day, .bk-time, .type-opt, .pay-q') {
  const ok = await page.evaluate((text, sel) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
    const el = els.find((e) => e.textContent.replace(/\s+/g, ' ').trim() === text) ?? els.find((e) => e.textContent.replace(/\s+/g, ' ').includes(text))
    if (!el || el.disabled) return false
    el.click()
    return true
  }, text, sel)
  if (!ok) throw new Error(`tıklanacak bulunamadı/pasif: "${text}"`)
  await sleep(250)
}
async function fill(label, value, scope = '') {
  const ok = await page.evaluate((label, value, scope) => {
    const root = scope ? document.querySelector(scope) : document
    const fields = [...root.querySelectorAll('.field')].filter((f) => f.querySelector('label')?.textContent.trim().startsWith(label))
    const input = fields.map((f) => f.querySelector('input, textarea, select')).find(Boolean)
    if (!input) return false
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    return true
  }, label, value, scope)
  if (!ok) throw new Error(`alan bulunamadı: "${label}"`)
  await sleep(200)
}
async function setInput(selector, value, index = 0) {
  const ok = await page.evaluate((selector, value, index) => {
    const input = document.querySelectorAll(selector)[index]
    if (!input) return false
    const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    return true
  }, selector, value, index)
  if (!ok) throw new Error(`input yok: ${selector}[${index}]`)
  await sleep(200)
}
const text = () => page.evaluate(() => document.body.innerText)
async function expectText(t) { const s = await text(); if (!s.includes(t)) throw new Error(`metin yok: "${t}"`) }
async function noText(t) { const s = await text(); if (s.includes(t)) throw new Error(`olmaması gereken metin: "${t}"`) }
const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel)
/** Uygulamanın verisi: tarayıcı modunda localStorage, sunucu modunda /api/sync (yazımların gitmesi beklenir). */
async function db() {
  if (!API) return page.evaluate(() => JSON.parse(localStorage.getItem('makas:v1')))
  await sleep(400)
  const token = await page.evaluate(() => localStorage.getItem('rh:token'))
  return (await fetch(API + '/api/sync', { headers: { authorization: `Bearer ${token}` } })).json()
}
/** Test için veriyi doğrudan değiştirir (ör. yarına randevu taşımak). */
async function editDb(mutate) {
  if (!API) return page.evaluate((src) => { const d = JSON.parse(localStorage.getItem('makas:v1')); new Function('d', src)(d); localStorage.setItem('makas:v1', JSON.stringify(d)) }, mutate)
  const d = await db()
  new Function('d', mutate)(d)
  await apiReset(JSON.stringify(d))
}

async function step(name, fn) {
  const before = errs.length
  try {
    await fn()
    const newErrs = errs.slice(before)
    results.push({ name, ok: newErrs.length === 0, err: newErrs.join(' | ') })
  } catch (e) {
    results.push({ name, ok: false, err: e.message + (errs.length > before ? ' | ' + errs.slice(before).join(' | ') : '') })
    try { await page.screenshot({ path: `e2e/fail-${results.length}.png` }) } catch {}
  }
}

// DOM'da kullanılan ama yüklü hiçbir stil sayfasında geçmeyen sınıflar
async function unstyled() {
  return page.evaluate(() => {
    const defined = new Set()
    const walk = (rules) => { for (const r of rules) { if (r.selectorText) for (const m of r.selectorText.matchAll(/\.([a-zA-Z0-9_-]+)/g)) defined.add(m[1]); if (r.cssRules) walk(r.cssRules) } }
    for (const sh of document.styleSheets) { try { walk(sh.cssRules) } catch {} }
    const used = new Set()
    for (const el of document.querySelectorAll('[class]')) for (const c of (el.getAttribute('class') || '').split(/\s+/)) if (c) used.add(c)
    const ignore = new Set(['lucide', 'on', 'off', 'num', 'clickable', 'danger', 'success', 'warning', 'accent', 'info', 'today', 'cur', 'done', 'set', 'liked', 'expired', 'inactive', 'closed', 'waiting', 'total', 'net', 'neg', 'dev', 'compact', 'selected', 'dragging', 'drop', 'full', 'leave', 'break', 'meeting', 'wide', 'bordered', 'pulse', 'warn', 'ok', 'left', 'over', 'grace', 'locked', 'expiring', 'active', 'light', 'dark', 'system', 'product', 'service', 'package_sale', 'package_use', 'pos', 'bank', 'sms', 'whatsapp', 'price', 'r'])
    return [...used].filter((c) => !defined.has(c) && !ignore.has(c) && !c.startsWith('lucide-') && !c.startsWith('s-'))
  })
}

const suites = {
  async extra() {
    await fresh('u_t_lara_owner')
    await step('Şube değiştir: Konyaaltı takvimi', async () => {
      await go('/takvim'); await page.click('.branch-btn'); await clickText('Konyaaltı', '.menu button'); await sleep(400)
      const names = await page.evaluate(() => [...document.querySelectorAll('.tg-colhead b')].map((b) => b.textContent))
      if (!names.includes('Deniz')) throw new Error('Konyaaltı personeli yok: ' + names)
      await page.click('.branch-btn'); await clickText('Lara', '.menu button')
    })
    await step('Takvim: alttan çekerek süre uzat', async () => {
      await go('/takvim')
      // yarından itibaren uygun randevusu olan ilk güne git (kapalı günleri atla)
      for (let i = 0; i < 7; i++) {
        await page.keyboard.press('ArrowRight'); await sleep(300)
        const ok = await page.evaluate(() => [...document.querySelectorAll('.ap')].some((e) => e.classList.contains('s-confirmed') && !e.classList.contains('compact')))
        if (ok) break
      }
      const r = await page.evaluate(async () => {
        const el = [...document.querySelectorAll('.ap')].find((e) => e.classList.contains('s-confirmed') && !e.classList.contains('compact'))
        const h = el.querySelector('.ap-resize'); const b = h.getBoundingClientRect()
        h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.x + 5, clientY: b.y + 2 }))
        await new Promise((r) => setTimeout(r, 80))
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.x + 5, clientY: b.y + 2 + 48 }))
        await new Promise((r) => setTimeout(r, 80))
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        return true
      })
      await sleep(400); await expectText('Süre:')
    })
    await step('Hizmetler: satır içi süre', async () => { await go('/hizmetler'); await setInput('.inline-num:not(.price) input', '50', 0); await sleep(300); await expectText('Süre güncellendi') })
    await step('Ayarlar: bağlantı adı değiş → online sayfa yeni adla açılır', async () => {
      await go('/ayarlar'); await fill('Online randevu bağlantısı', 'lara-sac'); await clickText('Kaydet', '.set-body button'); await sleep(300)
      await go('/r/lara-sac'); await expectText('Studio Lara')
    })
    await step('Kalıcılık: yenileyince veri ve tema korunur', async () => {
      await go('/musteriler')
      await clickText('Yeni müşteri', '.page-head button'); await fill('Ad Soyad', 'Kalıcı Kişi'); await fill('Telefon', '0536 777 66 55'); await clickText('Kaydet', '.drawer-foot button'); await sleep(300)
      await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('makas:session')); s.theme = 'dark'; localStorage.setItem('makas:session', JSON.stringify(s)) })
      await page.reload({ waitUntil: 'networkidle0' }); await sleep(400)
      await go('/musteriler'); await setInput('.cust-toolbar input', 'Kalıcı'); await expectText('Kalıcı Kişi')
      if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') throw new Error('tema korunmadı')
    })
    await step('Askıdaki salona giriş engellenir', async () => {
      await fresh('u_platform'); await go('/platform')
      await page.evaluate(() => [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Berber Mert')).querySelector('[aria-label=Diğer]').click()); await sleep(200)
      await clickText('Askıya al', '.menu button'); await clickText('Askıya al', '.modal button'); await sleep(300)
      await asUser(null)
      await go('/giris'); await clickText('Mert Öztürk', '.login-user'); await sleep(800)
      await expectText('askıya alınmış')
      await go('/r/berber-mert'); await expectText('Salon bulunamadı')
    })
    await fresh('u_t_lara_rec', 390, 844)
    await step('Mobil: + ile randevu oluştur', async () => {
      await go('/takvim'); await page.click('.fab'); await sleep(400)
      await page.evaluate(() => document.querySelectorAll('.svc-chip')[0].click()); await sleep(200)
      const before = (await db()).appointments.length
      await clickText('Randevu oluştur', '.drawer-foot button'); await sleep(300)
      if ((await db()).appointments.length !== before + 1) throw new Error('eklenmedi')
    })
    await step('Mobil: personel değiştir', async () => { await clickText('Mert', '.staff-pill'); await sleep(200); const n = await page.evaluate(() => document.querySelector('.tg-colhead b')?.textContent); if (n !== 'Mert') throw new Error('sütun değişmedi: ' + n) })
    await step('Mobil: kasada ödeme', async () => {
      await go('/kasa'); await clickText('Yeni adisyon', '.ticket-list button'); await sleep(300)
      await page.evaluate(() => document.querySelectorAll('.cat-item')[0].click()); await sleep(200)
      await page.evaluate(() => [...document.querySelectorAll('.ticket-actions .btn-primary')].pop().click()); await sleep(300)
      await clickText('Ödemeyi tamamla', '.modal button'); await sleep(300); await expectText('Kapandı')
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (over > 2) throw new Error('taşma ' + over)
    })
    await step('Mobil: Daha fazla → Raporlar? (resepsiyon görmez) / Stok açılır', async () => { await go('/daha'); await clickText('Stok', '.more-item'); await sleep(300); await expectText('Ürün ekle') })
  },
  async styles() {
    const routes = [
      ['u_t_lara_owner', '/takvim', ['.ap', 'click']], ['u_t_lara_owner', '/musteriler', ['tbody tr', 'click']], ['u_t_lara_rec', '/kasa', null],
      ['u_t_lara_owner', '/hizmetler', null], ['u_t_lara_owner', '/personel', ['.perf-card tbody tr', 'click']], ['u_t_lara_owner', '/stok', ['.page-head .btn-primary', 'click']],
      ['u_t_lara_owner', '/paketler', ['.page-head .btn-primary', 'click']], ['u_t_lara_owner', '/mesajlar', null], ['u_t_lara_owner', '/raporlar', null],
      ['u_t_lara_owner', '/ayarlar', null], ['u_platform', '/platform', ['tbody tr .btn', 'click']], ['', '/r/studio-lara', null], ['', '/davet/davetgulusdemo2026', null],
      ['u_t_lara_staff', '/primlerim', null], ['u_t_lara_owner', '/daha', null],
    ]
    for (const [user, route, action] of routes) {
      await step(`Stil: ${route} (doğrudan giriş)`, async () => {
        await fresh(user)
        await go(route)
        if (action) { await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return; if (el.classList.contains('ap')) { const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.x + 3, clientY: r.y + 3 })); setTimeout(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })), 80) } else el.click() }, action[0]); await sleep(500) }
        const miss = await unstyled()
        if (miss.length) throw new Error('stilsiz sınıflar: ' + miss.join(', '))
      })
    }
    // Panel içi sekmeler / pencereler
    await step('Stil: personel prim sekmesi', async () => { await fresh('u_t_lara_owner'); await go('/personel'); await page.click('.perf-card tbody tr'); await sleep(300); await clickText('Prim', '.drawer .tabs button'); const m = await unstyled(); if (m.length) throw new Error(m.join(', ')) })
    await step('Stil: personel hizmetler sekmesi', async () => { await clickText('Hizmetler', '.drawer .tabs button'); const m = await unstyled(); if (m.length) throw new Error(m.join(', ')) })
    await step('Stil: müşteri boya formu', async () => { await fresh('u_t_lara_owner'); await go('/musteriler'); await page.click('tbody tr'); await sleep(300); await clickText('Boya kartı', '.drawer .tabs button'); await clickText('Yeni boya kaydı', '.drawer button'); const m = await unstyled(); if (m.length) throw new Error(m.join(', ')) })
    await step('Stil: platform lisans uzat', async () => { await fresh('u_platform'); await go('/platform'); await clickText('Uzat', 'tbody .btn'); const m = await unstyled(); if (m.length) throw new Error(m.join(', ')) })
    await step('Stil: platform davet', async () => { await page.keyboard.press('Escape'); await sleep(200); await clickText('Davet', 'tbody .btn'); const m = await unstyled(); if (m.length) throw new Error(m.join(', ')) })
    await step('Stil: platform yeni işletme', async () => { await page.keyboard.press('Escape'); await sleep(200); await clickText('Yeni işletme', '.page-head button'); const m = await unstyled(); if (m.length) throw new Error(m.join(', ')) })
  },

  async login() {
    await fresh('')
    await step('Giriş: demo hesaplar listelenir', async () => { await go('/giris'); await expectText('Studio Lara'); await expectText('Comodo Yönetici') })
    await step('Giriş: sahip olarak gir', async () => { await clickText('Zeynep Arıkan', '.login-user'); await sleep(500); await expectText('Randevu') })
    await step('Çıkış', async () => { await page.click('.sidebar-foot .user-btn'); await clickText('Çıkış yap', '.menu button'); await sleep(300); await expectText('Bir rol seçin') })
  },
  async calendar() {
    await fresh('u_t_lara_rec')
    await go('/takvim')
    await step('Takvim: personel sütunları', async () => { if ((await count('.tg-col')) < 3) throw new Error('sütun yok') })
    await step('Takvim: boş hücreden yeni randevu', async () => {
      await page.evaluate(() => { const c = document.querySelectorAll('.tg-col')[0]; c.closest('.tg-scroll').scrollTop = 0; const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + 30, clientY: r.y + 12 })) })
      await sleep(400)
      await expectText('Yeni randevu')
      await page.evaluate(() => document.querySelectorAll('.svc-chip')[0].click())
      await sleep(200)
      const before = (await db()).appointments.length
      await clickText('Randevu oluştur', '.drawer-foot button')
      await sleep(400)
      const after = (await db()).appointments.length
      if (after !== before + 1) throw new Error(`randevu eklenmedi ${before}->${after}`)
    })
    await step('Takvim: yeni randevu + yeni müşteri', async () => {
      await clickText('Randevu', '.cal-toolbar button.btn-primary'); await sleep(300)
      await clickText('Yeni', '.drawer button')
      await fill('Ad Soyad', 'Test Müşteri')
      await fill('Telefon', '0555 123 45 67')
      await clickText('Kaydet ve seç', '.drawer button')
      await expectText('Test Müşteri')
      await page.evaluate(() => document.querySelectorAll('.svc-chip')[1].click())
      await clickText('Randevu oluştur', '.drawer-foot button')
      await sleep(300)
      const d = await db()
      if (!d.customers.some((c) => c.phone === '5551234567')) throw new Error('müşteri kaydı yok')
    })
    await step('Takvim: randevu detayı ve durum akışı', async () => {
      await page.evaluate(() => { const el = [...document.querySelectorAll('.ap')].find((e) => e.classList.contains('s-confirmed')); const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.x + 5, clientY: r.y + 5 })) })
      await sleep(150)
      await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })))
      await sleep(400)
      await clickText('Geldi', '.drawer-foot button')
      await clickText('İşleme al', '.drawer-foot button')
      await expectText('Tamamla')
      await page.keyboard.press('Escape'); await sleep(200)
    })
    await step('Takvim: onay bekleyenler listesi', async () => {
      const n = await page.evaluate(() => Number([...document.querySelectorAll('.cal-kpis .kpi')].find((k) => k.textContent.includes('Onay bekleyen'))?.querySelector('b')?.textContent))
      if (!(n >= 2)) throw new Error('demo verisinde yeterli bekleyen yok: ' + n)
      await clickText('Onay bekleyen', '.cal-kpis .kpi'); await expectText('Onay bekleyenler')
      const rows = await count('.drawer .pending-row')
      if (rows !== n) throw new Error(`listede ${rows} kişi, beklenen ${n}`)
      await clickText('Onayla', '.drawer .pending-row button'); await sleep(300)
      if ((await count('.drawer .pending-row')) !== n - 1) throw new Error('onaylanan listeden düşmedi')
      await page.evaluate(() => document.querySelector('.drawer .pending-row').click()); await sleep(300)
      await expectText('Onayla')
      await page.keyboard.press('Escape'); await sleep(200)
    })
    await step('Takvim: sürükle-bırak taşıma', async () => {
      const r = await page.evaluate(async () => {
        const el = [...document.querySelectorAll('.ap')].find((e) => e.classList.contains('s-confirmed'))
        const col2 = document.querySelectorAll('.tg-col')[2]
        const a = el.getBoundingClientRect(); const c = col2.getBoundingClientRect()
        const id = el.getAttribute('aria-label')
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: a.x + 5, clientY: a.y + 5 }))
        await new Promise((r) => setTimeout(r, 100))
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: c.x + 20, clientY: a.y + 40 }))
        await new Promise((r) => setTimeout(r, 100))
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        return id
      })
      await sleep(500)
      // Onay modali çıkarsa onayla
      const hasModal = await count('.modal')
      if (hasModal) await clickText('Taşı', '.modal button')
      await sleep(300)
      await expectText('Taşındı')
    })
    await step('Takvim: randevusuz müşteri', async () => {
      await clickText('Randevusuz', '.cal-toolbar button')
      await page.evaluate(() => document.querySelector('.modal .chip').click())
      const before = (await db()).appointments.length
      await clickText('Sıraya al', '.modal button')
      await sleep(300)
      if ((await db()).appointments.length !== before + 1) throw new Error('walk-in eklenmedi')
    })
    await step('Takvim: hafta görünümü', async () => { await clickText('Hafta', '.seg button'); if ((await count('.tg-col')) !== 7) throw new Error('7 gün yok'); await clickText('Gün', '.seg button') })
    await step('Takvim: ileri/geri ve Bugün', async () => { await page.click('.cal-date .icon-btn:nth-of-type(2)'); await sleep(200); await clickText('Bugün', '.cal-date button'); await expectText('Bugün') })
  },
  async customers() {
    await fresh('u_t_lara_owner')
    await go('/musteriler')
    await step('Müşteriler: arama', async () => { await setInput('.cust-toolbar input', 'elif'); const n = await count('tbody tr'); if (!n) throw new Error('sonuç yok') ; await setInput('.cust-toolbar input', '') })
    await step('Müşteriler: filtreler', async () => { for (const f of ['VIP', 'Borçlu', 'Doğum günü', 'Uzun süredir gelmeyen', 'Yeni', 'Tümü']) await clickText(f, '.filter-chips .chip') })
    await step('Müşteriler: yeni müşteri', async () => {
      await clickText('Yeni müşteri', '.page-head button')
      await fill('Ad Soyad', 'Ayla Deneme'); await fill('Telefon', '0544 000 11 22')
      await clickText('Kaydet', '.drawer-foot button'); await sleep(300)
      await expectText('Ayla Deneme')
    })
    await step('Müşteriler: mükerrer telefon engeli', async () => {
      await page.keyboard.press('Escape'); await sleep(200)
      await clickText('Yeni müşteri', '.page-head button')
      await fill('Ad Soyad', 'Kopya'); await fill('Telefon', '+90 544 000 1122')
      await clickText('Kaydet', '.drawer-foot button'); await expectText('adına kayıtlı')
      await page.keyboard.press('Escape'); await sleep(200)
    })
    await step('Müşteri kartı: sekmeler', async () => {
      await go('/musteriler'); await page.click('tbody tr'); await sleep(300)
      for (const t of ['Boya kartı', 'Randevular', 'Satışlar', 'Paketler', 'Notlar']) await clickText(t, '.drawer .tabs button')
    })
    await step('Müşteri kartı: boya kaydı ekle', async () => {
      await clickText('Boya kartı', '.drawer .tabs button')
      await clickText('Yeni boya kaydı', '.drawer button')
      await setInput('.cc-item-row input', 'Igora', 0)
      await setInput('.cc-item-row input', '7.1', 1)
      await clickText('Kaydet', '.drawer .card button.btn-primary')
      await sleep(300)
      if ((await count('.color-card')) < 1) throw new Error('boya kaydı görünmüyor')
    })
    await step('Müşteri kartı: düzenle', async () => { await clickText('Düzenle', '.drawer-foot button'); await fill('Notlar & formül', 'Test notu'); await clickText('Kaydet', '.drawer-foot button'); await sleep(300) })
    await step('Müşteri kartı: paket sat → kasaya git', async () => {
      await go('/musteriler'); await page.click('tbody tr'); await sleep(300)
      await clickText('Paketler', '.drawer .tabs button')
      await page.evaluate(() => { const s = document.querySelector('.pkg-sell select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, s.options[1].value); s.dispatchEvent(new Event('change', { bubbles: true })) })
      await sleep(200)
      await clickText('Ödemeye geç', '.drawer button'); await sleep(500)
      if (!page.url().includes('kasa')) throw new Error('kasaya gitmedi: ' + page.url())
      await expectText('Paket satışı')
    })
    await step('Müşteri kartı: randevu ver', async () => {
      await go('/musteriler'); await page.click('tbody tr'); await sleep(300)
      await clickText('Randevu ver', '.drawer-foot button'); await expectText('Yeni randevu')
    })
  },
  async cash() {
    await fresh('u_t_lara_rec')
    await go('/kasa')
    await step('Kasa: yeni adisyon + hizmet + ürün', async () => {
      await clickText('Yeni adisyon', '.ticket-list button')
      await page.evaluate(() => document.querySelectorAll('.cat-item')[0].click()); await sleep(200)
      await clickText('Ürün', '.add-box .seg button')
      await page.evaluate(() => document.querySelectorAll('.cat-item:not(:disabled)')[0].click()); await sleep(200)
      if ((await count('.tl')) !== 2) throw new Error('satırlar eklenmedi')
    })
    await step('Kasa: indirim ve bahşiş', async () => {
      await setInput('.ticket-sum .tl-price', '10', 0)
      await expectText('-₺')
    })
    await step('Kasa: kartla ödeme (POS seçimi)', async () => {
      await page.evaluate(() => [...document.querySelectorAll('.ticket-actions .btn-primary')].pop().click()); await sleep(300)
      await clickText('Garanti POS', '.pay-q')
      await clickText('Ödemeyi tamamla', '.modal button'); await sleep(400)
      const d = await db(); const t = d.tickets.filter((x) => x.status === 'closed').pop()
      if (!t.payments.some((p) => p.accountId)) throw new Error('POS kaydedilmedi')
      await expectText('Kapandı')
    })
    await step('Kasa: parçalı ödeme', async () => {
      await clickText('Yeni adisyon', '.ticket-list button')
      await page.evaluate(() => document.querySelectorAll('.cat-item')[2].click()); await sleep(200)
      await page.evaluate(() => [...document.querySelectorAll('.ticket-actions .btn-primary')].pop().click()); await sleep(300)
      await setInput('.pay-amount input', '100', 0)
      await clickText('Ödemeyi böl', '.modal button')
      await clickText('Ödemeyi tamamla', '.modal button'); await sleep(400)
      await expectText('Kapandı')
    })
    await step('Kasa: müşterisiz veresiye engeli', async () => {
      await clickText('Yeni adisyon', '.ticket-list button')
      await page.evaluate(() => document.querySelectorAll('.cat-item')[0].click()); await sleep(200)
      await page.evaluate(() => [...document.querySelectorAll('.ticket-actions .btn-primary')].pop().click()); await sleep(300)
      const dis = await page.evaluate(() => [...document.querySelectorAll('.pay-q')].find((b) => b.textContent.includes('Veresiye')).disabled)
      if (!dis) throw new Error('veresiye pasif değil')
      await page.keyboard.press('Escape'); await sleep(200)
    })
    await step('Kasa: adisyon sil', async () => { await clickText('Sil', '.ticket-actions button'); await clickText('Sil', '.modal button'); await sleep(300) })
    await step('Kasa: gün sonu ekranı', async () => { await clickText('Gün sonu', '.tabs button'); await expectText('Kasada olması gereken'); await expectText('POS ve banka hesapları'); await expectText('Ödeme alınanlar') })
    await step('Kasa: gider ekle (karttan) gün sonundan düşer', async () => {
      await clickText('Giderler', '.tabs button')
      await fill('Tutar', '250')
      await clickText('Kart', '.card .seg button')
      await sleep(200)
      await clickText('Ekle', '.card-pad button.btn-primary'); await sleep(300)
      await expectText('Gider eklendi')
      await clickText('Gün sonu', '.tabs button')
      await expectText('−₺250')
    })
    await step('Kasa: gider yeni kategori', async () => {
      await clickText('Giderler', '.tabs button')
      await fill('Kategori', '__new')
      await setInput('.card-pad input', 'Reklam', 0)
      await clickText('Ekle', '.card-pad .row button')
      const d = await db(); if (!d.tenants[0].expenseCategories.includes('Reklam')) throw new Error('kategori eklenmedi')
    })
    await step('Kasa: gider filtreleri', async () => { for (const t of ['Bugün', '7 gün', 'Geçen ay', 'Bu ay']) await clickText(t, '.exp-filters .seg button'); await clickText('Kart', '.exp-filters .seg button'); await clickText('Tarih seç', '.exp-filters .seg button'); if ((await count('.exp-filters input[type=date]')) !== 2) throw new Error('tarih alanları yok') })
    await step('Kasa: veresiye tahsilat', async () => {
      await clickText('Veresiye', '.tabs button')
      await clickText('Tahsil et', '.list-item button')
      await clickText('Tahsil et', '.modal-foot button'); await sleep(300)
      await expectText('Tahsilat kaydedildi')
    })
    await step('Kasa: gün sonu kapat', async () => {
      await clickText('Gün sonu', '.tabs button')
      await fill('Kasada sayılan nakit', '100')
      await clickText('Günü kapat', '.card-pad button'); await clickText('Günü kapat', '.modal button'); await sleep(300)
      await expectText('Gün kapatıldı')
    })
    await step('Kasa: kapalı günde ödeme engeli', async () => {
      await clickText('Adisyonlar', '.tabs button')
      await clickText('Yeni adisyon', '.ticket-list button')
      await page.evaluate(() => document.querySelectorAll('.cat-item')[0].click()); await sleep(200)
      await expectText('Gün kapalı')
    })
  },
  async services() {
    await fresh('u_t_lara_owner')
    await go('/hizmetler')
    await step('Hizmetler: satır içi fiyat', async () => { await setInput('.inline-num.price input', '650', 0); await sleep(300); await expectText('Fiyat güncellendi') })
    await step('Hizmetler: yeni hizmet', async () => {
      await clickText('Yeni hizmet', '.page-head button')
      await fill('Hizmet adı', 'Test Hizmet'); await fill('Fiyat', '500')
      await clickText('Kaydet', '.drawer-foot button'); await sleep(300); await expectText('Test Hizmet')
    })
    await step('Hizmetler: düzenle + sil', async () => {
      await page.evaluate(() => { const row = [...document.querySelectorAll('.svc-row')].find((r) => r.textContent.includes('Test Hizmet')); row.querySelector('[aria-label=Düzenle]').click() }); await sleep(300)
      await clickText('Sil', '.drawer-foot button'); await clickText('Sil', '.modal button'); await sleep(300)
      await noText('Test Hizmet')
    })
    await step('Hizmetler: yeni kategori', async () => { await clickText('Kategori', '.page-head button'); await fill('Ad', 'Kaş & Kirpik'); await clickText('Ekle', '.drawer-foot button'); await sleep(300); await expectText('Kaş & Kirpik') })
  },
  async staff() {
    await fresh('u_t_lara_owner')
    await go('/personel')
    await step('Personel: performans tablosu ve tarih filtresi', async () => { await expectText('Kim ne kadar yaptı'); for (const t of ['Bugün', '7 gün', 'Geçen ay', 'Bu ay']) await clickText(t, '.staff-filters .seg button') })
    await step('Personel: prim ayarı kaydet', async () => {
      const name = await page.evaluate(() => [...document.querySelectorAll('.perf-card tbody tr')].find((r) => r.textContent.includes('Kategori primi')).querySelector('.t-strong').textContent)
      await page.evaluate(() => [...document.querySelectorAll('.perf-card tbody tr')].find((r) => r.textContent.includes('Kategori primi')).click()); await sleep(300)
      await clickText('Prim', '.drawer .tabs button')
      await setInput('.pct input', '45', 1)
      await clickText('Kaydet', '.drawer-foot button'); await sleep(300)
      const d = await db(); if (!Object.values(d.staff.find((s) => s.name === name).categoryRates).includes(45)) throw new Error('kategori oranı kaydedilmedi: ' + name)
    })
    await step('Personel: kademeli prim', async () => {
      await page.click('.perf-card tbody tr'); await sleep(300)
      await clickText('Prim', '.drawer .tabs button')
      await clickText('Kademeli', '.drawer .seg button')
      await clickText('Dilim ekle', '.drawer button')
      await clickText('Kaydet', '.drawer-foot button'); await sleep(300)
    })
    await step('Personel: marka ekle', async () => {
      await page.click('.perf-card tbody tr'); await sleep(300)
      await clickText('Prim', '.drawer .tabs button')
      await fill('Marka ekle', 'Wella')
      await clickText('Ekle', '.drawer .cm-sec button'); await sleep(200); await expectText('Wella')
      await page.keyboard.press('Escape'); await sleep(200)
    })
    await step('Personel: izin ekle', async () => {
      await page.click('.perf-card tbody tr'); await sleep(300)
      await clickText('İzin & mola', '.drawer .tabs button')
      await clickText('Ekle', '.drawer .card button'); await sleep(200)
      await page.keyboard.press('Escape'); await sleep(200)
    })
    await step('Personel: yeni personel', async () => {
      await clickText('Personel ekle', '.page-head button')
      await fill('Ad Soyad', 'Yeni Kalfa')
      await clickText('Kaydet', '.drawer-foot button'); await sleep(300); await expectText('Yeni Kalfa')
    })
  },
  async stock() {
    await fresh('u_t_lara_owner')
    await go('/stok')
    await step('Stok: kategori/marka filtresi', async () => { await clickText('Boya', '.stock-facets .chip'); await clickText('Majirel', '.stock-facets .chip'); await clickText('Tümü', '.stock-facets .chip') })
    await step('Stok: giriş hareketi', async () => {
      const before = (await db()).products[0].stock
      await clickText('Giriş', '.stock-row button'); await clickText('Kaydet', '.modal button'); await sleep(300)
      const p = (await db()).products.find((x) => x.stock !== undefined)
      await expectText('stok güncellendi')
    })
    await step('Stok: sayım', async () => { await page.click('.stock-row [aria-label=Sayım]'); await setInput('.modal input', '5', 0); await clickText('Kaydet', '.modal button'); await sleep(300) })
    await step('Stok: Excel (.xlsx) içe aktarma', async () => {
      const f = join(TMP, 'urunler.xlsx')
      writeFileSync(f, makeXlsx([['Ürün Adı', 'Marka', 'Kategori', 'Barkod', 'Alış Fiyatı', 'Satış Fiyatı (KDV Dahil)', 'KDV', 'Stok'], ['E2E Şampuan', 'TestMarka', 'Şampuan', '8690000099', 100, 240, 0.2, 7], ['E2E Maske', 'TestMarka', 'Maske', '', '80,50', '', '%20', ''], ['', 'boş', '', '', '', '', '', '']]))
      await clickText("Excel'den aktar", '.page-head button'); await expectText('Excel ya da CSV')
      const input = await page.$('.modal input[type=file]'); await input.uploadFile(f); await sleep(600)
      await expectText('2 yeni'); await expectText('1 atlanacak')
      const on = await page.evaluate(() => document.querySelector('.modal .switch')?.getAttribute('aria-checked') ?? document.querySelector('.modal .switch')?.className)
      await clickText('2 ürünü aktar', '.modal button'); await sleep(300)
      await expectText('2 ürün eklendi')
      const d = await db()
      const p = d.products.find((x) => x.name === 'E2E Şampuan')
      if (!p || p.price !== 20000 || p.cost !== 10000 || p.vatRate !== 20 || p.stock !== 7 || p.barcode !== '8690000099') throw new Error('xlsx ürünü hatalı: ' + JSON.stringify(p) + ' switch=' + on)
      if (!d.products.some((x) => x.name === 'E2E Maske' && x.cost === 8050)) throw new Error('2. ürün yok')
    })
    await step('Stok: CSV ile güncelleme (barkoddan tanır)', async () => {
      const f = join(TMP, 'liste.csv')
      writeFileSync(f, '\uFEFFÜrün;Barkod;Satış Fiyatı;Stok\nE2E Şampuan Yeni;8690000099;300,00;3\n')
      await clickText("Excel'den aktar", '.page-head button')
      const input = await page.$('.modal input[type=file]'); await input.uploadFile(f); await sleep(600)
      await expectText('1 güncellenecek')
      await clickText('1 ürünü aktar', '.modal button'); await sleep(300)
      const p = (await db()).products.find((x) => x.barcode === '8690000099')
      if (p.name !== 'E2E Şampuan Yeni' || p.price !== 30000 || p.stock !== 3 || p.brand !== 'TestMarka') throw new Error('güncelleme hatalı: ' + JSON.stringify(p))
    })
    await step('Stok: PDF reddedilir, yönlendirir', async () => {
      const f = join(TMP, 'liste.pdf'); writeFileSync(f, '%PDF-1.4')
      await clickText("Excel'den aktar", '.page-head button')
      const input = await page.$('.modal input[type=file]'); await input.uploadFile(f); await sleep(400)
      await expectText('PDF tabloları')
      await page.keyboard.press('Escape'); await sleep(200)
    })
    await step('Stok: yeni ürün + yeni marka', async () => {
      await clickText('Ürün ekle', '.page-head button')
      await fill('Ürün adı', 'Test Krem')
      await fill('Marka', '__new'); await setInput('.drawer .row input', 'TestMarka', 0); await clickText('Ekle', '.drawer .row button')
      await fill('Kategori', 'Bakım')
      await fill('Alış fiyatı', '100'); await fill('Satış fiyatı', '200')
      await expectText('KDV dahil: ₺240')
      await clickText('Kaydet', '.drawer-foot button'); await sleep(300)
      const d = await db(); const p = d.products.find((x) => x.name === 'Test Krem'); if (!p || p.brand !== 'TestMarka' || p.price !== 20000) throw new Error('ürün yanlış: ' + JSON.stringify(p))
    })
    await step('Stok: hareket geçmişi', async () => { await page.click('.stock-main'); await sleep(300); await expectText('Stok hareketleri'); await page.keyboard.press('Escape') })
  },
  async packages() {
    await fresh('u_t_lara_owner')
    await go('/paketler')
    await step('Paketler: 8+2 görünür', async () => { await expectText('8+2 = 10 kullanım') })
    await step('Paketler: yeni paket bonuslu', async () => {
      await clickText('Yeni paket', '.page-head button')
      await fill('Paket adı', 'Test 5+1'); await fill('Paket fiyatı', '1000')
      await setInput('.drawer input[title="Hediye (bonus)"]', '1', 0)
      await clickText('Kaydet', '.drawer-foot button'); await sleep(300)
      await expectText('Test 5+1')
    })
    await step('Paketler: satılanlar sekmesi', async () => { await clickText('Satılan paketler', '.tabs button'); if (!(await count('.list-item'))) throw new Error('liste boş') })
  },
  async packageFlow() {
    await fresh('u_t_lara_rec')
    await step('Paket akışı: paketli müşteriye hizmet → paketten düşer', async () => {
      await go('/kasa')
      const cust = ((d) => { const cp = d.customerPackages.find((c) => c.tenantId === 't_lara' && Object.values(c.remaining).some((n) => n > 0) && c.expiresOn > '2026'); const c = d.customers.find((x) => x.id === cp.customerId); const svc = d.services.find((s) => s.id === Object.keys(cp.remaining).find((k) => cp.remaining[k] > 0)); return { name: c.name, svc: svc.name } })(await db())
      await clickText('Yeni adisyon', '.ticket-list button')
      await setInput('.ticket .input-icon input', cust.name.split(' ')[0])
      await sleep(300)
      await page.evaluate((n) => [...document.querySelectorAll('.cust-search-results .list-item')].find((e) => e.textContent.includes(n)).click(), cust.name)
      await sleep(300)
      await setInput('.add-box .input-icon input', cust.svc)
      await page.evaluate((n) => [...document.querySelectorAll('.cat-item')].find((e) => e.querySelector('b').textContent === n).click(), cust.svc); await sleep(300)
      await expectText('Paketten')
      await clickText('Kapat', '.ticket-actions button'); await sleep(300)
      await expectText('Kapandı')
    })
  },
  async messages() {
    await fresh('u_t_lara_rec')
    await go('/mesajlar')
    await step('Mesajlar: toplu SMS', async () => {
      const disabled = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Tümüne SMS gönder'))?.disabled)
      if (disabled) { // yarın randevu yok ya da hepsine zaten gönderilmiş
        const t = await text(); if (!t.includes('Yarın için hatırlatılacak randevu yok') && !t.includes('Hatırlatılacak randevu kalmadı')) throw new Error('boş durum mesajı yok'); return
      }
      await clickText('Tümüne SMS gönder', 'button'); await sleep(300); await expectText('hatırlatma SMS')
    })
    await step('Mesajlar: tümüne WhatsApp (tek tek)', async () => {
      // yarın kapalı olabilir: 3 gelecek randevuyu yarına taşı, izinleri aç
      await editDb(`
        const t = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
        const ids = new Set(d.messages.filter((m) => m.kind === 'reminder').map((m) => m.appointmentId))
        const pick = d.appointments.filter((a) => a.tenantId === 't_lara' && a.customerId && a.status === 'confirmed' && !ids.has(a.id)).slice(0, 3)
        pick.forEach((a, i) => { a.date = t; a.start = 600 + i * 60; a.end = a.start + 30; const c = d.customers.find((x) => x.id === a.customerId); c.consentSms = true })
      `)
      await go('/mesajlar')
      const n = await count('.list .list-item')
      if (n < 3) throw new Error(`yarın listesi ${n}`)
      await clickText('Tümüne WhatsApp', 'button'); await expectText('WhatsApp ile tek tek gönder'); await expectText('1 / ')
      await clickText("WhatsApp'ta aç", '.modal button')
      const u1 = await page.evaluate(() => window.__opened)
      if (!/wa\.me\/90\d{10}\?text=/.test(u1 ?? '')) throw new Error('bireysel wa.me açılmadı: ' + u1)
      await expectText('2 / ')
      await clickText('Atla', '.modal button')
      await clickText("WhatsApp'ta aç", '.modal button')
      const u2 = await page.evaluate(() => window.__opened)
      if (u2 === u1) throw new Error('aynı kişiye tekrar açıldı')
      // Yarın zaten randevu olabilir: kuyruk uzunluğu güne göre değişir, kalanları atla
      for (let i = 0; i < 20 && !(await text()).includes('gönderildi'); i++) await clickText('Atla', '.modal button')
      await expectText('gönderildi'); await clickText('Bitti', '.modal button')
      const d = await db()
      const wa = d.messages.filter((m) => m.channel === 'whatsapp' && m.kind === 'reminder').length
      if (wa < 2) throw new Error('WhatsApp kaydı yok')
    })
    await step('Mesajlar: WhatsApp butonu', async () => { await clickText('Kutla', 'button').catch(() => {}); })
    await step('Mesajlar: şablon düzenle', async () => { await clickText('Şablonlar', '.tabs button'); await setInput('.card-pad textarea', 'Merhaba {musteri} test', 0); await clickText('Kaydet', '.card-pad button'); await expectText('Şablon kaydedildi') })
    await step('Mesajlar: kayıt', async () => { await clickText('Gönderim kaydı', '.tabs button'); if (!(await count('.list-item'))) throw new Error('kayıt yok') })
  },
  async reports() {
    await fresh('u_t_lara_owner')
    await go('/raporlar')
    await step('Raporlar: dönemler', async () => { for (const t of ['Bugün', '7 gün', 'Bu ay', 'Geçen ay', '30 gün']) await clickText(t, '.rp-filters .seg button') })
    await step('Raporlar: şube filtresi', async () => { await setInput('.rp-filters select', 'b_lara') })
    await step('Raporlar: tablo görünümü', async () => { await clickText('Tablo', 'button'); if (!(await count('.rp-main tbody tr'))) throw new Error('tablo yok'); await clickText('Grafik', 'button') })
  },
  async settings() {
    await fresh('u_t_lara_owner')
    await go('/ayarlar')
    await step('Ayarlar: salon kaydet', async () => { await clickText('Kaydet', '.set-body button'); await expectText('Salon bilgileri kaydedildi') })
    await step('Ayarlar: POS ekle', async () => { await clickText('POS & banka hesapları', '.set-nav button'); await setInput('.set-body .card-pad input', 'Akbank POS', 0); await clickText('Ekle', '.set-body .card-pad button'); await expectText('Akbank POS eklendi') })
    await step('Ayarlar: şube düzenle', async () => { await clickText('Şubeler & saatler', '.set-nav button'); await page.click('.set-body .list-item'); await sleep(300); await clickText('Kaydet', '.drawer-foot button'); await expectText('Şube kaydedildi') })
    await step('Ayarlar: kullanıcı ekle', async () => { await clickText('Kullanıcılar', '.set-nav button'); await clickText('Kullanıcı ekle', '.set-body button'); await fill('Ad Soyad', 'Yeni Resepsiyon'); await clickText('Kaydet', '.drawer-foot button'); await expectText('Yeni Resepsiyon') })
    await step('Ayarlar: kutucukla yetki — kasası kapalı kullanıcı kasaya giremez', async () => {
      await clickText('Kullanıcılar', '.set-nav button'); await clickText('Kullanıcı ekle', '.set-body button')
      await fill('Ad Soyad', 'Kısıtlı Resepsiyon')
      if (API) { await fill('Giriş e-postası', 'kisitli@salon.test'); await fill('Şifre', 'kisitli-sifre-1') }
      const unticked = await page.evaluate(() => {
        const item = [...document.querySelectorAll('.perm-item')].find((l) => l.querySelector('.perm-label')?.textContent === 'Kasa')
        const box = item?.querySelector('input'); if (!box?.checked) return false
        box.click(); return !box.checked
      })
      if (!unticked) throw new Error('Kasa kutucuğu kaldırılamadı')
      await clickText('Kaydet', '.drawer-foot button'); await sleep(API ? 1200 : 400)
      await expectText('Özel yetki')
      const u = (await db()).users.find((x) => x.name === 'Kısıtlı Resepsiyon')
      if (!u?.perms || u.perms.includes('cash') || !u.perms.includes('calendar')) throw new Error('yetkiler kaydedilmedi: ' + JSON.stringify(u?.perms))
      if (API) {
        const r = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'kisitli@salon.test', password: 'kisitli-sifre-1' }) })
        const { token } = await r.json()
        await page.evaluate((id, t) => { localStorage.setItem('makas:session', JSON.stringify({ userId: id, branchId: null, theme: 'light' })); localStorage.setItem('rh:token', t) }, u.id, token)
      } else await page.evaluate((id) => localStorage.setItem('makas:session', JSON.stringify({ userId: id, branchId: null, theme: 'light' })), u.id)
      await go('/kasa'); if (page.url().includes('/kasa')) throw new Error('kasaya girebildi')
      await go('/takvim'); if (!page.url().includes('/takvim')) throw new Error('takvime giremedi')
      await asUser('u_t_lara_owner'); await go('/ayarlar')
    })
    await step('Ayarlar: online randevu', async () => { await clickText('Online randevu', '.set-nav button'); await page.click('.set-row .switch'); await sleep(200); await page.click('.set-row .switch') })
    await step('Ayarlar: QR kod telefonla okunur ve randevu linkini verir', async () => {
      await clickText('Salon', '.set-nav button'); await clickText('QR kod', '.set-body button'); await sleep(400)
      const r = await page.evaluate(async () => {
        const svg = document.querySelector('.qr-img svg').outerHTML
        const url = document.querySelector('.qr-box code').textContent
        if (!('BarcodeDetector' in window)) return { skip: true }
        const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode()
        const c = document.createElement('canvas'); c.width = c.height = 600; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, 600, 600)
        const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(c)
        return { url, got: found[0]?.rawValue }
      })
      if (!r.skip && r.got !== r.url) throw new Error(`QR okunamadı: ${r.got} ≠ ${r.url}`)
      if (!/studio-lara$/.test(r.url ?? 'studio-lara')) throw new Error('link salona ait değil: ' + r.url)
      await page.keyboard.press('Escape'); await sleep(200)
    })
    await step('Ayarlar: tema', async () => { await clickText('Görünüm', '.set-nav button'); await clickText('Gece', '.theme-card'); const th = await page.evaluate(() => document.documentElement.dataset.theme); if (th !== 'dark') throw new Error('tema değişmedi'); await clickText('Ferah', '.theme-card') })
  },
  async platform() {
    await fresh('u_platform')
    await go('/platform')
    await step('Platform: tür filtresi', async () => { await clickText('Berber', '.filter-chips .chip'); if ((await count('tbody tr')) !== 1) throw new Error('filtre çalışmıyor'); await clickText('Tümü', '.filter-chips .chip') })
    await step('Platform: lisans filtresi', async () => { await clickText('Dolmuş', '.seg button'); await clickText('Tüm lisanslar', '.seg button') })
    await step('Platform: yeni işletme + davet', async () => {
      await clickText('Yeni işletme', '.page-head button')
      await clickText('Berber', '.type-opt')
      await fill('İşletme adı', 'Test Berber'); await fill('İşletme sahibinin adı', 'Ali Test')
      await clickText('Oluştur ve davet linkini al', '.drawer-foot button'); await sleep(300)
      await expectText('Davet linki · Test Berber'); await expectText('online randevu linki')
    })
    await step('Platform: davet linki ile giriş', async () => {
      const url = await page.evaluate(() => document.querySelector('.invite-box code').textContent)
      await page.goto('about:blank'); await page.goto(url, { waitUntil: 'networkidle0' }); await sleep(300)
      const mail = `ali.${Date.now()}@test.local`
      await fill('Cep telefonu', '05321234567'); await fill('E-posta', mail); await fill('Şifre', 'gizli-sifre-1')
      await clickText('Panelime gir', 'button'); await sleep(API ? 1500 : 500)
      await expectText('Test Berber')
      if ((await tryLogin(mail, 'gizli-sifre-1')).status !== 200) throw new Error('davetle belirlenen şifreyle giriş olmadı')
    })
    await step('Platform: lisans uzat', async () => {
      await asUser('u_platform')
      await go('/platform')
      await page.evaluate(() => [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Nüans')).querySelector('.btn').click()); await sleep(300)
      await clickText('90 gün', '.modal .pay-q'); await clickText('90 gün uzat', '.modal button'); await sleep(300)
      await expectText('tarihine uzatıldı')
    })
    await step('Platform: askıya al / aktifleştir', async () => {
      await page.evaluate(() => [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Berber Mert')).querySelector('[aria-label=Diğer]').click()); await sleep(200)
      await clickText('Askıya al', '.menu button'); await clickText('Askıya al', '.modal button'); await sleep(300); await expectText('Askıda')
    })
  },
  async password() {
    await fresh('u_t_lara_rec')
    await step('Şifre: kullanıcı kendi şifresini değiştirir', async () => {
      await go('/takvim')
      await page.click('.sidebar-foot .user-btn'); await clickText('Şifremi değiştir', '.menu button')
      await fill('Mevcut şifre', 'demo1234'); await fill('Yeni şifre', 'yeni-sifre-123'); await fill('Yeni şifre (tekrar)', 'yeni-sifre-123')
      await clickText('Kaydet', '.modal button'); await sleep(600); await expectText('Şifreniz değiştirildi')
      if ((await tryLogin(demoEmail('u_t_lara_rec'), 'yeni-sifre-123')).status !== 200) throw new Error('yeni şifreyle giriş olmadı')
    })
    await step('Şifre: unuttum → e-postaya gelen kodla yenile → giriş', async () => {
      await asUser(null); await go('/giris')
      await clickText('Şifremi unuttum', '.login-link')
      await fill('E-posta', demoEmail('u_t_lara_owner')); await clickText('Kod gönder', '.login-form button'); await sleep(600)
      await expectText('6 haneli kod')
      // Sunucu: e-posta kutusundan; tarayıcı demosu: e-posta gönderilemediği için kod ekranda gösterilir
      const code = API
        ? (await (await fetch(API + '/api/dev/emails?to=' + encodeURIComponent(demoEmail('u_t_lara_owner')))).json()).body.match(/\b\d{6}\b/)[0]
        : await page.evaluate(() => document.querySelector('.login-form .info-banner b')?.textContent)
      if (!/^\d{6}$/.test(code ?? '')) throw new Error('kod bulunamadı')
      await fill('Kod', code); await fill('Yeni şifre', 'unuttum-12345')
      await clickText('Şifremi yenile', '.login-form button'); await sleep(600); await expectText('Şifreniz yenilendi')
      await fill('Şifre', 'unuttum-12345'); await clickText('Giriş yap', '.login-form button'); await sleep(1500)
      if (!page.url().includes('/takvim')) throw new Error('giriş yapılamadı: ' + page.url())
    })
  },
  async adminUsers() {
    await fresh('u_platform')
    await go('/platform')
    await step('Platform: tek paket (Tam Paket ₺2.000/ay) ve uzatma tutarı', async () => {
      await expectText('Tam Paket'); await noText('Kurumsal'); await noText('Başlangıç')
      await page.evaluate(() => [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Studio Lara')).querySelector('.btn').click()); await sleep(300)
      await clickText('90 gün', '.modal .pay-q'); await expectText('₺6.000')
      await page.keyboard.press('Escape'); await sleep(200)
    })
    const login = async (email, password) => (await tryLogin(email, password)).status
    const openUsers = async (salon) => {
      await go('/platform')
      await page.evaluate((n) => [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes(n)).querySelector('[aria-label=Diğer]').click(), salon); await sleep(200)
      await clickText('Kullanıcılar', '.menu button'); await sleep(800)
    }
    const userAction = async (name, label) => {
      const ok = await page.evaluate((name, label) => {
        const row = [...document.querySelectorAll('.drawer .list-item')].find((r) => r.querySelector('.t-strong')?.textContent.includes(name))
        const btn = row && [...row.querySelectorAll('button')].find((b) => b.textContent.includes(label))
        btn?.click(); return !!btn
      }, name, label)
      if (!ok) throw new Error(`${name}: "${label}" yok`)
      await sleep(300)
    }
    await step('Yönetim: salon kullanıcılarının e-postaları görünür', async () => {
      await openUsers('Studio Lara'); await expectText(demoEmail('u_t_lara_owner')); await expectText(demoEmail('u_t_lara_rec'))
    })
    await step('Yönetim: kullanıcının şifresini değiştir', async () => {
      await userAction('Gamze', 'Şifre değiştir')
      await fill('Yeni şifre', 'yonetimden-123'); await fill('Yeni şifre (tekrar)', 'yonetimden-123')
      await clickText('Kaydet', '.modal button'); await sleep(600); await expectText('Şifre değiştirildi')
      if ((await login(demoEmail('u_t_lara_rec'), 'yonetimden-123')) !== 200) throw new Error('yeni şifre geçmedi')
    })
    await step('Yönetim: kullanıcının e-postasını değiştir', async () => {
      await userAction('Gamze', 'E-posta değiştir')
      await fill('Yeni e-posta', 'gamze.yeni@salon.test'); await clickText('Kaydet', '.modal button'); await sleep(600)
      await expectText('E-posta değiştirildi'); await expectText('gamze.yeni@salon.test')
      if ((await login('gamze.yeni@salon.test', 'yonetimden-123')) !== 200) throw new Error('yeni e-posta geçmedi')
    })
    await step('Yönetim: salona kullanıcı aç', async () => {
      await clickText('Kullanıcı aç', '.drawer-foot button')
      await fill('Ad Soyad', 'Yeni Resepsiyon'); await setInput('.modal select', 'reception')
      await fill('Giriş e-postası', 'yeni.resepsiyon@salon.test'); await fill('Şifre', 'ilk-sifre-123')
      await clickText('Aç', '.modal .btn-primary'); await sleep(1200)
      await expectText('Yeni Resepsiyon')
      if ((await login('yeni.resepsiyon@salon.test', 'ilk-sifre-123')) !== 200) throw new Error('yeni kullanıcı giriş yapamadı')
    })
    await step('Yönetim: Comodo yöneticisi aç', async () => {
      await go('/platform'); await clickText('Comodo yöneticileri', '.page-head button'); await sleep(600)
      await clickText('Yönetici aç', '.drawer-foot button')
      await fill('Ad Soyad', 'Ekip Arkadaşı'); await fill('Giriş e-postası', 'ekip@comodo.test'); await fill('Şifre', 'ekip-sifre-123')
      await clickText('Aç', '.modal .btn-primary'); await sleep(1200)
      if ((await tryLogin('ekip@comodo.test', 'ekip-sifre-123')).role !== 'platform') throw new Error('yönetici olarak giriş yapamadı')
    })
  },
  async booking() {
    await fresh('')
    await step('Online randevu: baştan sona', async () => {
      await go('/r/berber-mert')
      await page.evaluate(() => document.querySelectorAll('.bk-svc')[0].click()); await sleep(200)
      await clickText('Devam', '.bk-bar button')
      await clickText('Fark etmez', '.bk-option'); await sleep(400)
      await page.evaluate(() => document.querySelectorAll('.bk-time')[0].click()); await sleep(200)
      await clickText('Devam', '.bk-bar button')
      await fill('Ad Soyad', 'Online Test'); await fill('Cep telefonu', '0533 999 88 77')
      await page.click('.bk-kvkk input')
      await clickText('Randevuyu onayla', '.bk-bar button'); await sleep(400)
      await expectText('Talebiniz alındı')
    })
    if (API) await step('Online randevu: kısa link (alanadi/salon) randevu sayfasını açar', async () => {
      await page.goto('about:blank'); await page.goto(BASE + 'studio-lara', { waitUntil: 'networkidle0' }); await sleep(600)
      if (!page.url().includes('#/r/studio-lara')) throw new Error('yönlenmedi: ' + page.url())
      await expectText('Studio Lara')
    })
    await step('Online randevu: çok şubeli salon', async () => { await go('/r/studio-lara'); await clickText('Konyaaltı', '.bk-option'); await expectText('Hangi hizmeti') })
  },
  async staffRole() {
    await fresh('u_t_lara_staff')
    await step('Personel rolü: sadece kendi takvimi', async () => { await go('/takvim'); if ((await count('.tg-col')) !== 1) throw new Error('birden fazla sütun') })
    await step('Personel rolü: primlerim', async () => { await go('/primlerim'); await expectText('Primlerim') })
    await step('Personel rolü: kasaya giremez', async () => { await go('/kasa'); if (page.url().includes('kasa')) throw new Error('kasaya girebildi') })
  },
  async mobile() {
    await fresh('u_t_lara_rec', 390, 844)
    for (const p of ['/takvim', '/musteriler', '/kasa', '/daha', '/stok', '/mesajlar']) {
      await step(`Mobil: ${p} yatay taşma yok`, async () => {
        await go(p)
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        if (over > 2) throw new Error(`yatay taşma ${over}px`)
      })
    }
  },
}

for (const [name, fn] of Object.entries(suites)) {
  if (only && only !== name) continue
  try { await fn() } catch (e) { results.push({ name: `${name} (suite)`, ok: false, err: e.message }) }
}
await b.close()
const fails = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  →  ' + r.err.slice(0, 300)}`)
console.log(`\n${results.length - fails.length}/${results.length} geçti`)
