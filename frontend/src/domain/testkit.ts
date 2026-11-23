import type { Appointment, Staff, Ticket, WeekHours } from './types'

export const hours9to12: WeekHours = {
  0: null, 1: { open: 540, close: 720 }, 2: { open: 540, close: 720 }, 3: { open: 540, close: 720 },
  4: { open: 540, close: 720 }, 5: { open: 540, close: 720 }, 6: { open: 540, close: 720 },
}

export function mkStaff(p: Partial<Staff> = {}): Staff {
  return {
    id: 's1', tenantId: 't1', branchId: 'b1', name: 'Ayşe', title: 'Kuaför', color: '#e17055', phone: '',
    hours: hours9to12, serviceIds: [], serviceCommission: 40, productCommission: 10, active: true,
    commissionMode: 'category', categoryRates: {}, serviceRates: {}, brandRates: {}, tiers: [], ...p,
  }
}

export function mkAppt(p: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1', tenantId: 't1', branchId: 'b1', staffId: 's1', customerId: null, date: '2026-11-20',
    start: 600, end: 660, items: [], status: 'confirmed', source: 'reception', note: '', code: 'RH-000001',
    createdAt: '2026-11-01T00:00:00Z', ...p,
  }
}

export function mkTicket(p: Partial<Ticket> = {}): Ticket {
  return {
    id: 'k1', tenantId: 't1', branchId: 'b1', date: '2026-11-20', customerId: null, lines: [], discount: null,
    tip: 0, payments: [], status: 'closed', createdAt: '2026-11-20T10:00:00Z', ...p,
  }
}
