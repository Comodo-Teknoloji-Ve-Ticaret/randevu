import { Download, Printer } from 'lucide-react'
import { useMemo } from 'react'
import { qrSvg } from '../domain/qr'
import { Button, Modal, useToast } from './index'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Online randevu linkinin QR kodu: ekranda göster, PNG indir, A4 afiş yazdır. */
export function QrDialog({ url, salon, slug, onClose }: { url: string; salon: string; slug: string; onClose: () => void }) {
  const toast = useToast()
  const svg = useMemo(() => qrSvg(url), [url])

  const downloadPng = async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1200
    const g = canvas.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.drawImage(img, 0, 0, 1200, 1200)
    canvas.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `randevu-qr-${slug}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      toast('QR kod indirildi')
    }, 'image/png')
  }

  const print = () => {
    const w = window.open('', '_blank')
    if (!w) { toast('Yazdırma penceresi açılamadı; açılır pencere iznini kontrol edin.', 'error'); return }
    w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(salon)} · Online randevu</title>
<style>@page{size:A4;margin:18mm}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;color:#111;margin:0}
h1{font-size:34px;margin:24px 0 6px}p{font-size:20px;margin:0 0 28px;color:#444}.qr{width:120mm;height:120mm;margin:0 auto}.qr svg{width:100%;height:100%}
.url{font-size:16px;margin-top:20px;word-break:break-all;color:#333}.by{margin-top:40px;font-size:12px;color:#888}</style></head>
<body><h1>${esc(salon)}</h1><p>Online randevu için telefonunuzun kamerasıyla okutun</p><div class="qr">${svg}</div>
<div class="url">${esc(url)}</div><div class="by">RandevunHazır ile online randevu</div>
<script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
  }

  return (
    <Modal title="Online randevu QR kodu" onClose={onClose} footer={<>
      <Button icon={Printer} onClick={print}>Afiş yazdır</Button>
      <Button variant="primary" icon={Download} onClick={downloadPng}>PNG indir</Button>
    </>}>
      <div className="qr-box">
        {/* svg yalnız kendi ürettiğimiz kare yollarından oluşur (metin içermez) */}
        <div className="qr-img" role="img" aria-label={`Randevu linki QR kodu: ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
        <code className="t-small">{url}</code>
        <p className="t-small muted">Tezgâha, aynaya, kartvizite veya vitrine koyun. Müşteri telefonunun kamerasıyla okutunca randevu sayfanız açılır.</p>
      </div>
    </Modal>
  )
}
