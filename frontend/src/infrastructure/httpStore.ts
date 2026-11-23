import type { CollectionKey, DB, Store } from '../application/db'
import { emptyDb } from './localStore'

export interface Batch {
  upserts: { collection: CollectionKey; data: unknown }[]
  deletes: { collection: CollectionKey; id: string }[]
}

const KEYS = Object.keys(emptyDb()).filter((k) => k !== 'version') as CollectionKey[]

/** İki DB arasındaki fark: değişen/yeni kayıtlar ve silinenler (değişmeyen kayıt gönderilmez). */
export function diffDb(prev: DB, next: DB): Batch {
  const out: Batch = { upserts: [], deletes: [] }
  for (const key of KEYS) {
    const a = prev[key] as { id: string }[]
    const b = next[key] as { id: string }[]
    if (a === b) continue
    const before = new Map(a.map((r) => [r.id, r]))
    const ids = new Set<string>()
    for (const row of b) {
      ids.add(row.id)
      const old = before.get(row.id)
      if (old !== row && (!old || JSON.stringify(old) !== JSON.stringify(row))) out.upserts.push({ collection: key, data: row })
    }
    for (const row of a) if (!ids.has(row.id)) out.deletes.push({ collection: key, id: row.id })
  }
  return out
}

export interface HttpStore extends Store {
  /** Sunucudan gelen veriyle önbelleği doldurur (giriş/yenileme sonrası). */
  hydrate(db: DB): void
  /** Çıkışta önbelleği boşaltır. */
  clear(): void
  /** Bekleyen yazımlar sunucuya kaydedilince çözülür; reddedilirse sunucunun mesajıyla hata verir. */
  settled(): Promise<void>
}

/**
 * Sunucu destekli depo. Ekranlar veriyi bellekten senkron okur/yazar (servisler değişmez);
 * aynı anda yapılan yazımlar tek bir işlemsel istekte gönderilir. Sunucu reddederse
 * son onaylı hâle dönülür ve mesaj gösterilir. Bir istek sürerken yapılan yazımlar ardından gönderilir.
 */
export function createHttpStore(send: (batch: Batch) => Promise<void>, onError: (message: string) => void): HttpStore {
  const listeners = new Set<() => void>()
  let db: DB = emptyDb()
  let confirmed: DB = db
  let scheduled = false
  let inFlight = false
  let waiters: { resolve: () => void; reject: (e: Error) => void }[] = []
  const notify = () => listeners.forEach((fn) => fn())
  const idle = () => !scheduled && !inFlight && db === confirmed
  const settle = (error?: Error) => {
    const w = waiters
    waiters = []
    w.forEach((x) => (error ? x.reject(error) : x.resolve()))
  }

  async function flush() {
    scheduled = false
    if (inFlight) return
    const target = db
    const batch = diffDb(confirmed, target)
    if (!batch.upserts.length && !batch.deletes.length) {
      confirmed = target
      if (idle()) settle()
      return
    }
    inFlight = true
    try {
      await send(batch)
      confirmed = target
    } catch (e) {
      // Reddedilen ve sonrasında yapılmış (henüz gönderilmemiş) değişiklikler geri alınır.
      const message = (e as Error).message || 'Değişiklik kaydedilemedi.'
      db = confirmed
      inFlight = false
      notify()
      onError(message)
      settle(new Error(message))
      return
    }
    inFlight = false
    if (db !== confirmed) schedule()
    else settle()
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => void flush())
  }

  return {
    read: () => db,
    write(next) {
      db = next
      notify()
      schedule()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    reset() {
      db = confirmed
      notify()
    },
    settled() {
      return idle() ? Promise.resolve() : new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }))
    },
    hydrate(next) {
      db = confirmed = next
      notify()
    },
    clear() {
      db = confirmed = emptyDb()
      notify()
    },
    recovered: false,
    persistError: false,
  }
}
