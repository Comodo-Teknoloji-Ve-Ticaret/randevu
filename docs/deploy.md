# RandevunHazır: Sunucuya Kurulum ve Taşıma

Bu rehber, RandevunHazır'ı kendi sunucunuzda çalıştırmak için gereken adımları anlatır. Kurulum sonunda şunlar hazır olur:

- `https://alanadiniz` adresinde çalışan bir site
- Otomatik HTTPS sertifikası
- Kalıcı bir PostgreSQL veritabanı

Bütün sistem Docker ile çalışır. Bu sayede sunucu firmasından bağımsızdır; sunucu değiştirmek, veriyi yeni sunucuya taşımaktan ibarettir.

```
İnternet ──443──▶ web (Caddy: HTTPS + site) ──/api──▶ api (.NET) ──▶ db (PostgreSQL)
```

Dışarıya yalnızca 80 ve 443 numaralı portlar açılır. API ve veritabanına dışarıdan doğrudan erişilemez.

---

## 1. Gerekenler

| Ne | Önerilen |
|---|---|
| Sunucu | Ubuntu 24.04, en az 2 GB RAM, 20 GB disk (Türkiye'de bir veri merkezi KVKK açısından avantajlıdır) |
| Alan adı | Örneğin `randevunhazır.com.tr`. DNS'te **A kaydı** sunucunun IP adresini göstermelidir |
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
| `DOMAIN` | Alan adınız, `https://` olmadan. Türkçe karakter varsa `xn--` biçiminde yazın. Örnek: `randevunhazır.com.tr` → `xn--randevunhazr-c5b.com.tr` (çevirmek için: `python3 -c "print('randevunhazır.com.tr'.encode('idna').decode())"`) |
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

## 6a. SMS ve e-posta (gerçek gönderim)

Bu ayarlar boş bırakılırsa SMS ve e-posta **gönderilmez**. Mesajlar yalnızca kayda geçer ve kayıtta "SMS (demo)" olarak görünür. Gerçek gönderim için `.env` dosyasını doldurup `up -d` komutunu tekrar çalıştırın.

**SMS (Netgsm veya İleti Merkezi'nden biri)**

| Ayar | Netgsm | İleti Merkezi |
|---|---|---|
| `SMS_PROVIDER` | `netgsm` | `iletimerkezi` |
| `SMS_SENDER` | BTK onaylı gönderici adınız (başlık) | Aynı. Onay gelene kadar test için `APITEST` |
| `SMS_USERNAME` / `SMS_PASSWORD` | Netgsm abone numaranız ve API şifreniz | — |
| `SMS_API_KEY` / `SMS_API_HASH` | — | Panel > Ayarlar > Güvenlik > API Erişimi'ndeki **anahtar** ve **hash**. Aynı ekranda "API erişimine izin ver" seçeneği açık olmalıdır |

Nasıl çalışır:

- **Hizmet mesajları** (randevu onayı, hatırlatma, iptal) İYS dışında gönderilir.
- **Kampanya ve doğum günü mesajları** İYS kapsamında, "bireysel" olarak gönderilir.
- Kayıtta her mesajın durumu görünür: **SMS iletildi** ya da **SMS iletilemedi** (nedeniyle birlikte, örneğin "Gönderici adı tanımlı değil").

> **Netgsm kullanıyorsanız:** Kampanya mesajlarında İYS filtresi olarak `11` (bireysel) gönderilir. Bu değeri Netgsm desteğiyle teyit edin. Farklıysa `.env` dosyasına `Sms__NetgsmIysFilter=<değer>` satırını ekleyin.

**E-posta** (şifre sıfırlama kodları): kurumsal e-posta hesabınızın SMTP bilgilerini girin. Bunlar `SMTP_HOST`, `SMTP_PORT` (genellikle 587), `SMTP_USER`, `SMTP_PASSWORD` ve `SMTP_FROM` alanlarıdır.

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
