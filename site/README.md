# Tanıtım sitesi

Bağımlılıksız statik site. Ad, alan adı, WhatsApp numarası ve fiyat tek yerde: `site.config.json`.

```bash
node site/build.mjs                       # → site/dist/
cd site/dist && python3 -m http.server 5320   # yerelde bak: http://127.0.0.1:5320
```

- `whatsapp`: 90 ile başlayan 12 hane (ör. `905321234567`). Boşsa derleme uyarı verir.
- `phone` / `email` doluysa alt bilgide görünür.
- Ekran görüntüleri `assets/shots/` altında (demo salon "Studio Lara"). Font (Plus Jakarta Sans, OFL) siteyle birlikte barındırılır; Google'a istek gitmez.

Yayına alırken: site alan adının köküne, uygulama `/panel` gibi bir yola ya da alt alan adına taşınacak (bkz. `frontend/Caddyfile`).

## Tanıtım videosu

`assets/video/tanitim.mp4` (1920×1080, ~40 sn, seslendirmeli) + `tanitim-poster.webp`. Sahneler `video/director.html`'de çizilir;
ad, fiyat ve alan adı `site.config.json`'dan, konuşma metni ve ses `video/narration.json`'dan gelir
(macOS `say`, Yelda sesi). Sahne süreleri konuşmaya göre ayarlanır, ses tek parça karıştırılıp AAC'ye çevrilir ve
`video/mux.swift` ile videoya eklenir. Metin, ad ya da fiyat değişince yeniden üretin:

```bash
node site/video/render.mjs                  # ~20 sn, sesli (--silent: sessiz); Chrome'un WebCodecs kodlayıcısıyla kare kare H.264 → MP4 (ffmpeg gerekmez)
node site/video/render.mjs --stills 3,10,31 # kontrol için tek kareler → site/video/stills/
node site/build.mjs
```

Not: Ekransız (headless) Chrome'un `<video>` öğesi bu dosyayı yalnız arka planla çizebiliyor; bu bir test kısıtı.
Dosyayı doğrulamak için macOS'te `qlmanage -t` ya da QuickTime kullanın.
Uygulama ekranları değişirse `assets/shots/` ve `video/frames/` görüntülerini yeniden alın (ekranlarda ürün adı da görünür).
