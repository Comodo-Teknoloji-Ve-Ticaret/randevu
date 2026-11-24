import { ArrowRight, KeyRound, Link2Off, Mail, Phone, Scissors, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../../app/session'
import { businessTypeLabel } from '../../domain/license'
import type { BusinessType, User } from '../../domain/types'
import { apiFetch } from '../../infrastructure/api'
import { Button, Field, Input } from '../../ui'
import './platform.css'

interface Info { tenant: { id: string; name: string; logoColor: string; businessType: BusinessType }; used: boolean; ownerName: string | null }

/** Sunucu modunda davet: salon sahibi ad, telefon, e-posta ve şifresini belirler. */
export default function ApiInvite({ token }: { token: string }) {
  const nav = useNavigate()
  const { openSession } = useSession()
  const [info, setInfo] = useState<Info | null | undefined>(undefined)
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiFetch<Info>(`/api/invite/${encodeURIComponent(token)}`)
      .then((i) => { setInfo(i); setF((x) => ({ ...x, name: i.ownerName ?? '' })) })
      .catch(() => setInfo(null))
  }, [token])

  if (info === undefined) return <div className="boot-loading" role="status">Yükleniyor…</div>
  if (!info || info.used) {
    return (
      <div className="inv-shell">
        <div className="inv-card" style={{ alignItems: 'center', textAlign: 'center' }}>
          <Link2Off size={30} className="muted" />
          <h1>{info?.used ? 'Bu davet kullanılmış' : 'Davet linki geçersiz'}</h1>
          <p className="muted">{info?.used ? 'Hesabınız zaten oluşturulmuş. Giriş ekranından devam edebilirsiniz.' : 'Link hatalı ya da yenilenmiş olabilir. Comodo ile iletişime geçin.'}</p>
          <Button onClick={() => nav('/giris')}>Giriş ekranı</Button>
        </div>
      </div>
    )
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setErr(null) }
  const submit = async () => {
    setBusy(true)
    try {
      const r = await apiFetch<{ token: string; user: User }>(`/api/invite/${encodeURIComponent(token)}`, { body: f })
      await openSession(r.token, r.user.id)
      nav('/ayarlar')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const t = info.tenant
  return (
    <div className="inv-shell">
      <div className="inv-card">
        <div className="inv-mark" style={{ background: t.logoColor }}><Scissors /></div>
        <div>
          <p className="t-small muted">{businessTypeLabel(t.businessType)} · RandevunHazır salon paneli</p>
          <h1>{t.name} paneline hoş geldiniz</h1>
          <p className="muted" style={{ marginTop: 6 }}>İşletme sahibi hesabınızı oluşturun; bu e-posta ve şifreyle giriş yapacaksınız.</p>
        </div>
        <Field label="Ad Soyad"><Input icon={UserRound} autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Cep telefonu"><Input icon={Phone} inputMode="tel" value={f.phone} placeholder="05xx xxx xx xx" onChange={set('phone')} /></Field>
        <Field label="E-posta"><Input icon={Mail} type="email" autoComplete="username" value={f.email} onChange={set('email')} /></Field>
        <Field label="Şifre" hint="En az 8 karakter." error={err}><Input icon={KeyRound} type="password" autoComplete="new-password" value={f.password} invalid={!!err} onChange={set('password')} /></Field>
        <Button variant="primary" size="lg" icon={ArrowRight} disabled={busy || !f.name.trim() || !f.email.trim() || f.password.length < 8} onClick={submit}>
          {busy ? 'Hesap oluşturuluyor…' : 'Panelime gir'}
        </Button>
      </div>
    </div>
  )
}
