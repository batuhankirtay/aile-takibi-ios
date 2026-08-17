# aile-takibi-ios

Aile Takibi — şeffaf ve onay temelli aile konum takibi. Bu repo, arka plan GPS takibi için
PWA'yı native iOS/Android uygulamasına çeviren **Capacitor** projesini içerir.
Web kodu (`native/www/`) mevcut PWA'dan birebir kopyalanır.

## Neden native?

iOS, PWA'ların arka planda GPS çalıştırmasına izin vermez. Native uygulama
(`BackgroundGeoPlugin`) Core Location (iOS) / FusedLocation (Android) ile
**gerçek arka plan takibi** yapar. Uygulama arka plana geçse bile GPS çalışmaya devam eder.

## Yapı

```
native/
├── www/                      # Web kaynakları (PWA'dan kopya)
├── .github/workflows/        # iOS IPA derleme workflow'u (GitHub Actions)
├── src/plugins/background-geo/  # (bilgi amaçlı JS köprüsü)
├── ios/App/                  # Xcode projesi
│   └── App/
│       ├── BackgroundGeoPlugin.swift   # Core Location arka plan izleme
│       ├── AppDelegate.swift
│       └── Info.plist        # Konum izinleri + UIBackgroundModes=location
└── android/                  # Android Studio projesi
    └── app/src/main/java/com/irtibat/ailetakibi/
        ├── BackgroundGeoPlugin.java
        ├── BackgroundLocationService.java  # Foreground Service (kalıcı bildirim)
        └── LocationTracker.java
```

## iOS IPA Derleme (GitHub Actions, Xcode gerekmez)

Repodaki `.github/workflows/build-ios.yml` workflow'u, her push'ta veya
**Actions** sekmesinden "Build iOS IPA" → "Run workflow" ile elle tetiklenebilir.
Xcode'lu macOS runner'da derler ve **AileTakibi-ipa** artifact'ini üretir.

1. GitHub → **Actions** → **Build iOS IPA** → **Run workflow**
2. Bitince artifact'ten `AileTakibi.ipa`'yı indir
3. **Sideloadly** (https://sideloadly.io) ile Apple ID'nle imzala ve telefona kur
   - Ücretsiz Apple hesabı: uygulama **7 günde bir** yenilenmeli (AltStore otomatik yapar)
   - Süreklilik için $99/yıl Apple Developer Programı
4. Telefonda: Ayarlar → Gizlilik → Konum Servisleri → AileTakibi → **"Her Zaman İzin Ver"**

## Yerel iOS Kurulum (Xcode ile)

```
cd native
npx cap sync ios
cd ios/App
pod install
open App.xcworkspace
```

Xcode'da Team olarak Apple ID seç, cihaza **Run (▶)**.

## Android Kurulum

1. `native/android` klasörünü **Android Studio**'da aç (gradle senkronizasyonu bekler)
2. Veya komut satırından: `cd android && ./gradlew assembleDebug`
3. APK'yı telefona kur (`app/build/outputs/apk/debug/app-debug.apk`)
4. Konum izninde **"Her Zaman İzin Ver"** seç
   - Android, arka plan izleme sırasında kalıcı "Aile Takibi aktif" bildirimi gösterir —
     bu Android'in şeffaflık zorunluluğudur, kapatılamaz.

## Ayarlar

Bot token ve Chat ID kod içinde **gömülü değildir**; uygulamanın ⚙️ Ayarlar
bölümünden girilir. Telegram verileri yalnızca cihazda (localStorage) saklanır.

## Test

5 saniyelik test aralığı `native/www/app.js` içindeki `SEND_INTERVAL_MS` ile ayarlanır.
Test bitince 5 dakikaya (`5 * 60 * 1000`) geri çekin.
