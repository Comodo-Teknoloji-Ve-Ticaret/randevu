import { describe, expect, it } from 'vitest'
import { marketingConsentText, privacyNotice } from './legal'

const salon = { name: 'Studio Lara', address: 'Lara Cad. No:1, Muratpaşa/Antalya', phone: '2421112233' }

describe('privacyNotice (KVKK m.10 aydınlatma)', () => {
  const text = privacyNotice(salon).map((s) => `${s.title}\n${s.body}`).join('\n')
  it('names the salon as data controller with its contact details', () => {
    expect(text).toContain('Studio Lara')
    expect(text).toContain('Lara Cad. No:1')
    expect(text).toContain('0242 111 22 33')
  })
  it('covers every item KVKK article 10 requires', () => {
    for (const heading of ['Veri sorumlusu', 'Hangi verileri', 'Hangi amaçlarla', 'Hukuki sebep', 'Kimlere aktarılır', 'Nasıl toplanır', 'Haklarınız']) {
      expect(text).toContain(heading)
    }
    expect(text).toContain('11. madde')
  })
  it('does not make the appointment conditional on consent', () => {
    expect(text).toContain('sözleşmenin kurulması veya ifası')
  })
})

describe('marketingConsentText (açık rıza)', () => {
  it('is specific, optional and revocable', () => {
    const t = marketingConsentText(salon)
    expect(t).toContain('Studio Lara')
    expect(t).toContain('isteğe bağlıdır')
    expect(t).toContain('geri alabilirsiniz')
  })
})
