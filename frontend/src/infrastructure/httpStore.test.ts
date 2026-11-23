import { describe, expect, it } from 'vitest'
import type { DB } from '../application/db'
import { createHttpStore, diffDb, type Batch } from './httpStore'
import { emptyDb } from './localStore'

const cust = (id: string, name: string) => ({ id, tenantId: 't1', name, phone: '', tags: [], notes: '', consentSms: true, createdAt: '2026-11-24' })
const base = (): DB => ({ ...emptyDb(), customers: [cust('m_1', 'Elif'), cust('m_2', 'Ayşe')] })
const tick = () => new Promise((r) => setTimeout(r, 0))

function harness(respond: (b: Batch) => Promise<void> = async () => {}) {
  const sent: Batch[] = []
  const errors: string[] = []
  const store = createHttpStore(async (b) => { sent.push(b); await respond(b) }, (m) => errors.push(m))
  store.hydrate(base())
  return { store, sent, errors }
}

describe('diffDb', () => {
  it('sends only changed and new rows, plus deletions', () => {
    const a = base()
    const b = { ...a, customers: [a.customers[0], cust('m_2', 'Ayşe Yeni'), cust('m_3', 'Zeynep')] }
    const c = { ...b, customers: b.customers.filter((x) => x.id !== 'm_1') }
    expect(diffDb(a, c)).toEqual({
      upserts: [{ collection: 'customers', data: cust('m_2', 'Ayşe Yeni') }, { collection: 'customers', data: cust('m_3', 'Zeynep') }],
      deletes: [{ collection: 'customers', id: 'm_1' }],
    })
  })
  it('ignores rows that are equal but re-created', () => {
    const a = base()
    expect(diffDb(a, { ...a, customers: a.customers.map((x) => ({ ...x })) })).toEqual({ upserts: [], deletes: [] })
  })
})

describe('createHttpStore', () => {
  it('coalesces writes made in the same tick into one batch', async () => {
    const { store, sent } = harness()
    const db = store.read()
    store.write({ ...db, customers: [...db.customers, cust('m_3', 'A')] })
    store.write({ ...store.read(), customers: [...store.read().customers, cust('m_4', 'B')] })
    await tick()
    expect(sent).toHaveLength(1)
    expect(sent[0].upserts.map((u) => (u.data as { id: string }).id)).toEqual(['m_3', 'm_4'])
  })

  it('reverts to the last saved state and reports the server message when rejected', async () => {
    const { store, errors } = harness(async () => { throw new Error('Bu günün kasası kapatılmış.') })
    let notified = 0
    store.subscribe(() => notified++)
    store.write({ ...store.read(), customers: [] })
    expect(store.read().customers).toHaveLength(0) // ekran anında güncellenir
    await tick(); await tick()
    expect(store.read().customers).toHaveLength(2)
    expect(errors).toEqual(['Bu günün kasası kapatılmış.'])
    expect(notified).toBe(2)
  })

  it('queues writes made while a batch is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const { store, sent } = harness(async (b) => { if (sent.length === 1) await gate; void b })
    store.write({ ...store.read(), customers: [...store.read().customers, cust('m_3', 'A')] })
    await tick()
    store.write({ ...store.read(), customers: [...store.read().customers, cust('m_4', 'B')] })
    await tick()
    expect(sent).toHaveLength(1)
    release(); await tick(); await tick()
    expect(sent).toHaveLength(2)
    expect(sent[1].upserts.map((u) => (u.data as { id: string }).id)).toEqual(['m_4'])
  })

  it('settled() resolves after pending writes are saved, and rejects if they were refused', async () => {
    let fail = false
    const { store, sent } = harness(async () => { if (fail) throw new Error('Reddedildi') })
    store.write({ ...store.read(), customers: [...store.read().customers, cust('m_5', 'C')] })
    await store.settled()
    expect(sent).toHaveLength(1)
    fail = true
    store.write({ ...store.read(), customers: [] })
    await expect(store.settled()).rejects.toThrow('Reddedildi')
    await expect(store.settled()).resolves.toBeUndefined() // bekleyen bir şey yok
  })

  it('sends nothing for a no-op write and clear() empties the cache', async () => {
    const { store, sent } = harness()
    store.write({ ...store.read() })
    await tick()
    expect(sent).toHaveLength(0)
    store.clear()
    expect(store.read().customers).toEqual([])
  })
})
