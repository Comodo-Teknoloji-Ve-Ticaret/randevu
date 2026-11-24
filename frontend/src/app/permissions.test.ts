import { describe, expect, it } from 'vitest'
import { can } from './permissions'

describe('can', () => {
  it('limits staff to their own calendar', () => {
    expect(can('staff', 'cash')).toBe(false)
    expect(can('staff', 'calendar.all')).toBe(false)
    expect(can('staff', 'calendar')).toBe(true)
  })
  it('lets reception run the desk but not settings or full reports', () => {
    expect(can('reception', 'cash')).toBe(true)
    expect(can('reception', 'calendar.all')).toBe(true)
    expect(can('reception', 'settings')).toBe(false)
    expect(can('reception', 'reports')).toBe(false)
  })
  it('gives owners everything except the platform panel', () => {
    expect(can('owner', 'settings')).toBe(true)
    expect(can('owner', 'reports')).toBe(true)
    expect(can('owner', 'platform')).toBe(false)
    expect(can('platform', 'platform')).toBe(true)
    expect(can('platform', 'cash')).toBe(false)
  })
})

import { canUser, defaultPerms, PERM_GROUPS, userPermsToSave } from './permissions'
import type { User } from '../domain/types'

const u = (p: Partial<User>): User => ({ id: 'u1', tenantId: 't1', name: 'X', role: 'reception', branchIds: [], ...p })

describe('kişiye özel yetkiler (kutucuklar)', () => {
  it('özel liste yoksa rolün varsayılanı', () => {
    expect(canUser(u({ role: 'reception' }), 'cash')).toBe(true)
    expect(canUser(u({ role: 'staff' }), 'cash')).toBe(false)
  })
  it('özel liste varsa yalnız işaretli olanlar', () => {
    expect(canUser(u({ role: 'reception', perms: ['calendar', 'customers'] }), 'cash')).toBe(false)
    expect(canUser(u({ role: 'staff', perms: ['calendar', 'cash'] }), 'cash')).toBe(true)
  })
  it('salon sahibi kısıtlanamaz, platform yetkisi kutucukla verilemez', () => {
    expect(canUser(u({ role: 'owner', perms: ['calendar'] }), 'reports')).toBe(true)
    expect(canUser(u({ role: 'reception', perms: ['platform' as never] }), 'platform')).toBe(false)
  })
  it('kaydederken: varsayılanla aynıysa özel liste tutulmaz', () => {
    expect(userPermsToSave('reception', defaultPerms('reception'))).toBeUndefined()
    expect(userPermsToSave('reception', ['calendar'])).toEqual(['calendar'])
    expect(userPermsToSave('owner', ['calendar'])).toBeUndefined()
  })
  it('kutucuk grupları tüm salon yetkilerini bir kez içerir', () => {
    const all = PERM_GROUPS.flatMap((g) => g.items.map((i) => i.perm))
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual(['calendar', 'calendar.all', 'cash', 'commission.own', 'customers', 'messages', 'packages', 'reports', 'services', 'settings', 'staff', 'stock'])
  })
})
