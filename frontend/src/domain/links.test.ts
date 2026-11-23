import { describe, expect, it } from 'vitest'
import { bookingLink, inviteMessage, isReservedSlug, shortLinkRedirect } from './links'

describe('randevu linki', () => {
  it('sunucuda kısa: alanadi/salon', () => {
    expect(bookingLink('studio-lara', { origin: 'https://randevuhazir.com.tr', pathname: '/' }, true)).toBe('https://randevuhazir.com.tr/studio-lara')
  })
  it('demo sitede (GitHub Pages) bugünkü biçim', () => {
    expect(bookingLink('studio-lara', { origin: 'https://comodo.github.io', pathname: '/randevu/' }, false)).toBe('https://comodo.github.io/randevu/#/r/studio-lara')
  })
})

describe('kısa linkten yönlendirme', () => {
  it('/salon → randevu sayfası', () => {
    expect(shortLinkRedirect('/studio-lara', '')).toBe('/#/r/studio-lara')
    expect(shortLinkRedirect('/studio-lara/', '')).toBe('/#/r/studio-lara')
  })
  it('kök, uygulama içi adresler, dosyalar ve ayrılmış adlar yönlendirilmez', () => {
    expect(shortLinkRedirect('/', '')).toBeNull()
    expect(shortLinkRedirect('/studio-lara', '#/takvim')).toBeNull()
    expect(shortLinkRedirect('/favicon.svg', '')).toBeNull()
    expect(shortLinkRedirect('/assets', '')).toBeNull()
    expect(shortLinkRedirect('/a/b', '')).toBeNull()
  })
  it('ayrılmış adlar salona verilemez', () => {
    expect(isReservedSlug('api')).toBe(true)
    expect(isReservedSlug('studio-lara')).toBe(false)
  })
})

describe('davet mesajı', () => {
  it('panel davet linki ve müşterilere verilecek randevu linki birlikte', () => {
    const m = inviteMessage({ ownerName: 'Zeynep Arıkan', salon: 'Studio Lara', inviteUrl: 'https://x/#/davet/abc', bookingUrl: 'https://x/studio-lara' })
    expect(m).toContain('Merhaba Zeynep')
    expect(m).toContain('https://x/#/davet/abc')
    expect(m).toContain('https://x/studio-lara')
    expect(m.indexOf('#/davet/abc')).toBeLessThan(m.indexOf('x/studio-lara'))
  })
})
