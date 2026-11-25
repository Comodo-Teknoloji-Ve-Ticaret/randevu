// RandevunHazır — canlıya yayın (Plesk/IIS, FTP).
// Çalıştırma: Mac'te  ./deploy/yayinla.sh   ·   Windows'ta  .\deploy\yayinla.ps1
// Seçenekler:  --testsiz    testleri atla
//              --kuru       hiçbir şey yüklemeden neyin yükleneceğini göster
//              --hepsi      önbelleği yok say, her dosyayı yeniden yükle
//
// Ne yapar: testler → panel + tanıtım sitesi + backend derlenir → yalnız değişen dosyalar FTP ile yüklenir
// (backend değiştiyse önce bakım sayfası açılır) → eski dosyalar silinir → canlı adres kontrol edilir.
// Sunucudaki api/web.config (veritabanı şifresi vb.) hiçbir zaman değiştirilmez.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEPLOY = join(ROOT, 'deploy')
const OUT = join(ROOT, '.yayin')
const SETTINGS = join(DEPLOY, 'yayin.ayarlar.json')
const CACHE = join(DEPLOY, '.yayin-onbellek.json')
const args = new Set(process.argv.slice(2))
const DRY = args.has('--kuru')
const isWin = process.platform === 'win32'

const c = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
const step = (s) => console.log('\n' + c.b('▶ ' + s))
const die = (s) => { console.error('\n' + c.r('✖ ' + s)); process.exit(1) }

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: opts.quiet ? 'pipe' : 'inherit', shell: isWin, encoding: 'utf8', ...opts })
  if (r.status !== 0) {
    if (opts.quiet) console.error((r.stdout ?? '') + (r.stderr ?? ''))
    die(`${cmd} ${cmdArgs.join(' ')} başarısız oldu.`)
  }
  return r
}
const have = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: isWin }).status === 0

// ── Ayarlar ────────────────────────────────────────────────────────────────
if (!existsSync(SETTINGS)) {
  writeFileSync(SETTINGS, JSON.stringify({ ftpHost: '77.245.159.112', ftpUser: 'randevu', ftpPassword: 'FTP-SIFRESINI-YAZIN', siteUrl: 'https://xn--randevunhazr-c5b.com' }, null, 2) + '\n')
  die(`Ayar dosyası oluşturuldu: ${SETTINGS}\n  İçine FTP şifresini yazıp betiği tekrar çalıştırın. (Bu dosya GitHub'a gönderilmez.)`)
}
const cfg = JSON.parse(readFileSync(SETTINGS, 'utf8'))
if (!cfg.ftpPassword || cfg.ftpPassword.includes('SIFRE')) die(`FTP şifresi ${SETTINGS} dosyasında yazılı değil.`)
const SITE = cfg.siteUrl.replace(/\/$/, '')

for (const t of ['node', 'npm', 'dotnet', 'curl']) if (!have(t)) die(`"${t}" bulunamadı. Kurulu olmalı (node/npm: nodejs.org, dotnet: .NET 10 SDK).`)

// ── Testler ────────────────────────────────────────────────────────────────
const FRONT = join(ROOT, 'frontend')
if (!existsSync(join(FRONT, 'node_modules'))) { step('Ön yüz paketleri kuruluyor'); run('npm', ['ci'], { cwd: FRONT }) }
if (!args.has('--testsiz')) {
  step('Ön yüz testleri')
  run('npm', ['test', '--', '--reporter=dot'], { cwd: FRONT })
}

// ── Derleme ────────────────────────────────────────────────────────────────
step('Derleniyor: panel, tanıtım sitesi, backend')
rmSync(OUT, { recursive: true, force: true })
const siteOut = join(OUT, 'site'), apiOut = join(OUT, 'api')
run('npx', ['vite', 'build', '--outDir', join(siteOut, 'panel'), '--emptyOutDir'], { cwd: FRONT, quiet: true, env: { ...process.env, VITE_API_URL: SITE, VITE_DEMO: '' } })
run('node', [join(ROOT, 'site', 'build.mjs')], { cwd: join(ROOT, 'site'), quiet: true })
copyDir(join(ROOT, 'site', 'dist'), siteOut)
mkdirSync(join(siteOut, 'tanitim'), { recursive: true })
writeFileSync(join(siteOut, 'tanitim', 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=../"><a href="../">Ana sayfa</a>\n')
copyFileSync(join(DEPLOY, 'site.web.config'), join(siteOut, 'web.config'))
// Sunucunun uygulama havuzu 32-bit: win-x86. Git sürüm numarası gömülmez: backend kodu değişmediyse dosyalar aynı kalır,
// yayında API bakım moduna girmez.
run('dotnet', ['publish', join(ROOT, 'backend', 'src', 'ComodoRandevuHazir.WebApi'), '-c', 'Release', '-r', 'win-x86', '--self-contained', 'false', '-p:IncludeSourceRevisionInInformationalVersion=false', '-p:Deterministic=true', '-p:DebugType=none', '-p:EnableSourceLink=false', '-o', apiOut, '-v', 'q', '-nologo'], { quiet: true })
for (const f of ['web.config', 'appsettings.Development.json']) rmSync(join(apiOut, f), { force: true })
console.log(c.g('  derleme tamam'))

// ── Ne değişti? ──────────────────────────────────────────────────────────────
const files = new Map() // uzak yol → { local, hash }
for (const [dir, prefix] of [[siteOut, ''], [apiOut, 'api/']]) {
  for (const f of walk(dir)) {
    const rel = prefix + relative(dir, f).split(sep).join('/')
    files.set(rel, { local: f, hash: createHash('sha1').update(readFileSync(f)).digest('hex') })
  }
}
const cache = !args.has('--hepsi') && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
const changed = [...files].filter(([p, f]) => cache[p] !== f.hash).map(([p]) => p)
const stale = Object.keys(cache).filter((p) => !files.has(p))
const apiChanged = changed.some((p) => p.startsWith('api/')) || stale.some((p) => p.startsWith('api/'))
// Önce backend ve dosyalar, en son sayfaların giriş noktaları (index.html) — yarım yayında eski sayfa yeni dosyaları istemesin
changed.sort((a, b) => Number(a.endsWith('index.html')) - Number(b.endsWith('index.html')) || Number(!a.startsWith('api/')) - Number(!b.startsWith('api/')))

step(`Yüklenecek: ${changed.length} dosya, silinecek eski dosya: ${stale.length}` + (apiChanged ? ' (backend güncelleniyor)' : ''))
if (DRY) { for (const p of changed) console.log('  + ' + p); for (const p of stale) console.log('  - ' + p); process.exit(0) }
if (!changed.length && !stale.length) { console.log(c.g('  Her şey güncel, yüklenecek bir şey yok.')); await check(); process.exit(0) }

// ── Yükleme ──────────────────────────────────────────────────────────────────
const ftpBase = `ftp://${cfg.ftpHost}/`
const auth = ['--user', `${cfg.ftpUser}:${cfg.ftpPassword}`]
const enc = (p) => p.split('/').map(encodeURIComponent).join('/')
const ftp = (extra) => spawnSync('curl', ['-s', '-S', '--retry', '4', '--retry-delay', '3', '--retry-all-errors', '--connect-timeout', '20', '-m', '600', ...auth, ...extra], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NULL = isWin ? 'NUL' : '/dev/null'
const remoteHas = (dir, name) => (ftp(['--list-only', ftpBase + dir + '/']).stdout ?? '').split(/\r?\n/).includes(name)
const save = () => writeFileSync(CACHE, JSON.stringify(cache, null, 0))

const offline = join(OUT, 'app_offline.htm')
writeFileSync(offline, '<!doctype html><meta charset="utf-8"><title>Kısa bakım</title><p style="font-family:sans-serif">RandevunHazır güncelleniyor, lütfen bir dakika sonra tekrar deneyin.</p>')
if (apiChanged) {
  console.log(c.y('  backend bakım moduna alındı (app_offline.htm)'))
  if (ftp(['-T', offline, ftpBase + 'api/app_offline.htm']).status !== 0) die('Bakım sayfası yüklenemedi — FTP bilgilerini kontrol edin.')
}
let failed = changed
// Bağlantı anlık koparsa başarısız dosyalar birkaç tur daha denenir
for (let round = 1; round <= 4 && failed.length; round++) {
  if (round > 1) { console.log(c.y(`  ${failed.length} dosya yüklenemedi, ${round}. deneme (10 sn sonra)…`)); await sleep(10000) }
  const todo = failed; failed = []; let done = 0
  for (const p of todo) {
    const r = ftp(['--ftp-create-dirs', '-T', files.get(p).local, ftpBase + enc(p)])
    done++
    if (r.status === 0) { cache[p] = files.get(p).hash; if (done % 5 === 0) save() } else failed.push(p)
    process.stdout.write(`\r  ${done}/${todo.length} ${p.slice(0, 60).padEnd(60)}`)
  }
  process.stdout.write('\n')
}
for (const p of stale) {
  const r = ftp(['-o', NULL, '-Q', `DELE /${p}`, ftpBase])
  if (r.status === 0 || /550/.test(r.stderr)) delete cache[p]
}
save()
// Bakım sayfası her durumda kaldırılır (yükleme yarım kalsa bile API eski/yeni sürümle açılır) ve kaldırıldığı doğrulanır
if (apiChanged || remoteHas('api', 'app_offline.htm')) {
  let off = false
  for (let i = 0; i < 6 && !off; i++) {
    if (i) await sleep(5000)
    ftp(['-o', NULL, '-Q', 'DELE /api/app_offline.htm', ftpBase])
    off = !remoteHas('api', 'app_offline.htm')
  }
  console.log(off ? c.y('  bakım modu kapatıldı') : c.r('  UYARI: api/app_offline.htm silinemedi — FTP ile elle silin, yoksa API kapalı kalır.'))
}
if (failed.length) die(`${failed.length} dosya yüklenemedi:\n  ${failed.join('\n  ')}\nBetiği tekrar çalıştırın; yalnız eksikler yüklenir.`)
console.log(c.g(`  ${changed.length} dosya yüklendi`))
await check()

// ── Kontrol ──────────────────────────────────────────────────────────────────
async function check() {
  step('Canlı kontrol')
  const probe = async (url, test) => {
    for (let i = 0; i < 6; i++) {
      try { const res = await fetch(url, { signal: AbortSignal.timeout(30000) }); const body = await res.text(); if (res.ok && test(body)) return true } catch { /* tekrar dene */ }
      await new Promise((r) => setTimeout(r, 5000))
    }
    return false
  }
  const api = await probe(`${SITE}/api/health`, (b) => b.includes('ok'))
  const site = await probe(`${SITE}/`, (b) => b.includes('RandevunHazır'))
  const panel = await probe(`${SITE}/panel/`, (b) => b.includes('<div id="root">'))
  console.log(`  API: ${api ? c.g('çalışıyor') : c.r('YANIT YOK')}   Site: ${site ? c.g('açık') : c.r('AÇILMADI')}   Panel: ${panel ? c.g('açık') : c.r('AÇILMADI')}`)
  if (!(api && site && panel)) die('Canlı kontrol başarısız. Sorun giderme: docs/deploy.md → "Plesk / IIS".')
  console.log('\n' + c.g(c.b(`✔ Yayında: ${SITE}  (panel: ${SITE}/panel/)`)))
}

function walk(d) { return readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] }) }
function copyDir(from, to) { for (const f of walk(from)) { const t = join(to, relative(from, f)); mkdirSync(dirname(t), { recursive: true }); copyFileSync(f, t) } }
