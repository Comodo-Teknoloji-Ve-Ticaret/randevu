// Sunucuya bugünün tarihleriyle demo verisini yükler (sunucuda Demo:AllowReset=true olmalı).
// Kullanım: API_URL=http://localhost:8080 npm run seed:api
import { createServer } from 'vite'

const api = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/$/, '')
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { buildSeed } = await vite.ssrLoadModule('/src/infrastructure/seed.ts')
  const { todayIstanbul, nowMinutesIstanbul } = await vite.ssrLoadModule('/src/domain/time.ts')
  const db = buildSeed(todayIstanbul(), nowMinutesIstanbul())
  const res = await fetch(`${api}/api/dev/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(db) })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status}: ${text || 'sunucu reddetti (Demo:AllowReset kapalı olabilir)'}`)
  console.log(`Demo verisi yüklendi (${JSON.parse(text).imported} kayıt). Giriş: lara.owner@demo.randevuhazir.com.tr / demo1234`)
} finally {
  await vite.close()
}
