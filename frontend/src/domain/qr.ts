/**
 * Bağımlılıksız QR kod üreticisi (ISO/IEC 18004): bayt modu, hata düzeltme seviyesi M, sürüm 1–10
 * (213 bayta kadar — salon randevu linkleri için yeterli). Matris: true = koyu modül, [satır][sütun].
 */

/** Sürüm → [blok başına hata düzeltme kod sözcüğü, [blok sayısı, blok veri kod sözcüğü][]] (seviye M). */
const BLOCKS: Record<number, [number, [number, number][]]> = {
  1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
  6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]],
}
const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}
const EC_M_FORMAT_BITS = 0 // L=1, M=0, Q=3, H=2

const gfMul = (x: number, y: number) => {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

/** Reed–Solomon hata düzeltme kod sözcükleri (üreteç kökleri α^0…α^(n-1)). */
export function rsRemainder(data: number[], n: number): number[] {
  const divisor = new Array<number>(n).fill(0)
  divisor[n - 1] = 1
  let root = 1
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      divisor[j] = gfMul(divisor[j], root)
      if (j + 1 < n) divisor[j] ^= divisor[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  const result = new Array<number>(n).fill(0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    for (let i = 0; i < n; i++) result[i] ^= gfMul(divisor[i], factor)
  }
  return result
}

const dataCapacity = (v: number) => BLOCKS[v][1].reduce((s, [count, size]) => s + count * size, 0)

function encodeData(bytes: Uint8Array): { version: number; codewords: number[] } {
  const version = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((v) => 4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCapacity(v) * 8)
  if (!version) throw new Error('Metin QR kod için çok uzun (en fazla 213 bayt).')
  const bits: number[] = []
  const put = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  put(0b0100, 4) // bayt modu
  put(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const capBits = dataCapacity(version) * 8
  put(0, Math.min(4, capBits - bits.length)) // sonlandırıcı
  while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; data.length < dataCapacity(version); pad ^= 0xec ^ 0x11) data.push(pad)

  // Bloklara böl, hata düzeltme ekle, sütun sütun harmanla
  const [ecLen, groups] = BLOCKS[version]
  const blocks: { d: number[]; e: number[] }[] = []
  let k = 0
  for (const [count, size] of groups) for (let i = 0; i < count; i++) {
    const d = data.slice(k, k + size)
    k += size
    blocks.push({ d, e: rsRemainder(d, ecLen) })
  }
  const out: number[] = []
  const maxD = Math.max(...blocks.map((b) => b.d.length))
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i])
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i])
  return { version, codewords: out }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

function build(version: number, codewords: number[], mask: number): boolean[][] {
  const n = version * 4 + 17
  const m = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  const fn = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  const set = (r: number, c: number, dark: boolean) => { m[r][c] = dark; fn[r][c] = true }

  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) } // zamanlama
  for (const [cr, cc] of [[3, 3], [3, n - 4], [n - 4, 3]]) // konum kareleri + ayırıcılar
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const r = cr + dy, c = cc + dx
      if (r < 0 || c < 0 || r >= n || c >= n) continue
      const d = Math.max(Math.abs(dy), Math.abs(dx))
      set(r, c, d !== 2 && d !== 4)
    }
  const al = ALIGN[version]
  al.forEach((r, i) => al.forEach((c, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(r + dy, c + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1)
  }))

  // Biçim bilgisi (BCH 15,5) — iki kopya
  const fmtData = (EC_M_FORMAT_BITS << 3) | mask
  let rem = fmtData
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const fmt = ((fmtData << 10) | rem) ^ 0x5412
  const bit = (x: number, i: number) => ((x >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(i, 8, bit(fmt, i))
  set(7, 8, bit(fmt, 6)); set(8, 8, bit(fmt, 7)); set(8, 7, bit(fmt, 8))
  for (let i = 9; i < 15; i++) set(8, 14 - i, bit(fmt, i))
  for (let i = 0; i < 8; i++) set(8, n - 1 - i, bit(fmt, i))
  for (let i = 8; i < 15; i++) set(n - 15 + i, 8, bit(fmt, i))
  set(n - 8, 8, true) // karanlık modül

  if (version >= 7) { // sürüm bilgisi (BCH 18,6)
    let vr = version
    for (let i = 0; i < 12; i++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1f25)
    const vb = (version << 12) | vr
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3), b = Math.floor(i / 3)
      set(b, a, bit(vb, i)); set(a, b, bit(vb, i))
    }
  }

  // Veri: sağ alttan zikzak, 6. sütun atlanır
  let i = 0
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const c = right - j
      const upward = ((right + 1) & 2) === 0
      const r = upward ? n - 1 - vert : vert
      if (fn[r][c]) continue
      if (i < codewords.length * 8) { m[r][c] = bit(codewords[i >>> 3], 7 - (i & 7)); i++ }
      if (MASKS[mask](r, c)) m[r][c] = !m[r][c]
    }
  }
  return m
}

/** Okunabilirlik cezası (ISO 18004 §7.8.3): uzun dizi, 2×2 blok, konum karesine benzeyen desen, koyu oranı. */
function penalty(m: boolean[][]): number {
  const n = m.length
  let p = 0
  const lines = [...m, ...m[0].map((_, c) => m.map((row) => row[c]))]
  for (const line of lines) {
    let run = 1
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++
      else { if (run >= 5) p += run - 2; run = 1 }
    }
    const s = line.map((d) => (d ? '1' : '0')).join('')
    for (const pat of ['10111010000', '00001011101']) for (let k = s.indexOf(pat); k >= 0; k = s.indexOf(pat, k + 1)) p += 40
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = m[r][c]
    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3
  }
  const dark = m.reduce((s, row) => s + row.filter(Boolean).length, 0)
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10
  return p
}

export function qrMatrix(text: string): boolean[][] {
  const { version, codewords } = encodeData(new TextEncoder().encode(text))
  let best: boolean[][] | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const m = build(version, codewords, mask)
    const s = penalty(m)
    if (s < bestScore) { best = m; bestScore = s }
  }
  return best!
}

/** Ölçeklenebilir SVG (4 modül sessiz alanlı); yazdırma ve PNG'ye çevirme için. */
export function qrSvg(text: string, opts: { dark?: string; light?: string } = {}): string {
  const m = qrMatrix(text)
  const size = m.length + 8
  let d = ''
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + 4} ${r + 4}h1v1h-1z` }))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${opts.light ?? '#fff'}"/><path d="${d}" fill="${opts.dark ?? '#000'}"/></svg>`
}
