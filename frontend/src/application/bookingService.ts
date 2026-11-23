import { findSlots } from '../domain/availability'
import { normalizePhone } from '../domain/phone'
import { diffDays } from '../domain/time'
import type { ID } from '../domain/types'
import { appointmentService, durationFor, istanbulClock, type Clock } from './appointmentService'
import type { Store } from './db'
import { tenantAccess } from './platformService'
import { createRepos } from './repos'

export type BookingError = 'slot_taken' | 'disabled' | 'invalid_phone' | 'invalid'
export interface BookingInput {
  branchId: ID
  serviceIds: ID[]
  staffId: ID | 'any'
  date: string
  start: number
  name: string
  phone: string
  note: string
  /** İsteğe bağlı açık rıza: kampanya/fırsat mesajları */
  marketingConsent?: boolean
}

/** Müşteri tarafı online randevu. Salonu slug ile bulur; yalnızca o salonun verisine erişir. */
export function bookingService(store: Store, slug: string, clock: Clock = istanbulClock) {
  const tenant = store.read().tenants.find((t) => t.slug === slug)
  const repos = tenant ? createRepos(store, tenant.id) : null
  const live = () => {
    const t = repos?.tenants.get(tenant!.id)
    return t && tenantAccess(t, clock().date) === 'ok' ? t : null
  }

  function info() {
    const t = live()
    if (!t || !repos) return null
    const staff = repos.staff.list({ active: true })
    const offered = new Set(staff.flatMap((s) => s.serviceIds))
    return {
      tenant: t,
      branches: repos.branches.list(),
      categories: repos.categories.list().sort((a, b) => a.order - b.order),
      services: repos.services.list().filter((s) => s.online && offered.has(s.id)),
      staff,
    }
  }

  function slots(branchId: ID, serviceIds: ID[], staffId: ID | 'any', date: string): { staffId: ID; start: number }[] {
    const t = live()
    if (!t || !repos || !t.onlineBooking.enabled || !serviceIds.length) return []
    const { date: today, min } = clock()
    const ahead = diffDays(date, today)
    if (ahead < 0 || ahead > t.onlineBooking.maxDaysAhead) return []
    const branch = repos.branches.get(branchId)
    const candidates = repos.staff
      .list({ branchId, active: true })
      .filter((s) => (staffId === 'any' || s.id === staffId) && serviceIds.every((id) => s.serviceIds.includes(id)))
    const appts = repos.appointments.list({ date })
    const blocks = repos.blocks.list({ date })
    const all = candidates.flatMap((s) =>
      findSlots({
        date, staff: [s], appts, blocks, branchHours: branch?.hours, today, nowMin: min, minLeadMin: t.onlineBooking.minLeadMinutes,
        duration: serviceIds.reduce((a, id) => a + durationFor(repos.services.get(id)!, s.id), 0),
      }),
    )
    // "Fark etmez" için her saatte en az dolu personeli öne al
    const load = new Map(candidates.map((s) => [s.id, appts.filter((a) => a.staffId === s.id).length]))
    const byStart = new Map<number, { staffId: ID; start: number }>()
    for (const s of all.sort((a, b) => (load.get(a.staffId) ?? 0) - (load.get(b.staffId) ?? 0))) if (!byStart.has(s.start)) byStart.set(s.start, s)
    return [...byStart.values()].sort((a, b) => a.start - b.start)
  }

  function book(input: BookingInput): { ok: true; code: string; status: 'pending' | 'confirmed' } | { ok: false; error: BookingError } {
    const t = live()
    if (!t || !repos || !t.onlineBooking.enabled) return { ok: false, error: 'disabled' }
    const phone = normalizePhone(input.phone)
    if (!phone) return { ok: false, error: 'invalid_phone' }
    if (!input.name.trim() || !input.serviceIds.length) return { ok: false, error: 'invalid' }
    // Kayıttan hemen önce slotu yeniden doğrula
    const slot = slots(input.branchId, input.serviceIds, input.staffId, input.date).find((s) => s.start === input.start)
    if (!slot) return { ok: false, error: 'slot_taken' }
    let customer = repos.customers.list({ phone })[0] ?? repos.customers.upsert({
      name: input.name.trim(), phone, tags: ['Yeni'], notes: '', consentSms: true, createdAt: clock().date,
    })
    if (input.marketingConsent && !customer.consentMarketing) {
      customer = repos.customers.upsert({ ...customer, consentMarketing: true, consentMarketingAt: new Date().toISOString(), consentMarketingSource: 'online' })
    }
    const status = t.onlineBooking.requireApproval ? 'pending' : 'confirmed'
    const { appt } = appointmentService(repos, clock).create({
      branchId: input.branchId, staffId: slot.staffId, customerId: customer.id, date: input.date, start: input.start,
      serviceIds: input.serviceIds, note: input.note, source: 'online', status,
    })
    return { ok: true, code: appt.code, status }
  }

  return { info, slots, book }
}
