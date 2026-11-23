import { ArrowRight, Building2, CalendarCheck2, KeyRound, LogIn, Mail, Scissors, ShieldCheck, Smartphone, Wallet } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { tenantAccess } from '../application/platformService'
import { licenseStatus } from '../domain/license'
import { nowMinutesIstanbul, todayIstanbul } from '../domain/time'
import { ROLE_LABEL } from '../app/permissions'
import { isSuspendedLogin, useSession } from '../app/session'
import { useDbSnapshot } from '../infrastructure'
import { apiMode, demoMode } from '../infrastructure/api'
import { DEMO_PASSWORD, demoEmail } from '../infrastructure/demoAccounts'
import { buildSeed } from '../infrastructure/seed'
import { Avatar, Badge, Button, Field, Input, useToast } from '../ui'
import { ForgotPassword } from '../ui/PasswordDialogs'
import './login.css'

const FEATURES = [
  { icon: CalendarCheck2, text: 'Sürükle-bırak takvim, online randevu' },
  { icon: Wallet, text: 'Adisyon, veresiye, gün sonu kasa' },
  { icon: Smartphone, text: 'Resepsiyonda da cepte de aynı rahatlık' },
]

export default function Login() {
  const stored = useDbSnapshot()
  // Sunucu modunda giriş öncesi veri yoktur; demo hesap listesi örnek veriden çizilir (sunucudaki demo verisiyle aynı kimlikler).
  const db = useMemo(() => (apiMode && demoMode ? buildSeed(todayIstanbul(), nowMinutesIstanbul()) : stored), [stored])
  const { login, loginWithPassword } = useSession()
  const nav = useNavigate()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgot, setForgot] = useState(false)

  const signIn = async (mail: string, pass: string) => {
    setBusy(true)
    setError(null)
    try {
      const user = await loginWithPassword(mail, pass)
      nav(user.role === 'platform' ? '/platform' : '/takvim')
    } catch (e) {
      setError((e as Error).message)
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (email.trim() && password) void signIn(email, password)
  }

  const go = (userId: string, role: string) => {
    if (isSuspendedLogin(db, userId)) {
      const t = db.tenants.find((x) => x.id === db.users.find((u) => u.id === userId)?.tenantId)
      toast(t?.status === 'suspended' ? 'Bu işletmenin hesabı askıya alınmış. Comodo ile iletişime geçin.' : 'Lisans süresi doldu. Yenilemek için Comodo ile iletişime geçin.', 'error')
      return
    }
    if (apiMode) {
      void signIn(demoEmail(userId), DEMO_PASSWORD)
      return
    }
    login(userId)
    nav(role === 'platform' ? '/platform' : '/takvim')
  }

  const platform = db.users.filter((u) => u.role === 'platform')

  return (
    <div className="login">
      <section className="login-hero">
        <div className="login-hero-inner">
          <div className="login-logo">
            <span><CalendarCheck2 /></span> RandevuHazır
          </div>
          <h1>Salonunuzun gününü<br />tek ekrandan yönetin.</h1>
          <p>Randevudan kasaya, stoktan prime kadar kuaförler için tasarlanmış yönetim paneli.</p>
          <ul>
            {FEATURES.map((f) => (
              <li key={f.text}><f.icon /> {f.text}</li>
            ))}
          </ul>
        </div>
        <div className="login-hero-art" aria-hidden>
          <div className="art-card a1"><b>10:30</b><span>Zeynep A. · Ombre</span></div>
          <div className="art-card a2"><b>₺14.250</b><span>Bugünkü ciro</span></div>
          <div className="art-card a3"><b>%86</b><span>Doluluk</span></div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-panel-inner">
          {apiMode && forgot && (
            <ForgotPassword initialEmail={email} onDone={(mail) => {
              setForgot(false)
              if (mail) { setEmail(mail); setPassword(''); toast('Şifreniz yenilendi. Yeni şifrenizle giriş yapın.') }
            }} />
          )}
          {apiMode && !forgot && (
            <form className="login-form" onSubmit={submit}>
              <h2>Giriş yap</h2>
              <Field label="E-posta"><Input icon={Mail} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Şifre" error={error}><Input icon={KeyRound} type="password" autoComplete="current-password" value={password} invalid={!!error} onChange={(e) => { setPassword(e.target.value); setError(null) }} /></Field>
              <Button variant="primary" size="lg" icon={LogIn} type="submit" disabled={busy || !email.trim() || !password}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</Button>
              <button type="button" className="login-link" onClick={() => setForgot(true)}>Şifremi unuttum</button>
            </form>
          )}
          {demoMode && <>
          <h2>{apiMode ? 'ya da demo hesabıyla' : 'Demo hesabıyla giriş'}</h2>
          <p className="muted">Bir rol seçin; her rol farklı yetkilerle açılır.</p>

          {db.tenants.map((t) => (
            <div key={t.id} className="login-salon">
              <div className="login-salon-head">
                <span className="login-salon-mark" style={{ background: t.logoColor }}><Scissors /></span>
                <div>
                  <b>{t.name}</b>
                  <span>{db.branches.filter((b) => b.tenantId === t.id).map((b) => b.name).join(' · ')}</span>
                </div>
                {t.status === 'suspended' ? <Badge tone="danger">Askıda</Badge> : tenantAccess(t, todayIstanbul()) === 'license' ? <Badge tone="danger">Lisans doldu</Badge> : licenseStatus(t.license, todayIstanbul()).state === 'grace' ? <Badge tone="warning">Ek süre</Badge> : null}
              </div>
              <div className="login-users">
                {db.users.filter((u) => u.tenantId === t.id).map((u) => (
                  <button key={u.id} className="login-user" onClick={() => go(u.id, u.role)}>
                    <Avatar name={u.name} size={36} />
                    <div>
                      <b>{u.name}</b>
                      <span>{ROLE_LABEL[u.role]}</span>
                    </div>
                    <ArrowRight className="go" />
                  </button>
                ))}
              </div>
            </div>
          ))}

          {platform.map((u) => (
            <button key={u.id} className="login-user platform" onClick={() => go(u.id, u.role)}>
              <span className="login-salon-mark dark"><ShieldCheck /></span>
              <div>
                <b>{u.name}</b>
                <span>Tüm salonları yönet</span>
              </div>
              <ArrowRight className="go" />
            </button>
          ))}

          <p className="login-foot muted">
            <Building2 /> Online randevu sayfası:{' '}
            {db.tenants.map((t, i) => (
              <span key={t.id}>{i > 0 && ' · '}<a href={`#/r/${t.slug}`}>{t.name}</a></span>
            ))}
          </p>
          </>}
        </div>
      </section>
    </div>
  )
}
