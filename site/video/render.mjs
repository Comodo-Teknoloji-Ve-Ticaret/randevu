// Tanıtım videosunu üretir → site/assets/video/tanitim.(mp4|webm) + tanitim-poster.webp
// Kullanım:  node site/video/render.mjs                 (video)
//            node site/video/render.mjs --stills 2,8,14  (kontrol için sabit kareler → site/video/stills/)
// Gerekenler: Google Chrome ve frontend/node_modules (puppeteer-core). ffmpeg gerekmez; kaydı Chrome yapar.
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const site = join(here, '..')
const require = createRequire(join(site, '..', 'frontend', 'package.json'))
const puppeteer = require('puppeteer-core')
const cfg = JSON.parse(readFileSync(join(site, 'site.config.json'), 'utf8'))
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.js': 'text/javascript' }
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  let body
  try { body = readFileSync(join(site, path)) } catch { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }); res.end(body)
}).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
const port = server.address().port

const qs = new URLSearchParams({ name: cfg.name, price: cfg.priceMonthly, domain: cfg.domain })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  page.on('pageerror', (e) => console.error('Sayfa hatası:', e.message))
  await page.goto(`http://127.0.0.1:${port}/video/director.html?${qs}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction('window.ready === true', { timeout: 15000 })

  const stillsArg = process.argv.indexOf('--stills')
  if (stillsArg > 0) {
    const out = join(here, 'stills'); mkdirSync(out, { recursive: true })
    for (const t of process.argv[stillsArg + 1].split(',').map(Number)) {
      await page.evaluate((t) => window.drawAt(t), t)
      await (await page.$('canvas')).screenshot({ path: join(out, `t${t}.png`) })
    }
    console.log(`Kareler → ${out}`)
  } else {
    const total = await page.evaluate(() => window.TOTAL)
    console.log(`Kodlanıyor (${total.toFixed(1)} sn, kare kare)…`)
    const { mimeType, base64 } = await page.evaluate(() => window.record())
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
    const out = join(site, 'assets', 'video'); mkdirSync(out, { recursive: true })
    for (const e of ['mp4', 'webm']) rmSync(join(out, `tanitim.${e}`), { force: true })
    const file = join(out, `tanitim.${ext}`)
    writeFileSync(file, Buffer.from(base64, 'base64'))
    await page.evaluate(() => window.drawAt(3.2))
    await (await page.$('canvas')).screenshot({ path: join(out, 'tanitim-poster.webp'), type: 'webp', quality: 82 })
    console.log(`Video → ${file} (${mimeType}, ${(Buffer.byteLength(base64, 'base64') / 1e6).toFixed(1)} MB)`)
  }
} finally {
  await browser.close()
  server.close()
}
