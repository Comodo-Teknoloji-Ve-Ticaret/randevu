import { describe, expect, it } from 'vitest'
import { appointmentService } from './appointmentService'
import { messageService } from './messageService'
import { setup } from './testkit'

const clock = () => ({ date: '2026-11-20', min: 600 })

function withTemplates() {
  const r = setup()
  r.templates.upsert({ kind: 'reminder', name: 'Hatırlatma', enabled: true, hoursBefore: 24, body: 'Hatırlatma {musteri}: {tarih} {saat} {hizmet} – {personel}, {salon}' })
  r.customers.upsert({ id: 'm2', name: 'Can Yıldız', phone: '5332223344', tags: [], notes: '', consentSms: false, createdAt: '2026-01-01' })
  return r
}

describe('messageService (yalnız WhatsApp)', () => {
  it('lists tomorrow’s active appointments of consenting customers that were not reminded yet', () => {
    const r = withTemplates()
    const a = appointmentService(r, clock)
    const ok = a.create({ branchId: 'b1', staffId: 's1', customerId: 'm1', date: '2026-11-21', start: 630, serviceIds: ['sv1'] }).appt
    a.create({ branchId: 'b1', staffId: 's1', customerId: 'm2', date: '2026-11-21', start: 700, serviceIds: ['sv1'] }) // izin yok
    const cancelled = a.create({ branchId: 'b1', staffId: 's2', customerId: 'm1', date: '2026-11-21', start: 700, serviceIds: ['sv1'] }).appt
    a.setStatus(cancelled.id, 'cancelled')
    const m = messageService(r, clock)
    expect(m.dueReminders().map((x) => x.id)).toEqual([ok.id])
    m.send('reminder', { appointmentId: ok.id })
    expect(m.dueReminders()).toEqual([])
  })

  it('renders the reminder, logs it as an opened WhatsApp message and returns a wa.me url', () => {
    const r = withTemplates()
    const appt = appointmentService(r, clock).create({ branchId: 'b1', staffId: 's1', customerId: 'm1', date: '2026-11-21', start: 630, serviceIds: ['sv1'] }).appt
    const log = messageService(r, clock).send('reminder', { appointmentId: appt.id })
    expect(log.body).toBe('Hatırlatma Elif: 21 Kasım Cumartesi 10:30 Kesim – Ayşe, Test')
    expect(log.channel).toBe('whatsapp')
    expect(log.status).toBe('opened')
    expect(log.to).toBe('5321112233')
    expect(log.url).toMatch(/^https:\/\/wa\.me\/905321112233\?text=/)
  })

  it('refuses service messages without consent and writes no log', () => {
    const r = withTemplates()
    const appt = appointmentService(r, clock).create({ branchId: 'b1', staffId: 's1', customerId: 'm2', date: '2026-11-21', start: 630, serviceIds: ['sv1'] }).appt
    expect(() => messageService(r, clock).send('reminder', { appointmentId: appt.id })).toThrow('Müşterinin ileti izni yok.')
    expect(r.messages.list()).toEqual([])
  })

  it('campaign messages need explicit marketing consent; birthday list shows only consenting customers', () => {
    const r = withTemplates()
    r.customers.upsert({ ...r.customers.get('m1')!, birthday: '11-20' })
    r.customers.upsert({ id: 'm3', name: 'Deniz Ak', phone: '5334445566', tags: [], notes: '', consentSms: true, consentMarketing: true, birthday: '11-20', createdAt: '2026-01-01' })
    const m = messageService(r, clock)
    expect(m.birthdaysToday().map((c) => c.id)).toEqual(['m3'])
    expect(() => m.send('birthday', { customerId: 'm1' })).toThrow('Müşterinin kampanya mesajı için açık rızası yok.')
    expect(m.send('birthday', { customerId: 'm3' }).url).toMatch(/^https:\/\/wa\.me\/905334445566/)
  })
})
