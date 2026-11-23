import { useCallback, useEffect, useRef, useState } from 'react'
import { bookingService, type BookingInput } from '../../application/bookingService'
import { useDbSnapshot, useStore } from '../../infrastructure'
import { apiFetch, apiMode, ApiError } from '../../infrastructure/api'

type Svc = ReturnType<typeof bookingService>
export type BookingInfo = NonNullable<ReturnType<Svc['info']>>
export type Slot = { staffId: string; start: number }
export type BookResult = { ok: true; code: string; status: 'pending' | 'confirmed' } | { ok: false; message: string; slotTaken: boolean }

export interface BookingSource {
  /** undefined: yükleniyor; null: salon yok / online randevu kapalı */
  info: BookingInfo | null | undefined
  slots(branchId: string, serviceIds: string[], staffId: string, date: string): Slot[]
  /** Sunucu modunda bir tarih aralığının boş saatlerini tek istekte önbelleğe alır. */
  prefetch(branchId: string, serviceIds: string[], staffId: string, from: string, days: number): void
  /** Önbellek her dolduğunda artar (bağımlı hesaplar tazelensin). */
  version: number
  book(input: BookingInput): Promise<BookResult>
}

const LOCAL_ERR = {
  slot_taken: 'Bu saat az önce doldu. Lütfen başka bir saat seçin.',
  disabled: 'Salon şu anda online randevu almıyor.',
  invalid_phone: 'Lütfen geçerli bir cep telefonu girin.',
  invalid: 'Lütfen bilgileri kontrol edin.',
}

/** Tarayıcı (demo) modu: mevcut bookingService, anında. */
function useLocalSource(slug: string): BookingSource {
  const store = useStore()
  useDbSnapshot()
  const svc = bookingService(store, slug)
  return {
    info: svc.info(),
    slots: svc.slots,
    prefetch: () => {},
    version: 0,
    book: async (input) => {
      const r = svc.book(input)
      return r.ok ? r : { ok: false, message: LOCAL_ERR[r.error], slotTaken: r.error === 'slot_taken' }
    },
  }
}

/** Sunucu modu: /api/public/{slug} uç noktaları; müşteri/telefon gibi özel veri tarayıcıya hiç gelmez. */
function useApiSource(slug: string): BookingSource {
  const [info, setInfo] = useState<BookingInfo | null | undefined>(undefined)
  const [version, setVersion] = useState(0)
  const cache = useRef(new Map<string, Record<string, Slot[]>>())
  const loading = useRef(new Set<string>())
  const base = `/api/public/${encodeURIComponent(slug)}`

  useEffect(() => {
    apiFetch<BookingInfo>(base).then(setInfo).catch(() => setInfo(null))
  }, [base])

  const key = (b: string, s: string[], st: string) => `${b}|${s.join(',')}|${st}`
  const prefetch = useCallback((branchId: string, serviceIds: string[], staffId: string, from: string, days: number) => {
    const k = key(branchId, serviceIds, staffId)
    if (!serviceIds.length || cache.current.has(k) || loading.current.has(k)) return
    loading.current.add(k)
    const q = new URLSearchParams({ branchId, serviceIds: serviceIds.join(','), staffId, date: from, days: String(days) })
    apiFetch<Record<string, Slot[]>>(`${base}/slots?${q}`)
      .then((map) => { cache.current.set(k, map); setVersion((v) => v + 1) })
      .catch(() => {})
      .finally(() => loading.current.delete(k))
  }, [base])

  return {
    info,
    version,
    prefetch,
    slots: (branchId, serviceIds, staffId, date) => cache.current.get(key(branchId, serviceIds, staffId))?.[date] ?? [],
    book: async (input) => {
      try {
        const r = await apiFetch<{ code: string; status: 'pending' | 'confirmed' }>(`${base}/book`, { body: input })
        cache.current.clear() // dolan saat bir sonraki görünümde güncel gelsin
        setVersion((v) => v + 1)
        return { ok: true, ...r }
      } catch (e) {
        const slotTaken = e instanceof ApiError && e.status === 409
        if (slotTaken) { cache.current.clear(); setVersion((v) => v + 1) }
        return { ok: false, message: (e as Error).message, slotTaken }
      }
    },
  }
}

// Mod derleme anında sabittir; hook sırası değişmez.
export const useBookingSource: (slug: string) => BookingSource = apiMode ? useApiSource : useLocalSource
