/** Salon randevu linkleri ve davet mesajı. */

/** Kısa link alanadi/<ad> biçiminde olduğu için sitenin kendi yollarıyla çakışan adlar salona verilmez. */
const RESERVED = new Set(['api', 'panel', 'tanitim', 'assets', 'r', 'davet', 'giris', 'admin', 'www', 'static', 'index', 'favicon', 'robots', 'sitemap'])

export const isReservedSlug = (slug: string) => RESERVED.has(slug)

/**
 * Müşterilere verilecek randevu linki. Sunucuda kısa (randevuhazir.com.tr/studio-lara);
 * GitHub Pages demosunda sunucu yönlendirmesi olmadığı için uygulama içi biçim (…/#/r/studio-lara).
 */
export function bookingLink(slug: string, loc: { origin: string; pathname: string }, short: boolean, publicUrl?: string): string {
  return short ? `${base(loc, publicUrl)}/${slug}` : `${loc.origin}${loc.pathname}#/r/${slug}`
}

/** Salon sahibine gönderilen kurulum (davet) linki; panelin yolu (/panel/) korunur. */
export function inviteLink(token: string, loc: { origin: string; pathname: string }, publicUrl?: string): string {
  return `${base(loc, publicUrl)}${loc.pathname}#/davet/${token}`
}

/**
 * Paylaşılan linklerin alan adı. Asıl alan adında "ı" olduğu için WhatsApp/SMS'te xn--… biçiminde görünür;
 * VITE_PUBLIC_URL (ör. https://randevunhazir.com.tr) verilirse linkler onunla üretilir, o adres siteye yönlendirir.
 */
const base = (loc: { origin: string }, publicUrl?: string) => (publicUrl || loc.origin).replace(/\/$/, '')

/** alanadi/<ad> ile açılınca randevu sayfasına yönlendirilecek adres; değilse null. */
export function shortLinkRedirect(pathname: string, hash: string): string | null {
  if (hash && hash !== '#' && hash !== '#/') return null
  const m = /^\/([a-z0-9-]+)\/?$/.exec(pathname)
  return m && !isReservedSlug(m[1]) ? `/#/r/${m[1]}` : null
}

export function inviteMessage(p: { ownerName?: string; salon: string; inviteUrl: string; bookingUrl: string }): string {
  const hi = p.ownerName ? `Merhaba ${p.ownerName.split(' ')[0]},` : 'Merhaba,'
  return [
    `${hi} ${p.salon} için RandevunHazır salon paneliniz hazır.`,
    `1) Panelinize bu bağlantıdan girip e-posta ve şifrenizi belirleyin: ${p.inviteUrl}`,
    `2) Müşterilerinize vereceğiniz online randevu linkiniz: ${p.bookingUrl}`,
    'Bu linki Instagram profilinize, WhatsApp İşletme profilinize ve Google İşletme sayfanıza ekleyebilirsiniz. Hizmetlerinizi ve personelinizi ekledikten sonra randevu almaya başlar.',
  ].join('\n\n')
}
