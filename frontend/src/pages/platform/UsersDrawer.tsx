import { KeyRound, Mail, ShieldCheck, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { newId } from '../../application/db'
import { ROLE_LABEL } from '../../app/permissions'
import { useSession } from '../../app/session'
import type { Role, User } from '../../domain/types'
import { httpStore, useDbSnapshot, useStore } from '../../infrastructure'
import { apiFetch, apiMode } from '../../infrastructure/api'
import { Avatar, Badge, Button, Drawer, Field, Input, Modal, Select, useToast } from '../../ui'

type SalonRole = Exclude<Role, 'platform'>
type Action = { kind: 'email' | 'password' | 'login'; user: User }

/**
 * Comodo yönetim paneli: bir işletmenin (tenantId) ya da Comodo yöneticilerinin (tenantId = null) kullanıcıları.
 * Kullanıcı açma, giriş e-postası ve şifre değiştirme. Şifreler sunucuda tutulur; burada hiçbir şifre görüntülenmez.
 */
export function UsersDrawer({ tenantId, onClose }: { tenantId: string | null; onClose: () => void }) {
  const db = useDbSnapshot()
  const { user: me } = useSession()
  const tenant = tenantId ? db.tenants.find((t) => t.id === tenantId) : undefined
  const users = db.users.filter((u) => (tenantId ? u.tenantId === tenantId : u.role === 'platform'))
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [action, setAction] = useState<Action | null>(null)

  const loadEmails = useCallback(() => {
    if (apiMode) apiFetch<Record<string, string>>('/api/users/emails').then(setEmails).catch(() => setEmails({}))
  }, [])
  useEffect(loadEmails, [loadEmails])

  return (
    <Drawer
      title={tenant ? `${tenant.name} · Kullanıcılar` : 'Comodo yöneticileri'}
      subtitle={tenant ? 'Salonun giriş yapabilen hesapları' : 'Tüm işletmeleri yönetebilen ekip hesapları'}
      onClose={onClose}
      footer={<><span className="spacer" /><Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>{tenant ? 'Kullanıcı aç' : 'Yönetici aç'}</Button></>}
    >
      {!apiMode && <p className="t-small muted">Demo modunda giriş bilgisi yoktur; e-posta ve şifre işlemleri sunucu sürümünde çalışır.</p>}
      <div className="list">
        {users.map((u) => {
          const email = emails[u.id]
          return (
            <div key={u.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <Avatar name={u.name} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-strong">{u.name}{u.id === me?.id && <span className="muted t-small"> (siz)</span>}</div>
                <div className="t-small muted ellipsis">{apiMode ? email ?? <span style={{ color: 'var(--warning)' }}>giriş bilgisi yok</span> : ROLE_LABEL[u.role]}</div>
                {apiMode && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {email ? <>
                      <Button size="sm" icon={Mail} onClick={() => setAction({ kind: 'email', user: u })}>E-posta değiştir</Button>
                      <Button size="sm" icon={KeyRound} onClick={() => setAction({ kind: 'password', user: u })}>Şifre değiştir</Button>
                    </> : <Button size="sm" variant="primary" icon={ShieldCheck} onClick={() => setAction({ kind: 'login', user: u })}>Giriş bilgisi ver</Button>}
                  </div>
                )}
              </div>
              <Badge tone={u.role === 'owner' || u.role === 'platform' ? 'accent' : u.role === 'reception' ? 'info' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge>
            </div>
          )
        })}
        {users.length === 0 && <p className="muted t-small" style={{ padding: 16 }}>Henüz kullanıcı yok.</p>}
      </div>
      {adding && <NewUser tenantId={tenantId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); loadEmails() }} />}
      {action && <LoginAction action={action} currentEmail={emails[action.user.id] ?? ''} onClose={() => setAction(null)} onSaved={() => { setAction(null); loadEmails() }} />}
    </Drawer>
  )
}

function NewUser({ tenantId, onClose, onSaved }: { tenantId: string | null; onClose: () => void; onSaved: () => void }) {
  const store = useStore()
  const db = useDbSnapshot()
  const toast = useToast()
  const branches = tenantId ? db.branches.filter((b) => b.tenantId === tenantId) : []
  const staff = tenantId ? db.staff.filter((s) => s.tenantId === tenantId && s.active) : []
  const [f, setF] = useState({ name: '', role: 'owner' as SalonRole, staffId: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const needsLogin = apiMode
  const invalid = !f.name.trim() || (tenantId !== null && f.role === 'staff' && !f.staffId) || (needsLogin && (!f.email.includes('@') || f.password.length < 8))

  const save = async () => {
    const id = newId('u_')
    const role: Role = tenantId ? f.role : 'platform'
    const staffRec = staff.find((s) => s.id === f.staffId)
    const user: User = {
      id, tenantId, name: f.name.trim(), role,
      staffId: role === 'staff' ? f.staffId : undefined,
      branchIds: role === 'staff' && staffRec ? [staffRec.branchId] : branches.map((b) => b.id),
    }
    const cur = store.read()
    store.write({ ...cur, users: [...cur.users, user] })
    if (!needsLogin) { toast('Kullanıcı açıldı'); onSaved(); return }
    setBusy(true)
    try {
      await httpStore().settled() // kullanıcı önce sunucuya yazılmalı
      await apiFetch(`/api/users/${id}/credentials`, { body: { email: f.email.trim(), password: f.password } })
      toast(`${user.name} açıldı. Giriş bilgilerini kendisine iletin.`)
      onSaved()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={tenantId ? 'Kullanıcı aç' : 'Comodo yöneticisi aç'} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
      <Button variant="primary" icon={UserPlus} disabled={busy || invalid} onClick={save}>{busy ? 'Açılıyor…' : 'Aç'}</Button>
    </>}>
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Ad Soyad"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        {tenantId && (
          <Field label="Rol">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as SalonRole })}>
              <option value="owner">Salon Sahibi</option><option value="reception">Resepsiyon</option><option value="staff">Personel</option>
            </Select>
          </Field>
        )}
        {tenantId && f.role === 'staff' && (
          <Field label="Personel kaydı" hint="Bu kullanıcı yalnızca bu personelin takvimini görür.">
            <Select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value, name: f.name || staff.find((s) => s.id === e.target.value)?.name || '' })}>
              <option value="">Seçin…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        {needsLogin && <>
          <Field label="Giriş e-postası"><Input type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Şifre" hint="En az 8 karakter. Kullanıcıya siz iletin; ilk girişten sonra kendisi değiştirebilir."><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        </>}
      </div>
    </Modal>
  )
}

function LoginAction({ action, currentEmail, onClose, onSaved }: { action: Action; currentEmail: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const { kind, user } = action
  const [email, setEmail] = useState(kind === 'login' ? '' : currentEmail)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const showEmail = kind !== 'password'
  const showPassword = kind !== 'email'
  const invalid = (showEmail && (!email.includes('@') || email.trim() === currentEmail)) || (showPassword && (pw.length < 8 || pw !== pw2))

  const save = async () => {
    setBusy(true)
    try {
      if (kind === 'email') await apiFetch(`/api/users/${user.id}/email`, { body: { email: email.trim() } })
      else if (kind === 'password') await apiFetch(`/api/users/${user.id}/password`, { body: { password: pw } })
      else await apiFetch(`/api/users/${user.id}/credentials`, { body: { email: email.trim(), password: pw } })
      toast(kind === 'email' ? 'E-posta değiştirildi' : kind === 'password' ? 'Şifre değiştirildi. Yeni şifreyi kullanıcıya iletin.' : 'Giriş bilgisi verildi')
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`${user.name} · ${kind === 'email' ? 'E-posta değiştir' : kind === 'password' ? 'Şifre değiştir' : 'Giriş bilgisi ver'}`} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
      <Button variant="primary" disabled={busy || invalid} onClick={save}>Kaydet</Button>
    </>}>
      <div className="stack" style={{ gap: 12 }}>
        {showEmail && <Field label={kind === 'email' ? 'Yeni e-posta' : 'Giriş e-postası'} error={kind === 'email' ? err : null}><Input type="email" autoFocus autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); setErr(null) }} /></Field>}
        {showPassword && <>
          <Field label="Yeni şifre" hint="En az 8 karakter."><Input type="password" autoFocus={!showEmail} autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(null) }} /></Field>
          <Field label="Yeni şifre (tekrar)" error={err ?? (pw2 && pw !== pw2 ? 'Şifreler aynı değil' : null)}><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        </>}
        {kind === 'password' && <p className="t-small muted">Kullanıcının mevcut oturumları açık kalır; yeni şifre bir sonraki girişte geçerlidir.</p>}
      </div>
    </Modal>
  )
}
