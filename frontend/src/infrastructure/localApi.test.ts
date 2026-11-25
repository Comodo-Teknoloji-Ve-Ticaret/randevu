import { describe, expect, it } from 'vitest'
import { platformService } from '../application/platformService'
import { nowMinutesIstanbul, todayIstanbul } from '../domain/time'
import { DEMO_PASSWORD, demoEmail } from './demoAccounts'
import { createLocalApi } from './localApi'
import { createLocalStore } from './localStore'
import { buildSeed } from './seed'

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.get(k) ?? null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, v) }
}

function setup() {
  const storage = new MemStorage()
  const today = todayIstanbul()
  const store = createLocalStore('makas:v1', storage, () => buildSeed(today, nowMinutesIstanbul()), today)
  let clock = 1_000_000
  const api = createLocalApi(store, storage, () => clock)
  const as = (userId: string | null) => storage.setItem('makas:session', JSON.stringify({ userId }))
  const call = (path: string, body?: Record<string, unknown>) => api.handle(path, body)
  return { store, storage, api, as, call, tick: (ms: number) => { clock += ms } }
}

const err = async (p: Promise<unknown>) => {
  try { await p } catch (e) { return { status: (e as { status: number }).status, message: (e as Error).message } }
  throw new Error('hata bekleniyordu')
}

describe('tarayıcı demosu: giriş', () => {
  it('demo hesabı demo şifresiyle girer, büyük/küçük harf ve boşluk fark etmez', async () => {
    const { call } = setup()
    const r = await call('/api/auth/login', { email: ` ${demoEmail('u_t_lara_owner').toUpperCase()} `, password: DEMO_PASSWORD }) as { user: { id: string } }
    expect(r.user.id).toBe('u_t_lara_owner')
  })

  it('yanlış şifre ve kayıtsız e-posta aynı mesajı alır', async () => {
    const { call } = setup()
    const a = await err(call('/api/auth/login', { email: demoEmail('u_t_lara_owner'), password: 'yanlis-sifre' }))
    const b = await err(call('/api/auth/login', { email: 'yok@ornek.com', password: 'herhangi1' }))
    expect(a).toEqual({ status: 401, message: 'E-posta veya şifre hatalı.' })
    expect(b).toEqual(a)
  })

  it('askıya alınmış salonun kullanıcısı giremez', async () => {
    const { call, store } = setup()
    platformService(store).setStatus('t_lara', 'suspended')
    expect(await err(call('/api/auth/login', { email: demoEmail('u_t_lara_owner'), password: DEMO_PASSWORD })))
      .toEqual({ status: 403, message: 'İşletme hesabı askıya alınmış. Comodo ile iletişime geçin.' })
  })
})

describe('tarayıcı demosu: kullanıcıya giriş bilgisi', () => {
  it('salon sahibi kendi kullanıcısına e-posta/şifre verir, kullanıcı bununla girer', async () => {
    const { call, as } = setup()
    as('u_t_lara_owner')
    await call('/api/users/u_t_lara_rec/credentials', { email: 'Gamze@Salon.com', password: 'yenisifre1' })
    const r = await call('/api/auth/login', { email: 'gamze@salon.com', password: 'yenisifre1' }) as { user: { id: string } }
    expect(r.user.id).toBe('u_t_lara_rec')
    expect((await call('/api/users/emails') as Record<string, string>).u_t_lara_rec).toBe('gamze@salon.com')
  })

  it('giriş adı e-posta yerine kullanıcı adı da olabilir; geçersiz adlar reddedilir', async () => {
    const { call, as } = setup()
    as('u_t_lara_owner')
    await call('/api/users/u_t_lara_rec/credentials', { email: 'RandevuHazır', password: 'kadi-sifre-9' })
    const r = await call('/api/auth/login', { email: ' randevuhazır ', password: 'kadi-sifre-9' }) as { user: { id: string } }
    expect(r.user.id).toBe('u_t_lara_rec')
    for (const bad of ['ab', 'boşluklu ad', 'eksik@alan', 'x/y'])
      expect((await err(call('/api/users/u_t_lara_rec/email', { email: bad }))).status).toBe(400)
  })
  it('başka salonun kullanıcısına dokunamaz; resepsiyon hiç dokunamaz', async () => {
    const { call, as, store } = setup()
    const other = store.read().users.find((u) => u.tenantId && u.tenantId !== 't_lara')!
    as('u_t_lara_owner')
    expect((await err(call(`/api/users/${other.id}/password`, { password: 'yenisifre1' }))).status).toBe(403)
    as('u_t_lara_rec')
    expect((await err(call('/api/users/u_t_lara_owner/password', { password: 'yenisifre1' }))).status).toBe(403)
    expect((await err(call('/api/users/emails'))).status).toBe(403)
  })

  it('kullanılan e-posta başkasına verilmez, kısa şifre reddedilir', async () => {
    const { call, as } = setup()
    as('u_t_lara_owner')
    expect(await err(call('/api/users/u_t_lara_rec/email', { email: demoEmail('u_t_lara_owner') })))
      .toEqual({ status: 409, message: 'Bu e-posta zaten kullanılıyor.' })
    expect((await err(call('/api/users/u_t_lara_rec/password', { password: 'kisa' }))).message).toBe('Şifre en az 8 karakter olmalı.')
  })

  it('silinen kullanıcının e-postası yeniden kullanılabilir', async () => {
    const { call, as, store } = setup()
    as('u_t_lara_owner')
    const db = store.read()
    store.write({ ...db, users: db.users.filter((u) => u.id !== 'u_t_lara_rec') })
    await call('/api/users/u_t_lara_owner/email', { email: demoEmail('u_t_lara_rec') })
    expect((await call('/api/users/emails') as Record<string, string>).u_t_lara_owner).toBe(demoEmail('u_t_lara_rec'))
  })
})

describe('tarayıcı demosu: şifre', () => {
  it('kendi şifresini mevcut şifreyle değiştirir', async () => {
    const { call, as } = setup()
    as('u_t_lara_owner')
    expect((await err(call('/api/me/password', { currentPassword: 'yanlis', newPassword: 'yenisifre1' }))).message).toBe('Mevcut şifre hatalı.')
    await call('/api/me/password', { currentPassword: DEMO_PASSWORD, newPassword: 'yenisifre1' })
    await call('/api/auth/login', { email: demoEmail('u_t_lara_owner'), password: 'yenisifre1' })
  })

  it('unutulan şifre: kod demo yanıtında gelir, tek kullanımlık ve süreli', async () => {
    const { call, tick } = setup()
    const email = demoEmail('u_t_lara_owner')
    const { demoCode } = await call('/api/auth/forgot', { email }) as { demoCode: string }
    expect(demoCode).toMatch(/^\d{6}$/)
    expect((await err(call('/api/auth/reset', { email, code: '000000' === demoCode ? '111111' : '000000', newPassword: 'yenisifre1' }))).message).toBe('Kod geçersiz ya da süresi dolmuş.')
    await call('/api/auth/reset', { email, code: demoCode, newPassword: 'yenisifre1' })
    await call('/api/auth/login', { email, password: 'yenisifre1' })
    expect((await err(call('/api/auth/reset', { email, code: demoCode, newPassword: 'baskasifre1' }))).status).toBe(400)
    const again = await call('/api/auth/forgot', { email }) as { demoCode: string }
    tick(16 * 60_000)
    expect((await err(call('/api/auth/reset', { email, code: again.demoCode, newPassword: 'baskasifre1' }))).message).toBe('Kod geçersiz ya da süresi dolmuş.')
  })

  it('kayıtsız e-posta için kod üretilmez ama hata da verilmez', async () => {
    const { call } = setup()
    expect(await call('/api/auth/forgot', { email: 'yok@ornek.com' })).toEqual({})
  })
})

describe('tarayıcı demosu: davet', () => {
  it('salon sahibi daveti e-posta/şifreyle kabul eder ve o bilgilerle girer; davet ikinci kez kullanılamaz', async () => {
    const { call, store } = setup()
    const ps = platformService(store)
    const created = ps.createSalon({ name: 'Deneme Kuaför', slug: 'deneme-kuafor', ownerName: 'Ayla', businessType: 'kuafor', branchName: 'Merkez', licenseDays: 30 } as never)
    if (!created.ok) throw new Error('salon açılamadı')
    const token = store.read().tenants.find((t) => t.id === created.tenant.id)!.invite!.token
    const info = await call(`/api/invite/${token}`) as { used: boolean; ownerName: string }
    expect(info.used).toBe(false)
    expect((await err(call(`/api/invite/${token}`, { name: 'Ayla Kaya', phone: '0532 111 22 33', email: 'ayla@deneme.com', password: 'kisa' }))).message).toBe('Şifre en az 8 karakter olmalı.')
    const r = await call(`/api/invite/${token}`, { name: 'Ayla Kaya', phone: '0532 111 22 33', email: 'ayla@deneme.com', password: 'aylasifre1' }) as { user: { name: string } }
    expect(r.user.name).toBe('Ayla Kaya')
    await call('/api/auth/login', { email: 'ayla@deneme.com', password: 'aylasifre1' })
    expect((await err(call(`/api/invite/${token}`, { name: 'X', phone: '0532 111 22 33', email: 'x@deneme.com', password: 'xsifre123' }))).status).toBe(409)
  })
})

describe('tarayıcı demosu: sıfırlama', () => {
  it('demo sıfırlanınca değişen şifreler demo şifresine döner', async () => {
    const { call, as, api } = setup()
    as('u_t_lara_owner')
    await call('/api/me/password', { currentPassword: DEMO_PASSWORD, newPassword: 'yenisifre1' })
    await api.reset()
    await call('/api/auth/login', { email: demoEmail('u_t_lara_owner'), password: DEMO_PASSWORD })
  })
})
