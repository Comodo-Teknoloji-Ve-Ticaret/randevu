/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Tanımlıysa uygulama sunucuya bağlanır (ör. http://localhost:8080); yoksa tarayıcıda demo modunda çalışır. */
  readonly VITE_API_URL?: string
  /** "true" ise giriş ekranında demo hesapları ve "demo verisini sıfırla" gösterilir. */
  readonly VITE_DEMO?: string
}
