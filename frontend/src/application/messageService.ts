import { isActive } from '../domain/availability'
import { whatsappUrl } from '../domain/phone'
import { renderTemplate } from '../domain/template'
import { addDays, formatDate, toHHMM } from '../domain/time'
import type { Appointment, Customer, ID, MessageKind, MessageLog } from '../domain/types'
import { istanbulClock, type Clock } from './appointmentService'
import type { Repos } from './repos'

const FALLBACK: Record<MessageKind, string> = {
  confirm: 'Merhaba {musteri}, {tarih} {saat} randevunuz oluşturuldu. {salon}',
  reminder: 'Hatırlatma: {musteri}, {tarih} {saat} randevunuz var. {salon}',
  cancel: 'Merhaba {musteri}, {tarih} {saat} randevunuz iptal edildi. {salon}',
  birthday: 'İyi ki doğdun {musteri}! {salon}',
  winback: 'Seni özledik {musteri}! {salon}',
}

/** Kampanya/kutlama mesajları: açık rıza gerekir (İYS). Onay/hatırlatma/iptal hizmet mesajıdır. */
const COMMERCIAL = new Set<MessageKind>(['birthday', 'winback'])

export function messageService(repos: Repos, clock: Clock = istanbulClock) {
  const salon = () => (repos.tenantId ? repos.tenants.get(repos.tenantId)?.name : '') ?? ''
  const first = (n: string) => n.split(' ')[0]

  function varsFor(customer: Customer, appt?: Appointment): Record<string, string> {
    const v: Record<string, string> = { musteri: first(customer.name), salon: salon() }
    if (appt) {
      v.tarih = formatDate(appt.date, { weekday: true })
      v.saat = toHHMM(appt.start)
      v.hizmet = appt.items.map((i) => repos.services.get(i.serviceId)?.name ?? '').join(', ')
      v.personel = first(repos.staff.get(appt.staffId)?.name ?? '')
    }
    return v
  }

  function preview(kind: MessageKind, target: { appointmentId?: ID; customerId?: ID }): { customer: Customer; body: string; appt?: Appointment } {
    const appt = target.appointmentId ? repos.appointments.get(target.appointmentId) : undefined
    const customerId = target.customerId ?? appt?.customerId
    const customer = customerId ? repos.customers.get(customerId) : undefined
    if (!customer) throw new Error('Müşteri bulunamadı')
    const tpl = repos.templates.list({ kind })[0]?.body ?? FALLBACK[kind]
    return { customer, appt, body: renderTemplate(tpl, varsFor(customer, appt)) }
  }

  /**
   * Mesajlar yalnız WhatsApp ile gider: kayıt tutulur ve salonun telefonunda hazır mesajla açılacak wa.me bağlantısı döner.
   * Sunucudaki MessageRules ile aynı izin kuralları: hizmet mesajı ileti izni, kampanya mesajı ayrıca açık rıza ister.
   */
  function send(kind: MessageKind, target: { appointmentId?: ID; customerId?: ID }): MessageLog & { url: string } {
    const { customer, appt, body } = preview(kind, target)
    if (!customer.consentSms) throw new Error('Müşterinin ileti izni yok.')
    if (COMMERCIAL.has(kind) && !customer.consentMarketing) throw new Error('Müşterinin kampanya mesajı için açık rızası yok.')
    const log = repos.messages.upsert({
      customerId: customer.id, appointmentId: appt?.id, kind, channel: 'whatsapp', to: customer.phone, body,
      status: 'opened', at: new Date().toISOString(),
    })
    return { ...log, url: whatsappUrl(customer.phone, body) }
  }

  function dueReminders(): Appointment[] {
    const tomorrow = addDays(clock().date, 1)
    const reminded = new Set(repos.messages.list({ kind: 'reminder' }).map((m) => m.appointmentId))
    return repos.appointments
      .list({ date: tomorrow })
      .filter((a) => isActive(a) && a.status !== 'completed' && a.customerId && !reminded.has(a.id) && repos.customers.get(a.customerId)?.consentSms)
      .sort((a, b) => a.start - b.start)
  }

  function birthdaysToday(): Customer[] {
    const md = clock().date.slice(5)
    return repos.customers.list().filter((c) => c.birthday === md && c.consentSms && c.consentMarketing)
  }

  return { preview, send, dueReminders, birthdaysToday }
}
