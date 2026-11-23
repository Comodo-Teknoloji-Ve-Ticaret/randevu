import { describe, expect, it } from 'vitest'
import { bookingService } from './bookingService'
import { setup } from './testkit'

const clock = () => ({ date: '2026-11-20', min: 540 })
const input = { branchId: 'b1', serviceIds: ['sv1'], staffId: 's1', date: '2026-11-21', start: 600, name: 'Deniz Ak', phone: '0535 444 55 66', note: '' }

describe('bookingService', () => {
  it('books a free slot as pending online appointment and creates the customer', () => {
    const r = setup()
    const b = bookingService(r.store, 'test', clock)
    const res = b.book(input)
    expect(res.ok).toBe(true)
    const a = r.appointments.list({ source: 'online' })[0]
    expect(a).toMatchObject({ status: 'pending', staffId: 's1', start: 600, end: 630 })
    expect(r.customers.list({ phone: '5354445566' })).toHaveLength(1)
  })
  it('records optional marketing consent with time and source, never by default', () => {
    const r = setup()
    const b = bookingService(r.store, 'test', clock)
    b.book(input)
    expect(r.customers.list({ phone: '5354445566' })[0].consentMarketing).toBeUndefined()
    b.book({ ...input, start: 660, marketingConsent: true })
    expect(r.customers.list({ phone: '5354445566' })[0]).toMatchObject({ consentMarketing: true, consentMarketingSource: 'online' })
    expect(r.customers.list({ phone: '5354445566' })[0].consentMarketingAt).toBeTruthy()
  })
  it('refuses the same slot twice', () => {
    const r = setup()
    const b = bookingService(r.store, 'test', clock)
    expect(b.book(input).ok).toBe(true)
    expect(b.book({ ...input, name: 'Başka', phone: '05357778899' })).toEqual({ ok: false, error: 'slot_taken' })
  })
  it('auto-confirms when approval is not required', () => {
    const r = setup()
    const t = r.tenants.get('t1')!
    r.tenants.upsert({ ...t, onlineBooking: { ...t.onlineBooking, requireApproval: false } })
    bookingService(r.store, 'test', clock).book(input)
    expect(r.appointments.list({ source: 'online' })[0].status).toBe('confirmed')
  })
  it('is disabled when online booking is off or the salon is suspended', () => {
    const r = setup()
    const t = r.tenants.get('t1')!
    r.tenants.upsert({ ...t, onlineBooking: { ...t.onlineBooking, enabled: false } })
    expect(bookingService(r.store, 'test', clock).book(input)).toEqual({ ok: false, error: 'disabled' })
    r.tenants.upsert({ ...t, status: 'suspended' })
    expect(bookingService(r.store, 'test', clock).info()).toBeNull()
  })
  it('rejects invalid phones', () => {
    expect(bookingService(setup().store, 'test', clock).book({ ...input, phone: '12' })).toEqual({ ok: false, error: 'invalid_phone' })
  })
  it('"any staff" picks a free staff and hides times when everyone is busy', () => {
    const r = setup()
    const b = bookingService(r.store, 'test', clock)
    b.book({ ...input, staffId: 'any' })
    b.book({ ...input, staffId: 'any', phone: '05357778899' })
    const slots = b.slots('b1', ['sv1'], 'any', '2026-11-21').map((s) => s.start)
    expect(slots).not.toContain(600)
    expect(r.appointments.list().map((a) => a.staffId).sort()).toEqual(['s1', 's2'])
  })
  it('respects minimum lead time and max days ahead', () => {
    const b = bookingService(setup().store, 'test', clock) // minLead 60, maxDays 30
    expect(b.slots('b1', ['sv1'], 'any', '2026-11-20')[0].start).toBe(600)
    expect(b.slots('b1', ['sv1'], 'any', '2026-12-25')).toEqual([])
  })
})
