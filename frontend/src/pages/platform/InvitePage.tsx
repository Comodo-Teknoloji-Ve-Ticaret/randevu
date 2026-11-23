import { ArrowRight, Link2Off, Phone, Scissors, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { platformService } from '../../application/platformService'
import { useSession } from '../../app/session'
import { businessTypeLabel } from '../../domain/license'
import { useDbSnapshot, useStore } from '../../infrastructure'
import { apiMode } from '../../infrastructure/api'
import ApiInvite from './ApiInvite'
import { Button, Field, Input } from '../../ui'
import './platform.css'

export default function InvitePage() {
  const { token = '' } = useParams()
  return apiMode ? <ApiInvite token={token} /> : <LocalInvite token={token} />
}

function LocalInvite({ token }: { token: string }) {
  const store = useStore()
  useDbSnapshot()
  const { login } = useSession()
  const nav = useNavigate()
  const ps = platformService(store)
  const info = ps.inviteInfo(token)
  const owner = info ? store.read().users.find((u) => u.tenantId === info.tenant.id && u.role === 'owner') : undefined
  const [name, setName] = useState(owner?.name ?? '')
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState<string | null>(null)

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
  const t = info.tenant
  return (
    <div className="inv-shell">
      <div className="inv-card">
        <div className="inv-mark" style={{ background: t.logoColor }}><Scissors /></div>
        <div>
          <p className="t-small muted">{businessTypeLabel(t.businessType)} · RandevuHazır salon paneli</p>
          <h1>{t.name} paneline hoş geldiniz</h1>
          <p className="muted" style={{ marginTop: 6 }}>İşletme sahibi hesabınızı tamamlayın; ardından hizmetlerinizi ve personelinizi ekleyebilirsiniz.</p>
        </div>
        <Field label="Ad Soyad"><Input icon={UserRound} autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Cep telefonu" error={err} hint="Giriş ve bildirimler için kullanılır."><Input icon={Phone} inputMode="tel" value={phone} placeholder="05xx xxx xx xx" invalid={!!err} onChange={(e) => { setPhone(e.target.value); setErr(null) }} /></Field>
        <Button variant="primary" size="lg" icon={ArrowRight} disabled={!name.trim()} onClick={() => {
          const r = ps.acceptInvite(token, { name, phone })
          if (!r.ok) { setErr(r.error === 'invalid_input' ? 'Geçerli bir cep telefonu girin' : 'Davet artık geçerli değil'); return }
          login(r.userId)
          nav('/ayarlar')
        }}>Panelime gir</Button>
        <p className="t-small muted">Gerçek sürümde bu adımda şifre belirlenir ve telefonunuza doğrulama kodu gelir.</p>
      </div>
    </div>
  )
}
