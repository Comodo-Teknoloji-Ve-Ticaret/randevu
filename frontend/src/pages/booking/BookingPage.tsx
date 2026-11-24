import { ArrowLeft, CalendarCheck2, CalendarPlus, Check, Clock3, MapPin, Phone, Scissors, Sparkles, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { durationFor, priceFor } from '../../application/appointmentService'
import { formatTRY } from '../../domain/money'
import { formatPhone } from '../../domain/phone'
import { addDays, dayShort, formatDate, todayIstanbul, toHHMM } from '../../domain/time'
import { Avatar, Button, cx, Field, Input, Textarea } from '../../ui'
import { LegalDialog, type LegalDoc } from '../../ui/LegalDialog'
import { useBookingSource } from './bookingSource'
import './booking.css'

type Step = 'branch' | 'service' | 'staff' | 'time' | 'info' | 'done'

function icsFile(title: string, date: string, start: number, end: number, location: string) {
  const dt = (m: number) => `${date.replace(/-/g, '')}T${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RandevunHazir//TR', 'BEGIN:VEVENT', `UID:${Date.now()}@randevuhazir`, `DTSTART;TZID=Europe/Istanbul:${dt(start)}`, `DTEND;TZID=Europe/Istanbul:${dt(end)}`, `SUMMARY:${title}`, `LOCATION:${location}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }))
  a.download = 'randevu.ics'
  a.click()
}

export default function BookingPage() {
  const { slug = '' } = useParams()
  const src = useBookingSource(slug)
  const info = src.info
  const today = todayIstanbul()

  const [step, setStep] = useState<Step>('branch')
  const [branchId, setBranchId] = useState<string | null>(null)
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [staffId, setStaffId] = useState<string | 'any'>('any')
  const [date, setDate] = useState(today)
  const [time, setTime] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [kvkk, setKvkk] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ code: string; status: string } | null>(null)

  const branch = info?.branches.find((b) => b.id === branchId) ?? (info?.branches.length === 1 ? info.branches[0] : undefined)
  const effStep: Step = step === 'branch' && info?.branches.length === 1 ? 'service' : step
  const staffHere = info?.staff.filter((s) => s.branchId === branch?.id) ?? []
  const services = info?.services.filter((s) => staffHere.some((st) => st.serviceIds.includes(s.id))) ?? []
  const chosen = services.filter((s) => serviceIds.includes(s.id))
  const capable = staffHere.filter((s) => serviceIds.every((id) => s.serviceIds.includes(id)))
  const priceStaff = staffId === 'any' ? undefined : staffId
  const total = chosen.reduce((a, s) => a + priceFor(s, priceStaff), 0)
  const duration = chosen.reduce((a, s) => a + durationFor(s, priceStaff), 0)
  const maxAhead = info?.tenant.onlineBooking.maxDaysAhead ?? 30

  const days = useMemo(() => Array.from({ length: Math.min(21, maxAhead + 1) }, (_, i) => addDays(today, i)), [today, maxAhead])
  const slotsFor = (d: string) => (branch ? src.slots(branch.id, serviceIds, staffId, d) : [])
  const slots = effStep === 'time' ? slotsFor(date) : []
  useEffect(() => {
    if (effStep === 'time' && branch) src.prefetch(branch.id, serviceIds, staffId, today, days.length)
  }, [effStep, branch?.id, serviceIds.join(), staffId, today, days.length, src.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const dayHas = useMemo(() => (effStep === 'time' ? new Map(days.map((d) => [d, slotsFor(d).length > 0])) : new Map()), [effStep, days, serviceIds, staffId, branch?.id, src.version]) // eslint-disable-line react-hooks/exhaustive-deps

  // Seçili günde boş saat yoksa ilk uygun güne geç
  useEffect(() => {
    if (effStep !== 'time' || dayHas.get(date)) return
    const first = days.find((d) => dayHas.get(d))
    if (first) setDate(first)
  }, [effStep, dayHas]) // eslint-disable-line react-hooks/exhaustive-deps

  if (info === undefined) return <div className="boot-loading" role="status">Yükleniyor…</div>
  if (!info) {
    return (
      <div className="bk-shell">
        <div className="bk-card bk-empty">
          <Scissors size={28} />
          <h2>Salon bulunamadı</h2>
          <p className="muted">Bu bağlantı geçersiz ya da salon şu an online randevu almıyor.</p>
        </div>
      </div>
    )
  }
  const t = info.tenant
  const legalBranch = branch ?? info.branches[0]
  const legalSalon = { name: t.name, address: legalBranch?.address ?? '', phone: legalBranch?.phone ?? '' }
  const closed = !t.onlineBooking.enabled
  const steps: Step[] = [...(info.branches.length > 1 ? (['branch'] as Step[]) : []), 'service', 'staff', 'time', 'info']
  const idx = steps.indexOf(effStep)
  const back = () => setStep(steps[Math.max(0, idx - 1)])
  const groups = [
    { label: 'Sabah', from: 0, to: 720 },
    { label: 'Öğleden sonra', from: 720, to: 1020 },
    { label: 'Akşam', from: 1020, to: 1440 },
  ]

  const submit = async () => {
    if (!branch || time === null) return
    const r = await src.book({ branchId: branch.id, serviceIds, staffId, date, start: time, name, phone, note, marketingConsent: marketing })
    if (!r.ok) {
      setError(r.message)
      if (r.slotTaken) { setTime(null); setStep('time') }
      return
    }
    setResult(r)
    setStep('done')
  }

  return (
    <div className="bk-shell" style={{ ['--brand' as string]: t.logoColor }}>
      <header className="bk-hero">
        <div className="bk-hero-inner">
          <div className="bk-logo"><Scissors /></div>
          <div>
            <h1>{t.name}</h1>
            <p><MapPin size={13} /> {branch ? branch.address : `${info.branches.length} şube`}</p>
          </div>
        </div>
      </header>

      <main className="bk-card">
        {closed ? (
          <div className="bk-empty"><Clock3 size={28} /><h2>Online randevu kapalı</h2><p className="muted">Randevu için salonu arayabilirsiniz{branch && <>: <a href={`tel:+90${branch.phone}`}>{formatPhone(branch.phone)}</a></>}</p></div>
        ) : effStep === 'done' && result ? (
          <div className="bk-done">
            <div className="bk-check"><Check /></div>
            <h2>{result.status === 'pending' ? 'Talebiniz alındı!' : 'Randevunuz oluşturuldu!'}</h2>
            <p className="muted">{result.status === 'pending' ? 'Randevunuz salon onayladığında kesinleşir. Gerekirse salon sizinle telefon ya da WhatsApp üzerinden iletişime geçer.' : 'Sizi bekliyoruz.'}</p>
            <div className="bk-ticket">
              <div><span>Randevu kodu</span><b className="bk-code">{result.code}</b></div>
              <div><span>Tarih</span><b>{formatDate(date, { weekday: true })}</b></div>
              <div><span>Saat</span><b>{toHHMM(time!)}</b></div>
              <div><span>Hizmet</span><b>{chosen.map((s) => s.name).join(', ')}</b></div>
              <div><span>Şube</span><b>{branch?.name}</b></div>
            </div>
            <Button icon={CalendarPlus} onClick={() => icsFile(`${t.name} – ${chosen.map((s) => s.name).join(', ')}`, date, time!, time! + duration, branch?.address ?? '')}>Takvime ekle</Button>
            <Button variant="ghost" onClick={() => { setStep('service'); setServiceIds([]); setTime(null); setResult(null) }}>Yeni randevu</Button>
          </div>
        ) : (
          <>
            <div className="bk-top">
              {idx > 0 ? <button className="bk-back" onClick={back} aria-label="Geri"><ArrowLeft /></button> : <span />}
              <div className="bk-steps">{steps.map((s, i) => <i key={s} className={cx(i < idx && 'done', i === idx && 'cur')} />)}</div>
              <span className="t-small muted">{idx + 1}/{steps.length}</span>
            </div>

            {effStep === 'branch' && (
              <section className="bk-section">
                <h2>Şube seçin</h2>
                {info.branches.map((b) => (
                  <button key={b.id} className="bk-option" onClick={() => { setBranchId(b.id); setStep('service') }}>
                    <MapPin /><div><b>{b.name}</b><span>{b.address}</span></div>
                  </button>
                ))}
              </section>
            )}

            {effStep === 'service' && (
              <section className="bk-section">
                <h2>Hangi hizmeti istersiniz?</h2>
                <p className="muted t-small">Birden fazla seçebilirsiniz.</p>
                {info.categories.map((c) => {
                  const list = services.filter((s) => s.categoryId === c.id)
                  if (!list.length) return null
                  return (
                    <div key={c.id} className="bk-group">
                      <h5><i style={{ background: `var(--cat-${c.color}-bd)` }} />{c.name}</h5>
                      {list.map((s) => {
                        const on = serviceIds.includes(s.id)
                        return (
                          <button key={s.id} className={cx('bk-svc', on && 'on')} onClick={() => setServiceIds((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}>
                            <span className="bk-tick">{on && <Check />}</span>
                            <div><b>{s.name}</b><span>{s.duration} dk</span></div>
                            <em>{formatTRY(s.price)}</em>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </section>
            )}

            {effStep === 'staff' && (
              <section className="bk-section">
                <h2>Kimden hizmet almak istersiniz?</h2>
                <button className={cx('bk-option', staffId === 'any' && 'on')} onClick={() => { setStaffId('any'); setTime(null); setStep('time') }}>
                  <span className="bk-any"><Sparkles /></span><div><b>Fark etmez</b><span>En uygun saati olan uzman</span></div>
                </button>
                {capable.map((s) => (
                  <button key={s.id} className={cx('bk-option', staffId === s.id && 'on')} onClick={() => { setStaffId(s.id); setTime(null); setStep('time') }}>
                    <Avatar name={s.name} color={s.color} size={40} /><div><b>{s.name}</b><span>{s.title}</span></div>
                  </button>
                ))}
                {capable.length === 0 && <p className="muted">Seçtiğiniz hizmetlerin hepsini yapan uzman yok; hizmet seçimini değiştirin.</p>}
              </section>
            )}

            {effStep === 'time' && (
              <section className="bk-section">
                <h2>Tarih ve saat</h2>
                <div className="bk-days">
                  {days.map((d) => (
                    <button key={d} className={cx('bk-day', d === date && 'on')} disabled={!dayHas.get(d)} onClick={() => { setDate(d); setTime(null) }}>
                      <span>{d === today ? 'Bugün' : dayShort(d)}</span>
                      <b>{Number(d.slice(8))}</b>
                      <small>{formatDate(d).split(' ')[1].slice(0, 3)}</small>
                    </button>
                  ))}
                </div>
                {slots.length === 0 ? (
                  <p className="muted" style={{ padding: '20px 0', textAlign: 'center' }}>Bu gün için uygun saat yok. Başka bir gün seçin.</p>
                ) : (
                  groups.map((g) => {
                    const list = slots.filter((s) => s.start >= g.from && s.start < g.to)
                    if (!list.length) return null
                    return (
                      <div key={g.label} className="bk-group">
                        <h5>{g.label}</h5>
                        <div className="bk-times">
                          {list.map((s) => <button key={s.start} className={cx('bk-time', time === s.start && 'on')} onClick={() => setTime(s.start)}>{toHHMM(s.start)}</button>)}
                        </div>
                      </div>
                    )
                  })
                )}
              </section>
            )}

            {effStep === 'info' && (
              <section className="bk-section">
                <h2>Bilgileriniz</h2>
                <Field label="Ad Soyad"><Input autoFocus icon={UserRound} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
                <Field label="Cep telefonu" hint="Randevu bilgisi bu numaraya gönderilir."><Input icon={Phone} value={phone} onChange={(e) => { setPhone(e.target.value); setError(null) }} inputMode="tel" autoComplete="tel" placeholder="05xx xxx xx xx" /></Field>
                <Field label="Not (isteğe bağlı)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. saç uzunluğum omuz hizasında" /></Field>
                <label className="bk-kvkk"><input type="checkbox" checked={kvkk} onChange={(e) => setKvkk(e.target.checked)} /> <span><button type="button" className="bk-link" onClick={(e) => { e.preventDefault(); setLegalDoc('privacy') }}>Aydınlatma Metni</button>'ni okudum. Randevum ile ilgili bilgilendirme mesajları bu numaraya gönderilir.</span></label>
                <label className="bk-kvkk"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> <span>Kampanya ve fırsatlardan WhatsApp ile haberdar olmak istiyorum (<button type="button" className="bk-link" onClick={(e) => { e.preventDefault(); setLegalDoc('consent') }}>Açık Rıza Metni</button>). <i>İsteğe bağlı.</i></span></label>
                <div className="bk-summary">
                  <div><CalendarCheck2 size={16} /> {formatDate(date, { weekday: true })} · {toHHMM(time ?? 0)}</div>
                  <div><Scissors size={16} /> {chosen.map((s) => s.name).join(', ')}</div>
                  <div><UserRound size={16} /> {staffId === 'any' ? 'Fark etmez' : capable.find((s) => s.id === staffId)?.name}</div>
                </div>
              </section>
            )}

            {error && <div className="bk-error">{error}</div>}
          </>
        )}
      </main>

      {!closed && effStep !== 'done' && effStep !== 'branch' && (
        <footer className="bk-bar">
          <div>
            <b>{chosen.length ? formatTRY(total) : 'Hizmet seçin'}</b>
            <span>{chosen.length ? `${chosen.length} hizmet · ${duration} dk` : ''}</span>
          </div>
          {effStep === 'service' && <Button variant="primary" size="lg" disabled={!chosen.length} onClick={() => setStep('staff')}>Devam</Button>}
          {effStep === 'time' && <Button variant="primary" size="lg" disabled={time === null} onClick={() => setStep('info')}>Devam</Button>}
          {effStep === 'info' && <Button variant="primary" size="lg" disabled={!name.trim() || phone.replace(/\D/g, '').length < 10 || !kvkk} onClick={submit}>Randevuyu onayla</Button>}
        </footer>
      )}
      <p className="bk-powered">RandevunHazır ile online randevu · <button type="button" className="bk-link" onClick={() => setLegalDoc('privacy')}>KVKK Aydınlatma Metni</button></p>
      {legalDoc && <LegalDialog doc={legalDoc} salon={legalSalon} onClose={() => setLegalDoc(null)} />}
    </div>
  )
}
