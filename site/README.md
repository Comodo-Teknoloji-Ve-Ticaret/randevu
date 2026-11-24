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
