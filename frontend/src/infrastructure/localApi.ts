/**
 * Sunucusuz (tarayıcı) demo modunda giriş/hesap uç noktalarının taklidi. Arayüz aynı apiFetch çağrılarını yapar;
 * sunucu adresi yoksa istekler buraya gelir. Kurallar ve mesajlar sunucudakiyle aynıdır
 * (AuthService, AccountService, PasswordService). Giriş bilgileri yalnız bu tarayıcıda, ayrı bir anahtarda tutulur;
 * şifreler tuzlu SHA-256 özetidir. Kod sıfırlama e-postası gönderilemediği için kod yanıtta döner (demoCode).
 */
import type { Store } from '../application/db'
import { platformService, tenantAccess } from '../application/platformService'
import { normalizePhone } from '../domain/phone'
import { todayIstanbul } from '../domain/time'
import type { User } from '../domain/types'
import { DEMO_PASSWORD, demoEmail } from './demoAccounts'

export const CREDS_KEY = 'rh:local-creds'
const SESSION_KEY = 'makas:session' // app/session.tsx ile aynı
const CODE_MINUTES = 15
const MAX_ATTEMPTS = 5
const BAD_CODE = 'Kod geçersiz ya da süresi dolmuş.'
const WRONG = 'E-posta veya şifre hatalı.'

interface Cred { email: string; salt: string; hash: string }
interface Reset { codeHash: string; salt: string; expiresAt: number; attempts: number }
interface CredDb { creds: Record<string, Cred>; resets: Record<string, Reset> }

export class LocalApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
const fail = (status: number, message: string): never => { throw new LocalApiError(status, message) }

const enc = new TextEncoder()
async function digest(salt: string, secret: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${secret}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const newSalt = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')
async function makeCred(email: string, password: string): Promise<Cred> {
  const salt = newSalt()
  return { email, salt, hash: await digest(salt, password) }
}

export const normalizeEmail = (e: string) => e.trim().toLocaleLowerCase('en-US')
function validEmail(raw: unknown): string {
  const e = normalizeEmail(String(raw ?? ''))
  const at = e.indexOf('@')
  if (e.length > 254 || at < 1 || e.lastIndexOf('.') < at + 2 || e.endsWith('.') || e.includes(' ')) fail(400, 'Geçerli bir e-posta girin.')
  return e
}
function validPassword(p: unknown) {
  if (typeof p !== 'string' || p.length < 8) fail(400, 'Şifre en az 8 karakter olmalı.')
}

export function createLocalApi(store: Store, storage: Storage = localStorage, now: () => number = Date.now) {
  /** İlk açılışta (ya da demo sıfırlanınca) mevcut her kullanıcıya demo giriş bilgisi verilir: sunucudaki demo ile aynı. */
  async function seed(): Promise<CredDb> {
    const db: CredDb = { creds: {}, resets: {} }
    for (const u of store.read().users) db.creds[u.id] = await makeCred(demoEmail(u.id), DEMO_PASSWORD)
    save(db)
    return db
  }
  function save(db: CredDb) {
    try { storage.setItem(CREDS_KEY, JSON.stringify(db)) } catch { /* özel pencere */ }
  }
  async function load(): Promise<CredDb> {
    let raw: string | null = null
    try { raw = storage.getItem(CREDS_KEY) } catch { /* yok say */ }
    if (!raw) return seed()
    try { return JSON.parse(raw) as CredDb } catch { return seed() }
  }

  const users = () => store.read().users
  const userById = (id: string) => users().find((u) => u.id === id)
  /** Silinmiş kullanıcıların kayıtları yok sayılır (e-postaları yeniden kullanılabilir). */
  const findByEmail = (db: CredDb, email: string) =>
    Object.entries(db.creds).find(([id, c]) => c.email === email && userById(id))?.[0]

  function me(): User {
    let id: string | null = null
    try { id = JSON.parse(storage.getItem(SESSION_KEY) ?? '{}').userId ?? null } catch { /* yok say */ }
    const u = id ? userById(id) : undefined
    return u ?? fail(401, 'Oturum süreniz doldu. Lütfen tekrar giriş yapın.')
  }

  function ensureCanSignIn(u: User) {
    if (u.role === 'platform' || !u.tenantId) return
    const t = store.read().tenants.find((x) => x.id === u.tenantId) ?? fail(403, 'İşletme bulunamadı.')
    const access = tenantAccess(t, todayIstanbul())
    if (access === 'suspended') fail(403, 'İşletme hesabı askıya alınmış. Comodo ile iletişime geçin.')
    if (access === 'license') fail(403, 'Lisans süreniz doldu. Uzatmak için Comodo ile iletişime geçin.')
  }

  /** Comodo yöneticisi her kullanıcıyı; salon sahibi yalnız kendi salonunun (platform dışı) kullanıcılarını yönetir. */
  function authorizeUserAdmin(who: User, targetId: string): User {
    const target = userById(targetId) ?? fail(404, 'Kullanıcı bulunamadı.')
    const allowed = who.role === 'platform' || (who.role === 'owner' && target.tenantId === who.tenantId && target.role !== 'platform')
    if (!allowed) fail(403, 'Bu işlem için yetkiniz yok.')
    return target
  }
  function ensureEmailFree(db: CredDb, email: string, userId: string) {
    const owner = findByEmail(db, email)
    if (owner && owner !== userId) fail(409, 'Bu e-posta zaten kullanılıyor.')
  }
  const existingLogin = (db: CredDb, userId: string) =>
    db.creds[userId] ?? fail(400, 'Bu kullanıcının giriş bilgisi yok; önce e-posta ve şifre belirleyin.')

  async function handle(path: string, body: Record<string, unknown> | undefined): Promise<unknown> {
    const db = await load()
    const b = body ?? {}

    if (path === '/api/auth/login') {
      if (!String(b.email ?? '').trim() || !b.password) fail(400, 'E-posta ve şifre gerekli.')
      const id = findByEmail(db, normalizeEmail(String(b.email)))
      const c = id ? db.creds[id] : undefined
      if (!id || !c || (await digest(c.salt, String(b.password))) !== c.hash) fail(401, WRONG)
      const u = userById(id!) ?? fail(401, WRONG)
      ensureCanSignIn(u)
      return { token: 'local', user: u }
    }

    if (path === '/api/auth/forgot') {
      const id = findByEmail(db, normalizeEmail(String(b.email ?? '')))
      if (!id) return {} // kayıtlı olup olmadığı dışarı sızmaz
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
      const salt = newSalt()
      db.resets[id] = { codeHash: await digest(salt, code), salt, expiresAt: now() + CODE_MINUTES * 60_000, attempts: 0 }
      save(db)
      return { demoCode: code }
    }

    if (path === '/api/auth/reset') {
      validPassword(b.newPassword)
      const id = findByEmail(db, normalizeEmail(String(b.email ?? ''))) ?? fail(400, BAD_CODE)
      const r = db.resets[id]
      if (!r || r.expiresAt < now() || r.attempts >= MAX_ATTEMPTS) fail(400, BAD_CODE)
      if ((await digest(r.salt, String(b.code ?? '').trim())) !== r.codeHash) {
        r.attempts++
        save(db)
        fail(400, BAD_CODE)
      }
      db.creds[id] = await makeCred(db.creds[id].email, String(b.newPassword))
      delete db.resets[id]
      save(db)
      return {}
    }

    if (path === '/api/me/password') {
      const who = me()
      const c = db.creds[who.id] ?? fail(400, 'Bu hesabın şifresi yok.')
      if ((await digest(c.salt, String(b.currentPassword ?? ''))) !== c.hash) fail(400, 'Mevcut şifre hatalı.')
      validPassword(b.newPassword)
      db.creds[who.id] = await makeCred(c.email, String(b.newPassword))
      save(db)
      return {}
    }

    if (path === '/api/users/emails') {
      const who = me()
      if (who.role !== 'platform' && who.role !== 'owner') fail(403, 'Bu işlem için yetkiniz yok.')
      const visible = users().filter((u) => who.role === 'platform' || u.tenantId === who.tenantId)
      return Object.fromEntries(visible.filter((u) => db.creds[u.id]).map((u) => [u.id, db.creds[u.id].email]))
    }

    const m = path.match(/^\/api\/users\/([^/]+)\/(credentials|email|password)$/)
    if (m) {
      const [, userId, kind] = m
      authorizeUserAdmin(me(), decodeURIComponent(userId))
      const id = decodeURIComponent(userId)
      if (kind === 'credentials') {
        const email = validEmail(b.email)
        validPassword(b.password)
        ensureEmailFree(db, email, id)
        db.creds[id] = await makeCred(email, String(b.password))
      } else if (kind === 'email') {
        const email = validEmail(b.email)
        const c = existingLogin(db, id)
        ensureEmailFree(db, email, id)
        db.creds[id] = { ...c, email }
      } else {
        validPassword(b.password)
        const c = existingLogin(db, id)
        db.creds[id] = await makeCred(c.email, String(b.password))
      }
      save(db)
      return {}
    }

    const inv = path.match(/^\/api\/invite\/([^/]+)$/)
    if (inv) {
      const token = decodeURIComponent(inv[1])
      const ps = platformService(store)
      const info = ps.inviteInfo(token) ?? fail(404, 'Davet linki geçersiz.')
      const owner = users().find((u) => u.tenantId === info.tenant.id && u.role === 'owner')
      if (body === undefined) {
        const t = info.tenant
        return { tenant: { id: t.id, name: t.name, logoColor: t.logoColor, businessType: t.businessType }, used: info.used, ownerName: owner?.name ?? null }
      }
      if (!String(b.name ?? '').trim()) fail(400, 'Ad soyad gerekli.')
      if (!normalizePhone(String(b.phone ?? ''))) fail(400, 'Geçerli bir cep telefonu girin.')
      const email = validEmail(b.email)
      validPassword(b.password)
      if (info.used) fail(409, 'Bu davet kullanılmış. Giriş ekranından devam edin.')
      if (info.tenant.status === 'suspended') fail(403, 'İşletme hesabı askıya alınmış. Comodo ile iletişime geçin.')
      if (!owner) fail(404, 'Davet linki geçersiz.')
      ensureEmailFree(db, email, owner!.id)
      const r = ps.acceptInvite(token, { name: String(b.name), phone: String(b.phone) })
      if (!r.ok) fail(r.error === 'used' ? 409 : 400, r.error === 'used' ? 'Bu davet kullanılmış. Giriş ekranından devam edin.' : 'Davet linki geçersiz.')
      db.creds[owner!.id] = await makeCred(email, String(b.password))
      save(db)
      return { token: 'local', user: userById(owner!.id) }
    }

    return fail(404, 'Bu işlem tarayıcı demosunda yok; sunucu sürümünde çalışır.')
  }

  return {
    handle,
    /** Demo verisi sıfırlanınca giriş bilgileri de demo hâline döner. */
    async reset() { await seed() },
  }
}
