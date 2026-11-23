# RandevuHazır — Backend Tasarımı

Tarih: 2026-11-21 · Durum: kullanıcı onayladı ("onay başla")

## 1. Amaç
Ön yüz bugün tüm veriyi tarayıcıda (localStorage) tutuyor: cihazlar arası paylaşım yok, Safari'de ~2.5 MB sınırına yakın, veri kaybolabilir. Backend; veriyi sunucuda kalıcı, çok salonlu ve güvenli tutar. Ekranlar değişmez.

## 2. Kullanıcı kararları
- Veritabanı: **PostgreSQL**.
- Çalışma ortamı: önce yerelde **Docker**; sunucu sonra seçilecek. **Sonradan kendi sunucuya taşınabilir olmalı** (kullanıcı sorusu) → her şey Docker imajı + ortam değişkenleriyle; veri `pg_dump`/`pg_restore` ile taşınır; `docs/deploy.md` taşıma rehberi.
- Giriş: **e-posta + şifre**; SMS kodu sonra.

## 3. Hedefler / hedef olmayanlar
- Hedef: kalıcı veri, kiracı izolasyonu, rol bazlı yetki, demo verisiyle tek komutla ayağa kalkan ortam, mevcut 118 adımlık e2e testinin gerçek backend'e karşı geçmesi.
- Hedef değil (bu aşamada): gerçek SMS gönderimi, WhatsApp API, online ödeme, e-Fatura, sunucu kurulumu.
- Anti-hedef: bir salonun başka salonun verisini görebilmesi; ön yüzün davranışının değişmesi; GitHub Pages demosunun bozulması.

## 4. Yaklaşımlar
1. **Her iş kuralını sunucuya taşı, ön yüzü async API'ye yeniden yaz.** En "temiz" ama ön yüzdeki tüm servisler (senkron `Repos` üzerinde çalışıyor) yeniden yazılır; aylar sürer, mevcut testler çöpe gider.
2. **Sadece veri deposu (generic CRUD).** Hızlı ama kurallar yalnız tarayıcıda; kötü niyetli/hatalı istemci tutarsız veri yazabilir.
3. **Seçilen — Senkron önbellek + sunucuda doğrulanan kayıt API'si.** Ön yüz girişte kiracının verisini tek istekte alır (`GET /api/sync`), `Store` arayüzünün HTTP uygulaması (`HttpStore`) her yazımda farkı (değişen/silinen kayıtlar) tek bir işlemsel istekte gönderir (`POST /api/batch`). Sunucu her kaydı kiracıya bağlar, rol yetkisini ve kritik kuralları (randevu çakışması, kilitli gün sonu, kapanmış adisyon, stok hareketi tutarlılığı, lisans) doğrular; reddederse ön yüz eski hâline döner ve hata gösterir. Online randevu gibi girişsiz akışlar ayrı, dar uç noktalardan geçer. Ön yüz servisleri ve testleri aynen kalır; kurallar aşamalı olarak sunucuya da eklenir.

Neden 3: ekranlar değişmez (kullanıcı şartı), mevcut 136 birim + 118 e2e testi korunur, veri sunucuda güvenli doğrulanır.

## 5. Mimari
- `backend/` — .NET 10 (LTS), Clean Architecture (Comodo düzeni, Detailing ile aynı adlandırma):
  - `ComodoRandevuHazir.Domain` — varlıklar, kurallar (çakışma, lisans, para).
  - `ComodoRandevuHazir.Application` — kullanım senaryoları: kimlik doğrulama, senkron/batch, yetki, doğrulayıcılar, public booking.
  - `ComodoRandevuHazir.Infrastructure` — EF Core + Npgsql, şifre özeti, JWT üretimi, seed içe aktarma.
  - `ComodoRandevuHazir.WebApi` — Minimal API uç noktaları, ProblemDetails hata biçimi, CORS.
  - `tests/ComodoRandevuHazir.Tests` — xUnit; birim + gerçek PostgreSQL'e karşı entegrasyon testleri.
- **Veri modeli:** ön yüzdeki 20 koleksiyonun her biri bir tablo; kimlikler ön yüzdeki gibi metin (`a_xxxx`). İç içe yapılar (çalışma saatleri, randevu kalemleri, adisyon satırları/ödemeler, oranlar) `jsonb` sütun. Her kiracı tablosunda `tenant_id` + EF Core global query filter.
- **Kimlik:** `users` tablosuna `email` (benzersiz, küçük harf) ve `password_hash` (ASP.NET Identity `PasswordHasher`, PBKDF2). Giriş → kısa ömürlü JWT (8 saat) içinde `sub`, `tenant`, `role`, `branches`. Platform yöneticisi `tenant` taşımaz.
- **Yetki:** sahip her şeyi; resepsiyon ayarlar/personel primleri/lisans hariç; personel yalnız kendi randevuları ve kendi adisyon satırları (okuma ağırlıklı). Kesin matris ön yüzdeki mevcut ekran yetkilerinden çıkarılır.
- **Davet:** platform yöneticisi işletme açınca tek kullanımlık token; davet sayfasında sahip ad, telefon, **e-posta ve şifre** belirler.
- **Demo verisi:** ön yüzün `buildSeed` çıktısı JSON'a dökülüp backend ilk açılışta içe aktarır; demo kullanıcılarına bilinen şifre (`demo1234`) atanır, giriş ekranındaki demo düğmeleri bu hesaplarla giriş yapar.
- **Yapılandırma:** `ConnectionStrings__Db`, `Jwt__Key`, `Cors__Origins`, `Seed__Demo` ortam değişkenleri; koda gömülü sır yok.
- **Docker:** `docker-compose.yml` → `db` (postgres:18) + `api` (çok aşamalı .NET imajı); `docker compose up` ile ayağa kalkar, veri adlandırılmış volume'da.
- **Ön yüz:** `VITE_API_URL` tanımlıysa `HttpStore`, değilse bugünkü `localStore` → GitHub Pages demosu aynen çalışır.

## 6. Aşamalar (her biri çalışan sürüm + push)
1. İskelet, veritabanı şeması, Docker, e-posta+şifre girişi, `GET /api/sync`.
2. `POST /api/batch` + kiracı/rol yetkisi; salon, şube, personel, hizmet doğrulamaları.
3. Müşteri ve randevu kuralları (çakışma, durum geçişleri); public online randevu uç noktaları.
4. Kasa: adisyon, ödeme, borç tahsilatı, gider, gün sonu kilidi.
5. Stok hareketleri ve paketler.
6. Mesaj kayıtları (SMS sağlayıcı arayüzü, şimdilik simülasyon), raporlar için gerekli indeksler.
7. Ön yüz `HttpStore` + giriş ekranı + e2e testlerinin backend'e karşı koşması; `docs/deploy.md`.

## 7. Builder'a bırakılanlar
Tablo/sütun adlandırma ayrıntıları, indeksler, hata mesajlarının metni (Türkçe), log biçimi.

## 8. Bizim verdiğimiz kararlar (kullanıcı kontrol etsin)
- Yaklaşım 3 (senkron önbellek + doğrulanan batch API).
- Kimlikler metin ve istemcide üretilir (sunucu biçim + benzersizlik doğrular).
- JWT 8 saat; yenileme token'ı sonraya.
- Demo hesap şifresi `demo1234` (yalnız `Seed__Demo=true` iken).
- NuGet: .NET 10 hattındaki paketler (11.0 sürümleri çok yeni).
