import { describe, expect, it } from 'vitest'
import { isSuspendedLogin } from '../app/session'
import { platformService, slugify, tenantAccess } from './platformService'
import { setup } from './testkit'

describe('platformService', () => {
  it('creates a salon with a branch, an owner user and starter data', () => {
    const r = setup()
    const res = platformService(r.store).createSalon({ name: 'Saç Atölyesi', slug: 'sac-atolyesi', ownerName: 'Ayla Er', branchName: 'Merkez', plan: 'pro' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const db = r.store.read()
    expect(db.branches.filter((b) => b.tenantId === res.tenant.id)).toHaveLength(1)
    expect(db.users.find((u) => u.tenantId === res.tenant.id && u.role === 'owner')?.name).toBe('Ayla Er')
    expect(db.categories.filter((c) => c.tenantId === res.tenant.id).length).toBeGreaterThan(0)
    expect(db.templates.filter((t) => t.tenantId === res.tenant.id).length).toBe(5)
  })
  it('rejects reserved link names that would clash with the site (kısa link)', () => {
    const r = setup()
    expect(platformService(r.store).createSalon({ name: 'X', slug: 'api', ownerName: 'A', branchName: 'M' })).toEqual({ ok: false, error: 'slug_taken' })
    expect(platformService(r.store).slugTaken('assets')).toBe(true)
  })
  it('rejects a slug that is already used', () => {
    const r = setup() // slug 'test'
    expect(platformService(r.store).createSalon({ name: 'X', slug: 'Test', ownerName: 'A', branchName: 'M', plan: 'pro' })).toEqual({ ok: false, error: 'slug_taken' })
  })
  it('suspending a salon blocks its users from logging in', () => {
    const r = setup()
    r.users.upsert({ id: 'u1', tenantId: 't1', name: 'Sahip', role: 'owner', branchIds: ['b1'] })
    platformService(r.store).setStatus('t1', 'suspended')
    expect(isSuspendedLogin(r.store.read(), 'u1')).toBe(true)
  })
  it('slugifies Turkish names', () => {
    expect(slugify('Çağla Güzellik & Saç Şişli')).toBe('cagla-guzellik-sac-sisli')
  })
})

describe('platformService licenses & invites', () => {
  const clock = () => ({ date: '2026-11-20', min: 600 })
  const create = (r: ReturnType<typeof setup>, extra = {}) => {
    const res = platformService(r.store, clock).createSalon({ name: 'Gülüş Diş', slug: 'gulus', ownerName: 'Dt. Ece', branchName: 'Merkez', plan: 'pro', businessType: 'dis', licenseDays: 30, ...extra })
    if (!res.ok) throw new Error(res.error)
    return res.tenant
  }
  it('stores type, license from today and a fresh invite; starter categories follow the type', () => {
    const r = setup()
    const t = create(r)
    expect(t.businessType).toBe('dis')
    expect(t.license).toEqual({ start: '2026-11-20', days: 30 })
    expect(t.invite?.token).toMatch(/^[a-z0-9]{16,}$/)
    expect(r.store.read().categories.filter((c) => c.tenantId === t.id).map((c) => c.name)).toContain('Muayene')
  })
  it('extends an active license from its current end', () => {
    const r = setup()
    const t = create(r)
    platformService(r.store, clock).extendLicense(t.id, 30)
    expect(r.store.read().tenants.find((x) => x.id === t.id)!.license).toEqual({ start: '2026-11-20', days: 60 })
  })
  it('restarts an expired license from today', () => {
    const r = setup()
    const t = create(r)
    const later = () => ({ date: '2027-01-10', min: 600 })
    platformService(r.store, later).extendLicense(t.id, 90)
    expect(r.store.read().tenants.find((x) => x.id === t.id)!.license).toEqual({ start: '2027-01-10', days: 90 })
  })
  it('accepting an invite renames the owner, burns the token and returns the owner user', () => {
    const r = setup()
    const t = create(r)
    const p = platformService(r.store, clock)
    const res = p.acceptInvite(t.invite!.token, { name: 'Ece Kara', phone: '0532 111 22 33' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const owner = r.store.read().users.find((u) => u.id === res.userId)!
    expect(owner).toMatchObject({ name: 'Ece Kara', role: 'owner', tenantId: t.id })
    expect(p.acceptInvite(t.invite!.token, { name: 'X', phone: '0532 111 22 33' })).toEqual({ ok: false, error: 'used' })
    expect(p.acceptInvite('nope', { name: 'X', phone: '0532 111 22 33' })).toEqual({ ok: false, error: 'invalid' })
  })
  it('a new invite replaces the old token', () => {
    const r = setup()
    const t = create(r)
    const p = platformService(r.store, clock)
    const token = p.newInvite(t.id)
    expect(token).not.toBe(t.invite!.token)
    expect(p.acceptInvite(t.invite!.token, { name: 'X', phone: '05321112233' })).toEqual({ ok: false, error: 'invalid' })
  })
  it('a locked license blocks login and online booking', () => {
    const r = setup()
    const t = create(r)
    const owner = r.store.read().users.find((u) => u.tenantId === t.id && u.role === 'owner')!
    expect(tenantAccess(r.store.read().tenants.find((x) => x.id === t.id)!, '2026-12-10')).toBe('ok')
    expect(tenantAccess(r.store.read().tenants.find((x) => x.id === t.id)!, '2026-12-24')).toBe('license')
    expect(isSuspendedLogin(r.store.read(), owner.id, '2026-12-24')).toBe(true)
  })
})
