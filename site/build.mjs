// Tanıtım sitesini üretir: site.config.json'daki ad, WhatsApp, fiyat… şablona yerleşir → dist/
// Kullanım: node site/build.mjs   (bağımlılık yok)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8'))
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const digits = String(cfg.whatsapp).replace(/\D/g, '')
if (!/^90\d{10}$/.test(digits)) console.warn(`⚠️  WhatsApp numarası eksik ya da hatalı ("${cfg.whatsapp}"). site.config.json'a 90 ile başlayan 12 haneli numarayı yazın, ör. 905321234567.`)
const message = cfg.whatsappMessage.replaceAll('{name}', cfg.name)
const wa = `https://wa.me/${digits || '90XXXXXXXXXX'}?text=${encodeURIComponent(message)}`

const mailAscii = cfg.email ? cfg.email.replace(/@(.+)$/, (_, d) => '@' + new URL(`https://${d}`).host) : ''
const mailHref = mailAscii ? `mailto:${mailAscii}?subject=${encodeURIComponent(cfg.name + ' hakkında bilgi')}` : ''
const contact = [
  cfg.phone && `<a href="tel:${esc(cfg.phone.replace(/\s/g, ''))}">${esc(cfg.phone)}</a>`,
  cfg.email && `<a href="${esc(mailHref)}">${esc(cfg.email)}</a>`,
  `<a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>`,
].filter(Boolean).join(' · ')

// Google Tag Manager (site.config.json → gtmId). Boşsa hiçbir izleme kodu eklenmez.
const gtm = cfg.gtmId ?? ''
if (gtm && !/^GTM-[A-Z0-9]+$/.test(gtm)) throw new Error(`gtmId geçersiz: ${gtm}`)
const gtmHead = gtm ? `<!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');</script>
  <!-- /Google Tag Manager -->` : ''
const gtmBody = gtm ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtm}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>` : ''

const values = {
  gtmHead,
  gtmBody,
  name: esc(cfg.name),
  domain: esc(cfg.domain),
  domainUrl: esc(new URL(`https://${cfg.domain}`).host), // xn-- biçimi (önizleme botları/arama motorları için)
  company: esc(cfg.company),
  priceMonthly: esc(cfg.priceMonthly),
  priceNote: esc(cfg.priceNote),
  year: String(new Date().getFullYear()),
  wa: esc(wa),
  contactLine: contact,
  mailHref: esc(mailHref),
  email: esc(cfg.email),
}

let html = readFileSync(join(root, 'src/index.html'), 'utf8')
html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => {
  if (!(k in values)) throw new Error(`Şablonda bilinmeyen alan: ${m}`)
  return values[k]
})

const out = join(root, 'dist')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'index.html'), html)
cpSync(join(root, 'assets'), join(out, 'assets'), { recursive: true })
writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: https://${values.domainUrl}/sitemap.xml\n`)
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${values.domainUrl}/</loc></url></urlset>\n`)
console.log(`Site hazır → ${out}`)
