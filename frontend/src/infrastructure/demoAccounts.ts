/** Sunucudaki DemoAccounts.EmailFor ile aynı: u_t_lara_owner → lara.owner@demo.randevuhazir.com.tr */
export const DEMO_PASSWORD = 'demo1234'

export function demoEmail(userId: string): string {
  let s = userId.startsWith('u_') ? userId.slice(2) : userId
  if (s.startsWith('t_')) s = s.slice(2)
  return `${s.replace(/_/g, '.').toLowerCase()}@demo.randevuhazir.com.tr`
}
