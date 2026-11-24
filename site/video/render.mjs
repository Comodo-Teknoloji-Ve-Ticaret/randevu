// Tanıtım videosunu üretir → site/assets/video/tanitim.mp4 (+ tanitim-poster.webp)
//   node site/video/render.mjs                  sesli video (seslendirme: narration.json, macOS 'say')
//   node site/video/render.mjs --silent         sessiz video
//   node site/video/render.mjs --stills 3,10,31 kontrol için sabit kareler → site/video/stills/
// Gerekenler: macOS (say, afconvert, swift), Google Chrome, frontend/node_modules (puppeteer-core). ffmpeg gerekmez.
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const site = join(here, '..')
const build = join(here, '.build')
const require = createRequire(join(site, '..', 'frontend', 'package.json'))
const puppeteer = require('puppeteer-core')
const cfg = JSON.parse(readFileSync(join(site, 'site.config.json'), 'utf8'))
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const RATE = 44100
const args = process.argv.slice(2)
const stillsArg = args.indexOf('--stills')
const silent = args.includes('--silent')

/* ——— Seslendirme ——— */
function readWav(file) {
  const b = readFileSync(file)
  let o = 12, fmt = null
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4)
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }
    if (id === 'data') {
      if (!fmt || fmt.ch !== 1 || fmt.rate !== RATE || fmt.bits !== 16) throw new Error(`Beklenmeyen WAV biçimi: ${JSON.stringify(fmt)}`)
      const n = size / 2, out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(o + 8 + i * 2) / 32768
      return out
    }
    o += 8 + size + (size & 1)
  }
  throw new Error('WAV veri bölümü yok: ' + file)
}

/** Konuşmanın başındaki/sonundaki sessizliği kırp (sahneye hizalamak için). */
function trim(s, thr = 0.003) {
  let a = 0, z = s.length - 1
  while (a < z && Math.abs(s[a]) < thr) a++
  while (z > a && Math.abs(s[z]) < thr) z--
  return s.subarray(Math.max(0, a - 441), Math.min(s.length, z + 441)) // 10 ms pay
}

function synthesize() {
  const n = JSON.parse(readFileSync(join(here, 'narration.json'), 'utf8'))
  return n.segments.map((text, i) => {
    const file = join(build, `seg${i}.wav`)
    execFileSync('say', ['-v', n.voice, '--file-format=WAVE', '--data-format=LEI16@44100', '-o', file, `[[rate ${n.rate}]] ${text}`])
    return trim(readWav(file))
  })
}

function writeWav(file, samples) {
  const b = Buffer.alloc(44 + samples.length * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  writeFileSync(file, b)
}

/** Sahne süreleri: konuşma + nefes payı; varsayılandan kısa olmaz. */
function timeline(segs, defaults) {
  const LEAD = 0.55, TAIL = 0.65
  const durs = segs.map((s, i) => {
    const speech = s.length / RATE
    const tail = i === segs.length - 1 ? 1.8 : TAIL // kapanışta son söz sonrası kısa bekleme
    return +Math.max(defaults[i], LEAD + speech + tail).toFixed(3)
  })
  const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0))
  return { durs, starts, lead: LEAD, total: durs.reduce((a, b) => a + b, 0) }
}

function mix(segs, tl) {
  const out = new Float32Array(Math.ceil(tl.total * RATE))
  const fade = Math.round(RATE * 0.012)
  segs.forEach((s, i) => {
    const at = Math.round((tl.starts[i] + tl.lead) * RATE)
    for (let k = 0; k < s.length && at + k < out.length; k++) {
      const g = Math.min(1, k / fade, (s.length - 1 - k) / fade) // tık sesi olmasın diye yumuşak giriş/çıkış
      out[at + k] += s[k] * g
    }
  })
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  const gain = peak > 0 ? Math.min(3, 0.89 / peak) : 1 // tepe ≈ -1 dBFS
  for (let i = 0; i < out.length; i++) out[i] *= gain
  return out
}

/* ——— Görüntü ——— */
const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.js': 'text/javascript' }
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  let body
  try { body = readFileSync(join(site, path)) } catch { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }); res.end(body)
}).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
const port = server.address().port

rmSync(build, { recursive: true, force: true }); mkdirSync(build, { recursive: true })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  page.on('pageerror', (e) => console.error('Sayfa hatası:', e.message))
  const open = async (durs) => {
    const qs = new URLSearchParams({ name: cfg.name, price: cfg.priceMonthly, domain: cfg.domain, ...(durs ? { durs: durs.join(',') } : {}) })
    await page.goto(`http://127.0.0.1:${port}/video/director.html?${qs}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction('window.ready === true', { timeout: 15000 })
  }
  await open()
  const defaults = await page.evaluate(() => window.DEFAULT_DURS)

  let segs = null, tl = null
  if (!silent) {
    segs = synthesize()
    tl = timeline(segs, defaults)
    writeFileSync(join(build, 'timeline.json'), JSON.stringify({ ...tl, speech: segs.map((s) => +(s.length / RATE).toFixed(2)) }, null, 1))
    console.log('Sahne süreleri:', tl.durs.map((d) => d.toFixed(1)).join(' · '), `→ ${tl.total.toFixed(1)} sn`)
    await open(tl.durs)
  }

  if (stillsArg >= 0) {
    const out = join(here, 'stills'); mkdirSync(out, { recursive: true })
    for (const t of args[stillsArg + 1].split(',').map(Number)) {
      await page.evaluate((t) => window.drawAt(t), t)
      await (await page.$('canvas')).screenshot({ path: join(out, `t${t}.png`) })
    }
    console.log(`Kareler → ${out}`)
  } else {
    const total = await page.evaluate(() => window.TOTAL)
    console.log(`Görüntü kodlanıyor (${total.toFixed(1)} sn, kare kare)…`)
    const { base64 } = await page.evaluate(() => window.record())
    const outDir = join(site, 'assets', 'video'); mkdirSync(outDir, { recursive: true })
    const final = join(outDir, 'tanitim.mp4')
    const videoOnly = join(build, 'video.mp4')
    writeFileSync(videoOnly, Buffer.from(base64, 'base64'))
    if (silent) {
      writeFileSync(final, readFileSync(videoOnly))
    } else {
      console.log('Ses karıştırılıyor…')
      writeWav(join(build, 'mix.wav'), mix(segs, tl))
      execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', join(build, 'mix.wav'), join(build, 'mix.m4a')])
      execFileSync('swift', [join(here, 'mux.swift'), videoOnly, join(build, 'mix.m4a'), final], { stdio: ['ignore', 'pipe', 'inherit'] })
    }
    await page.evaluate(() => window.drawAt(3.2))
    await (await page.$('canvas')).screenshot({ path: join(outDir, 'tanitim-poster.webp'), type: 'webp', quality: 82 })
    console.log(`Video → ${final} (${(readFileSync(final).length / 1e6).toFixed(1)} MB, ${silent ? 'sessiz' : 'sesli'})`)
  }
} finally {
  await browser.close()
  server.close()
}
