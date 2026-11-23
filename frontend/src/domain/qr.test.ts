import { describe, expect, it } from 'vitest'
import { qrMatrix, qrSvg, rsRemainder } from './qr'

describe('Reed–Solomon (QR, GF(256) 0x11D)', () => {
  it('ISO 18004 ek I örneği: "01234567" 1-M veri kod sözcükleri → 10 hata düzeltme kod sözcüğü', () => {
    const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17]
    expect(rsRemainder(data, 10)).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85])
  })
})

describe('qrMatrix', () => {
  const finderAt = (m: boolean[][], r: number, c: number) => {
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
      const d = Math.max(Math.abs(dy - 3), Math.abs(dx - 3))
      if (m[r + dy][c + dx] !== (d !== 2)) return false
    }
    return true
  }

  it('kısa link sürüm 2-3, uzun link daha büyük sürüm seçer', () => {
    expect(qrMatrix('https://randevuhazir.com.tr/studio-lara').length).toBe(29) // sürüm 3
    expect(qrMatrix('x'.repeat(200)).length).toBe(57) // sürüm 10
    expect(() => qrMatrix('x'.repeat(300))).toThrow()
  })

  it('üç köşede konum kareleri ve zamanlama çizgileri', () => {
    const m = qrMatrix('https://comodo-teknoloji-ve-ticaret.github.io/randevu/#/r/studio-lara')
    const n = m.length
    expect(finderAt(m, 0, 0) && finderAt(m, 0, n - 7) && finderAt(m, n - 7, 0)).toBe(true)
    for (let i = 8; i < n - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0)
      expect(m[i][6]).toBe(i % 2 === 0)
    }
    expect(m[n - 8][8]).toBe(true) // karanlık modül
  })

  it('aynı girdi aynı kodu üretir; SVG çizer', () => {
    expect(qrMatrix('abc')).toEqual(qrMatrix('abc'))
    const svg = qrSvg('abc')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('viewBox="0 0 29 29"') // 21 + 2×4 sessiz alan
  })
})
