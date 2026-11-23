import { conflictsFor, findSlots, type Conflict } from '../domain/availability'
import { addDays, nowMinutesIstanbul, todayIstanbul } from '../domain/time'
import type { Appointment, AppointmentSource, AppointmentStatus, ID, Service, Staff, Ticket } from '../domain/types'
import { newId } from './db'
import type { Repos } from './repos'

export type Clock = () => { date: string; min: number }
export const istanbulClock: Clock = () => ({ date: todayIstanbul(), min: nowMinutesIstanbul() })

export function newCode(): string {
  return 'RH-' + Math.floor(Math.random() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0')
}

export const priceFor = (s: Service, staffId?: ID) => (staffId && s.overrides[staffId]?.price) || s.price
export const durationFor = (s: Service, staffId?: ID) => (staffId && s.overrides[staffId]?.duration) || s.duration

export interface CreateInput {
  branchId: ID
  staffId: ID
  customerId: ID | null
  date: string
  start: number
  serviceIds: ID[]
  note?: string
  source?: AppointmentSource
  status?: AppointmentStatus
}

export interface Result { appt: Appointment; conflicts: Conflict[] }

export function appointmentService(repos: Repos, clock: Clock = istanbulClock) {
  const staffOf = (id: ID): Staff => {
    const s = repos.staff.get(id)
    if (!s) throw new Error('Personel bulunamadı')
    return s
  }
  const check = (a: Appointment): Result => ({
    appt: a,
    conflicts: conflictsFor(a, repos.appointments.list({ date: a.date, staffId: a.staffId }), repos.blocks.list({ date: a.date, staffId: a.staffId }), staffOf(a.staffId)),
  })
  const itemsFor = (serviceIds: ID[], staffId: ID) =>
    serviceIds.map((sid) => {
      const s = repos.services.get(sid)
      if (!s) throw new Error('Hizmet bulunamadı')
      return { serviceId: s.id, price: priceFor(s, staffId), duration: durationFor(s, staffId) }
    })
  const save = (a: Appointment) => repos.appointments.upsert(a)
  const get = (id: ID) => {
    const a = repos.appointments.get(id)
    if (!a) throw new Error('Randevu bulunamadı')
    return a
  }

  /** Çakışmayı kaydetmeden kontrol eder (UI onay penceresi için). */
  function preview(input: CreateInput & { id?: ID }): Conflict[] {
    const items = itemsFor(input.serviceIds, input.staffId)
    const end = input.start + items.reduce((s, i) => s + i.duration, 0)
    const fake = { id: input.id ?? '__new', tenantId: '', branchId: input.branchId, staffId: input.staffId, customerId: input.customerId, date: input.date, start: input.start, end, items, status: 'confirmed', source: 'reception', note: '', code: '', createdAt: '' } as Appointment
    return check(fake).conflicts
  }

  function create(input: CreateInput): Result {
    const items = itemsFor(input.serviceIds, input.staffId)
    const appt = save({
      id: newId('a_'), tenantId: '', branchId: input.branchId, staffId: input.staffId, customerId: input.customerId,
      date: input.date, start: input.start, end: input.start + items.reduce((s, i) => s + i.duration, 0), items,
      status: input.status ?? 'confirmed', source: input.source ?? 'reception', note: input.note ?? '', code: newCode(), createdAt: new Date().toISOString(),
    })
    return check(appt)
  }

  function update(id: ID, input: Omit<CreateInput, 'branchId'> & { branchId?: ID }): Result {
    const a = get(id)
    const items = itemsFor(input.serviceIds, input.staffId)
    return check(save({ ...a, ...input, branchId: input.branchId ?? a.branchId, items, end: input.start + items.reduce((s, i) => s + i.duration, 0), note: input.note ?? a.note }))
  }

  function move(id: ID, to: { staffId: ID; date: string; start: number }): Result {
    const a = get(id)
    const dur = a.end - a.start
    const staff = staffOf(to.staffId)
    return check(save({ ...a, staffId: to.staffId, branchId: staff.branchId, date: to.date, start: to.start, end: to.start + dur }))
  }

  function resize(id: ID, end: number): Result {
    const a = get(id)
    return check(save({ ...a, end: Math.max(a.start + 15, end) }))
  }

  function setStatus(id: ID, status: AppointmentStatus): Appointment {
    return save({ ...get(id), status })
  }

  function walkIn(input: { branchId: ID; staffId?: ID; serviceIds: ID[]; customerId?: ID | null }): Appointment {
    const { date, min } = clock()
    const nowMin = Math.floor(min / 15) * 15
    const candidates = repos.staff
      .list({ branchId: input.branchId, active: true })
      .filter((s) => (input.staffId ? s.id === input.staffId : input.serviceIds.every((id) => s.serviceIds.includes(id))))
    const branch = repos.branches.get(input.branchId)
    const slots = candidates.flatMap((s) =>
      findSlots({
        date, duration: itemsFor(input.serviceIds, s.id).reduce((a, i) => a + i.duration, 0), staff: [s],
        appts: repos.appointments.list({ date }), blocks: repos.blocks.list({ date }), branchHours: branch?.hours, today: date, nowMin,
      }).slice(0, 1),
    ).sort((a, b) => a.start - b.start)
    const pick = slots[0] ?? { staffId: input.staffId ?? candidates[0]?.id, start: nowMin }
    if (!pick.staffId) throw new Error('Bu hizmeti yapabilecek personel yok')
    return create({
      branchId: input.branchId, staffId: pick.staffId, customerId: input.customerId ?? null, date, start: pick.start,
      serviceIds: input.serviceIds, source: 'walkin', status: 'arrived',
    }).appt
  }

  function repeat(id: ID, everyWeeks: number, count: number): Appointment[] {
    const a = get(id)
    const recurrenceId = a.recurrenceId ?? newId('rc_')
    save({ ...a, recurrenceId })
    const out: Appointment[] = []
    for (let i = 1; i <= count; i++) {
      out.push(save({ ...a, id: newId('a_'), date: addDays(a.date, everyWeeks * 7 * i), status: 'confirmed', code: newCode(), recurrenceId, createdAt: new Date().toISOString() }))
    }
    return out
  }

  function toTicket(id: ID): Ticket {
    const a = get(id)
    const existing = repos.tickets.list({ appointmentId: id }).find((t) => t.status === 'open')
    if (existing) return existing
    const closed = repos.tickets.list({ appointmentId: id }).find((t) => t.status === 'closed')
    if (closed) return closed
    return repos.tickets.upsert({
      branchId: a.branchId, date: a.date, customerId: a.customerId, appointmentId: a.id, discount: null, tip: 0, payments: [], status: 'open',
      createdAt: new Date().toISOString(),
      lines: a.items.map((it) => ({
        id: newId('l_'), kind: 'service', refId: it.serviceId, name: repos.services.get(it.serviceId)?.name ?? 'Hizmet', staffId: a.staffId, qty: 1, unitPrice: it.price, discount: null,
      })),
    })
  }

  return { preview, create, update, move, resize, setStatus, walkIn, repeat, toTicket }
}

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Onay bekliyor',
  confirmed: 'Onaylandı',
  arrived: 'Geldi',
  in_service: 'İşlemde',
  completed: 'Tamamlandı',
  no_show: 'Gelmedi',
  cancelled: 'İptal',
}

export const SOURCE_LABEL: Record<AppointmentSource, string> = {
  reception: 'Resepsiyon',
  online: 'Online',
  phone: 'Telefon',
  walkin: 'Randevusuz',
}
