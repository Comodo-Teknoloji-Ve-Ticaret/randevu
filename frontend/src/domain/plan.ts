/** Tek paket: tüm özellikler dahil, sabit aylık fiyat (kuruş). */
export const PLAN = { name: 'Tam Paket', monthly: 200000 } as const

/** Lisans süresinin tutarı: gün → ay (365 gün = 12 ay); 14 günlük deneme ücretsiz. */
export const licenseFee = (days: number) => Math.round((days * 12) / 365) * PLAN.monthly
