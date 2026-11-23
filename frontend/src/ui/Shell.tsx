import {
  BarChart3, Building2, CalendarDays, ChevronDown, Gift, LogOut, MessageSquare, Monitor, Moon, MoreHorizontal,
  CalendarCheck2, Package, RotateCcw, Scissors, Settings, Sun, TriangleAlert, UserRound, Users, Wallet, type LucideIcon,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ROLE_LABEL, type Perm } from '../app/permissions'
import { useSession, type ThemePref } from '../app/session'
import { licenseStatus } from '../domain/license'
import { formatDate, todayIstanbul } from '../domain/time'
import { useDbSnapshot, useStore } from '../infrastructure'
import { Avatar, cx, Popover, useConfirm, useToast } from './index'
import './shell.css'
import '../pages/platform/platform.css'

export interface NavItem { to: string; label: string; icon: LucideIcon; perm: Perm; badge?: number; mobile?: boolean }

export function useNav(): NavItem[] {
  const db = useDbSnapshot()
  const { tenant, can, branchId } = useSession()
  return useMemo(() => {
    const tid = tenant?.id
    const today = todayIstanbul()
    const pending = tid ? db.appointments.filter((a) => a.tenantId === tid && a.branchId === branchId && a.status === 'pending' && a.date >= today).length : 0
    const critical = tid ? db.products.filter((p) => p.tenantId === tid && p.stock <= p.critical).length : 0
    const items: NavItem[] = [
      { to: '/takvim', label: 'Randevu', icon: CalendarDays, perm: 'calendar', badge: pending || undefined, mobile: true },
      { to: '/musteriler', label: 'Müşteriler', icon: Users, perm: 'customers', mobile: true },
      { to: '/kasa', label: 'Kasa', icon: Wallet, perm: 'cash', mobile: true },
      { to: '/hizmetler', label: 'Hizmetler', icon: Scissors, perm: 'services' },
      { to: '/personel', label: 'Personel', icon: UserRound, perm: 'staff' },
      { to: '/stok', label: 'Stok', icon: Package, perm: 'stock', badge: critical || undefined },
      { to: '/paketler', label: 'Paketler', icon: Gift, perm: 'packages' },
      { to: '/mesajlar', label: 'Mesajlar', icon: MessageSquare, perm: 'messages' },
      { to: '/raporlar', label: 'Raporlar', icon: BarChart3, perm: 'reports', mobile: true },
      { to: '/primlerim', label: 'Primlerim', icon: Wallet, perm: 'commission.own' },
      { to: '/ayarlar', label: 'Ayarlar', icon: Settings, perm: 'settings' },
      { to: '/platform', label: 'İşletmeler', icon: Building2, perm: 'platform', mobile: true },
    ]
    return items.filter((i) => can(i.perm) && !(i.to === '/primlerim' && can('reports')))
  }, [db, tenant, can, branchId])
}

const THEMES: { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Ferah', icon: Sun },
  { value: 'dark', label: 'Gece', icon: Moon },
  { value: 'system', label: 'Sistem', icon: Monitor },
]

function Brand() {
  const { tenant } = useSession()
  const color = tenant?.logoColor ?? 'var(--accent)'
  return (
    <div className="brand">
      <div className="brand-mark" style={{ background: color }}>
        <CalendarCheck2 />
      </div>
      <div className="brand-text">
        <b>{tenant?.name ?? 'RandevuHazır'}</b>
        <span>{tenant ? 'RandevuHazır · Salon Paneli' : 'Platform Yönetimi'}</span>
      </div>
    </div>
  )
}

function UserMenu() {
  const { user, logout, theme, setTheme } = useSession()
  const store = useStore()
  const confirm = useConfirm()
  const toast = useToast()
  const nav = useNavigate()
  if (!user) return null
  return (
    <Popover
      trigger={(toggle) => (
        <button className="user-btn" onClick={toggle}>
          <Avatar name={user.name} size={32} />
          <div className="user-meta">
            <b className="ellipsis">{user.name}</b>
            <span>{ROLE_LABEL[user.role]}</span>
          </div>
          <ChevronDown className="chev" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-label">Görünüm</div>
          <div className="theme-pick">
            {THEMES.map((t) => (
              <button key={t.value} className={cx(theme === t.value && 'on')} onClick={() => setTheme(t.value)}>
                <t.icon />
                {t.label}
              </button>
            ))}
          </div>
          <div className="divider" />
          <button
            onClick={async () => {
              close()
              if (await confirm({ title: 'Demo verisi sıfırlansın mı?', text: 'Tüm değişiklikler silinir ve örnek salon verisi yeniden yüklenir.', confirm: 'Sıfırla', danger: true })) {
                store.reset()
                toast('Demo verisi yenilendi')
              }
            }}
          >
            <RotateCcw /> Demo verisini sıfırla
          </button>
          <button onClick={() => { close(); logout(); nav('/giris') }}>
            <LogOut /> Çıkış yap
          </button>
        </>
      )}
    </Popover>
  )
}

function BranchPicker() {
  const { branches, branch, setBranch } = useSession()
  if (branches.length < 2 || !branch) return null
  return (
    <Popover
      align="left"
      trigger={(toggle) => (
        <button className="branch-btn" onClick={toggle}>
          <Building2 />
          <span>{branch.name}</span>
          <ChevronDown className="chev" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-label">Şube</div>
          {branches.map((b) => (
            <button key={b.id} onClick={() => { setBranch(b.id); close() }} className={cx(b.id === branch.id && 'on')}>
              <Building2 /> {b.name}
            </button>
          ))}
        </>
      )}
    </Popover>
  )
}

function LicenseBanner() {
  const { tenant, user } = useSession()
  if (!tenant || !user || user.role === 'staff') return null
  const ls = licenseStatus(tenant.license, todayIstanbul())
  if (ls.state === 'active' || ls.state === 'locked') return null
  const text = ls.state === 'grace'
    ? `Lisans süreniz ${formatDate(ls.end)} tarihinde doldu. ${ls.graceLeft} gün içinde yenilenmezse panel ve online randevu kapanacak.`
    : ls.remaining === 0 ? 'Lisansınızın bugün son günü. Kesintisiz kullanım için Comodo ile iletişime geçin.'
    : `Lisansınızın bitmesine ${ls.remaining} gün kaldı (${formatDate(ls.end)}). Yenilemek için Comodo ile iletişime geçin.`
  return <div className={cx('lic-banner', ls.state)} role="status"><TriangleAlert />{text}</div>
}

export function Shell({ children }: { children: ReactNode }) {
  const nav = useNav()
  const mobileItems = nav.filter((n) => n.mobile).slice(0, 4)
  const hasMore = nav.length > mobileItems.length
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('nav-item', isActive && 'on')}>
              <n.icon />
              <span>{n.label}</span>
              {n.badge ? <span className="count-pill">{n.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <UserMenu />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-mobile-brand"><Brand /></div>
          <BranchPicker />
          <div className="spacer" />
          <div className="topbar-user"><UserMenu /></div>
        </header>
        <LicenseBanner />
        <main className="content">{children}</main>
      </div>
      <nav className="bottom-nav">
        {mobileItems.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('bn-item', isActive && 'on')}>
            <span className="bn-icon"><n.icon />{n.badge ? <span className="count-pill">{n.badge}</span> : null}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
        {hasMore && (
          <NavLink to="/daha" className={({ isActive }) => cx('bn-item', isActive && 'on')}>
            <span className="bn-icon"><MoreHorizontal /></span>
            <span>Daha fazla</span>
          </NavLink>
        )}
      </nav>
    </div>
  )
}

export function MorePage() {
  const nav = useNav()
  return (
    <div className="page">
      <div className="more-grid">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} className="more-item card">
            <span className="more-icon"><n.icon /></span>
            <b>{n.label}</b>
            {n.badge ? <span className="count-pill">{n.badge}</span> : null}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

