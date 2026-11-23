import { describe, expect, it } from 'vitest'
import { appointmentService } from './appointmentService'
import { setup } from './testkit'

const now = () => ({ date: '2026-11-20', min: 600 })

describe('appointmentService', () => {
  it('creates with staff-specific price and summed duration', () => {
    const r = setup()
    const svc = appointmentService(r, now)
    const { appt, conflicts } = svc.create({ branchId: 'b1', staffId: 's2', customerId: 'm1', date: '2026-11-20', start: 600, serviceIds: ['sv1', 'sv2'] })
    expect(appt.end).toBe(660)
    expect(appt.items.map((i) => i.price)).toEqual([50000, 30000])
    expect(appt.code).toMatch(/^RH-[0-9A-Z]{6}$/)
    expect(conflicts).toEqual([])
  })
  it('move saves even on conflict but reports it', () => {
    const r = setup()
    const svc = appointmentService(r, now)
    svc.create({ branchId: 'b1', staffId: 's1', customerId: null, date: '2026-11-20', start: 600, serviceIds: ['sv1'] })
    const b = svc.create({ branchId: 'b1', staffId: 's2', customerId: null, date: '2026-11-20', start: 600, serviceIds: ['sv1'] }).appt
    const res = svc.move(b.id, { staffId: 's1', date: '2026-11-20', start: 615 })
    expect(res.conflicts).toEqual(['overlap'])
    expect(r.appointments.get(b.id)).toMatchObject({ staffId: 's1', start: 615, end: 645 })
  })
  it('resize never goes below 15 minutes', () => {
    const r = setup()
    const svc = appointmentService(r, now)
    const a = svc.create({ branchId: 'b1', staffId: 's1', customerId: null, date: '2026-11-20', start: 600, serviceIds: ['sv1'] }).appt
    expect(svc.resize(a.id, 690).appt.end).toBe(690)
    expect(svc.resize(a.id, 590).appt.end).toBe(615)
  })
  it('walk-in goes to the staff that frees up first when everyone is busy', () => {
    const r = setup()
    const svc = appointmentService(r, now)
    svc.create({ branchId: 'b1', staffId: 's1', customerId: null, date: '2026-11-20', start: 585, serviceIds: ['sv1', 'sv2'] }) // 09:45–10:45
    svc.create({ branchId: 'b1', staffId: 's2', customerId: null, date: '2026-11-20', start: 600, serviceIds: ['sv1'] }) // 10:00–10:30
    const w = svc.walkIn({ branchId: 'b1', serviceIds: ['sv2'] })
    expect(w).toMatchObject({ staffId: 's2', start: 630, source: 'walkin', status: 'arrived' })
  })
  it('walk-in starts now when someone is free', () => {
    const r = setup()
    const w = appointmentService(r, now).walkIn({ branchId: 'b1', serviceIds: ['sv1'] })
    expect(w.start).toBe(600)
  })
  it('repeat creates linked copies every N weeks', () => {
    const r = setup()
    const svc = appointmentService(r, now)
    const a = svc.create({ branchId: 'b1', staffId: 's1', customerId: 'm1', date: '2026-11-20', start: 600, serviceIds: ['sv1'] }).appt
    const copies = svc.repeat(a.id, 4, 3)
    expect(copies.map((c) => c.date)).toEqual(['2026-12-18', '2027-01-15', '2027-02-12'])
    const rid = r.appointments.get(a.id)!.recurrenceId
    expect(rid).toBeTruthy()
    expect(copies.every((c) => c.recurrenceId === rid)).toBe(true)
  })
  it('toTicket returns the same open ticket when called twice', () => {
    const r = setup()
    const svc = appointmentService(r, now)
    const a = svc.create({ branchId: 'b1', staffId: 's2', customerId: 'm1', date: '2026-11-20', start: 600, serviceIds: ['sv1'] }).appt
    const t1 = svc.toTicket(a.id)
    const t2 = svc.toTicket(a.id)
    expect(t2.id).toBe(t1.id)
    expect(t1.lines).toMatchObject([{ kind: 'service', refId: 'sv1', staffId: 's2', unitPrice: 50000 }])
    expect(r.tickets.list()).toHaveLength(1)
  })
})
