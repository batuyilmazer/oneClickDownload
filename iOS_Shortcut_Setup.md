# iOS Kestirmesi Kurulum Rehberi

## Nasıl Çalışır?

```
Denetim Merkezi kısayolu
        ↓
Clipboard'dan YouTube/Instagram/Twitter/TikTok linki okunur
        ↓
POST /download → backend sunucusu
        ↓
Backend yt-dlp ile videoyu indirir ve mp4 olarak döner
        ↓
iOS Fotoğraflar'a kaydedilir
```

---

## 1. Backend Kurulumu

### Gereksinimler

```bash
# Homebrew ile yt-dlp ve ffmpeg kur
brew install yt-dlp ffmpeg

# Proje bağımlılıklarını yükle
npm install

# Ortam değişkenlerini ayarla
cp .env.example .env
# .env dosyasını düzenle: API_KEY, PORT vb.

# Sunucuyu başlat
npm start
```

### Dışarıdan Erişilebilir Yapmak

iPhone'unuzun backend'e ulaşabilmesi için bir seçenek kullanın:

| Seçenek | Nasıl |
|---------|-------|
| **Aynı Wi-Fi** | Mac'inizin yerel IP'si (örn. `192.168.1.42:3000`) |
| **Cloudflare Tunnel** | `cloudflared tunnel --url http://localhost:3000` → size `https://xxx.trycloudflare.com` verir |
| **ngrok** | `ngrok http 3000` → `https://xxxx.ngrok-free.app` verir |
| **VPS / sunucu** | Sunucuya deploy edin, domain bağlayın |

---

## 2. iOS Kestirmesi Oluşturma

**Kestirmeler** uygulamasını açın → **+** (Yeni Kestirme) → Adı **"Video İndir"** yapın.

Aşağıdaki adımları sırasıyla ekleyin:

---

### Adım 1 — Pano'yu Al
`Eylemler Ekle` → **"Pano"** arayın → **"Panoyu Al"** seçin.

---

### Adım 2 — Metni Koy (Değişken)
`Eylemler Ekle` → **"Değişkeni Ayarla"** seçin.
- Değişken Adı: `clipText`
- Girdi: `Pano` (önceki adımdan)

---

### Adım 3 — Desteklenen Link mi? (Koşul)
`Eylemler Ekle` → **"Eğer"** seçin.
- Girdi: `clipText`
- Koşul: **"İçeriyor"**
- Değer: `youtube.com` → **"veya"** ekle → `youtu.be` → `instagram.com` → `twitter.com` → `x.com` → `tiktok.com`

---

### Adım 4 — URL'ye İçerik Al (API çağrısı)
`Eğer` bloğunun **içine** ekleyin → **"URL'nin İçeriğini Al"**

| Alan | Değer |
|------|-------|
| URL | `https://SİZİN_SUNUCU_ADRESİNİZ/download` |
| Yöntem | `POST` |
| Üst Bilgiler | `Content-Type` → `application/json` |
| Üst Bilgiler | `X-Api-Key` → `.env`'deki `API_KEY` değeriniz |
| İstek Gövdesi | **JSON** |
| JSON Anahtarı | `url` → Değer: `clipText` değişkeni |

> ⚠️  "URL'nin İçeriğini Al" adımında → ayarlar simgesine tıklayıp
> **"Yanıta Devam Et"** yerine **"Dosya Olarak Sakla"** veya
> doğrudan sonraki adıma aktar seçeneğini kullanın (iOS 16+).

---

### Adım 5 — Fotoğraflara Kaydet
`URL'nin İçeriğini Al` adımından gelen sonucu → **"Fotoğraf Albümüne Kaydet"**
- Albüm: **"İndirilenler"** (ya da istediğiniz bir albüm)

---

### Adım 6 — Başarı Bildirimi
`Eylemler Ekle` → **"Bildirim Göster"**
- Mesaj: `✅ Video Fotoğraflar'a kaydedildi!`

---

### Adım 7 — Değilse (Hata durumu)
`Değilse` bloğuna → **"Bildirim Göster"**
- Mesaj: `❌ Panoda desteklenen bir video linki bulunamadı.`

---

### Adım 8 — Denetim Merkezine Ekle
1. **Ayarlar** → **Denetim Merkezi**
2. **"Kestirmeler"** satırını **yeşil +** ile ekleyin
3. Denetim Merkezini aşağı kaydırın → Kestirmeler simgesine uzun basın
4. Listeden **"Video İndir"** kestirmesini seçin

---

## 3. Tam Akış Testi

1. Tarayıcıda bir YouTube/TikTok videosuna gidin ve linki kopyalayın.
2. Denetim Merkezini açın ve **Video İndir** kısa yoluna dokunun.
3. ~10–30 saniye bekleyin (video boyutuna göre).
4. **Fotoğraflar** uygulamasında videonun kayıtlı olduğunu doğrulayın.

---

## 4. Sorun Giderme

| Hata | Çözüm |
|------|-------|
| `401 Yetkisiz` | `X-Api-Key` header'ı `.env`'deki `API_KEY` ile eşleşmiyor |
| `400 Desteklenmeyen platform` | Pano linkini kontrol edin; ham metin değil URL olmalı |
| `422 İndirme hatası` | `yt-dlp --update` ile güncelleme yapın; bazı platformlar token ister |
| Fotoğraflara kaydedilmiyor | iOS Kestirmeler uygulamasına **Fotoğraflar** erişim izni verin |
| Sunucuya ulaşılamıyor | Aynı ağda mı? Cloudflare/ngrok tüneli aktif mi? Port açık mı? |
