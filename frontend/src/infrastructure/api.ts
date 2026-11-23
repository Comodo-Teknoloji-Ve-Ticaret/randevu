/** Sunucu adresi (VITE_API_URL). Boşsa uygulama tarayıcıda demo modunda (localStorage) çalışır. */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
export const apiMode = API_URL !== ''
export const demoMode = !apiMode || import.meta.env.VITE_DEMO === 'true'

const TOKEN_KEY = 'rh:token'

export const authToken = {
  get(): string | null {
    try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  set(t: string) {
    try { localStorage.setItem(TOKEN_KEY, t) } catch { /* özel pencere: oturum bu sekmede kalır */ }
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY) } catch { /* yok say */ }
  },
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: (() => void) | null = null
/** Oturum süresi dolunca (401) çağrılır: oturumu kapatıp giriş ekranına döner. */
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = authToken.get()
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.')
  }
  if (res.status === 401 && token && !path.startsWith('/api/auth/')) {
    authToken.clear()
    onUnauthorized?.()
  }
  const text = await res.text()
  const body = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new ApiError(res.status, body?.title ?? (res.status === 429 ? 'Çok fazla deneme yapıldı. Lütfen biraz bekleyin.' : 'Beklenmeyen bir hata oluştu.'))
  return body as T
}
