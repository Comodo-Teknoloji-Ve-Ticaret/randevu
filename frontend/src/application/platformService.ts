import { licenseStatus } from '../domain/license'
import { addDays, diffDays } from '../domain/time'
import type { BusinessType, CategoryKey, Tenant } from '../domain/types'
import { istanbulClock, type Clock } from './appointmentService'
import { isReservedSlug } from '../domain/links'
import { normalizePhone } from '../domain/phone'
import { DEFAULT_EXPENSE_CATS } from '../infrastructure/localStore'
import { TEMPLATES } from '../infrastructure/seed'
import { newId, type Store } from './db'

export function slugify(s: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u' }
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (c) => map[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const DEFAULT_HOURS = { 0: null, 1: { open: 540, close: 1200 }, 2: { open: 540, close: 1200 }, 3: { open: 540, close: 1200 }, 4: { open: 540, close: 1200 }, 5: { open: 540, close: 1200 }, 6: { open: 540, close: 1200 } }
const STARTER_CATS: Record<BusinessType, [string, CategoryKey][]> = {
  kuafor: [['Kesim', 'kesim'], ['Boya & Renk', 'boya'], ['Bakım', 'bakim'], ['Fön & Şekillendirme', 'fon']],
  berber: [['Kesim', 'kesim'], ['Sakal & Tıraş', 'sakal'], ['Bakım', 'bakim']],
  guzellik: [['Cilt Bakımı', 'bakim'], ['Lazer Epilasyon', 'fon'], ['Kaş & Kirpik', 'tirnak'], ['Makyaj', 'boya']],
  dis: [['Muayene', 'kesim'], ['Dolgu & Kanal', 'boya'], ['Temizlik & Beyazlatma', 'bakim'], ['Protez & İmplant', 'fon']],
  spa: [['Masaj', 'bakim'], ['Vücut Bakımı', 'fon'], ['Hamam & Kese', 'kesim']],
  tirnak: [['Manikür', 'tirnak'], ['Pedikür', 'bakim'], ['Protez Tırnak', 'boya']],
  diger: [['Hizmetler', 'diger']],
}

export interface NewSalon { name: string; slug: string; ownerName: string; branchName: string; plan?: Tenant['plan']; businessType?: BusinessType; licenseDays?: number }

export const newToken = () => Array.from({ length: 2 }, () => Math.random().toString(36).slice(2, 12).padEnd(10, '0')).join('')

/** Kiracıya erişim: askı veya kilitli lisans girişi ve online randevuyu kapatır. */
export function tenantAccess(t: Tenant, today: string): 'ok' | 'suspended' | 'license' {
  if (t.status === 'suspended') return 'suspended'
  return licenseStatus(t.license, today).state === 'locked' ? 'license' : 'ok'
}

/** Comodo platform yönetimi: salon (kiracı) oluşturma ve askıya alma. */
export function platformService(store: Store, clock: Clock = istanbulClock) {
  /** Başka salonda kullanılıyor ya da sitenin kendi yollarıyla çakışıyor (kısa link: alanadi/<ad>). */
  const slugTaken = (slug: string, exceptId?: string) => isReservedSlug(slug) || store.read().tenants.some((t) => t.slug === slug && t.id !== exceptId)

  function createSalon(input: NewSalon): { ok: true; tenant: Tenant } | { ok: false; error: 'slug_taken' | 'invalid' } {
    const slug = slugify(input.slug || input.name)
    if (!slug || !input.name.trim() || !input.ownerName.trim()) return { ok: false, error: 'invalid' }
    if (slugTaken(slug)) return { ok: false, error: 'slug_taken' }
    const db = store.read()
    const tid = newId('t_')
    const bid = newId('b_')
    const today = clock().date
    const type = input.businessType ?? 'kuafor'
    const tenant: Tenant = {
      id: tid, name: input.name.trim(), slug, logoColor: '#6c5ce7', plan: 'tam', status: 'active', createdAt: today,
      onlineBooking: { enabled: true, requireApproval: true, maxDaysAhead: 30, minLeadMinutes: 120 },
      businessType: type, license: { start: today, days: input.licenseDays ?? 30 }, invite: { token: newToken(), createdAt: today },
      accounts: [{ id: newId('acc_'), name: 'POS cihazı', kind: 'pos', active: true }, { id: newId('acc_'), name: 'Banka hesabı', kind: 'bank', active: true }],
      expenseCategories: [...DEFAULT_EXPENSE_CATS], brands: [], productCategories: [],
    }
    store.write({
      ...db,
      tenants: [...db.tenants, tenant],
      branches: [...db.branches, { id: bid, tenantId: tid, name: input.branchName.trim() || 'Merkez', address: '', phone: '', hours: DEFAULT_HOURS }],
      users: [...db.users,
        { id: newId('u_'), tenantId: tid, name: input.ownerName.trim(), role: 'owner', branchIds: [bid] },
        { id: newId('u_'), tenantId: tid, name: 'Resepsiyon', role: 'reception', branchIds: [bid] }],
      categories: [...db.categories, ...STARTER_CATS[type].map(([name, color], i) => ({ id: newId('c_'), tenantId: tid, name, color, order: i }))],
      templates: [...db.templates, ...TEMPLATES.map((t) => ({ ...t, id: newId('tp_'), tenantId: tid }))],
    })
    return { ok: true, tenant }
  }

  const patch = (tenantId: string, fn: (t: Tenant) => Tenant) => {
    const db = store.read()
    store.write({ ...db, tenants: db.tenants.map((t) => (t.id === tenantId ? fn(t) : t)) })
  }

  const setStatus = (tenantId: string, status: Tenant['status']) => patch(tenantId, (t) => ({ ...t, status }))

  /** Süresi geçmişse bugünden başlatır, değilse mevcut bitişe ekler. */
  function extendLicense(tenantId: string, days: number) {
    const today = clock().date
    patch(tenantId, (t) => {
      const end = addDays(t.license.start, t.license.days)
      return { ...t, license: end < today ? { start: today, days } : { ...t.license, days: t.license.days + days } }
    })
  }

  function newInvite(tenantId: string): string {
    const token = newToken()
    patch(tenantId, (t) => ({ ...t, invite: { token, createdAt: clock().date } }))
    return token
  }

  function inviteInfo(token: string) {
    const t = store.read().tenants.find((x) => x.invite?.token === token)
    return t ? { tenant: t, used: !!t.invite?.usedAt } : null
  }

  function acceptInvite(token: string, input: { name: string; phone: string }): { ok: true; userId: string } | { ok: false; error: 'invalid' | 'used' | 'invalid_input' } {
    const info = inviteInfo(token)
    if (!info) return { ok: false, error: 'invalid' }
    if (info.used) return { ok: false, error: 'used' }
    if (!input.name.trim() || !normalizePhone(input.phone)) return { ok: false, error: 'invalid_input' }
    const db = store.read()
    const owner = db.users.find((u) => u.tenantId === info.tenant.id && u.role === 'owner')
    if (!owner) return { ok: false, error: 'invalid' }
    store.write({
      ...db,
      users: db.users.map((u) => (u.id === owner.id ? { ...u, name: input.name.trim() } : u)),
      tenants: db.tenants.map((t) => (t.id === info.tenant.id ? { ...t, invite: { ...t.invite!, usedAt: clock().date } } : t)),
    })
    return { ok: true, userId: owner.id }
  }

  const daysSince = (d: string) => diffDays(clock().date, d)

  return { createSalon, setStatus, slugTaken, extendLicense, newInvite, inviteInfo, acceptInvite, daysSince }
}
