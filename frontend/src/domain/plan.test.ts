import { describe, expect, it } from 'vitest'
import { licenseFee, PLAN } from './plan'

describe('tek paket', () => {
  it('Tam Paket, aylık ₺2.000 (kuruş)', () => {
    expect(PLAN).toEqual({ name: 'Tam Paket', monthly: 200000 })
  })
  it('lisans uzatma tutarı ay sayısına göre', () => {
    expect(licenseFee(30)).toBe(200000)
    expect(licenseFee(90)).toBe(600000)
    expect(licenseFee(180)).toBe(1200000)
    expect(licenseFee(365)).toBe(2400000)
    expect(licenseFee(14)).toBe(0) // deneme
  })
})
