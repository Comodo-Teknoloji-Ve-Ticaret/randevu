/**
 * Kare kare H.264 kodlama (WebCodecs) + tek parçalı, "faststart" MP4 yazımı (moov önce).
 * Bağımlılık yok. Tek video izi, B-kare yok (kodlayıcıdan gelen zaman damgaları sıralı olmalı).
 */

const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'] // High / Main / Baseline, seviye 4.0 (1080p30)

export async function encodeMp4({ canvas, draw, seconds, fps = 30, bitrate = 1_600_000, keyEvery = 2 }) {
  const { width, height } = canvas
  let config
  for (const codec of CODECS) {
    const c = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' }
    if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break }
  }
  if (!config) throw new Error('Bu tarayıcı H.264 kodlayamıyor')

  const samples = []
  let description = null
  let lastTs = -1
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !description) description = new Uint8Array(meta.decoderConfig.description)
      if (chunk.timestamp <= lastTs) throw new Error('Sırasız kare (B-kare) desteklenmiyor')
      lastTs = chunk.timestamp
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data)
      samples.push({ data, key: chunk.type === 'key' })
    },
    error: (e) => { throw e },
  })
  encoder.configure(config)

  const frames = Math.round(seconds * fps)
  for (let i = 0; i < frames; i++) {
    draw(i / fps)
    // Tuvalin anlık kopyası: VideoFrame(canvas) doğrudan verilirse kodlayıcı tuvali geç okuyabiliyor
    // ve bir sonraki karenin yarım çizimini (yalnız arka plan) yakalıyor.
    const bitmap = await createImageBitmap(canvas)
    const frame = new VideoFrame(bitmap, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) })
    bitmap.close()
    encoder.encode(frame, { keyFrame: i % (fps * keyEvery) === 0 })
    frame.close()
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2))
  }
  await encoder.flush()
  encoder.close()
  if (!description) throw new Error('avcC (decoderConfig.description) gelmedi')
  if (samples.length !== frames) throw new Error(`Kare sayısı tutmuyor: ${samples.length}/${frames}`)
  return { bytes: mux({ samples, description, width, height, fps }), codec: config.codec, frames }
}

/* ——— MP4 kutuları ——— */
const enc = new TextEncoder()
function box(type, ...parts) {
  const body = parts.flat(Infinity)
  const size = 8 + body.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(size)
  new DataView(out.buffer).setUint32(0, size)
  out.set(enc.encode(type), 4)
  let o = 8
  for (const p of body) { out.set(p, o); o += p.length }
  return out
}
const u8 = (...v) => new Uint8Array(v)
const u16 = (v) => u8(v >>> 8 & 255, v & 255)
const u32 = (v) => u8(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255)
const zeros = (n) => new Uint8Array(n)
const full = (type, version, flags, ...parts) => box(type, u8(version, flags >>> 16 & 255, flags >>> 8 & 255, flags & 255), ...parts)
const MATRIX = [u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]

function mux({ samples, description, width, height, fps }) {
  const TS = fps * 1000 // medya zaman ölçeği; her kare 1000 birim
  const n = samples.length
  const durMs = Math.round((n / fps) * 1000)
  const ftyp = box('ftyp', enc.encode('isom'), u32(0x200), enc.encode('isomiso2avc1mp41'))
  const mdatSize = 8 + samples.reduce((s, x) => s + x.data.length, 0)

  const moov = (chunkOffset) => box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)),
    box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), zeros(4), u32(durMs), zeros(8), u16(0), u16(0), u16(0), zeros(2), MATRIX, u32(width << 16), u32(height << 16)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(n * 1000), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('VideoHandler\0')),
        box('minf',
          full('vmhd', 0, 1, zeros(8)),
          box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
          box('stbl',
            full('stsd', 0, 0, u32(1), box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), zeros(4), u16(1), zeros(32), u16(0x0018), u16(0xffff), box('avcC', description))),
            full('stts', 0, 0, u32(1), u32(n), u32(1000)),
            full('stss', 0, 0, u32(samples.filter((s) => s.key).length), samples.flatMap((s, i) => (s.key ? [u32(i + 1)] : []))),
            full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
            full('stsz', 0, 0, u32(0), u32(n), samples.map((s) => u32(s.data.length))),
            full('stco', 0, 0, u32(1), u32(chunkOffset)),
          ),
        ),
      ),
    ),
  )

  const moovSize = moov(0).length
  const offset = ftyp.length + moovSize + 8
  const parts = [ftyp, moov(offset)]
  const mdatHead = new Uint8Array(8); new DataView(mdatHead.buffer).setUint32(0, mdatSize); mdatHead.set(enc.encode('mdat'), 4)
  parts.push(mdatHead, ...samples.map((s) => s.data))
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
