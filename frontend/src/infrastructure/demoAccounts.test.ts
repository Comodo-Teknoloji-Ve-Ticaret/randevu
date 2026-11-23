import { describe, expect, it } from 'vitest'
import { DEMO_PASSWORD, demoEmail } from './demoAccounts'

describe('demoEmail', () => {
  it('matches the backend mapping (DemoAccounts.EmailFor)', () => {
    expect(demoEmail('u_t_lara_owner')).toBe('lara.owner@demo.randevuhazir.com.tr')
    expect(demoEmail('u_platform')).toBe('platform@demo.randevuhazir.com.tr')
    expect(demoEmail('u_t_mert_staff')).toBe('mert.staff@demo.randevuhazir.com.tr')
    expect(DEMO_PASSWORD).toBe('demo1234')
  })
})
