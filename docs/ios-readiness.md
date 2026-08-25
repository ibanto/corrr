# CORRR — Auditoría de readiness para iOS

Fecha: jun 2026. App: RN + Expo SDK 54, hoy Android-only (Play, producción solicitada).
Objetivo: portar a iPhone / App Store. Este doc lista lo que ya está, los gaps y el esfuerzo.

## ✅ Lo que YA está listo (no hay que tocar)
- **Stack compartido RN/Expo** → ~75% del código vale tal cual.
- `app.json` iOS: `bundleIdentifier: app.corrr`, `supportsTablet: true`, `ITSAppUsesNonExemptEncryption: false` (evita prompt de export compliance).
- **Google Maps key** ya en `ios.config.googleMapsApiKey` (misma que Android).
- **Permisos de ubicación iOS**: el plugin `expo-location` ya define `locationWhenInUsePermission` y `locationAlwaysAndWhenInUsePermission` → genera los `NSLocation*UsageDescription`.
- Código ya **iOS-aware** en varios sitios: `Platform.OS === 'ios'` para teclado (KeyboardAvoidingView), paddings y safe area; `notifications.ts` aísla el canal Android.
- **EAS configurado** (`extra.eas.projectId`) → builds iOS en la nube posibles sin pelearse con firma de Xcode.
- **Premium es placeholder** (botón `opacity:0.5`, sin libs de pago) → **sin problema de Apple IAP por ahora**.

## ⚠️ Gaps a resolver (por prioridad)
| # | Gap | Prioridad | Acción |
|---|---|---|---|
| 1 | **GPS en background** | 🔴 ALTA | iOS no tiene foreground service; el OS suspende la app. (a) Añadir `UIBackgroundModes: ['location']` a `ios.infoPlist` (el plugin NO lo pone solo). (b) **Re-validar y re-ajustar TODO el tracking en un iPhone real** — el ciclo de background difiere; lo afinado para Android no transfiere. Aquí va el 60-70% del esfuerzo. |
| 2 | **Push (APNs)** | 🟠 Media | `notifications.ts` usa `getExpoPushTokenAsync` (push REMOTO). iOS necesita clave APNs de Apple + capability Push Notifications. Sin ello, las notifs de robo/zona no llegan en iPhone. |
| 3 | **Google Sign-In iOS** | 🟠 Media | `@react-native-google-signin` en iOS necesita un **OAuth client ID de iOS** propio + el **URL scheme reversed-client-id** en Info.plist (CFBundleURLTypes). |
| 4 | **No hay carpeta `ios/`** | — | `expo prebuild -p ios` (o build directo con EAS). |
| 5 | **ImagePicker (avatar)** | 🟢 Baja | Añadir `NSCameraUsageDescription` y `NSPhotoLibraryUsageDescription` (cámara + galería). |
| 6 | **Fuente de las frases** | 🟢 Baja | `sans-serif-condensed` (MapScreen) **no existe en iOS** → cae a fuente por defecto, se pierde el look BEBAS. Cargar Bebas Neue/Oswald con expo-font, o usar condensada iOS. |
| 7 | **StatusBar / notch** | 🟢 Baja | `StatusBar backgroundColor` se ignora en iOS. Probar notch / isla dinámica / home indicator (hoy se usa `SafeAreaView` básico de RN). |
| 8 | **Maps SDK iOS** | 🟢 Baja | Verificar en Google Cloud que la API key tiene habilitado **"Maps SDK for iOS"** (además del de Android). |

## ✅ Actualización — ago 2026: primer build iOS funcionando

Se hizo el primer `expo prebuild -p ios` + build real en simulador (iPhone 17 Pro, iOS 26.5, Xcode 26.6):

- **Gaps 1a, 5, 6, 7 confirmados YA resueltos** en un pase anterior (estaban en `app.json`/`MapScreen.tsx` antes de esta sesión).
- **CocoaPods instalado** (`brew install cocoapods`). Nota: el `pod install` falla con `Encoding::CompatibilityError` si el shell no tiene `LANG`/`LC_ALL` en UTF-8 (Mac trae el shell en `C` por defecto) → siempre exportar `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` antes de `pod install` / `expo prebuild`.
- **Fix nuevo**: `AppCheckCore` (dependencia transitiva de `@react-native-google-signin/google-signin` → Firebase) es un pod Swift que no compila como librería estática sin `use_modular_headers!`. `expo-build-properties` NO tiene esa opción en RN 0.81/SDK 54 → se creó un config plugin local `apps/mobile/plugins/withModularHeaders.js` (usa `withPodfile` de `@expo/config-plugins` para inyectar la directiva) y se registró en `app.json` → sobrevive a `expo prebuild --clean`.
- **`ios/` NO se commitea** (ya estaba en `.gitignore` desde antes, a diferencia de `android/` que sí está trackeado por herencia histórica). Regenerar con `npx expo prebuild -p ios` cuando haga falta.
- **Build headless con xcodebuild → BUILD SUCCEEDED** a la primera tras el fix de modular headers.
- **Probado en simulador**: splash, los 4 slides de onboarding, pantalla bienvenida (Empezar/Ya tengo cuenta) y formulario de login — todo renderiza perfecto, fuente `AvenirNextCondensed-Heavy` aplicada correctamente, sin errores en Metro. Conectado a Metro vía dev-client (`corrr://expo-development-client/?url=...`).
- **Sin tocar todavía**: GPS foreground/background real (simulador no sirve para esto — hace falta iPhone físico), push APNs, Google Sign-In iOS (necesita OAuth client ID iOS propio), cuenta Apple Developer.

### Cómo levantar el simulador desde cero
```bash
cd apps/mobile
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo prebuild -p ios   # regenera ios/ (o --clean)
xcrun simctl boot "iPhone 17 Pro"                               # o el UDID que prefieras
npx expo start --dev-client                                     # Metro
# build con xcodebuild apuntando a ios/CORRR.xcworkspace, scheme CORRR, o `npx expo run:ios`
```

## 🔮 Futuro (cuando se active Premium)
Pagos de bienes digitales en iOS → **Apple IAP obligatorio (comisión 30%)**, no Stripe. Planificar StoreKit/RevenueCat antes de activar premium en iOS.

## 💰 Coste y esfuerzo
- **Apple Developer Program: 99 $/año** (recurrente).
- Gaps de config menores (2,3,5,6,7): ~1-2 días, **casi todos se pueden dejar listos AHORA sin cuenta Apple** (son cambios de `app.json`/código).
- **GPS background (#1)**: el grueso; días de prueba en calle con iPhone + ajuste. Difícil estimar sin probar.
- App Store Connect + ficha + capturas (tamaños iPhone) + etiquetas de privacidad + **TestFlight** + revisión Apple: ~2-3 días de trabajo + espera de revisión (más estricta que Google).

## Roadmap sugerido
0. (Ahora, gratis) **Pase de prep de config**: dejar listos en `app.json`/código los gaps 1a, 5, 6, 7.
1. Apple Developer (99 $) + decidir EAS Build vs Xcode local.
2. `expo prebuild -p ios` → que compile y arranque en simulador/iPhone.
3. **GPS core en iPhone** (foreground + background) → el trabajo de verdad.
4. Push APNs (#2) + Google Sign-In iOS (#3) + Maps SDK (#8).
5. TestFlight (beta iOS) → ficha App Store → revisión → producción.
