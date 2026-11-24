import { Cake, CalendarPlus, Crown, Download, MessageCircle, Phone, Search, UserPlus, Users, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { customerService, trLower } from '../../application/customerService'
import { STATUS_LABEL } from '../../application/appointmentService'
import { useSession } from '../../app/session'
import { formatTRY } from '../../domain/money'
import { formatPhone, whatsappUrl } from '../../domain/phone'
import { ticketTotals } from '../../domain/ticket'
import { addDays, diffDays, formatDate, todayIstanbul, toHHMM } from '../../domain/time'
import type { Customer } from '../../domain/types'
import { useRepos } from '../../infrastructure'
import {
  Avatar, Badge, Button, cx, Drawer, EmptyState, Field, Input, Kpi, PageHeader, Select, Switch, Tabs, Textarea, useIsMobile, useToast,
} from '../../ui'
import { STATUS_TONE } from '../calendar/AppointmentDetail'
import { AppointmentForm } from '../calendar/AppointmentForm'
import { cashService } from '../../application/cashService'
import { ColorCards } from './ColorCards'
import './customers.css'

type Filter = 'all' | 'vip' | 'debt' | 'birthday' | 'lost' | 'new'

interface Row {
  c: Customer
  visits: number
  spent: number
  last: string | null
  balance: number
  noShows: number
  next: string | null
}

const TAG_OPTIONS = ['VIP', 'Yeni', 'Hassas cilt', 'Riskli', 'Gelin', 'Öğrenci']

export default function CustomersPage() {
  const repos = useRepos()
  const nav = useNavigate()
  const { id } = useParams()
  const isMobile = useIsMobile()
  const today = todayIstanbul()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)
  const [limit, setLimit] = useState(60)

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>()
    for (const c of repos.customers.list()) map.set(c.id, { c, visits: 0, spent: 0, last: null, balance: 0, noShows: 0, next: null })
    for (const a of repos.appointments.list()) {
      const r = a.customerId ? map.get(a.customerId) : undefined
      if (!r) continue
      if (a.status === 'completed') { r.visits++; if (!r.last || a.date > r.last) r.last = a.date }
      if (a.status === 'no_show') r.noShows++
      if (a.date >= today && ['pending', 'confirmed'].includes(a.status) && (!r.next || a.date < r.next)) r.next = a.date
    }
    for (const t of repos.tickets.list({ status: 'closed' })) {
      const r = t.customerId ? map.get(t.customerId) : undefined
      if (!r) continue
      const tt = ticketTotals(t)
      r.spent += tt.total
      r.balance += tt.debt
    }
    for (const d of repos.debtCollections.list()) {
      const r = map.get(d.customerId)
      if (r) r.balance -= d.amount
    }
    return [...map.values()]
  }, [repos, today])

  const month = today.slice(5, 7)
  const filtered = useMemo(() => {
    const term = trLower(q.trim())
    let digits = q.replace(/\D/g, '')
    if (digits.startsWith('0')) digits = digits.slice(1)
    return rows
      .filter((r) => !term || trLower(r.c.name).includes(term) || (digits.length >= 3 && r.c.phone.includes(digits)))
      .filter((r) => {
        if (filter === 'vip') return r.c.tags.includes('VIP')
        if (filter === 'debt') return r.balance > 0
        if (filter === 'birthday') return r.c.birthday?.slice(0, 2) === month
        if (filter === 'lost') return r.last !== null && diffDays(today, r.last) > 60 && !r.next
        if (filter === 'new') return diffDays(today, r.c.createdAt.slice(0, 10)) <= 30
        return true
      })
      .sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || a.c.name.localeCompare(b.c.name, 'tr'))
  }, [rows, q, filter, month, today])

  const totals = useMemo(() => ({
    count: rows.length,
    vip: rows.filter((r) => r.c.tags.includes('VIP')).length,
    debt: rows.reduce((s, r) => s + Math.max(0, r.balance), 0),
    birthdays: rows.filter((r) => r.c.birthday?.slice(0, 2) === month).length,
  }), [rows, month])

  const exportCsv = () => {
    const head = ['Ad Soyad', 'Telefon', 'Ziyaret', 'Harcama (TL)', 'Son ziyaret', 'Bakiye (TL)', 'Etiketler']
    const lines = filtered.map((r) => [r.c.name, formatPhone(r.c.phone), r.visits, (r.spent / 100).toFixed(2).replace('.', ','), r.last ?? '', (r.balance / 100).toFixed(2).replace('.', ','), r.c.tags.join(' ')].join(';'))
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `musteriler-${today}.csv`
    a.click()
  }

  const selected = id ? repos.customers.get(id) : undefined

  return (
    <div className="page">
      <PageHeader
        title="Müşteriler"
        subtitle={`${totals.count} kayıtlı müşteri`}
        actions={
          <>
            {!isMobile && <Button icon={Download} onClick={exportCsv}>CSV</Button>}
            <Button variant="primary" icon={UserPlus} onClick={() => setCreating(true)}>Yeni müşteri</Button>
          </>
        }
      />

      <div className="kpis" style={{ marginBottom: 16 }}>
        <Kpi icon={Users} label="Toplam müşteri" value={totals.count} />
        <Kpi icon={Crown} label="VIP" value={totals.vip} tone="var(--warning)" />
        <Kpi icon={Wallet} label="Açık veresiye" value={formatTRY(totals.debt)} tone="var(--danger)" />
        <Kpi icon={Cake} label="Bu ay doğum günü" value={totals.birthdays} tone="#e84393" />
      </div>

      <div className="card">
        <div className="cust-toolbar">
          <div style={{ flex: 1, minWidth: 220 }}>
            <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad veya telefon ara…" />
          </div>
          <div className="filter-chips">
            {([
              ['all', 'Tümü'], ['vip', 'VIP'], ['debt', 'Borçlu'], ['birthday', 'Doğum günü'], ['lost', 'Uzun süredir gelmeyen'], ['new', 'Yeni'],
            ] as [Filter, string][]).map(([k, l]) => (
              <button key={k} className={cx('chip', filter === k && 'on')} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon={Users} title="Müşteri bulunamadı" text="Aramayı veya filtreyi değiştirin." />
        ) : isMobile ? (
          <div className="list">
            {filtered.slice(0, limit).map((r) => (
              <div key={r.c.id} className="list-item clickable" onClick={() => nav(`/musteriler/${r.c.id}`)}>
                <Avatar name={r.c.name} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-strong ellipsis">{r.c.name} {r.c.tags.includes('VIP') && <Badge tone="warning">VIP</Badge>}</div>
                  <div className="t-small muted">{formatPhone(r.c.phone)} · {r.visits} ziyaret</div>
                </div>
                {r.balance > 0 && <Badge tone="danger">{formatTRY(r.balance)}</Badge>}
              </div>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Müşteri</th><th>Telefon</th><th>Son ziyaret</th><th>Sıradaki</th><th className="r">Ziyaret</th><th className="r">Harcama</th><th className="r">Bakiye</th></tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((r) => (
                  <tr key={r.c.id} className="clickable" onClick={() => nav(`/musteriler/${r.c.id}`)}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar name={r.c.name} size={32} />
                        <div>
                          <div className="t-strong">{r.c.name}</div>
                          <div className="row" style={{ gap: 4 }}>
                            {r.c.tags.map((t) => <Badge key={t} tone={t === 'VIP' ? 'warning' : 'neutral'}>{t}</Badge>)}
                            {r.noShows >= 2 && <Badge tone="danger">{r.noShows}× gelmedi</Badge>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num muted">{formatPhone(r.c.phone)}</td>
                    <td className="muted">{r.last ? formatDate(r.last) : '—'}</td>
                    <td>{r.next ? <Badge tone="accent">{formatDate(r.next)}</Badge> : <span className="muted">—</span>}</td>
                    <td className="r num">{r.visits}</td>
                    <td className="r num t-strong">{formatTRY(r.spent)}</td>
                    <td className="r num">{r.balance > 0 ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{formatTRY(r.balance)}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > limit && (
          <div style={{ padding: 14, textAlign: 'center' }}>
            <Button size="sm" onClick={() => setLimit((l) => l + 60)}>Daha fazla göster ({filtered.length - limit})</Button>
          </div>
        )}
      </div>

      {creating && <CustomerEditor onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); nav(`/musteriler/${c.id}`) }} />}
      {selected && <CustomerDetail customer={selected} onClose={() => nav('/musteriler')} />}
    </div>
  )
}

export function CustomerEditor({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const repos = useRepos()
  const toast = useToast()
  const [f, setF] = useState({
    name: customer?.name ?? '', phone: customer ? formatPhone(customer.phone) : '', birthday: customer?.birthday ?? '',
    gender: customer?.gender, tags: customer?.tags ?? [], notes: customer?.notes ?? '', consentSms: customer?.consentSms ?? true,
    consentMarketing: customer?.consentMarketing ?? false, consentMarketingAt: customer?.consentMarketingAt, consentMarketingSource: customer?.consentMarketingSource,
  })
  const [err, setErr] = useState<string | null>(null)
  const save = () => {
    const res = customerService(repos).save({ ...customer, ...f, birthday: f.birthday || undefined })
    if (res.ok) { toast(customer ? 'Müşteri güncellendi' : 'Müşteri eklendi'); onSaved(res.customer); return }
    if (res.error === 'duplicate_phone') setErr(`Bu numara ${repos.customers.get(res.existingId!)?.name} adına kayıtlı`)
    else if (res.error === 'invalid_phone') setErr('Geçerli bir cep telefonu girin (05xx xxx xx xx)')
    else setErr('Ad soyad gerekli')
  }
  return (
    <Drawer
      title={customer ? 'Müşteriyi düzenle' : 'Yeni müşteri'}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button variant="primary" onClick={save}>Kaydet</Button></>}
    >
      <Field label="Ad Soyad"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Telefon" error={err}>
        <Input icon={Phone} value={f.phone} inputMode="tel" placeholder="0532 111 22 33" invalid={!!err} onChange={(e) => { setF({ ...f, phone: e.target.value }); setErr(null) }} />
      </Field>
      <div className="grid-2">
        <Field label="Doğum günü" hint="Gün ve ay">
          <Input type="date" value={f.birthday ? `2000-${f.birthday}` : ''} onChange={(e) => setF({ ...f, birthday: e.target.value.slice(5) })} />
        </Field>
        <Field label="Cinsiyet">
          <div className="seg">
            {([['k', 'Kadın'], ['e', 'Erkek']] as const).map(([v, l]) => (
              <button key={v} className={f.gender === v ? 'on' : ''} onClick={() => setF({ ...f, gender: v })}>{l}</button>
            ))}
          </div>
        </Field>
      </div>
      <Field label="Etiketler">
        <div className="svc-chips">
          {TAG_OPTIONS.map((t) => (
            <button key={t} className={cx('chip', f.tags.includes(t) && 'on')} onClick={() => setF({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] })}>{t}</button>
          ))}
        </div>
      </Field>
      <Field label="Notlar & formül" hint="Boya numarası, oksidan, hassasiyetler… Randevu açılınca görünür.">
        <Textarea value={f.notes} rows={4} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><div className="t-strong">Randevu bilgilendirme mesajları</div><div className="t-small muted">Onay, hatırlatma ve iptal mesajları (WhatsApp, hizmet mesajı)</div></div>
        <Switch on={f.consentSms} onChange={(v) => setF({ ...f, consentSms: v })} label="İleti izni" />
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="t-strong">Kampanya mesajı izni</div>
          <div className="t-small muted">{f.consentMarketing && f.consentMarketingAt
            ? `Açık rıza: ${formatDate(f.consentMarketingAt.slice(0, 10), { year: true })} · ${f.consentMarketingSource === 'online' ? 'online randevuda' : 'salonda'}`
            : 'Yalnız müşterinin açık rızasıyla açın (yazılı/sözlü onay alın)'}</div>
        </div>
        <Switch on={f.consentMarketing} label="Kampanya izni" onChange={(v) => setF({ ...f, consentMarketing: v, consentMarketingAt: v ? new Date().toISOString() : undefined, consentMarketingSource: v ? 'salon' : undefined })} />
      </div>
    </Drawer>
  )
}

function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const repos = useRepos()
  const { branch, tenant } = useSession()
  const [tab, setTab] = useState<'general' | 'color' | 'appts' | 'sales' | 'packages'>('general')
  const [sellPkg, setSellPkg] = useState('')
  const { user } = useSession()
  const nav = useNavigate()
  const [editing, setEditing] = useState(false)
  const [booking, setBooking] = useState(false)
  const stats = customerService(repos).stats(customer.id)
  const appts = repos.appointments.list({ customerId: customer.id }).sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start)
  const tickets = repos.tickets.list({ customerId: customer.id, status: 'closed' }).sort((a, b) => b.date.localeCompare(a.date))
  const packages = repos.customerPackages.list({ customerId: customer.id })
  const svcName = (id: string) => repos.services.get(id)?.name ?? ''
  const today = todayIstanbul()
  const firstStaff = repos.staff.list({ branchId: branch?.id ?? '', active: true })[0]

  if (editing) return <CustomerEditor customer={customer} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
  if (booking && branch && firstStaff) {
    return <AppointmentForm branchId={branch.id} initial={{ staffId: firstStaff.id, date: addDays(today, 1), start: 600, customerId: customer.id }} onClose={() => setBooking(false)} onSaved={() => setBooking(false)} />
  }

  return (
    <Drawer
      wide
      title={customer.name}
      subtitle={`Müşteri · ${formatDate(customer.createdAt.slice(0, 10), { year: true })} tarihinden beri`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => setEditing(true)}>Düzenle</Button>
          <div className="spacer" />
          <Button icon={MessageCircle} onClick={() => window.open(whatsappUrl(customer.phone, `Merhaba ${customer.name.split(' ')[0]}, ${tenant?.name ?? ''} olarak`), '_blank', 'noopener')}>WhatsApp</Button>
          <Button variant="primary" icon={CalendarPlus} onClick={() => setBooking(true)}>Randevu ver</Button>
        </>
      }
    >
      <div className="detail-hero">
        <Avatar name={customer.name} size={56} />
        <div>
          <h3>{customer.name}</h3>
          <p>
            <a href={`tel:+90${customer.phone}`}><Phone size={12} /> {formatPhone(customer.phone)}</a>
            {customer.birthday && <> · <Cake size={12} /> {formatDate(`2000-${customer.birthday}`)}</>}
          </p>
          <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {customer.tags.map((t) => <Badge key={t} tone={t === 'VIP' ? 'warning' : 'neutral'}>{t}</Badge>)}
            {!customer.consentSms && <Badge>İleti izni yok</Badge>}
          </div>
        </div>
      </div>

      <div className="cust-stats">
        <div><span>Ziyaret</span><b>{stats.visits}</b></div>
        <div><span>Toplam harcama</span><b>{formatTRY(stats.totalSpent)}</b></div>
        <div><span>Son ziyaret</span><b>{stats.lastVisit ? formatDate(stats.lastVisit) : '—'}</b></div>
        <div className={stats.balance > 0 ? 'danger' : ''}><span>Bakiye</span><b>{stats.balance > 0 ? formatTRY(stats.balance) : '—'}</b></div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'general', label: 'Notlar' },
          { value: 'color', label: 'Boya kartı', count: repos.colorCards.list({ customerId: customer.id }).length },
          { value: 'appts', label: 'Randevular', count: appts.length },
          { value: 'sales', label: 'Satışlar', count: tickets.length },
          { value: 'packages', label: 'Paketler', count: packages.length },
        ]}
      />

      {tab === 'general' && (
        <div className="stack">
          {customer.notes ? <div className="note-box" style={{ whiteSpace: 'pre-wrap' }}>📝 {customer.notes}</div> : <p className="muted">Not yok. Düzenle ile boya formülü, tercihler ekleyebilirsiniz.</p>}
          {stats.noShows > 0 && <div className="conflict-box">Bu müşteri {stats.noShows} kez randevusuna gelmedi.</div>}
        </div>
      )}
      {tab === 'color' && <ColorCards customer={customer} />}
      {tab === 'appts' && (
        <div className="list card">
          {appts.length === 0 && <p className="muted" style={{ padding: 14 }}>Randevu yok.</p>}
          {appts.slice(0, 50).map((a) => (
            <div key={a.id} className="list-item">
              <div className="date-chip"><b>{a.date.slice(8)}</b><span>{formatDate(a.date).split(' ')[1].slice(0, 3)}</span></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-strong ellipsis">{a.items.map((i) => svcName(i.serviceId)).join(' + ')}</div>
                <div className="t-small muted">{toHHMM(a.start)} · {repos.staff.get(a.staffId)?.name}</div>
              </div>
              <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
            </div>
          ))}
        </div>
      )}
      {tab === 'sales' && (
        <div className="list card">
          {tickets.length === 0 && <p className="muted" style={{ padding: 14 }}>Satış yok.</p>}
          {tickets.slice(0, 50).map((t) => {
            const tt = ticketTotals(t)
            return (
              <div key={t.id} className="list-item">
                <div className="date-chip"><b>{t.date.slice(8)}</b><span>{formatDate(t.date).split(' ')[1].slice(0, 3)}</span></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-strong ellipsis">{t.lines.map((l) => l.name).join(', ')}</div>
                  <div className="t-small muted">{t.payments.map((p) => ({ cash: 'Nakit', card: 'Kart', transfer: 'Havale', debt: 'Veresiye' })[p.method]).join(' + ')}</div>
                </div>
                <b className="num">{formatTRY(tt.total)}</b>
              </div>
            )
          })}
        </div>
      )}
      {tab === 'packages' && (
        <div className="stack">
          <div className="card card-pad pkg-sell">
            <b>Paket sat</b>
            <div className="row">
              <Select value={sellPkg} onChange={(e) => setSellPkg(e.target.value)}>
                <option value="">Paket seçin…</option>
                {repos.packageDefs.list({ active: true }).map((d) => <option key={d.id} value={d.id}>{d.name} · {formatTRY(d.price)}</option>)}
              </Select>
              <Button variant="primary" disabled={!sellPkg || !branch} onClick={() => {
                const def = repos.packageDefs.get(sellPkg)!
                const cash = cashService(repos, user)
                const t = cash.openTicket({ branchId: branch!.id, customerId: customer.id })
                cash.addLine(t.id, { kind: 'package_sale', refId: def.id, name: def.name, qty: 1, unitPrice: def.price, discount: null })
                nav(`/kasa?adisyon=${t.id}`)
              }}>Ödemeye geç</Button>
            </div>
            <span className="t-small muted">Ödeme alınınca paket müşteriye tanımlanır; her gelişinde ilgili hizmet otomatik paketten düşer.</span>
          </div>
          {packages.length === 0 && <p className="muted">Aktif paket yok.</p>}
          {packages.map((p) => {
            const def = repos.packageDefs.get(p.packageDefId)
            const expired = p.expiresOn < today
            return (
              <div key={p.id} className={cx('card card-pad pkg-card', expired && 'expired')}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>{def?.name}</b>
                  <Badge tone={expired ? 'neutral' : 'success'}>{expired ? 'Süresi doldu' : `${formatDate(p.expiresOn)}'e kadar`}</Badge>
                </div>
                {Object.entries(p.remaining).map(([sid, n]) => {
                  const it = def?.items.find((i) => i.serviceId === sid)
                  const total = it ? it.count + (it.bonus ?? 0) : n
                  return (
                    <div key={sid} className="pkg-line">
                      <span>{svcName(sid)}</span>
                      <div className="pkg-dots">{Array.from({ length: total }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</div>
                      <b>{n}/{total}</b>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </Drawer>
  )
}
