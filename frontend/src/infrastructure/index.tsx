import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { DB, Store } from '../application/db'
import { createRepos, type Repos } from '../application/repos'
import { diffDays, nowMinutesIstanbul, todayIstanbul } from '../domain/time'
import { apiFetch, apiMode } from './api'
import { createHttpStore, type Batch, type HttpStore } from './httpStore'
import { createLocalStore } from './localStore'
import { buildSeed } from './seed'
import { shiftDb } from './shift'

let singleton: Store | null = null
const errorListeners = new Set<(message: string) => void>()

/** Sunucu bir değişikliği reddettiğinde (ekran eski hâline döner) mesajı dinleyenlere iletir. */
export function onStoreError(fn: (message: string) => void): () => void {
  errorListeners.add(fn)
  return () => errorListeners.delete(fn)
}

/** Sunucu modunda HttpStore'a erişim (giriş sonrası doldurma, çıkışta boşaltma). */
export function httpStore(): HttpStore {
  if (!apiMode) throw new Error('Sunucu modu kapalı')
  return getStore() as HttpStore
}

/**
 * Uygulama genelinde tek depo. Sunucu adresi (VITE_API_URL) tanımlıysa sunucu destekli depo,
 * değilse localStorage deposu; eski demo verisi haftalık adımlarla bugüne kaydırılır.
 */
export function getStore(): Store {
  if (singleton) return singleton
  if (apiMode) {
    singleton = createHttpStore(
      (batch: Batch) => apiFetch('/api/batch', { body: batch }),
      (message) => errorListeners.forEach((fn) => fn(message)),
    )
    return singleton
  }
  const today = todayIstanbul()
  const store = createLocalStore('makas:v1', localStorage, () => buildSeed(today, nowMinutesIstanbul()), today)
  const db = store.read()
  if (db.seededFor && db.seededFor < today) {
    const weeks = Math.floor(diffDays(today, db.seededFor) / 7)
    if (weeks > 0) store.write(shiftDb(db, weeks * 7))
  }
  singleton = store
  return store
}

const StoreCtx = createContext<Store | null>(null)
const TenantCtx = createContext<string | null>(null)

export function StoreProvider({ store, children }: { store: Store; children: ReactNode }) {
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>
}

export function TenantScope({ tenantId, children }: { tenantId: string | null; children: ReactNode }) {
  return <TenantCtx.Provider value={tenantId}>{children}</TenantCtx.Provider>
}

export function useStore(): Store {
  const s = useContext(StoreCtx)
  if (!s) throw new Error('StoreProvider eksik')
  return s
}

/** Depo her değiştiğinde yeniden render eder. */
export function useDbSnapshot(): DB {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, store.read)
}

export function useRepos(): Repos {
  const store = useStore()
  const tenantId = useContext(TenantCtx)
  const db = useDbSnapshot()
  // db bağımlılığı: değişiklikte yeni nesne → bağımlı useMemo'lar tazelenir
  return useMemo(() => createRepos(store, tenantId), [store, tenantId, db]) // eslint-disable-line react-hooks/exhaustive-deps
}
