import type { Role, User } from '../domain/types'

export type Perm =
  | 'calendar' | 'calendar.all' | 'customers' | 'cash' | 'services' | 'staff' | 'stock'
  | 'packages' | 'messages' | 'reports' | 'settings' | 'platform' | 'commission.own'

const MATRIX: Record<Role, Perm[]> = {
  owner: ['calendar', 'calendar.all', 'customers', 'cash', 'services', 'staff', 'stock', 'packages', 'messages', 'reports', 'settings', 'commission.own'],
  reception: ['calendar', 'calendar.all', 'customers', 'cash', 'services', 'stock', 'packages', 'messages'],
  staff: ['calendar', 'customers', 'commission.own'],
  platform: ['platform'],
}

export const can = (role: Role, perm: Perm) => MATRIX[role].includes(perm)

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Salon Sahibi',
  reception: 'Resepsiyon',
  staff: 'Personel',
  platform: 'Comodo Yönetici',
}

/** Salon sahibinin kutucuklarla verebileceği yetkiler (sunucu: Permissions.SalonPerms). */
export const PERM_GROUPS: { title: string; items: { perm: Perm; label: string; hint: string }[] }[] = [
  { title: 'Randevu & müşteri', items: [
    { perm: 'calendar', label: 'Takvim', hint: 'Randevu verme, taşıma, durum değiştirme' },
    { perm: 'calendar.all', label: 'Tüm personelin takvimi', hint: 'Kapalıysa yalnız bağlı olduğu personelin takvimi' },
    { perm: 'customers', label: 'Müşteriler', hint: 'Müşteri kartı, notlar, boya kartı' },
    { perm: 'messages', label: 'Mesajlar', hint: 'WhatsApp hatırlatma ve şablonlar' },
  ] },
  { title: 'Kasa & satış', items: [
    { perm: 'cash', label: 'Kasa', hint: 'Adisyon, ödeme, veresiye, gider, gün sonu' },
    { perm: 'stock', label: 'Stok', hint: 'Ürünler, giriş/çıkış, sayım, Excel aktarma' },
    { perm: 'packages', label: 'Paketler', hint: 'Paket tanımları' },
  ] },
  { title: 'Yönetim', items: [
    { perm: 'services', label: 'Hizmetler & fiyatlar', hint: 'Hizmet, süre, fiyat, kategori' },
    { perm: 'staff', label: 'Personel & primler', hint: 'Personel kartları, çalışma saatleri, prim oranları' },
    { perm: 'reports', label: 'Raporlar', hint: 'Ciro, personel performansı, kâr' },
    { perm: 'settings', label: 'Ayarlar', hint: 'Salon bilgileri, şubeler, POS, online randevu (kullanıcı yönetimi hariç)' },
    { perm: 'commission.own', label: 'Kendi primini görme', hint: 'Primlerim sayfası' },
  ] },
]
const SALON_PERMS = new Set<string>(PERM_GROUPS.flatMap((g) => g.items.map((i) => i.perm)))

export const defaultPerms = (role: Role): Perm[] => [...MATRIX[role]]

/** Geçerli yetkiler: sahip/Comodo rol tablosundan (kısıtlanamaz), diğerleri özel liste ya da rol varsayılanı. */
export function effectivePerms(user: Pick<User, 'role' | 'perms'>): Perm[] {
  if (user.role === 'owner' || user.role === 'platform' || !user.perms) return defaultPerms(user.role)
  return user.perms.filter((p): p is Perm => SALON_PERMS.has(p))
}

export const canUser = (user: Pick<User, 'role' | 'perms'>, perm: Perm) => effectivePerms(user).includes(perm)

/** Kaydedilecek özel liste: rol varsayılanıyla aynıysa (ya da sahipse) tutulmaz. */
export function userPermsToSave(role: Role, perms: Perm[]): Perm[] | undefined {
  if (role === 'owner' || role === 'platform') return undefined
  const def = new Set(defaultPerms(role))
  const same = perms.length === def.size && perms.every((p) => def.has(p))
  return same ? undefined : PERM_GROUPS.flatMap((g) => g.items.map((i) => i.perm)).filter((p) => perms.includes(p))
}
