# Backend Aşama 1 — İskelet, veritabanı, giriş, senkron

**Spec:** docs/superpowers/specs/2026-11-21-randevuhazir-backend-design.md

**Goal:** Docker'da PostgreSQL + API; e-posta/şifre ile giriş (JWT); `GET /api/sync` kiracının tüm verisini ön yüzün `DB` biçiminde döndürür.

## Global Constraints
- .NET 10, paketler 10.0.x hattı (Npgsql EF 10.0.3, ASP.NET 10.0.14). Yeni bağımlılık eklemeden önce kullanıcıya sorulur.
- Hata mesajları Türkçe; ProblemDetails biçimi.
- Sır koda gömülmez: `ConnectionStrings:Db`, `Jwt:Key` yapılandırmadan gelir.
- Ön yüzdeki koleksiyon adları ve kayıt biçimi (camelCase JSON) birebir korunur.

## Kararlar (Ruling)
- Ruling: Kayıtlar tek `records` tablosunda (`collection`, `id`, `tenant_id`, `data jsonb`) — 20 koleksiyonun şeması ön yüzde sık değişiyor; jsonb ile şema değişikliği migration gerektirmez, kurallar gereken alanları tipli okuyarak doğrular — maliyeti: raporlama sorguları jsonb ifadeleri ister (gerekirse ifade indeksi eklenir).
- Ruling: Kimlik bilgileri ayrı `credentials` tablosunda (user_id, email benzersiz, password_hash) — kullanıcı belgesi senkronla istemciye gider, şifre özeti asla gitmez.
- Ruling: Kiracı kapsamı: `tenants` koleksiyonunda kayıt kendi id'si; diğerlerinde `tenantId`; platform kullanıcısı (tenant yok) hepsini görür — ön yüzdeki `createRepos` ile aynı.
- Ruling: Demo verisinin içe aktarımı (`ImportService`) bu aşamada yazılır (testler de kullanır); ön yüz seed'inin JSON'a dökülmesi aşama 7'de.

## Tasks
1. Domain: `Collections` (20 ad + id öneki), `LicenseRules` (ön yüz `licenseStatus` ile aynı: 7 gün yaklaşıyor, 3 gün ek süre, sonra kilit) — birim testleri ön yüz testlerinden.
2. Infrastructure: `AppDbContext` (records, credentials), ilk migration, `PasswordHasher` sarmalayıcı, `JwtTokenIssuer`.
3. Application: `ImportService` (DB JSON → records), `AuthService.Login` (yanlış şifre → 401 "E-posta veya şifre hatalı", askıya alınmış/lisansı kilitli kiracı → 403), `SyncService.Snapshot`.
4. WebApi: `/api/auth/login`, `/api/sync` (JWT zorunlu), ProblemDetails eşlemesi.
5. Docker: `docker-compose.yml` (db + api), `backend/Dockerfile`.
6. Testler (gerçek PostgreSQL, her test sınıfı kendi veritabanı): giriş başarılı/başarısız/kilitli lisans; sync kiracı izolasyonu; platform hepsini görür; token'sız sync 401.
