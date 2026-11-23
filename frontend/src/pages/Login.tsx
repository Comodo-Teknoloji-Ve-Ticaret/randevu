import { ArrowRight, Building2, CalendarCheck2, Scissors, ShieldCheck, Smartphone, Wallet } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { tenantAccess } from '../application/platformService'
import { licenseStatus } from '../domain/license'
import { todayIstanbul } from '../domain/time'
import { ROLE_LABEL } from '../app/permissions'
import { isSuspendedLogin, useSession } from '../app/session'
import { useDbSnapshot } from '../infrastructure'
import { Avatar, Badge, useToast } from '../ui'
import './login.css'

const FEATURES = [
  { icon: CalendarCheck2, text: 'Sürükle-bırak takvim, online randevu' },
  { icon: Wallet, text: 'Adisyon, veresiye, gün sonu kasa' },
  { icon: Smartphone, text: 'Resepsiyonda da cepte de aynı rahatlık' },
]

export default function Login() {
  const db = useDbSnapshot()
  const { login } = useSession()
  const nav = useNavigate()
  const toast = useToast()

  const go = (userId: string, role: string) => {
    if (isSuspendedLogin(db, userId)) {
      const t = db.tenants.find((x) => x.id === db.users.find((u) => u.id === userId)?.tenantId)
      toast(t?.status === 'suspended' ? 'Bu işletmenin hesabı askıya alınmış. Comodo ile iletişime geçin.' : 'Lisans süresi doldu. Yenilemek için Comodo ile iletişime geçin.', 'error')
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
          <h2>Demo hesabıyla giriş</h2>
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
        </div>
      </section>
    </div>
  )
}
