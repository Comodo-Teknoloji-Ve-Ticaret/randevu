import { apiMode } from './api'
import { httpStore } from './index'

let localReset: (() => Promise<void>) | null = null
/** getStore (tarayıcı modu) taklit hesap deposunun sıfırlayıcısını buraya kaydeder. */
export const registerLocalReset = (fn: () => Promise<void>) => { localReset = fn }

/** Tarayıcı demosunda veri sıfırlanınca demo giriş bilgilerini de yeniler. */
export async function resetLocalCredentials(): Promise<void> {
  await localReset?.()
}

/** Yazılan değişiklikler kalıcı olana kadar bekler (sunucu modu); tarayıcı deposu zaten anında yazar. */
export async function storeSettled(): Promise<void> {
  if (apiMode) await httpStore().settled()
}
