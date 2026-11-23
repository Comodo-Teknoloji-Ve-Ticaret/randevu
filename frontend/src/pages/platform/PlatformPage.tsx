import {
  AlarmClock, Building2, CalendarPlus, Copy, ExternalLink, Link2, MessageCircle, MoreHorizontal, Pause, Play, Plus, RefreshCw, Scissors, ShieldAlert, Wallet,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { platformService, slugify } from '../../application/platformService'
import { BUSINESS_TYPES, businessTypeLabel, licenseStatus, type LicenseStatus } from '../../domain/license'
import { formatTRY } from '../../domain/money'
import { ticketTotals } from '../../domain/ticket'
import { addDays, formatDate, todayIstanbul } from '../../domain/time'
import type { BusinessType, Tenant } from '../../domain/types'
import { useDbSnapshot, useStore } from '../../infrastructure'
import { Badge, Button, cx, Drawer, Field, Input, Kpi, Modal, PageHeader, Popover, Segmented, Select, useConfirm, useToast } from '../../ui'
import { bookingUrl } from '../settings/SettingsPage'
import '../settings/settings.css'
import './platform.css'

const PLAN_LABEL = { baslangic: 'Başlangıç', pro: 'Pro', kurumsal: 'Kurumsal' }
const PLAN_PRICE = { baslangic: 79900, pro: 149900, kurumsal: 299900 }
type LicFilter = 'all' | 'expiring' | 'expired'

export const inviteUrl = (token: string) => `${location.origin}${location.pathname}#/davet/${token}`

function LicenseCell({ ls, days }: { ls: LicenseStatus; days: number }) {
  const pct = Math.min(100, Math.round((ls.used / Math.max(1, days)) * 100))
  const text =
    ls.state === 'locked' ? 'Kilitli · lisans bitti' :
    ls.state === 'grace' ? `Süre doldu · ${ls.graceLeft} gün ek süre` :
    ls.remaining === 0 ? 'Bugün son gün' : `${ls.remaining} gün kaldı`
  return (
    <div className={cx('lic', ls.state)}>
      <div className="lic-top"><b>{text}</b><span>{ls.used}/{days} gün</span></div>
      <div className="lic-bar"><i style={{ width: `${ls.state === 'grace' || ls.state === 'locked' ? 100 : pct}%` }} /></div>
      <span className="lic-end">Bitiş: {formatDate(ls.end, { year: true })}</span>
    </div>
  )
}

export default function PlatformPage() {
  const db = useDbSnapshot()
  const store = useStore()
  const toast = useToast()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const [invite, setInvite] = useState<Tenant | null>(null)
  const [extend, setExtend] = useState<Tenant | null>(null)
  const [type, setType] = useState<BusinessType | 'all'>('all')
  const [lic, setLic] = useState<LicFilter>('all')
  const today = todayIstanbul()
  const since = addDays(today, -29)
  const ps = platformService(store)

  const rows = useMemo(() => db.tenants.map((t) => ({
    t,
    ls: licenseStatus(t.license, today),
    branches: db.branches.filter((b) => b.tenantId === t.id).length,
    appts: db.appointments.filter((a) => a.tenantId === t.id && a.date >= since && a.date <= today).length,
    revenue: db.tickets.filter((k) => k.tenantId === t.id && k.status === 'closed' && k.date >= since).reduce((s, k) => s + ticketTotals(k).total, 0),
  })), [db, today, since])

  const filtered = rows
    .filter((r) => type === 'all' || r.t.businessType === type)
    .filter((r) => lic === 'all' || (lic === 'expiring' ? r.ls.state === 'expiring' : r.ls.state === 'grace' || r.ls.state === 'locked'))
    .sort((a, b) => a.ls.remaining - b.ls.remaining)

  const active = rows.filter((r) => r.t.status === 'active' && r.ls.state !== 'locked')
  const expiring = rows.filter((r) => r.ls.state === 'expiring').length
  const expired = rows.filter((r) => r.ls.state === 'grace' || r.ls.state === 'locked').length
  const mrr = active.reduce((s, r) => s + PLAN_PRICE[r.t.plan], 0)
  const typeCounts = new Map<BusinessType, number>()
  for (const r of rows) typeCounts.set(r.t.businessType, (typeCounts.get(r.t.businessType) ?? 0) + 1)

  return (
    <div className="page">
      <PageHeader title="İşletmeler" subtitle="Comodo platform yönetimi · lisans ve erişim" actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Yeni işletme</Button>} />
      <div className="kpis" style={{ marginBottom: 16 }}>
        <Kpi icon={Building2} label="Aktif işletme" value={`${active.length} / ${rows.length}`} />
        <Kpi icon={AlarmClock} label="7 gün içinde bitecek" value={expiring} tone="var(--warning)" />
        <Kpi icon={ShieldAlert} label="Süresi dolmuş" value={expired} tone="var(--danger)" />
        <Kpi icon={Wallet} label="Aylık abonelik geliri (örnek)" value={formatTRY(mrr)} tone="var(--success)" />
      </div>

      <div className="plat-filters">
        <div className="filter-chips">
          <button className={cx('chip', type === 'all' && 'on')} onClick={() => setType('all')}>Tümü <span className="chip-n">{rows.length}</span></button>
          {BUSINESS_TYPES.filter((b) => typeCounts.has(b.value)).map((b) => (
            <button key={b.value} className={cx('chip', type === b.value && 'on')} onClick={() => setType(b.value)}>
              <i className="type-dot" style={{ background: b.color }} />{b.label} <span className="chip-n">{typeCounts.get(b.value)}</span>
            </button>
          ))}
        </div>
        <Segmented value={lic} onChange={setLic} options={[{ value: 'all', label: 'Tüm lisanslar' }, { value: 'expiring', label: `Yaklaşan (${expiring})` }, { value: 'expired', label: `Dolmuş (${expired})` }]} />
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="table plat-table">
            <thead><tr><th>İşletme</th><th style={{ width: 240 }}>Lisans</th><th>Paket</th><th className="r">30 gün randevu</th><th className="r">30 gün ciro</th><th>Durum</th><th /></tr></thead>
            <tbody>
              {filtered.map(({ t, ls, branches, appts, revenue }) => {
                const bt = BUSINESS_TYPES.find((b) => b.value === t.businessType)
                const pendingInvite = t.invite && !t.invite.usedAt
                return (
                  <tr key={t.id}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <span className="set-ico" style={{ background: t.logoColor, color: '#fff' }}><Scissors /></span>
                        <div>
                          <div className="t-strong">{t.name}</div>
                          <div className="row" style={{ gap: 6, marginTop: 2 }}>
                            <span className="type-tag" style={{ ['--tc' as string]: bt?.color }}>{bt?.label}</span>
                            <span className="t-small muted">{branches} şube</span>
                            {pendingInvite && <Badge tone="warning">Davet bekliyor</Badge>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><LicenseCell ls={ls} days={t.license.days} /></td>
                    <td><Badge tone="accent">{PLAN_LABEL[t.plan]}</Badge></td>
                    <td className="r num">{appts}</td>
                    <td className="r num t-strong">{formatTRY(Math.round(revenue / 100) * 100)}</td>
                    <td>
                      {t.status === 'suspended' ? <Badge tone="danger" dot>Askıda</Badge> : ls.state === 'locked' ? <Badge tone="danger" dot>Kilitli</Badge> : ls.state === 'grace' ? <Badge tone="warning" dot>Ek süre</Badge> : <Badge tone="success" dot>Aktif</Badge>}
                    </td>
                    <td className="r">
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant={ls.state === 'active' ? 'secondary' : 'primary'} icon={CalendarPlus} onClick={() => setExtend(t)}>Uzat</Button>
                        <Button size="sm" icon={Link2} onClick={() => setInvite(t)}>Davet</Button>
                        <Popover trigger={(open) => <button className="icon-btn" aria-label="Diğer" onClick={open}><MoreHorizontal /></button>}>
                          {(close) => (
                            <>
                              <button onClick={() => { close(); window.open(bookingUrl(t.slug), '_blank') }}><ExternalLink /> Online randevu sayfası</button>
                              {t.status === 'active' ? (
                                <button onClick={async () => {
                                  close()
                                  if (await confirm({ title: `${t.name} askıya alınsın mı?`, text: 'Kullanıcılar giriş yapamaz ve online randevu kapanır. Veriler silinmez.', danger: true, confirm: 'Askıya al' })) { ps.setStatus(t.id, 'suspended'); toast('Askıya alındı') }
                                }}><Pause /> Askıya al</button>
                              ) : (
                                <button onClick={() => { close(); ps.setStatus(t.id, 'active'); toast('Aktifleştirildi') }}><Play /> Aktifleştir</button>
                              )}
                            </>
                          )}
                        </Popover>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="muted" style={{ padding: 24, textAlign: 'center' }}>Bu filtreye uyan işletme yok.</p>}
        </div>
      </div>

      {creating && <NewBusiness onClose={() => setCreating(false)} onCreated={(t) => { setCreating(false); setInvite(t) }} />}
      {invite && <InviteModal tenantId={invite.id} onClose={() => setInvite(null)} />}
      {extend && <ExtendModal tenantId={extend.id} onClose={() => setExtend(null)} />}
    </div>
  )
}

function InviteModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const db = useDbSnapshot()
  const store = useStore()
  const toast = useToast()
  const t = db.tenants.find((x) => x.id === tenantId)!
  const owner = db.users.find((u) => u.tenantId === t.id && u.role === 'owner')
  const inv = t.invite
  const url = inv ? inviteUrl(inv.token) : ''
  const msg = `Merhaba${owner ? ` ${owner.name.split(' ')[0]}` : ''}, ${t.name} için RandevuHazır salon paneliniz hazır. Bu bağlantıdan giriş yapabilirsiniz: ${url}`
  return (
    <Modal title={`Davet linki · ${t.name}`} onClose={onClose} footer={<Button variant="ghost" onClick={onClose}>Kapat</Button>}>
      {!inv || inv.usedAt ? (
        <>
          <div className="pay-status ok" style={{ textAlign: 'left' }}>{inv?.usedAt ? `Davet ${formatDate(inv.usedAt, { year: true })} tarihinde kullanıldı.` : 'Aktif davet yok.'}</div>
          <p className="muted t-small">Sahip erişimini kaybettiyse yeni link üretebilirsiniz; eski link geçersiz olur.</p>
          <Button variant="primary" icon={RefreshCw} onClick={() => { platformService(store).newInvite(t.id); toast('Yeni davet linki oluşturuldu') }}>Yeni link üret</Button>
        </>
      ) : (
        <>
          <p className="muted">Bu linki işletme sahibine gönderin. Linke tıklayan kişi adını ve telefonunu girip doğrudan <b>salon sahibi</b> olarak paneline girer. Link tek kullanımlıktır.</p>
          <div className="invite-box">
            <code>{url}</code>
            <Button icon={Copy} onClick={() => { navigator.clipboard?.writeText(url); toast('Link kopyalandı') }}>Kopyala</Button>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="success" icon={MessageCircle} onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')}>WhatsApp ile gönder</Button>
            <Button icon={Copy} onClick={() => { navigator.clipboard?.writeText(msg); toast('Mesaj kopyalandı') }}>Mesajı kopyala</Button>
            <Button variant="ghost" icon={RefreshCw} onClick={() => { platformService(store).newInvite(t.id); toast('Yeni link üretildi; eskisi geçersiz') }}>Yenile</Button>
          </div>
          <p className="t-small muted">Oluşturulma: {formatDate(inv.createdAt, { year: true })}</p>
        </>
      )}
    </Modal>
  )
}

function ExtendModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const db = useDbSnapshot()
  const store = useStore()
  const toast = useToast()
  const t = db.tenants.find((x) => x.id === tenantId)!
  const today = todayIstanbul()
  const ls = licenseStatus(t.license, today)
  const [days, setDays] = useState(30)
  const newEnd = ls.remaining < 0 ? addDays(today, days) : addDays(ls.end, days)
  return (
    <Modal
      title={`Lisans uzat · ${t.name}`}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button variant="primary" icon={CalendarPlus} onClick={() => { platformService(store).extendLicense(t.id, days); toast(`Lisans ${formatDate(newEnd, { year: true })} tarihine uzatıldı`); onClose() }}>{days} gün uzat</Button></>}
    >
      <LicenseCell ls={ls} days={t.license.days} />
      <Field label="Süre">
        <div className="ext-opts">
          {[30, 90, 180, 365].map((d) => (
            <button key={d} className={cx('pay-q', days === d && 'on')} onClick={() => setDays(d)}><b>{d === 365 ? '1 yıl' : `${d} gün`}</b><span>{d === 30 ? 'Aylık' : d === 90 ? '3 ay' : d === 180 ? '6 ay' : 'Yıllık'}</span></button>
          ))}
        </div>
      </Field>
      <div className="summary-box" style={{ background: 'var(--surface-2)', borderRadius: 14, padding: '12px 14px' }}>
        <div className="sum-row"><span className="muted">Mevcut bitiş</span><span>{formatDate(ls.end, { year: true })}</span></div>
        <div className="sum-row"><span className="muted">Yeni bitiş</span><b>{formatDate(newEnd, { year: true })}</b></div>
        {ls.remaining < 0 && <p className="t-small muted" style={{ marginTop: 6 }}>Süre dolduğu için yeni dönem bugünden başlar.</p>}
      </div>
    </Modal>
  )
}

function NewBusiness({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Tenant) => void }) {
  const store = useStore()
  const toast = useToast()
  const [f, setF] = useState({ name: '', slug: '', ownerName: '', branchName: 'Merkez', plan: 'pro' as Tenant['plan'], businessType: 'kuafor' as BusinessType, licenseDays: 30 })
  const [err, setErr] = useState<string | null>(null)
  const slug = f.slug || slugify(f.name)
  return (
    <Drawer title="Yeni işletme" subtitle="İşletme, ilk şube, sahip hesabı ve davet linki oluşturulur" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button variant="primary" disabled={!f.name.trim() || !f.ownerName.trim()} onClick={() => {
      const r = platformService(store).createSalon({ ...f, slug })
      if (!r.ok) { setErr(r.error === 'slug_taken' ? 'Bu bağlantı adı kullanılıyor' : 'Bilgileri kontrol edin'); return }
      toast(`${r.tenant.name} oluşturuldu`)
      onCreated(r.tenant)
    }}>Oluştur ve davet linkini al</Button></>}>
      <Field label="İşletme türü">
        <div className="type-grid">
          {BUSINESS_TYPES.map((b) => (
            <button key={b.value} className={cx('type-opt', f.businessType === b.value && 'on')} style={{ ['--tc' as string]: b.color }} onClick={() => setF({ ...f, businessType: b.value })}>
              <i />{b.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="İşletme adı"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={`Örn. ${f.businessType === 'dis' ? 'Gülüş Diş Kliniği' : f.businessType === 'berber' ? 'Comodo Berber' : 'Saç Atölyesi'}`} /></Field>
      <Field label="Bağlantı adı" error={err} hint={`Online randevu: …/#/r/${slug || 'isletme-adi'}`}><Input value={f.slug} placeholder={slugify(f.name) || 'isletme-adi'} onChange={(e) => { setF({ ...f, slug: e.target.value }); setErr(null) }} /></Field>
      <div className="grid-2">
        <Field label="İşletme sahibinin adı"><Input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
        <Field label="İlk şube"><Input value={f.branchName} onChange={(e) => setF({ ...f, branchName: e.target.value })} /></Field>
      </div>
      <div className="grid-2">
        <Field label="Lisans süresi" hint={`Bitiş: ${formatDate(addDays(todayIstanbul(), f.licenseDays), { year: true })}`}>
          <Select value={f.licenseDays} onChange={(e) => setF({ ...f, licenseDays: Number(e.target.value) })}>
            {[[14, '14 gün (deneme)'], [30, '30 gün'], [90, '90 gün'], [180, '180 gün'], [365, '1 yıl']].map(([d, l]) => <option key={d} value={d}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Paket">
          <Select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value as Tenant['plan'] })}>
            {(Object.keys(PLAN_LABEL) as Tenant['plan'][]).map((p) => <option key={p} value={p}>{PLAN_LABEL[p]} · {formatTRY(PLAN_PRICE[p])}/ay</option>)}
          </Select>
        </Field>
      </div>
      <p className="t-small muted">Hizmet kategorileri {businessTypeLabel(f.businessType).toLocaleLowerCase('tr-TR')} için hazır gelir; işletme sahibi hizmet, personel ve fiyatları kendi panelinden ekler.</p>
    </Drawer>
  )
}
