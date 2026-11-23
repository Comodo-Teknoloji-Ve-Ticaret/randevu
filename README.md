# RandevuHazır: Kuaför Randevu & Salon Yönetimi

Comodo'nun kuaförlere sattığı çok kiracılı (çok salonlu) salon yönetim ürünü. Resepsiyondaki bilgisayardan kullanılmak üzere tasarlandı, telefonda da tam çalışır.

**Canlı demo:** GitHub Pages (`frontend/dist`). Giriş ekranında demo hesapları tek tıkla seçilir.

## Özellikler

| Modül | İçerik |
|---|---|
| **Randevu (takvim)** | Personel sütunlu gün görünümü, hafta görünümü, 15 dk ızgara, sürükle-bırak taşıma, alttan çekerek süre uzatma, çakışma/mesai/izin uyarısı, "şu an" çizgisi, randevusuz müşteri, tekrarlayan randevu, durum akışı (Bekliyor → Onaylandı → Geldi → İşlemde → Tamamlandı / Gelmedi / İptal), kısayollar (`N`, `T`, `←`/`→`) |
| **Müşteriler** | Boya kartı (marka, numara, gram, oksidan, süre, beğenildi), karttan paket satışı, ad/telefon ile anlık arama, mükerrer telefon engeli (0532…/+90… aynı sayılır), müşteri kartı: geçmiş, harcama, bakiye, gelmedi sayısı, boya formülü notları, paketler, CSV |
| **Kasa** | Birden fazla POS cihazı ve banka hesabı (ödemede seçilir, gün sonunda ayrı döküm), gün sonunda yönteme göre brüt − gider = net, paketli hizmet otomatik paketten düşer, randevudan tek tıkla adisyon, hizmet/ürün/paket satışı/paketten kullanım, satır ve toplam indirim, bahşiş, nakit/kart/havale/veresiye ve parçalı ödeme, para üstü, veresiye tahsilatı, giderler, gün sonu kapanışı (kilitlenir, sadece sahip açar), gün sonunda nakit/kart/havale ile kaç kişiden ödeme alındığı ve isim listesi (CSV) |
| **Hizmetler** | Kategoriler (takvim rengi), satır içi süre/fiyat düzenleme, personele özel fiyat/süre, online görünürlük |
| **Personel** | Tarih aralığına göre kim kaç TL yaptı; prim: kategori/hizmet bazlı % veya aylık kademeli (yalnızca aşan kısma), ürün primi markaya göre; haftalık mesai, izin/mola, yapabildiği hizmetler; personel rolü için "Primlerim" |
| **Stok** | Kategori → marka filtresi, marka/kategori listeden seçilir veya elle eklenir, alış/satış KDV hariç + KDV oranı (kasada KDV dahil), satış / salon kullanımı ürünleri, giriş/kullanım/sayım, hareket geçmişi, kritik stok uyarısı, satışta otomatik düşüm |
| **Paketler** | Bonuslu seans paketleri (ör. 8+2 fön = 10 kullanım), geçerlilik süresi, satılan paketler ve kalan seans takibi |
| **Mesajlar** | Değişkenli şablonlar ve canlı önizleme, yarınki randevulara toplu hatırlatma, doğum günü kutlaması, WhatsApp ile gönderim, gönderim kaydı (SMS demo modunda simüle edilir) |
| **Online randevu** | Salona özel link (`#/r/<salon>`): şube → hizmet → uzman ("fark etmez") → gün & saat → bilgiler → onay kodu + takvime ekle (.ics). Onay gerekliliği, ileri tarih ve minimum süre ayarlanır |
| **Raporlar** | Ciro (önceki döneme göre), ortalama sepet, net, doluluk, yeni/dönen müşteri, gelmeme oranı, günlük ciro grafiği, ödeme yöntemleri, en çok kazandıran hizmetler, personel performansı ve prim, CSV |
| **Ayarlar** | Salon bilgisi ve marka rengi, şubeler ve çalışma saatleri, kullanıcılar ve roller, online randevu, tema |
| **Platform (Comodo)** | İşletme listesi; işletme türü (kuaför, berber, güzellik merkezi, diş kliniği, spa, tırnak stüdyosu) ve türe göre filtre; lisans takibi (kullanılan/kalan gün, 7 gün kala uyarı, bitince 3 gün ek süre, sonra giriş ve online randevu kilitlenir; uzatma 30/90/180/365 gün); tek kullanımlık davet linki (kopyala / WhatsApp ile gönder / yenile); askıya alma |

**Roller:** Salon Sahibi (her şey) · Resepsiyon (takvim, müşteri, kasa, stok, mesaj) · Personel (kendi takvimi ve primi) · Comodo Yönetici (platform).

**Tema:** Ferah (açık, varsayılan) ve Gece (koyu); kullanıcı menüsünden veya Ayarlar → Görünüm'den.

## Yapı

```
frontend/   React 19 + TypeScript + Vite
  src/domain/          Saf kurallar: müsaitlik/çakışma, adisyon toplamları, prim, telefon, para, tarih (testli)
  src/application/     Repository arayüzleri ve servisler: randevu, müşteri, kasa, stok, mesaj, online randevu, rapor, platform (testli)
  src/infrastructure/  localStorage deposu, demo verisi (2 salon, 3 şube), React sağlayıcıları
  src/ui/              Ortak bileşenler, kabuk, grafikler, tema değişkenleri
  src/pages/           Ekranlar
backend/    .NET Clean Architecture (frontend onayından sonra)
docs/superpowers/      Tasarım dokümanı ve uygulama planı
```

Tüm veri erişimi `Repos` arayüzünden geçer; her kayıt `tenantId` taşır ve bir salon başka salonun verisini göremez. Backend aşamasında aynı arayüzün HTTP implementasyonu takılacak.

Para tutarları kuruş (tam sayı), saatler gün içi dakika, tarihler `YYYY-MM-DD` (Europe/Istanbul) olarak tutulur.

## Çalıştırma

```bash
cd frontend
npm install
npm run dev      # geliştirme
npm test         # Vitest birim testleri
npm run e2e      # Uçtan uca duman testi (çalışan dev sunucusu + yerel Chrome gerekir; BASE ve CHROME ile ayarlanır)
npm run build    # üretim derlemesi (frontend/dist)
```

Demo verisi tarayıcıda (`localStorage`) saklanır; kullanıcı menüsündeki **Demo verisini sıfırla** ile yenilenir. Eski demo verisi açılışta haftalık adımlarla bugüne kaydırılır.
