// RandevuHazır tanıtım videosu üreticisi: canlı siteyi gezer, ekranı kaydeder, Yelda sesiyle seslendirir, altyazı ekler.
// Kullanım: FFMPEG=/yol/ffmpeg node promo/make-video.mjs   (çıktı: promo/out/randevuhazir-tanitim.mp4)
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE ?? 'https://comodo-teknoloji-ve-ticaret.github.io/randevu/'
const FF = process.env.FFMPEG ?? 'ffmpeg'
const VOICE = process.env.VOICE ?? 'Yelda'
const RATE = process.env.RATE ?? '172'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
const W = 1920, H = 1080
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- Senaryo ----------
/** Her parça: seslendirme metni + aynı anda ekranda yapılacak hareket. */
const SEGMENTS = [
  { say: 'Randevular defterde, kasa hesap makinesinde, hatırlatmalar hep son dakikada mı?', act: () => card({ kicker: 'Kuaför · Berber · Güzellik salonu', title: 'Salonunuz hâlâ<br>defterle mi yönetiliyor?' }) },
  { say: "Comodo'dan Randevu Hazır ile salonunuzun tamamı, tek ekranda.", act: () => card({ logo: true, title: 'RandevuHazır', sub: 'Salon yönetimi, tek ekranda' }) },
  { say: 'Günlük takvimde tüm personelinizi ve randevularını yan yana görürsünüz.', act: async () => { await hideCard(); await sweepColumns() } },
  { say: 'Boş bir saate tıklayın, müşteriyi ve hizmeti seçin. Randevu saniyeler içinde hazır.', act: newAppointment },
  { say: 'Online gelen talepler onay listesine düşer; tek tıkla onaylarsınız.', act: approvePending },
  { say: 'Müşterileriniz, salonunuza özel bağlantıdan gece gündüz online randevu alabilir.', act: onlineBooking },
  { say: 'Her müşterinin geçmişi, notları, boya kartı ve paketleri tek kartta.', act: customerCard },
  { say: 'İşlem bitince adisyon kasaya düşer. Nakit, kart ya da havale ile, birden fazla POS cihazıyla ödeme alırsınız.', act: cashPayment },
  { say: 'Gün sonunda kimin ne ödediğini ve kasada ne kaldığını net görürsünüz.', act: dayEnd },
  { say: 'Personel primleri; hizmet, ürün ve paket bazında otomatik hesaplanır.', act: staffPerf },
  { say: "Ürün listenizi Excel'den tek seferde aktarın; kritik seviyedeki ürünler sizi uyarır.", act: stockImport },
  { say: 'Yarınki randevulara hatırlatmalar, tek tıkla SMS ya da WhatsApp ile gider.', act: messages },
  { say: 'Ciro, doluluk ve en çok kazandıran hizmetler, raporlarda bir bakışta.', act: reports },
  { say: 'Bilgisayarda, tablette ve telefonda çalışır; birden fazla şubeyi tek yerden yönetirsiniz.', act: phoneCard },
  { say: "Randevu Hazır. Salonunuz için, Comodo'dan.", act: () => card({ logo: true, title: 'RandevuHazır', sub: 'Salonunuz için, Comodo\'dan', foot: 'Demo: comodo-teknoloji-ve-ticaret.github.io/randevu' }) },
]

// ---------- Ses ----------
function tts(text, file) {
  execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', file, text])
  const info = execFileSync('afinfo', [file]).toString()
  return Number(/estimated duration: ([\d.]+)/.exec(info)[1])
}

// ---------- Tarayıcı ----------
let page
const ev = (fn, ...a) => page.evaluate(fn, ...a)

const OVERLAY = () => {
  if (document.getElementById('promo-style')) return
  const st = document.createElement('style'); st.id = 'promo-style'
  st.textContent = `
  #promo-cursor{position:fixed;left:0;top:0;z-index:99999;pointer-events:none;transition:transform .75s cubic-bezier(.22,.8,.25,1),opacity .3s;transform:translate(960px,600px)}
  #promo-cursor svg{width:30px;height:30px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}
  .promo-ripple{position:fixed;z-index:99998;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(108,92,231,.35);pointer-events:none;animation:promo-rip .55s ease-out forwards}
  @keyframes promo-rip{from{transform:scale(.2);opacity:1}to{transform:scale(1.6);opacity:0}}
  #promo-cap{position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:99997;max-width:1400px;padding:16px 30px;border-radius:18px;background:rgba(20,18,38,.82);color:#fff;font:600 30px/1.35 Inter,system-ui,sans-serif;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3);backdrop-filter:blur(8px);transition:opacity .3s;pointer-events:none}
  #promo-card{position:fixed;inset:0;z-index:99996;background-size:140% 140% !important;animation:promo-bg 9s ease-in-out infinite alternate;display:flex;align-items:center;justify-content:center;gap:90px;background:radial-gradient(1200px 700px at 20% 10%,#8e7cf6 0,transparent 60%),radial-gradient(900px 600px at 90% 90%,#12a37b55 0,transparent 60%),linear-gradient(135deg,#2a1f6b,#5b49d6 55%,#6c5ce7);color:#fff;font-family:Inter,system-ui,sans-serif;transition:opacity .5s;text-align:center}
  @keyframes promo-bg{from{background-position:0% 0%}to{background-position:100% 100%}}
  #promo-card .logo{animation:promo-float 3s ease-in-out infinite alternate}
  @keyframes promo-float{from{transform:translateY(-6px)}to{transform:translateY(6px)}}
  #promo-card .k{font-size:28px;letter-spacing:.12em;text-transform:uppercase;opacity:.75;margin-bottom:22px}
  #promo-card h1{font-size:92px;line-height:1.05;font-weight:800;margin:0;letter-spacing:-.02em}
  #promo-card .s{font-size:38px;opacity:.9;margin-top:22px}
  #promo-card .f{position:absolute;bottom:130px;left:0;right:0;font-size:26px;opacity:.85}
  #promo-card .logo{width:120px;height:120px;border-radius:32px;background:rgba(255,255,255,.16);display:grid;place-items:center;margin:0 auto 30px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
  #promo-card .logo svg{width:66px;height:66px}
  #promo-card .phone{width:410px;height:840px;border-radius:56px;background:#111;padding:14px;box-shadow:0 40px 120px rgba(0,0,0,.45)}
  #promo-card .phone iframe{width:100%;height:100%;border:0;border-radius:44px;background:#fff}
  #promo-card .left{text-align:left;max-width:760px}`
  document.head.appendChild(st)
  const c = document.createElement('div'); c.id = 'promo-cursor'
  c.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.6 6.6z" fill="#fff" stroke="#1d1b2f" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  document.body.appendChild(c)
  const cap = document.createElement('div'); cap.id = 'promo-cap'; cap.style.opacity = '0'
  document.body.appendChild(cap)
}

const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 10h18M8 2v4M16 2v4"/><path d="m9 16 2 2 4-4"/></svg>'

async function caption(text) {
  await ev((t) => { const c = document.getElementById('promo-cap'); c.textContent = t; c.style.opacity = t ? '1' : '0' }, text)
}
async function card({ kicker, title, sub, foot, logo, html, cursor }) {
  await ev((o, sc) => {
    let el = document.getElementById('promo-card')
    if (!el) { el = document.createElement('div'); el.id = 'promo-card'; document.body.appendChild(el) }
    el.style.opacity = '1'
    document.getElementById('promo-cursor').style.opacity = o.cursor ? '1' : '0'
    el.innerHTML = o.html ?? `<div>${o.logo ? `<div class="logo">${sc}</div>` : ''}${o.kicker ? `<div class="k">${o.kicker}</div>` : ''}<h1>${o.title}</h1>${o.sub ? `<div class="s">${o.sub}</div>` : ''}</div>${o.foot ? `<div class="f">${o.foot}</div>` : ''}`
  }, { kicker, title, sub, foot, logo, html, cursor }, LOGO)
}
async function hideCard() {
  await ev(() => { const el = document.getElementById('promo-card'); document.getElementById('promo-cursor').style.opacity = '1'; if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 500) } })
  await sleep(500)
}
async function cursorTo(x, y, ms = 800) {
  await ev((x, y) => { document.getElementById('promo-cursor').style.transform = `translate(${x - 6}px,${y - 3}px)` }, x, y)
  await sleep(ms)
}
/** Metne/seçiciye göre öğeyi bulur, görünür yapar, merkezini döndürür */
async function locate(sel, text) {
  const r = await ev((sel, text) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
    const el = text ? (els.find((e) => e.textContent.replace(/\s+/g, ' ').trim() === text) ?? els.find((e) => e.textContent.includes(text))) : els[0]
    if (!el) return null
    const b0 = el.getBoundingClientRect()
    if (b0.top < 80 || b0.bottom > innerHeight - 160) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return true
  }, sel, text)
  if (!r) throw new Error(`bulunamadı: ${sel} ${text ?? ''}`)
  await sleep(450)
  return ev((sel, text) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
    const el = text ? (els.find((e) => e.textContent.replace(/\s+/g, ' ').trim() === text) ?? els.find((e) => e.textContent.includes(text))) : els[0]
    const b = el.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }, sel, text)
}
async function click(sel, text, { wait = 700, move = 750 } = {}) {
  const p = await locate(sel, text)
  await cursorTo(p.x, p.y, move)
  await ev((x, y) => { const r = document.createElement('div'); r.className = 'promo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600) }, p.x, p.y)
  await page.mouse.click(p.x, p.y)
  await sleep(wait)
}
async function hover(sel, text, ms = 700) { const p = await locate(sel, text); await cursorTo(p.x, p.y, ms) }
async function nav(hash) { await ev((h) => { location.hash = h }, hash); await sleep(900) }
async function esc() { await page.keyboard.press('Escape'); await sleep(350) }
async function scrollTo(sel, text) { await locate(sel, text) }

// ---------- Sahneler ----------
async function sweepColumns() {
  const cols = await ev(() => [...document.querySelectorAll('.tg-col')].slice(0, 5).map((c) => { const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: Math.min(b.y + 260, innerHeight - 300) } }))
  for (const c of cols) await cursorTo(c.x, c.y, 650)
}
async function newAppointment() {
  const pt = await ev(() => {
    for (const c of [...document.querySelectorAll('.tg-col')].slice(1)) {
      const r = c.getBoundingClientRect()
      for (let y = r.y + 40; y < Math.min(r.bottom, innerHeight - 200); y += 18) {
        const x = r.x + r.width / 2, el = document.elementFromPoint(x, y)
        if (el && el.closest('.tg-col') && !el.closest('.ap') && !el.closest('.blk') && !el.closest('[class*=break]')) return { x, y }
      }
    }
  })
  await cursorTo(pt.x, pt.y, 800)
  await ev((x, y) => { const r = document.createElement('div'); r.className = 'promo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r) }, pt.x, pt.y)
  await page.mouse.click(pt.x, pt.y); await sleep(700)
  await hover('.drawer input', null, 500)
  await page.keyboard.type('Elif', { delay: 110 }); await sleep(450)
  await click('.cust-search-results .list-item', null, { wait: 450, move: 500 })
  await click('.drawer .svc-chip', null, { wait: 300, move: 600 })
  await click('.drawer-foot button', 'Randevu oluştur', { wait: 600, move: 600 })
}
async function approvePending() {
  await click('.cal-kpis .kpi', 'Onay bekleyen', { wait: 900 })
  await click('.drawer .pending-row button', 'Onayla', { wait: 900 })
  await hover('.drawer .pending-row button', 'Onayla', 600)
}
async function onlineBooking() {
  await esc()
  await card({ cursor: true, html: `<div class="left"><div class="k">Online randevu · 7/24</div><h1>Müşteriniz<br>kendisi seçsin.</h1><div class="s">Hizmet, personel, saat — size sadece onaylamak kalır</div></div><div class="phone"><iframe src="${BASE}#/r/studio-lara"></iframe></div>` })
  await sleep(1300)
  const f = page.frames().find((x) => x.url().includes('/r/studio-lara'))
  await clickIn(f, '.bk-option', 'Lara', 700)
  await clickIn(f, '.bk-svc', null, 450)
  await clickIn(f, '.bk-bar button', 'Devam', 700)
  await clickIn(f, '.bk-option', 'Fark etmez', 800)
}
/** iframe içindeki öğeye imleçle gidip tıklar */
async function clickIn(frame, sel, text, wait = 600) {
  const off = await ev(() => { const b = document.querySelector('#promo-card iframe').getBoundingClientRect(); return { x: b.x, y: b.y } })
  const p = await frame.evaluate((sel, text) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null)
    const el = text ? (els.find((e) => e.textContent.includes(text))) : els[0]
    if (!el) return null
    el.scrollIntoView({ block: 'nearest' })
    const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }, sel, text)
  if (!p) throw new Error(`iframe: bulunamadı ${sel} ${text ?? ''}`)
  const x = off.x + p.x, y = off.y + p.y
  await cursorTo(x, y, 650)
  await ev((x, y) => { const r = document.createElement('div'); r.className = 'promo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600) }, x, y)
  await frame.evaluate((sel, text) => { const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null); (text ? els.find((e) => e.textContent.includes(text)) : els[0]).click() }, sel, text)
  await sleep(wait)
}
async function customerCard() {
  const id = await ev(() => {
    const d = JSON.parse(localStorage.getItem('makas:v1'))
    const withCard = new Set(d.colorCards.filter((c) => c.tenantId === 't_lara').map((c) => c.customerId))
    const withPkg = new Set(d.customerPackages.filter((c) => c.tenantId === 't_lara').map((c) => c.customerId))
    return [...withCard].find((x) => withPkg.has(x)) ?? [...withCard][0]
  })
  await hideCard()
  await nav(`#/musteriler/${id}`); await sleep(200)
  await click('.tabs button', 'Boya kartı', { wait: 1100 })
  await click('.tabs button', 'Paketler', { wait: 900 })
}
async function cashPayment() {
  await esc()
  await nav('#/kasa'); await sleep(200)
  await click('.ticket-list button', 'Yeni adisyon', { wait: 700 })
  await click('.cat-item', null, { wait: 350, move: 600 })
  const items = await ev(() => document.querySelectorAll('.cat-item').length)
  if (items > 3) await click('.cat-item:nth-of-type(3)', null, { wait: 350, move: 500 })
  await click('.ticket-actions .btn-primary', 'Ödeme al', { wait: 900 })
  await click('.modal button', 'Kart', { wait: 800, move: 600 }).catch(() => {})
}
async function dayEnd() {
  await esc(); await esc()
  await click('.tabs button', 'Gün sonu', { wait: 800 })
  await click('.day-layout .row button', '‹', { wait: 900, move: 600 })
  await scrollTo('h3', 'Ödeme alınanlar'); await sleep(600)
}
async function staffPerf() {
  await nav('#/personel'); await sleep(200)
  await scrollTo('h3', 'Kim ne kadar yaptı'); await sleep(300)
  await click('.staff-filters .seg button', 'Bu ay', { wait: 900 })
}
async function stockImport() {
  await nav('#/stok'); await sleep(300)
  await click('.page-head button', "Excel'den aktar", { wait: 700 })
  const input = await page.$('.modal input[type=file]')
  await input.uploadFile(join(OUT, 'urun-listesi.csv')); await sleep(900)
  await hover('.modal-foot button', 'aktar', 700)
}
async function messages() {
  await esc()
  await nav('#/mesajlar'); await sleep(300)
  await click('button', 'Tümüne WhatsApp', { wait: 1300 })
  await hover('.modal button', "WhatsApp'ta aç", 700)
}
async function reports() {
  await esc()
  await nav('#/raporlar'); await sleep(300)
  await click('.rp-filters .seg button', 'Bu ay', { wait: 1200 })
  await ev(() => scrollBy({ top: 380, behavior: 'smooth' })); await sleep(900)
}
async function phoneCard() {
  await card({ html: `<div class="left"><div class="k">Her cihazda</div><h1>Resepsiyonda,<br>tablette, cepte.</h1><div class="s">Çok şube · çok personel · tek panel</div></div><div class="phone"><iframe src="${BASE}#/takvim"></iframe></div>` })
}

// ---------- Hazırlık ----------
function demoCsv() {
  writeFileSync(join(OUT, 'urun-listesi.csv'), '﻿Ürün Adı;Marka;Kategori;Alış Fiyatı;Satış Fiyatı;KDV;Stok\n' +
    'Argan Yağı Serum 100 ml;Moroccanoil;Bakım;420,00;690,00;20;8\nKeratin Şampuan 500 ml;Kerastase;Şampuan;510,00;890,00;20;6\nIsı Koruyucu Sprey;Tigi;Şekillendirici;180,00;320,00;20;12\nOksidan %6 1000 ml;Wella;Boya;150,00;;20;10\nMor Şampuan 300 ml;Fanola;Şampuan;260,00;470,00;20;5\n')
}

async function prepare() {
  await page.goto(BASE + '#/giris', { waitUntil: 'networkidle0' })
  await ev(() => { localStorage.clear(); localStorage.setItem('makas:session', JSON.stringify({ userId: 'u_t_lara_owner', branchId: null, theme: 'light' })) })
  await page.goto('about:blank'); await page.goto(BASE + '#/takvim', { waitUntil: 'networkidle0' })
  await ev(() => {
    const d = JSON.parse(localStorage.getItem('makas:v1'))
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
    const t = d.tenants.find((x) => x.id === 't_lara'); t.license = { ...t.license, start: today, days: 365 }
    // yarın salon kapalıysa hatırlatma sahnesi için birkaç randevuyu yarına taşı
    {
      d.appointments.filter((a) => a.tenantId === 't_lara' && a.customerId && a.status === 'confirmed' && a.date > tomorrow).slice(0, 5)
        .forEach((a, i) => { const dur = a.end - a.start; a.status = 'confirmed'; a.date = tomorrow; a.start = 600 + i * 75; a.end = a.start + dur; d.customers.find((c) => c.id === a.customerId).consentSms = true })
    }
    localStorage.setItem('makas:v1', JSON.stringify(d))
  })
  await page.goto('about:blank'); await page.goto(BASE + '#/takvim', { waitUntil: 'networkidle0' })
  await sleep(800)
  await ev(OVERLAY)
  await ev(() => { const g = document.querySelector('.tg-scroll'); if (g) g.scrollTop = 0 })
}

// ---------- Ana akış ----------
demoCsv()
console.log('Seslendirme üretiliyor…')
const durs = SEGMENTS.map((s, i) => tts(s.say, join(OUT, `seg${i}.aiff`)))
console.log('Toplam ses:', durs.reduce((a, b) => a + b, 0).toFixed(1), 'sn')

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: [`--window-size=${W},${H}`, '--hide-scrollbars', '--lang=tr-TR'],
})
page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
await page.evaluateOnNewDocument(() => { window.open = () => null })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await prepare()
await card({ kicker: 'Kuaför · Berber · Güzellik salonu', title: 'Salonunuz hâlâ<br>defterle mi yönetiliyor?' })
await sleep(400)

const rec = await page.screencast({ path: join(OUT, 'screen.webm'), ffmpegPath: FF })
const t0 = Date.now()
await sleep(600) // açılış nefesi
const starts = []
for (const [i, s] of SEGMENTS.entries()) {
  const start = (Date.now() - t0) / 1000
  starts.push(start)
  await caption(i <= 1 || i >= SEGMENTS.length - 2 ? '' : s.say)
  try { await s.act() } catch (e) { console.log(`  sahne ${i} uyarı:`, e.message) }
  const left = start + durs[i] + 0.55 - (Date.now() - t0) / 1000
  if (left > 0) await sleep(left * 1000)
  else console.log(`  sahne ${i} sesten ${(-left).toFixed(1)} sn uzun sürdü`)
}
await caption('')
await sleep(2200)
const total = (Date.now() - t0) / 1000
await rec.stop()
await browser.close()

// ---------- Birleştirme ----------
console.log('Ses ve görüntü birleştiriliyor…')
const inputs = SEGMENTS.flatMap((_, i) => ['-i', join(OUT, `seg${i}.aiff`)])
const delays = SEGMENTS.map((_, i) => `[${i + 1}:a]adelay=${Math.round(starts[i] * 1000)}|${Math.round(starts[i] * 1000)},aresample=48000[a${i}]`).join(';')
const mix = SEGMENTS.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${SEGMENTS.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo,apad[aout]`
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', join(OUT, 'screen.webm'), ...inputs,
  '-filter_complex', `${delays};${mix}`, '-map', '0:v', '-map', '[aout]', '-t', total.toFixed(2),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
  join(OUT, 'randevuhazir-tanitim.mp4')], { stdio: 'inherit' })
console.log('Hazır:', join(OUT, 'randevuhazir-tanitim.mp4'), `(${total.toFixed(1)} sn)`)
