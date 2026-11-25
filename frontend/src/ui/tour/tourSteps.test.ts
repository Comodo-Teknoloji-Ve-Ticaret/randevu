import { describe, expect, it } from 'vitest'
import { buildTourSteps } from './tourSteps'

const SALON_NAV = ['/takvim', '/musteriler', '/kasa', '/hizmetler', '/personel', '/stok', '/paketler', '/mesajlar', '/raporlar', '/ayarlar']
const MOBILE_NAV = ['/takvim', '/musteriler', '/kasa', '/raporlar']

describe('tanıtım turu adımları', () => {
  it('salon sahibine her menü için bir adım, başta karşılama, sonda bitiş gösterir', () => {
    const s = buildTourSteps({ role: 'owner', name: 'Zeynep', nav: SALON_NAV, mobileNav: MOBILE_NAV, hasBranches: true, mobile: false })
    expect(s[0].id).toBe('welcome')
    expect(s[0].target).toBeUndefined()
    expect(s[0].title).toContain('Zeynep')
    expect(s.at(-1)!.id).toBe('done')
    expect(s.at(-1)!.target).toBeUndefined()
    expect(s.map((x) => x.id)).toEqual(['welcome', ...SALON_NAV, 'branch', 'account', 'done'])
    expect(s.find((x) => x.id === '/takvim')!.target).toBe('.sidebar [data-tour="/takvim"]')
    expect(s.every((x) => x.title && x.text)).toBe(true)
  })

  it('yalnız görebildiği menüleri anlatır; tek şubede şube adımı yoktur', () => {
    const s = buildTourSteps({ role: 'staff', name: 'Ayşe', nav: ['/takvim', '/primlerim'], mobileNav: ['/takvim'], hasBranches: false, mobile: false })
    expect(s.map((x) => x.id)).toEqual(['welcome', '/takvim', '/primlerim', 'account', 'done'])
  })

  it('Comodo yöneticisine işletme yönetimini anlatır', () => {
    const s = buildTourSteps({ role: 'platform', name: 'Comodo', nav: ['/platform'], mobileNav: ['/platform'], hasBranches: false, mobile: false })
    expect(s.map((x) => x.id)).toEqual(['welcome', '/platform', 'account', 'done'])
    expect(s[1].text).toMatch(/Yeni işletme/)
  })

  it('telefonda alt menüde olmayan sayfaları "Daha fazla" üzerinden gösterir', () => {
    const s = buildTourSteps({ role: 'owner', name: 'Z', nav: SALON_NAV, mobileNav: MOBILE_NAV, hasBranches: false, mobile: true })
    expect(s.find((x) => x.id === '/takvim')!.target).toBe('.bottom-nav [data-tour="/takvim"]')
    const stock = s.find((x) => x.id === '/stok')!
    expect(stock.target).toBe('.bottom-nav [data-tour="/daha"]')
    expect(stock.text).toMatch(/Daha fazla/)
    expect(s.find((x) => x.id === 'account')!.target).toBe('.topbar-user .user-btn')
  })
})
