import { Building2, Copy, CreditCard, Landmark, ExternalLink, Globe, Monitor, Moon, Palette, Plus, Sun, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { newId } from '../../application/db'
import { platformService, slugify } from '../../application/platformService'
import { ROLE_LABEL } from '../../app/permissions'
import { useSession } from '../../app/session'
import { formatPhone } from '../../domain/phone'
import type { Branch, Role, User } from '../../domain/types'
import { httpStore, useRepos, useStore } from '../../infrastructure'
import { apiFetch, apiMode } from '../../infrastructure/api'
import { Avatar, Badge, Button, cx, Drawer, Field, Input, PageHeader, Select, Switch, useToast } from '../../ui'
import { HoursEditor } from '../staff/StaffPage'
import { LegalDialog, type LegalDoc } from '../../ui/LegalDialog'
import '../staff/staff.css'
import './settings.css'

type Section = 'salon' | 'branches' | 'accounts' | 'users' | 'online' | 'theme'
const SECTIONS: { key: Section; label: string; icon: typeof Building2 }[] = [
  { key: 'salon', label: 'Salon', icon: Palette },
  { key: 'branches', label: 'Şubeler & saatler', icon: Building2 },
  { key: 'accounts', label: 'POS & banka hesapları', icon: CreditCard },
  { key: 'users', label: 'Kullanıcılar', icon: Users },
  { key: 'online', label: 'Online randevu', icon: Globe },
  { key: 'theme', label: 'Görünüm', icon: Sun },
]
const BRAND_COLORS = ['#6c5ce7', '#12a37b', '#0984e3', '#e17055', '#e84393', '#2d3436', '#b8860b', '#00b894']
const PLAN_LABEL = { baslangic: 'Başlangıç', pro: 'Pro', kurumsal: 'Kurumsal' }

export const bookingUrl = (slug: string) => `${location.origin}${location.pathname}#/r/${slug}`

export default function SettingsPage() {
  const [sec, setSec] = useState<Section>('salon')
  return (
    <div className="page">
      <PageHeader title="Ayarlar" subtitle="Salon bilgileri, şubeler, kullanıcılar ve online randevu" />
      <div className="set-layout">
        <nav className="set-nav card">
          {SECTIONS.map((s) => (
            <button key={s.key} className={cx(sec === s.key && 'on')} onClick={() => setSec(s.key)}><s.icon />{s.label}</button>
          ))}
        </nav>
        <div className="set-body">
          {sec === 'salon' && <SalonSection />}
          {sec === 'branches' && <BranchesSection />}
          {sec === 'accounts' && <AccountsSection />}
          {sec === 'users' && <UsersSection />}
          {sec === 'online' && <OnlineSection />}
          {sec === 'theme' && <ThemeSection />}
        </div>
      </div>
    </div>
  )
}

function SalonSection() {
  const repos = useRepos()
  const store = useStore()
  const toast = useToast()
  const { tenant } = useSession()
  const [name, setName] = useState(tenant?.name ?? '')
  const [slug, setSlug] = useState(tenant?.slug ?? '')
  if (!tenant) return null
  const save = () => {
    const s = slugify(slug)
    if (!s) return toast('Bağlantı adı geçersiz', 'error')
    if (platformService(store).slugTaken(s, tenant.id)) return toast('Bu bağlantı adı başka bir salonda kullanılıyor', 'error')
    repos.tenants.upsert({ ...tenant, name: name.trim(), slug: s })
    setSlug(s)
    toast('Salon bilgileri kaydedildi')
  }
  return (
    <div className="card card-pad stack">
      <h3 className="set-h">Salon bilgileri</h3>
      <div className="grid-2">
        <Field label="Salon adı"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Paket"><div className="row" style={{ height: 40 }}><Badge tone="accent">{PLAN_LABEL[tenant.plan]}</Badge><span className="t-small muted">Değişiklik için Comodo ile iletişime geçin</span></div></Field>
      </div>
      <Field label="Marka rengi" hint="Logo ve online randevu sayfasında kullanılır.">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {BRAND_COLORS.map((c) => <button key={c} className={cx('color-dot', tenant.logoColor === c && 'on')} style={{ background: c }} aria-label={c} onClick={() => repos.tenants.upsert({ ...tenant, logoColor: c })} />)}
        </div>
      </Field>
      <Field label="Online randevu bağlantısı" hint="Instagram profilinize, Google İşletme sayfanıza veya WhatsApp'a ekleyin.">
        <div className="row">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
          <Button icon={Copy} onClick={() => { navigator.clipboard?.writeText(bookingUrl(tenant.slug)); toast('Bağlantı kopyalandı') }}>Kopyala</Button>
          <Button icon={ExternalLink} onClick={() => window.open(bookingUrl(tenant.slug), '_blank')}>Aç</Button>
        </div>
        <code className="set-url">{bookingUrl(tenant.slug)}</code>
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" onClick={save}>Kaydet</Button></div>
    </div>
  )
}

function BranchesSection() {
  const repos = useRepos()
  const toast = useToast()
  const [edit, setEdit] = useState<Branch | 'new' | null>(null)
  const branches = repos.branches.list()
  return (
    <div className="card">
      <div className="card-head"><h3>Şubeler</h3><Button size="sm" icon={Plus} onClick={() => setEdit('new')}>Şube ekle</Button></div>
      <div className="list" style={{ marginTop: 10 }}>
        {branches.map((b) => (
          <div key={b.id} className="list-item clickable" onClick={() => setEdit(b)}>
            <span className="set-ico"><Building2 /></span>
            <div style={{ flex: 1 }}><div className="t-strong">{b.name}</div><div className="t-small muted">{b.address || 'Adres girilmemiş'}{b.phone && ` · ${formatPhone(b.phone)}`}</div></div>
            <span className="t-small muted">{repos.staff.list({ branchId: b.id, active: true }).length} personel</span>
          </div>
        ))}
      </div>
      {edit && <BranchEditor branch={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => { toast('Şube kaydedildi'); setEdit(null) }} />}
    </div>
  )
}

function BranchEditor({ branch, onClose, onSaved }: { branch?: Branch; onClose: () => void; onSaved: () => void }) {
  const repos = useRepos()
  const [f, setF] = useState<Omit<Branch, 'id' | 'tenantId'>>(branch ?? { name: '', address: '', phone: '', hours: { 0: null, 1: { open: 540, close: 1200 }, 2: { open: 540, close: 1200 }, 3: { open: 540, close: 1200 }, 4: { open: 540, close: 1200 }, 5: { open: 540, close: 1200 }, 6: { open: 540, close: 1200 } } })
  return (
    <Drawer wide title={branch ? branch.name : 'Yeni şube'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Vazgeç</Button><Button variant="primary" disabled={!f.name.trim()} onClick={() => {
      const saved = repos.branches.upsert({ ...branch, ...f })
      if (!branch) for (const u of repos.users.list()) if (u.role === 'owner' || u.role === 'reception') repos.users.upsert({ ...u, branchIds: [...u.branchIds, saved.id] })
      onSaved()
    }}>Kaydet</Button></>}>
      <div className="grid-2">
        <Field label="Şube adı"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Telefon"><Input value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '') })} /></Field>
      </div>
      <Field label="Adres"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <Field label="Çalışma saatleri" hint="Personel mesaileri bu saatlerle sınırlanır."><HoursEditor value={f.hours} onChange={(hours) => setF({ ...f, hours })} /></Field>
    </Drawer>
  )
}

function AccountsSection() {
  const repos = useRepos()
  const { tenant } = useSession()
  const toast = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'pos' | 'bank'>('pos')
  if (!tenant) return null
  const save = (accounts: typeof tenant.accounts) => repos.tenants.upsert({ ...tenant, accounts })
  const groups = [
    { k: 'pos' as const, title: 'POS cihazları (kart)', icon: CreditCard, hint: 'Örn. Garanti POS, Ziraat POS' },
    { k: 'bank' as const, title: 'Banka hesapları (havale / EFT)', icon: Landmark, hint: 'Örn. İş Bankası, Garanti' },
  ]
  return (
    <div className="stack">
      {groups.map((g) => {
        const list = tenant.accounts.filter((a) => a.kind === g.k)
        return (
          <div key={g.k} className="card">
            <div className="card-head"><h3 className="row" style={{ gap: 8 }}><g.icon size={17} /> {g.title}</h3></div>
            <div className="list" style={{ marginTop: 8 }}>
              {list.length === 0 && <p className="muted t-small" style={{ padding: 14 }}>Tanımlı değil. {g.hint}</p>}
              {list.map((a) => (
                <div key={a.id} className="list-item">
                  <input
                    className="input"
                    defaultValue={a.name}
                    style={{ flex: 1, height: 36 }}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== a.name) { save(tenant.accounts.map((x) => (x.id === a.id ? { ...x, name: v } : x))); toast('Kaydedildi') } }}
                  />
                  <span className="t-small muted">{a.active ? 'Kullanımda' : 'Pasif'}</span>
                  <Switch on={a.active} onChange={(v) => save(tenant.accounts.map((x) => (x.id === a.id ? { ...x, active: v } : x)))} label="Aktif" />
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <div className="card card-pad stack">
        <h3 className="set-h">Yeni ekle</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="seg">
            <button className={kind === 'pos' ? 'on' : ''} onClick={() => setKind('pos')}>POS cihazı</button>
            <button className={kind === 'bank' ? 'on' : ''} onClick={() => setKind('bank')}>Banka hesabı</button>
          </div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'pos' ? 'Örn. Ziraat POS' : 'Örn. Garanti (Havale)'} style={{ flex: 1, minWidth: 180 }} />
          <Button variant="primary" icon={Plus} disabled={!name.trim()} onClick={() => {
            save([...tenant.accounts, { id: `acc_${Math.random().toString(36).slice(2, 9)}`, name: name.trim(), kind, active: true }])
            toast(`${name.trim()} eklendi`); setName('')
          }}>Ekle</Button>
        </div>
        <p className="t-small muted">Kasada kart veya havale ile ödeme alırken ve gider girerken bu listeden seçilir; gün sonunda her biri ayrı görünür. Pasif yapılanlar seçimde çıkmaz, geçmiş kayıtları korunur.</p>
      </div>
    </div>
  )
}

function UsersSection() {
  const repos = useRepos()
  const toast = useToast()
  const { user: me } = useSession()
  const [edit, setEdit] = useState<User | 'new' | null>(null)
  const users = repos.users.list()
  // Sunucu modu: kullanıcıların giriş e-postaları (şifreler asla gelmez)
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [emailsVersion, setEmailsVersion] = useState(0)
  useEffect(() => {
    if (apiMode) apiFetch<Record<string, string>>('/api/users/emails').then(setEmails).catch(() => setEmails({}))
  }, [emailsVersion])
  return (
    <div className="card">
      <div className="card-head"><h3>Kullanıcılar & roller</h3><Button size="sm" icon={UserPlus} onClick={() => setEdit('new')}>Kullanıcı ekle</Button></div>
      <div className="role-help">
        <div><b>Salon Sahibi</b><span>Her şey: raporlar, ayarlar, kasa açma</span></div>
        <div><b>Resepsiyon</b><span>Takvim, müşteri, kasa, stok, mesaj</span></div>
        <div><b>Personel</b><span>Kendi takvimi ve primi</span></div>
      </div>
      <div className="list">
        {users.map((u) => (
          <div key={u.id} className="list-item clickable" onClick={() => setEdit(u)}>
            <Avatar name={u.name} size={34} />
            <div style={{ flex: 1 }}><div className="t-strong">{u.name}{u.id === me?.id && <span className="muted t-small"> (siz)</span>}</div><div className="t-small muted">{u.branchIds.map((b) => repos.branches.get(b)?.name).join(', ')}{apiMode && <> · {emails[u.id] ?? <span style={{ color: 'var(--warning)' }}>giriş bilgisi yok</span>}</>}</div></div>
            <Badge tone={u.role === 'owner' ? 'accent' : u.role === 'reception' ? 'info' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge>
          </div>
        ))}
      </div>
      {edit && <UserEditor user={edit === 'new' ? undefined : edit} email={edit === 'new' ? '' : emails[edit.id] ?? ''} onClose={() => setEdit(null)} onSaved={() => { toast('Kullanıcı kaydedildi'); setEdit(null); setEmailsVersion((v) => v + 1) }} />}
    </div>
  )
}

function UserEditor({ user, email, onClose, onSaved }: { user?: User; email: string; onClose: () => void; onSaved: () => void }) {
  const repos = useRepos()
  const toast = useToast()
  const { user: me } = useSession()
  const branches = repos.branches.list()
  const staff = repos.staff.list({ active: true })
  const [f, setF] = useState({ name: user?.name ?? '', role: (user?.role ?? 'reception') as Exclude<Role, 'platform'>, staffId: user?.staffId ?? '', branchIds: user?.branchIds ?? branches.map((b) => b.id), email, password: '' })
  const [busy, setBusy] = useState(false)
  const isMe = user?.id === me?.id
  // Sunucu modu: e-posta değişti ya da şifre yazıldıysa giriş bilgisi güncellenir (ikisi birlikte gerekir).
  const loginChange = apiMode && (f.password !== '' || (f.email.trim() !== email && f.email.trim() !== ''))
  const loginInvalid = loginChange && (!f.email.includes('@') || f.password.length < 8)

  const save = async () => {
    const saved = repos.users.upsert({ ...user, id: user?.id ?? newId('u_'), name: f.name.trim(), role: f.role, staffId: f.staffId || undefined, branchIds: f.branchIds })
    if (!loginChange) { onSaved(); return }
    setBusy(true)
    try {
      await httpStore().settled() // kullanıcı önce sunucuya yazılmalı
      await apiFetch(`/api/users/${saved.id}/credentials`, { body: { email: f.email.trim(), password: f.password } })
      onSaved()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer title={user ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı'} onClose={onClose} footer={<>
      {user && !isMe && <Button variant="danger" onClick={() => { repos.users.remove(user.id); onSaved() }}>Kaldır</Button>}
      <div className="spacer" />
      <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
      <Button variant="primary" disabled={busy || !f.name.trim() || !f.branchIds.length || (f.role === 'staff' && !f.staffId) || loginInvalid} onClick={save}>Kaydet</Button>
    </>}>
      <Field label="Ad Soyad"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      {apiMode && <>
        <Field label="Giriş e-postası"><Input type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={email ? 'Yeni şifre' : 'Şifre'} hint={email ? 'Değiştirmek istemiyorsanız boş bırakın.' : 'En az 8 karakter. Kullanıcıya siz iletin.'}>
          <Input type="password" autoComplete="new-password" value={f.password} invalid={loginInvalid} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
      </>}
      <Field label="Rol">
        <Select value={f.role} disabled={isMe} onChange={(e) => setF({ ...f, role: e.target.value as typeof f.role })}>
          <option value="owner">Salon Sahibi</option><option value="reception">Resepsiyon</option><option value="staff">Personel</option>
        </Select>
      </Field>
      {f.role === 'staff' && (
        <Field label="Personel kaydı" hint="Bu kullanıcı yalnızca bu personelin takvimini görür.">
          <Select value={f.staffId} onChange={(e) => { const s = staff.find((x) => x.id === e.target.value); setF({ ...f, staffId: e.target.value, name: f.name || s?.name || '', branchIds: s ? [s.branchId] : f.branchIds }) }}>
            <option value="">Seçin…</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Şube erişimi">
        <div className="stack" style={{ gap: 6 }}>
          {branches.map((b) => (
            <label key={b.id} className="row" style={{ gap: 8 }}>
              <input type="checkbox" style={{ accentColor: 'var(--accent)' }} checked={f.branchIds.includes(b.id)} onChange={(e) => setF({ ...f, branchIds: e.target.checked ? [...f.branchIds, b.id] : f.branchIds.filter((x) => x !== b.id) })} />
              {b.name}
            </label>
          ))}
        </div>
      </Field>
      <p className="t-small muted">Gerçek sürümde kullanıcıya e-posta/SMS ile davet gönderilir ve kendi şifresini belirler.</p>
    </Drawer>
  )
}

function OnlineSection() {
  const repos = useRepos()
  const { tenant } = useSession()
  const toast = useToast()
  const { branch } = useSession()
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null)
  if (!tenant) return null
  const ob = tenant.onlineBooking
  const legalSalon = { name: tenant.name, address: branch?.address ?? '', phone: branch?.phone ?? '' }
  const set = (p: Partial<typeof ob>) => { repos.tenants.upsert({ ...tenant, onlineBooking: { ...ob, ...p } }); toast('Kaydedildi') }
  return (
    <div className="card card-pad stack">
      <h3 className="set-h">Online randevu</h3>
      <div className="set-row"><div><b>Online randevu açık</b><span>Müşteriler bağlantınızdan randevu alabilir</span></div><Switch on={ob.enabled} onChange={(v) => set({ enabled: v })} /></div>
      <div className="set-row"><div><b>Resepsiyon onayı gereksin</b><span>Kapalıysa online randevular doğrudan onaylanır</span></div><Switch on={ob.requireApproval} onChange={(v) => set({ requireApproval: v })} /></div>
      <div className="grid-2">
        <Field label="En fazla kaç gün ilerisi">
          <Select value={ob.maxDaysAhead} onChange={(e) => set({ maxDaysAhead: Number(e.target.value) })}>{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} gün</option>)}</Select>
        </Field>
        <Field label="En az ne kadar önceden">
          <Select value={ob.minLeadMinutes} onChange={(e) => set({ minLeadMinutes: Number(e.target.value) })}>{[0, 30, 60, 120, 240, 1440].map((m) => <option key={m} value={m}>{m === 0 ? 'Hemen' : m < 60 ? `${m} dk` : m === 1440 ? '1 gün' : `${m / 60} saat`}</option>)}</Select>
        </Field>
      </div>
      <p className="t-small muted">Hangi hizmetlerin online görüneceğini Hizmetler sayfasından seçebilirsiniz.</p>
      <Button icon={ExternalLink} onClick={() => window.open(bookingUrl(tenant.slug), '_blank')} style={{ alignSelf: 'flex-start' }}>Sayfayı önizle</Button>
      <div className="divider" />
      <h3 className="set-h">KVKK metinleri</h3>
      <p className="t-small muted">Online randevu sayfasında müşterilere gösterilir; salon adı, adres ve telefon bilgilerinizle doldurulur. Salonda yüz yüze kayıt alırken de müşteriye iletebilirsiniz (kopyala → WhatsApp/çıktı). <b>Bu metinler taslaktır; kullanmadan önce hukuk danışmanınıza onaylatın.</b></p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={() => setLegalDoc('privacy')}>Aydınlatma metni</Button>
        <Button onClick={() => setLegalDoc('consent')}>Açık rıza metni (kampanya)</Button>
      </div>
      {legalDoc && <LegalDialog doc={legalDoc} salon={legalSalon} copyable onClose={() => setLegalDoc(null)} />}
    </div>
  )
}

function ThemeSection() {
  const { theme, setTheme } = useSession()
  const opts = [
    { v: 'light' as const, label: 'Ferah', desc: 'Beyaz zemin, canlı pastel kartlar', icon: Sun, cls: 'light' },
    { v: 'dark' as const, label: 'Gece', desc: 'Koyu zemin, altın vurgular', icon: Moon, cls: 'dark' },
    { v: 'system' as const, label: 'Sistem', desc: 'Cihaz ayarını izler', icon: Monitor, cls: 'system' },
  ]
  return (
    <div className="card card-pad stack">
      <h3 className="set-h">Görünüm</h3>
      <div className="theme-cards">
        {opts.map((o) => (
          <button key={o.v} className={cx('theme-card', theme === o.v && 'on')} onClick={() => setTheme(o.v)}>
            <div className={`theme-prev ${o.cls}`}><i /><i /><i /></div>
            <div className="row" style={{ gap: 6 }}><o.icon size={15} /><b>{o.label}</b></div>
            <span>{o.desc}</span>
          </button>
        ))}
      </div>
      <p className="t-small muted">Tema seçimi bu cihazda saklanır.</p>
    </div>
  )
}
