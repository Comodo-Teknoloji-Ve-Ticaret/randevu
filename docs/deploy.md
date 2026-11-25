# RandevunHazır: Sunucuya Kurulum ve Taşıma

Bu rehber, RandevunHazır'ı kendi sunucunuzda çalıştırmak için gereken adımları anlatır. Kurulum sonunda şunlar hazır olur:

- `https://alanadiniz` adresinde çalışan bir site
- Otomatik HTTPS sertifikası
- Kalıcı bir SQL Server veritabanı

Bütün sistem Docker ile çalışır. Bu sayede sunucu firmasından bağımsızdır; sunucu değiştirmek, veriyi yeni sunucuya taşımaktan ibarettir.

```
İnternet ──443──▶ web (Caddy: HTTPS + site) ──/api──▶ api (.NET) ──▶ db (SQL Server)
```

Dışarıya yalnızca 80 ve 443 numaralı portlar açılır. API ve veritabanına dışarıdan doğrudan erişilemez.

---

> **Canlı kurulum (Kasım 2026):** randevunhazır.com bir Windows/Plesk (IIS) barındırmasında çalışır,
> veritabanı oradaki SQL Server'dır. Aşağıdaki "Plesk / IIS" bölümüne bakın. Docker anlatımı kendi sunucunuza
> kurulum içindir.

## Plesk / IIS (Windows barındırma) — canlı kurulum

Yerleşim (FTP kökü = sitenin kökü):

```
/            tanıtım sitesi (site/dist) + web.config (Plesk'in hata sayfaları + webp/woff2 MIME)
/panel/      uygulama; VITE_API_URL=https://xn--randevunhazr-c5b.com ile derlenir (demo kapalı)
/api/        backend; IIS'te "api" alt uygulaması (uç noktalar yine /api/... adresinde)
/App_Data/   yazılabilir klasör (gerekirse ANCM günlükleri buraya yönlendirilir)
```

- **Veritabanı:** paylaşılan SQL Server veritabanı. Tüm nesneler `randevu_` önekli
  (`randevu_records`, `randevu_credentials`, `randevu_password_resets`, `randevu_records_seq`,
  geçmiş tablosu `randevu___EFMigrationsHistory`); diğer uygulamaların tablolarına dokunulmaz.
  Uygulama açılışta bekleyen migration'ları kendisi uygular; elle uygulamak için:
  `dotnet ef database update -p src/ComodoRandevuHazir.Infrastructure -s src/ComodoRandevuHazir.WebApi --connection "<bağlantı>"`
- **Derleme:** uygulama havuzu **32-bit** çalışır → `dotnet publish src/ComodoRandevuHazir.WebApi -c Release -r win-x86 --self-contained false`.
  x64 derleme "500.30 / managed exception" ile açılmaz.
- **Ayarlar:** sunucudaki `api/web.config` içinde `<environmentVariables>` (ConnectionStrings__Db, Jwt__Key,
  Cors__Origins__0, Admin__Email/Password …). Bu dosya **depoya girmez**; şifreler yalnız sunucuda durur.
  `<httpErrors existingResponse="PassThrough" />` kalmalı (yoksa IIS API hatalarını HTML sayfasıyla değiştirir).
- **Güncelleme (tek komut):** Mac'te `./deploy/yayinla.sh`, Windows'ta `.\deploy\yayinla.ps1`
  (sağ tık → PowerShell ile çalıştır). Gerekenler: Node.js, .NET 10 SDK, curl.
  İlk çalıştırmada `deploy/yayin.ayarlar.json` oluşur; içine FTP şifresini yazın (depoya girmez).
  Betik: ön yüz testleri → panel + site + backend derlemesi → yalnız değişen dosyaları yükler
  (backend değiştiyse bu sırada `api/app_offline.htm` bakım sayfası açılır) → eski dosyaları siler → canlı kontrol.
  Seçenekler: `--kuru` (yüklemeden listele), `--testsiz`, `--hepsi` (her şeyi yeniden yükle).
  Sunucudaki `api/web.config` betik tarafından hiç değiştirilmez.
- **Elle güncelleme:** önce `api/app_offline.htm` yükleyin, değişen dosyaları gönderin, sonra silin.
  Yalnız `web.config` yüklemek de uygulamayı yeniden başlatır.
- **Giriş adı:** e-posta ya da kullanıcı adı olabilir (3–40 harf/rakam/nokta/tire; büyük-küçük harf fark etmez).
- **Açılmıyorsa:** `aspNetCore` öğesine geçici olarak
  `<handlerSettings><handlerSetting name="debugFile" value="..\App_Data\ancm-debug.log" /><handlerSetting name="debugLevel" value="FILE,TRACE" /></handlerSettings>`
  ekleyip günlüğü FTP'den okuyun; işiniz bitince kaldırın.

## 1. Gerekenler

| Ne | Önerilen |
|---|---|
| Sunucu | Ubuntu 24.04, en az 2 GB RAM, 20 GB disk (Türkiye'de bir veri merkezi KVKK açısından avantajlıdır) |
| Alan adı | Örneğin `randevunhazır.com`. DNS'te **A kaydı** sunucunun IP adresini göstermelidir |
| Açık portlar | 80 ve 443. Sertifika alınırken 80 numaralı port gerekir |

## 2. Docker'ı kurun

Sunucuya SSH ile bağlanıp şu komutları çalıştırın:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # çıkış yapıp tekrar girin
docker compose version          # çalışıyorsa hazırsınız
```

## 3. Kodu indirin

```bash
git clone https://github.com/Comodo-Teknoloji-Ve-Ticaret/randevu.git
cd randevu
```

## 4. Ayar dosyasını (.env) hazırlayın

```bash
cp .env.example .env
nano .env
```

Aşağıdaki değerlerin **hepsini** değiştirin:

| Ayar | Ne yazılır |
|---|---|
| `DOMAIN` | Alan adınız, `https://` olmadan. Türkçe karakter varsa `xn--` biçiminde yazın. Örnek: `randevunhazır.com` → `xn--randevunhazr-c5b.com` (çevirmek için: `python3 -c "print('randevunhazır.com'.encode('idna').decode())"`) |
| `DB_PASSWORD` | Güçlü bir veritabanı şifresi. Üretmek için: `openssl rand -hex 24` |
| `JWT_KEY` | Oturum imzalama anahtarı. Üretmek için: `openssl rand -base64 48` |
| `ADMIN_EMAIL` | Comodo yönetici hesabının e-postası |
| `ADMIN_PASSWORD` | Yönetici şifresi (en az 8 karakter, güçlü bir şifre) |

> `.env` dosyası şifreleri içerdiği için GitHub'a hiçbir zaman gönderilmez; `.gitignore` bunu engeller. Bu dosyanın bir kopyasını şifre yöneticinizde saklayın.
>
> `JWT_KEY` değiştirilirse herkesin oturumu kapanır ve kullanıcıların yeniden giriş yapması gerekir. Bunun dışında bir sorun çıkmaz.

## 5. Başlatın

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

İlk çalıştırma birkaç dakika sürer. Bu sırada şunlar olur:

- Ön yüz ve API derlenir.
- Veritabanı tabloları otomatik oluşturulur.
- Caddy, Let's Encrypt'ten HTTPS sertifikasını alır.
- `.env` dosyasındaki bilgilerle **Comodo yönetici hesabı** açılır.

Durumu kontrol etmek için:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl https://ALANADINIZ/api/health        # {"status":"ok"} dönmeli
```

## 6. İlk salonu açın

1. `https://ALANADINIZ` adresine gidin ve `ADMIN_EMAIL` / `ADMIN_PASSWORD` ile giriş yapın. Platform paneli açılır.
2. **Yeni işletme** düğmesine basın, salonu oluşturun ve davet linkini kopyalayın.
3. Linki salon sahibine gönderin. Sahip linki açınca adını, telefonunu, e-postasını ve şifresini kendisi belirler.
4. Sahip, personeline **Ayarlar → Kullanıcılar** ekranından giriş e-postası ve şifre verir.
5. Salonun müşterilerine vereceği randevu linki kısa adrestir: `https://ALANADINIZ/salon-adi`. Bu link davet mesajında da yer alır. Salon sahibi linki **Ayarlar → Salon** ekranında görür. Aynı ekranda **QR kod** düğmesi vardır; buradan PNG indirebilir ya da tezgâh için A4 afiş yazdırabilir.

> Gerçek sunucuda demo hesapları ve "Demo verisini sıfırla" düğmesi görünmez; `docker-compose.prod.yml` bunları kapatır.

## 6a. E-posta (şifre sıfırlama) ve mesajlar

**Mesajlar** (randevu hatırlatma, doğum günü kutlaması) **WhatsApp** ile gönderilir: Mesajlar sayfasında düğmeye basınca salonun telefonunda WhatsApp hazır mesajla açılır, gönder tuşuna salon basar. Sunucuda ayrıca bir ayar gerekmez; sistem SMS göndermez. Hatırlatma için müşterinin ileti izni, doğum günü/kampanya mesajı için ayrıca açık rızası gerekir.

**E-posta** (şifre sıfırlama kodları): Ayarlar boş bırakılırsa e-posta gönderilmez (kod yalnız API günlüğünde görünür). Kurumsal e-posta hesabınızın SMTP bilgilerini girin. Bunlar `SMTP_HOST`, `SMTP_PORT` (genellikle 587), `SMTP_USER`, `SMTP_PASSWORD` ve `SMTP_FROM` alanlarıdır.

---

## 7. Bilgisayardaki veriyi sunucuya taşımak

Bu adım yalnızca bilgisayarınızda (geliştirme ortamında) girilmiş, saklamak istediğiniz gerçek bir veri varsa gereklidir. Sadece demo verisi varsa atlayın.

**Bilgisayarda** veriyi bir dosyaya alın:

```bash
docker compose exec -T db pg_dump -U randevuhazir -Fc randevuhazir > randevuhazir.dump
scp randevuhazir.dump kullanici@SUNUCU:~/randevu/
```

**Sunucuda** dosyayı geri yükleyin. Bu işlem sunucudaki mevcut verinin yerine geçer:

```bash
P="-f docker-compose.yml -f docker-compose.prod.yml"
docker compose $P stop api
docker compose $P exec -T db pg_restore -U randevuhazir -d randevuhazir --clean --if-exists < randevuhazir.dump
docker compose $P start api
```

Kullanıcı şifreleri de veriyle birlikte taşınır. Yalnızca geri dönüştürülemeyecek şekilde (PBKDF2 özeti olarak) saklandıkları için kimse göremez.

## 8. Yedekleme (mutlaka kurun)

Sunucuda her gece 03:00'te otomatik yedek alınmasını sağlayın. Bu kurulumda yedekler 14 gün saklanır:

```bash
mkdir -p ~/yedek
crontab -e
```

Açılan dosyaya şu satırı ekleyin:

```
0 3 * * * cd ~/randevu && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db pg_dump -U randevuhazir -Fc randevuhazir > ~/yedek/rh-$(date +\%F).dump && find ~/yedek -name 'rh-*.dump' -mtime +14 -delete
```

> Yedekler sunucuyla aynı diskte durursa, disk bozulduğunda yedekler de kaybolur. Haftada en az bir yedeği başka bir yere kopyalayın: firmanın yedekleme hizmeti, ayrı bir depolama alanı ya da kendi bilgisayarınız.

**Yedekten geri dönmek** için 7. bölümdeki geri yükleme komutunu ilgili yedek dosyasıyla çalıştırın.

## 9. Güncelleme (yeni sürüm)

```bash
cd ~/randevu
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Veritabanı değişiklikleri (migration) API açılırken otomatik uygulanır. Güncellemeden önce elle bir yedek almanız önerilir (8. bölümdeki komut).

## 10. Sorun giderme

| Belirti | Bakılacak yer |
|---|---|
| Site açılmıyor veya sertifika hatası veriyor | `docker compose … logs web`. DNS A kaydı doğru mu, 80 ve 443 portları açık mı? |
| "Beklenmeyen bir hata oluştu" mesajı | `docker compose … logs api --tail 100` |
| Kimse giriş yapamıyor | `JWT_KEY` değişti mi? Değiştiyse herkesin yeniden giriş yapması gerekir |
| Yönetici şifresi unutuldu | `.env` dosyasında `ADMIN_EMAIL` değerini **yeni** bir e-postayla değiştirip API'yi yeniden başlatın. Yeni yönetici hesabı açılır |

`…` yerine `-f docker-compose.yml -f docker-compose.prod.yml` yazın.

---

## Ek: Yerel geliştirme (bilgisayarda)

```bash
cp .env.example .env          # DEMO_ALLOW_RESET=true yapın
docker compose up -d          # veritabanı + API (http://localhost:8080)
cd frontend
npm run seed:api              # bugünün tarihleriyle demo verisi
VITE_API_URL=http://localhost:8080 VITE_DEMO=true npx vite --port 5318
```

- Demo hesaplarının hepsinin şifresi `demo1234`. Örnek hesap: `lara.owner@demo.randevuhazir.com.tr`.
- Testleri çalıştırmak için:
  - Backend: `cd backend && dotnet test`
  - Ekran testleri: `API_URL=http://localhost:8080 BASE=http://127.0.0.1:5318/ npm run e2e`
- `VITE_API_URL` verilmezse uygulama bugünkü gibi tamamen tarayıcıda çalışır. GitHub Pages'teki demo site bu moddadır.
