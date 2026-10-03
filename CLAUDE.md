# CLAUDE.md — CORRR

Instrucciones para Claude trabajando en este repo. Léelo entero antes de tocar nada.

---

## 0. Dónde estamos (leer esto primero)

*Al día a 3-oct-2026, tarde. Si algo de aquí abajo contradice a este apartado, manda este.*

**En las tiendas**: 1.11.10 (Android vc67, iPhone build 17). 46 corredores.

**LA FECHA QUE MANDA: lunes 19 de octubre**, subir la 1.11.11 a las dos tiendas.
El evento de Halloween va del **viernes 23 de octubre al domingo 1 de noviembre**
(§9-bis). Apple tarda hasta tres días en revisar, de ahí el margen.

### Lo siguiente que hay que hacer

1. **Que Iban suba la 1.11.11 (22) / vc76**, que es la que arregla el cierre al
   abrir. Están hechas las dos: `apps/mobile/builds/corrr-v1.11.11-vc76.aab` y
   el archivo `CORRR-1.11.11-build22.xcarchive` en Organizer. **Las builds y los
   archivados los lanzo YO desde la terminal; él los recoge y los sube.**
   La vc75 / build 21 **no sirve**: se cerraba sola (§9).
2. **Terminar de bajar las calles**: `cd apps/backend && npm run calles` (va por
   324 de 442 trozos y 1,32 millones de celdas; se retoma solo). Luego
   `npm run calles:subir`.
3. **Que pruebe la vc76 / build 22**: que la app abra (lo primero), si las
   calabazas salen al instante, si el detector de Android avisa al salir a
   correr, y la prueba de calle del GPS (`docs/prueba-gps.md`).
   **Las calabazas de prueba caducan el 5 de octubre.**

### Ya funcionando en producción (servidor, sin build)

Cercos entre días (§9-quater) · Avisos con notificación al móvil (§9-ter) ·
Panel por pestañas (§9-ter) · Calabazas y su interruptor de tres estados
(§9-bis) · Mapa por tiras · Colores de corredor repartidos por el servidor ·
Historial de robos (`/robos`).

### Qué lleva la 1.11.11 sobre la 1.11.10

Calabazas en el mapa · 10+10 mensajes de Halloween y selector rehecho · pantalla
de Retos con el cartel del evento · detector automático de carrera en Android ·
ficha del corredor (ranking y mapa, la misma) · resumen de administración ·
el cartel de robo dice quién fue · historial "te han robado" en Stats · colores
que no se repiten · territorio que deja ver las calles · y los arreglos de
puntos partidos, vueltas grandes sin rellenar y calabazas que tardaban 18 s.

### Para DESPUÉS de Halloween

1. **Edge-to-edge**: hecho y revertido a propósito el 2-oct (`08125fb`,
   `c5bfdee`, revertidos en `8815d45`). Se recupera con un `git revert` de la
   reversión. No corre prisa: el margen de arriba ya se lee del sistema y el de
   abajo son 48 px fijos que solo quedan justos en móviles con barra alta.
2. **Pantallas grandes** y **DEX/R8**: los otros dos avisos de Google (plazo
   de febrero de 2027).

### Estado del juego

Cercos repartidos a todos menos a **KarolK** — 34.644 celdas, 4.553 de otros,
39.197 puntos. Sin cobrar **a propósito**: lo decide él. `npm run cercos` para
ver los pendientes (solo lee).

Quedan **139 calabazas de prueba** sembradas, que **caducan el 5 de octubre**.
El interruptor está en `prueba:Ibanto`. Al terminar de probar: apagarlo y
"Quitar las que queden sin coger".

### Cómo trabajar con Iban

- **No es programador.** Todo en castellano y en corto: qué pasa, por qué, y qué
  tiene que pulsar él. Nada de jerga sin traducir.
- **Los botones del panel los pulsa él**; los correos y mensajes a la gente, también.
  Pero **las builds y los archivados los lanzo yo** desde la terminal.
- **La BD de producción es de SOLO LECTURA**, y pidiendo permiso. No se borra nada.
- **No se sube nada a las tiendas** sin que él lo diga.
- **Si manda un boceto, se clava** y se compara el resultado con el boceto.
- El repositorio es **público**: ni un secreto en el código.
- **Comprobar antes de afirmar.** En este proyecto ya han salido SIETE fallos que
  se veían bien y estaban rotos por dentro, ninguno daba error: el panel sin
  JavaScript, los avisos sin contar vistas, los cercos saltándose en silencio, el
  territorio de los rivales opaco, el cartel de robo sin nombre, los colores
  repetidos y las calabazas invisibles 18 segundos. **Todos se encontraron
  midiendo, no mirando la pantalla.**

---

## 1. ¿Qué es CORRR?

App de running con captura de territorio: el usuario corre por la calle, sus pisadas se convierten en celdas de 10×10m que conquista en un grid global. Otros usuarios pueden "robar" celdas pisándolas. Mecánica tipo Pokémon GO + Strava con guerra de bandos.

- **Stack móvil**: React Native + Expo SDK 54 (TypeScript)
- **Stack backend**: Node.js + Fastify + Postgres (Supabase Ireland)
- **Hosting backend**: Railway (`https://corrr-api-production.up.railway.app`)
- **App Android**: `app.corrr` en Play Store (`https://play.google.com/store/apps/details?id=app.corrr`)
- **Dominio web**: `corrr.es` (placeholder, no app web aún)

## 2. Estructura del repo

```
corrr/
  apps/
    mobile/                React Native app (Android e iPhone)
      android/             Native Android project (firmado con corrr-release.keystore)
      assets/              Iconos, logos, sprites, sounds, etc.
      builds/              AABs versionados (corrr-vX.Y.Z-vcN.aab)
      src/
        screens/           Pantallas (MapScreen es la grande)
        components/        TauntSelector, ZonePopup, LoadingScreen
        services/api.ts    Cliente HTTP + tipos
        theme/             Colors, spacing, radius tokens
      App.tsx              Root: auth, deep links, version check
      app.json             Expo config (scheme: corrr)
    backend/
      src/routes/index.ts  TODO el backend (un solo archivo ~2300 líneas)
      .env                 Local secrets (NO committed)
  docs/
    privacy.html           Política de privacidad
    logo.png               Brand asset
```

## 3. Comandos esenciales

### Mobile

```bash
# Type-check (rápido, hazlo siempre tras editar)
cd apps/mobile && npx tsc --noEmit

# Comprobaciones de antes de montar: GPS, mapa y hooks detrás de un return
cd apps/mobile && npm run test:gps

# Build AAB para Play Console
cd apps/mobile/android && ./gradlew bundleRelease
# Output: app/build/outputs/bundle/release/app-release.aab
# Copia a builds/ con nombre versionado: corrr-vX.Y.Z-vcN.aab

# Dev server (hot reload en dev client)
cd apps/mobile && npx expo start --dev-client

# Instalar debug APK por USB (Xiaomi: activa "Instalar via USB")
cd apps/mobile/android && ./gradlew installDebug
```

#### Probar el arranque CON SESIÓN en el emulador

Sin esto no se ve la mitad de los fallos: recién instalada, la app se queda en
la pantalla de bienvenida y no llega a ejecutar el código de quien ya tiene
cuenta. Así se le mete una sesión a mano, sin cuenta de verdad y sin tocar la
base de datos (el token es falso: la app arranca entera y luego dice "sesión
caducada", que es justo lo que queremos ver).

```bash
emulator -avd Pixel_7 -no-snapshot-load &          # ~/Library/Android/sdk/emulator
cd apps/mobile/android && ./gradlew assembleRelease -PcorrrDebuggable=1
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell am start -n app.corrr/.MainActivity      # que cree su almacén
sleep 10 && adb shell am force-stop app.corrr

# Sacar el almacén, meterle la sesión antigua y devolverlo
adb shell run-as app.corrr cat /data/user/0/app.corrr/databases/RKStorage > /tmp/rk.db
python3 - <<'FIN'
import sqlite3, json
c = sqlite3.connect('/tmp/rk.db')
s = {"token": "da-igual", "user": {"id": "00000000-0000-0000-0000-000000000000",
     "username": "PruebaLocal", "email": "prueba@local.invalid", "city": "Bilbao"}}
c.execute('INSERT OR REPLACE INTO catalystLocalStorage VALUES (?,?)',
          ('@corrr_session', json.dumps(s)))
c.commit()
FIN
adb push /tmp/rk.db /data/local/tmp/RKStorage && adb shell chmod 666 /data/local/tmp/RKStorage
adb shell run-as app.corrr cp /data/local/tmp/RKStorage /data/user/0/app.corrr/databases/RKStorage

adb logcat -c && adb shell am start -n app.corrr/.MainActivity
sleep 15 && adb logcat -d | grep -iE "ReactNativeJS|FATAL"   # aquí sale el error de verdad
```

`@corrr_session` es el formato antiguo de sesión: la app lo migra sola al
arrancar y así no hace falta tocar el llavero (SecureStore). `-PcorrrDebuggable=1`
da el mismo paquete de release pero con `run-as` abierto; **el AAB que se sube
se monta SIN esa bandera**.

### Backend

```bash
# Type-check
cd apps/backend && npx tsc --noEmit

# Dev local
cd apps/backend && npm run dev

# Deploy a producción: push a main, Railway auto-deploya en ~60s
git push origin main
```

### Verificar despliegue

```bash
# Estado del API en producción
curl https://corrr-api-production.up.railway.app/app/version
```

## 4. Versionado

**Mantener sincronizados** en cada release:

1. `apps/mobile/app.json` → `version` y `android.versionCode`
2. `apps/mobile/android/app/build.gradle` → `versionCode` y `versionName`
3. `apps/mobile/ios/CORRR/Info.plist` → `CFBundleShortVersionString` y `CFBundleVersion` (build)
4. `apps/mobile/src/utils/checkForUpdates.ts` → `CURRENT_VERSION`
5. Aviso de actualización, SOLO cuando la tienda ya la haya publicado: Android `LATEST_APP_VERSION` / `LATEST_APP_VC`, iPhone `LATEST_IOS_VERSION` / `LATEST_IOS_BUILD` (Railway, o el valor por defecto en `apps/backend/src/routes/index.ts`)

Paso a paso completo (Xcode, App Store Connect, Play Console, Railway): `docs/publicar-version.md`.

**Versión actual** (2-oct-2026): Android `1.11.10` vc67 y iPhone `1.11.10` build 17 publicadas y **anunciadas las dos** (`/app/version`). **La 1.11.11 (vc68 / build 18) está CONSTRUIDA**: AAB en `apps/mobile/builds/corrr-v1.11.11-vc68.aab`; falta archivar el iPhone en Xcode, la prueba de calle y subir a las tiendas. **No anunciar hasta que cada tienda la haya publicado.**

**Bloqueo por versión mínima** (`MIN_APP_VERSION` en Railway, hoy en `1.0.0`): el aviso normal de "hay versión nueva" es **descartable** y sale una vez por sesión, así que no garantiza que nadie actualice. El bloqueo sí, y se pone sin build ni tiendas. Se usará la noche del 22 de octubre (§9-bis).

**Comprobación de la 1.11.11 antes de subirla** (2-oct): el AAB se generó y se
abrió para verificar que lleva dentro la versión 1.11.11, la firma, el permiso
`ACTIVITY_RECOGNITION`, el receptor del detector y sus clases en el dex. En iOS
se compiló con Xcode 27 y se arrancó en un simulador de **iOS 27**: la app abre
y pinta bien, sin el fallo de ciclo de vida que tumbó la 1.11.7.

**OJO al probar en el simulador**: un build de *Debug* lleva `expo-dev-client` y
necesita Metro corriendo; sin él arranca, se queda en el splash y se cierra
—que es EXACTAMENTE el mismo síntoma que el fallo de iOS 27— y uno se puede
pasar media hora buscando un fantasma. Para comprobar que la app arranca de
verdad, compilar en **Release** (lleva el código dentro y no necesita nada):
`xcodebuild -workspace ios/CORRR.xcworkspace -scheme CORRR -configuration Release -destination 'id=<UDID>' -derivedDataPath /tmp/x CODE_SIGNING_ALLOWED=NO build`

**Avisos en la app** (desde 23-sep): el pop-up que sale al abrir se escribe en `/admin` → "Aviso en la app" (tablas `avisos` y `aviso_vistas`, endpoints `/app/aviso` y `/admin/avisos`). No necesita build: el contenido, a quién le toca y si está encendido viven en el servidor. La parte de la app llega con la 1.11.10.

**Convención de commits**: `vX.Y.Z (vcN): summary` para releases, `fix(backend|mobile): summary` para fixes puntuales. Cada commit con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## 5. Secrets críticos

### Railway env vars (producción)

| Variable | Obligatoria | Uso |
|---|---|---|
| `JWT_ACCESS_SECRET` | **SÍ** (server crashea sin ella) | Firma JWTs de auth |
| `DATABASE_URL` | **SÍ** | Conexión a Supabase Postgres |
| `STRAVA_CLIENT_ID` | Para OAuth Strava | OAuth signup |
| `STRAVA_CLIENT_SECRET` | Para OAuth Strava | OAuth signup |
| `STRAVA_VERIFY_TOKEN` | Para webhook Strava | Verificación webhook |
| `RESEND_API_KEY` | Para emails (verify, reset password) | Resend API |
| `ADMIN_KEY` | Recomendada (si no, se genera random y nadie puede llamar `/admin/*`) | Endpoints admin |
| `LATEST_APP_VERSION` | Opcional, hay fallback | `/app/version` |
| `LATEST_APP_VC` | Opcional | `/app/version` |
| `MIN_APP_VERSION` | Opcional, fallback `1.0.0` | Force update (futuro) |
| `GOOGLE_CLIENT_ID` | Para login Google | Auth Google |
| `DATABASE_SSL` | No. Solo emergencia | Sin definir = TLS verificado contra la CA de Supabase (`src/db/supabase-ca.ts`). `no-verify` cifra sin verificar: solo si Supabase cambia de CA. Nunca desactivar el cifrado |

### Keystore Android (release)

- **Archivo**: `apps/mobile/android/app/corrr-release.keystore`
- **Contraseñas**: NO se escriben aquí. Están en `apps/mobile/android/keystore.properties`
  (ignorado por git) y en el gestor de contraseñas del usuario. El keystore es **PKCS12**:
  una sola contraseña, aunque el archivo pida los dos campos. Para cambiarla:
  `keytool -storepasswd -keystore ...` — ojo, `-keypasswd` NO funciona en PKCS12.
- **Huella del certificado** (para verificar cualquier copia): `74:45:0F:D6:82:05:25:32:...`

**CRÍTICO**: Sin este keystore no puedes firmar AABs nuevos. Backups en ubicación segura.

## 6. Modelo de dominio

### Territorios (sistema actual v1.6+)

- **Cell**: cuadrícula de 10×10m identificada por `(cell_x, cell_y)` enteros. Tabla `cells`.
- **Claim**: el usuario "claimea" una cell al pisarla durante un run. La cell apunta a `owner_id`.
- **Robo / Steal**: pisar una cell de OTRO usuario te la roba. Backend trackea via UPSERT `ON CONFLICT (cell_x, cell_y) DO UPDATE`.
- **Line bridge**: entre dos lecturas GPS consecutivas, rellenamos las cells del camino con `cellLine` (4-connected). Evita huecos.
- **Flood fill**: al cerrar un loop, las cells INTERIORES se claimean también. Función `fillEnclosedCells`.
- **Stationary detector** (mobile): si las últimas 6 lecturas GPS caben en un círculo de 15m, NO claimemos (anti-drift).

### Zonas (sistema legacy v1.5, mantenido para compatibilidad)

- **Zone**: polígono cerrado. Tabla `zones`. Ya casi no se usa, pero el cliente sigue enviándolas en `saveRun` para clientes viejos.

### Carreras

- **Run**: una sesión de carrera. Tabla `runs`. Incluye distancia, duración, puntos.
- **Puntos** (v1.7 economy):
  - 10 pts/km
  - +1 pt por celda nueva
  - +2 pts por celda robada
  - Multiplicador racha (×1.5 si llevas ≥3 días seguidos corriendo)
  - Multiplicador PB (×1.2 si esa es tu carrera más larga del histórico)
- **Validez**: una carrera se descarta si `cellCount < 5` o `distance < 50m`.

### Taunts (chat entre rivales)

- Cuando A roba a B, B recibe un `robo_notif` (tabla `taunts` mode=robo_notif).
- B puede pulsar "Devolver" → envía 1 `taunt` (mensaje) a A.
- A puede pulsar "Devolver" → envía 1 `response` (respuesta) a B.
- Backend cierra el hilo: solo 1 taunt + 1 response por `(from, to, run_id)`.
- **Desbloqueo progresivo**: el usuario empieza con 1 mensaje + 1 respuesta. Cada 10 robos desbloquea el siguiente. Cap a 10.

### Stats

- `user_stats` agrega: `total_zones`, `total_cells`, `total_points`, `total_km`, `total_runs`, `total_steals`, `streak_days`, `last_run_date`, `best_daily_km`, `bonus_xp`.
- **XP visible** = `floor(total_points / 100) + bonus_xp`.

## 7. Pantallas clave en mobile

| Pantalla | Archivo | Notas |
|---|---|---|
| Mapa + carrera | `MapScreen.tsx` (~2700 líneas) | La grande. Tiene Modal fullscreen para modo carrera estilo Strava. |
| Perfil | `PerfilScreen.tsx` | Stats 2×2, avatar, Strava connect, editar perfil |
| Editar perfil | `EditProfileScreen.tsx` | Form con dropdowns (zapatillas, año, sexo, distancia, frecuencia) |
| Stats | `StatsScreen.tsx` | Lista de carreras + botón "ver más" → AllRunsScreen |
| Todas las carreras | `AllRunsScreen.tsx` | Modal paginado (30/página) |
| Ranking | `RankingScreen.tsx` | Tabs: Global / Ciudad / Amigos |
| Retos | `RetosScreen.tsx` | Placeholder "Próximamente". El antiguo está en `RetosScreen.legacy.tsx`. |
| Onboarding | `OnboardingScreen.tsx` | Login + register + Strava OAuth signup |

## 8. Reglas para Claude

### SIEMPRE

- Tras editar TypeScript: `cd apps/mobile && npx tsc --noEmit` (o `cd apps/backend && npx tsc --noEmit`).
- **Tras tocar el mapa, el GPS o `apps/mobile/src/tracking/`**: `cd apps/mobile && npm run test:gps` tiene que acabar en "Todo en orden", y antes de subir a tiendas se hace la prueba en dispositivo de `docs/prueba-gps.md` (pantalla apagada con permiso "Mientras se usa", en Android y en iPhone). Lo pidió el usuario tras perder carreras: no se saca build sin las dos.
- La lógica de qué cuenta (distancia, celdas, auto-pausa, circuitos) vive en `src/tracking/runTracker.ts`, sin React. Cambios ahí, con escenario nuevo en `scripts/gps-check.ts`.
- **Apple Watch** (desde 1.11.6): `src/services/healthkit.ts` importa entrenos de correr/caminar posteriores a conectar; cada ruta pasa por el mismo `RunTracker` (`src/tracking/importWorkout.ts`). El backend (`POST /runs` con `source='healthkit'`) descarta duplicados y da cada celda a quien pasó por ella MÁS TARDE (`claimed_at` = hora de la carrera). La librería se carga con `require` bajo demanda: en Android no tiene parte nativa. **`NSHealthUpdateUsageDescription` es obligatorio en Info.plist aunque CORRR no escriba en Salud**: la librería contiene código de escritura y App Store Connect rechaza la subida sin él (ITMS-90683).
- **`pod install` siempre con UTF-8**: `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install`. Sin eso CocoaPods 1.17 con Ruby 4 se estrella y esconde el error real.
- **Xcode 27**: el `Podfile` sube a 15.1 el iOS mínimo de todos los pods en `post_install`. Sin eso no compila (librerías de Google, AsyncStorage… declaran 9–14).
- **Clave de Google Maps** (una sola, en `app.json`, `Info.plist` y `AndroidManifest.xml`, visible en el repo público): desde el 16-sep-2026 limitada a **Maps SDK for Android** y **Maps SDK for iOS** en Google Cloud (proyecto CORRR). La app no usa ninguna API web de Google (la ciudad sale del geocodificador del teléfono). **Pendiente para la próxima build:** separarla en dos claves con restricción de aplicación — Android (paquete `app.corrr` + SHA-1 de la clave de subida y de Play App Signing) e iOS (bundle `app.corrr`).
- **Copias de seguridad de la BD** (Supabase FREE no hace): `~/CORRR-copias/copia-bd.sh`, semanal vía `~/Library/LaunchAgents/com.corrr.copia-bd.plist` (se lanza a diario y al iniciar sesión, copia si la última tiene ≥7 días). `pg_dump` del esquema public por el pooler en modo sesión (5432) con TLS verificado, cifrado AES-256 con contraseña del Llavero (servicio `corrr-copias`), se descifra y lee entera antes de darla por buena, guarda 4. Si falla: notificación en el Mac y `registro.log`. Cómo restaurar: `~/CORRR-copias/LEEME-restaurar.md`. `--ahora` fuerza una copia.
- Comentar los CAMBIOS no obvios explicando el "por qué", no el "qué".
- Al modificar `MapScreen.tsx`, verificar que `myCellsUnion` y `rivalCellsUnions` siguen tomando los puntos correctos.
- En commits backend, recordar al usuario que tras push debe esperar ~60s antes de probar (Railway redeploy).
- Bumpear `CURRENT_VERSION` en `App.tsx` Y `versionCode/versionName` en `build.gradle` JUNTOS.

### NUNCA

- **NO subir** keystores, .env, secrets a Git. Ya están en `.gitignore`.
- **NO confundir** la app de Play Console: subimos a CORRR (`app.corrr`), NO a "NOT TOURIST PLAN" (otro proyecto del usuario).
- **NO** romper la compatibilidad de schema sin migración (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- **NO** quitar la validación / clamps anti-cheat en `/runs` (multiplicadores ×1.5/×1.2, cellCount mínimo).
- **NO** llamar `process.exit(1)` por env vars con valores cortos. Solo si están ausentes.
- **NO** poner secrets en código (incluso como fallback "temporal" — siempre vuelven a producción).

### EVITAR

- Construir AABs sin antes type-check. Gradle es lento, no quemes tiempo.
- Cambiar el threshold del detector anti-drift sin medir impacto en caminantes lentos.
- Tocar `polygon-clipping` o `cellLine` sin tests visuales.

## 9. Bugs históricos (no re-introducir)

- **La app se cerraba sola al abrirla, en iPhone y en Android** (3-oct-2026, 1.11.11 build 21 / vc75, retiradas): un `useEffect` nuevo —el de las notas sin ver— quedó escrito DEBAJO de los `return` de `App.tsx` (versión caducada, pantalla de carga, pantalla de bienvenida). React cuenta los hooks que ejecuta en cada pintada y exige que siempre sean los mismos: mientras cargaba se ejecutaban 14 y, en cuanto restauraba la sesión guardada, 15 → `Error: Rendered more hooks than during the previous render` y la app abajo, en las dos plataformas. Lo peor es cómo se esconde: **recién instalada funcionaba** —nunca pasaba del `return` de bienvenida—, así que en el emulador parecía sana; solo se cae a quien ya tiene sesión, o sea a todo el mundo menos a quien la acaba de instalar. Ni TypeScript ni el compilador dicen nada. Arreglado subiendo el hook con los demás, y con `npm run test:hooks` (`scripts/hooks-check.mjs`, ya dentro de `npm run test:gps`), que busca hooks detrás de un `return`. **Regla: TODOS los hooks van arriba del todo, antes del primer `return` — sin excepciones.** Y antes de dar una build por buena, probar el arranque CON SESIÓN, no solo recién instalada (§3).
- **MapView con `display:'none'`**: en versiones < 1.10.0 ocultaba el mapa durante el run pero al volver visible RN-Maps no refrescaba los polígonos. Solución: Modal absoluto encima, no `display:'none'`.
- **`pathSegments` no limpiado en stopRun**: dejaba dashes naranjas sobre las celdas tras la carrera. Limpiar siempre.
- **JWT_ACCESS_SECRET vacío**: `TextEncoder().encode(undefined)` produce secret literal "undefined" → cualquiera firma tokens. Fail-fast SIEMPRE si missing.
- **importStravaActivity sin idempotencia**: Strava reintenta webhooks → carrera duplicada. UNIQUE en `strava_activity_id`.
- **stopRun no idempotente**: doble-tap en STOP llamaba a saveRun() x2. Guard con `isRunningRef`.
- **trustProxy: false** detrás de Railway: rate limit compartido entre todos los usuarios. SIEMPRE `trustProxy: true`.
- **Math.random para tokens de email**: predecible. Usar `crypto.randomBytes`.
- **Tarea de fondo solo con permiso "Siempre"** (hasta 1.11.4): con "Mientras se usa" apagar la pantalla dejaba de registrar. expo-location no exige "Siempre" en ninguna plataforma; arrancarla siempre.
- **Dos caminos para los puntos GPS** (hasta 1.11.4): el de pantalla apagada daba por salto las calles rectas y perdía sus celdas. Un solo camino: `RunTracker.addReading`.
- **Distancia sumada dos veces** (1.11.4): antes y después del anti-deriva.
- **Modal que se monta mientras otro se cierra** (iOS): no se presenta nunca. Encadenar con retardo (`tauntReady`, `popupReady`, `summaryReady`).
- **Cierre del mapa en iOS "object cannot be nil" en `-[AIRGoogleMap insertReactSubview:atIndex:]`** (1.11.2–1.11.6 build 12): la capa de compatibilidad de React Native (`RCTLegacyViewManagerInteropComponentView`, viene precompilada) deja en cola los polígonos que no van al final y quita por posición; si un polígono en cola se retira y se recicla antes de vaciarla, inserta nil. Receta: mover el mapa, esperar 3 s, pulsar "Refrescar" (o la alerta de importación del reloj). Arreglado en `patches/react-native-maps+1.20.1.patch` (se aplica en `postinstall`): con el mapa de Google, inserta al momento y quita por identidad. **Si se actualiza react-native-maps o React Native, regenerar el parche y repetir la receta en el simulador.**
- **iOS 27 no abría la app** (1.11.6 build 13, publicada como "1.11.7"): compilada con Xcode 27 sin ciclo de vida por escenas → iOS 27 la cierra en el splash (`UIScene life cycle is required`). En iOS 26 arrancaba, por eso no se vio. Arreglado en 1.11.8 (build 14): `SceneDelegate` dentro de `ios/CORRR/AppDelegate.swift` + `UIApplicationSceneManifest` en `Info.plist`. React Native arranca en la escena (o en `didFinishLaunching` si iOS relanza la app en segundo plano por la ubicación). **Antes de subir una build de iOS, probarla en un simulador con la última versión de iOS**, no solo en la de tu iPhone. Pendiente: pasarlo a un config plugin para que sobreviva a `expo prebuild`, y el enlace de Strava con la app cerrada no llega a `getInitialURL` (Strava está desactivado).
- **Recta vertical que cortaba el territorio** (hasta 1.11.9): `/cells/viewport` tenía `LIMIT 5000` ordenado por `cell_x`; en zonas llenas (cuña de KarolK: 25.294 celdas en la casilla de la Sagrada Família) las del este se quedaban fuera y el mapa las cortaba en seco. Arreglo: formato **tiras** (`?formato=tiras`, `apps/backend/src/services/tiras.ts` + `apps/mobile/src/map/territory.ts`), sin tope; llega con la 1.11.10. El formato viejo sigue para apps instaladas (tope subido a 40.000, ordenado por cercanía al centro). `scripts/map-check.ts` (dentro de `npm run test:gps`) compara el dibujo por tiras con el de celda a celda. **Nunca volver a poner un tope de celdas que corte la respuesta.**
- `npx tsc --noEmit` en mobile da errores de `@expo/vector-icons` desde el 16-sep: el paquete está instalado dentro de `node_modules/expo/node_modules` y Metro lo resuelve, así que la app compila. No es un fallo del código; filtrar esas líneas.
- **El panel de administración se quedó sin JavaScript por una barra** (23-sep-2026): el HTML del panel vive en una plantilla de TypeScript y el navegador lo recibe con `document.write`, así que su código pasa por DOS procesados. Un `'\n'` (una sola barra) dentro del script se convertía en un salto de línea real dentro de una cadena → el navegador descartaba el script ENTERO y **ningún botón del panel hacía nada**, sin ningún aviso visible. Dentro de esa plantilla hay que escribir `\\n`, `\\s`, etc. **Tras tocar el panel: `cd apps/backend && npm run test:panel`** (genera el panel y le pasa el analizador de node; también comprueba que los botones siguen enganchados).
- **Ningún aviso contaba las vistas, por un POST sin cuerpo** (30-sep-2026): `api.request` pone siempre `Content-Type: application/json`, y `marcarAvisoVisto` manda `POST /app/aviso/:id/visto` **sin body**. Fastify contesta `FST_ERR_CTP_EMPTY_JSON_BODY` (400) **antes de `requireAuth`**, y el móvil se lo tragaba (`catch {}`). Consecuencias: el contador "lo han visto X de Y" clavado en 0 para TODOS los avisos, y el mismo cartel saliendo una y otra vez cada vez que alguien abría la app. Arreglado en el servidor (no en la app: las ya instaladas no se pueden cambiar) con un `addContentTypeParser` de `application/json` que convierte el cuerpo vacío en `{}`. **Cuidado al mandar un POST sin cuerpo desde el móvil** — y si algo "no registra nada", probar el endpoint con `curl` sin autenticación: si contesta 400 en vez de 401, el fallo está antes de la autenticación.
- **El territorio de los rivales se pintaba OPACO** (hasta 1.11.10): `getRivalColor` devolvía `hsl(220, 70%, 55%)` y el mapa le pega la transparencia detrás (`${color}80`). El resultado, `hsl(220, 70%, 55%)80`, no es un color válido: react-native-maps lo da por opaco y la zona del rival tapaba las calles. El territorio PROPIO se veía bien porque su color siempre fue `#FF5500`. Arreglado pasando `getRivalColor` a hexadecimal (`hslAHex`). **Al construir un color con transparencia pegándole dos dígitos detrás, el color base TIENE que ser hexadecimal** — con `rgb()` o `hsl()` no falla, mancha.
- **Un `versionCode` se gasta en cuanto EMPIEZA a subirse** (2-oct-2026): Play Console lo reserva al iniciar la subida, aunque se cancele o quede en borrador, y luego contesta *"El código de versión 69 ya se ha usado"*. Pasó al empezar a subir el vc69 a prueba abierta por error y cambiar a prueba interna. **Si pasa: subir el número, reconstruir el AAB y listo** — no hay forma de liberar el gastado. Por eso conviene no subir "a ver qué pasa".
- **Pedir ACTIVITY_RECOGNITION dejó fuera a 18.713 modelos de móvil** (2-oct-2026): Google Play da por hecho que si pides el permiso de actividad física necesitas **sensor de pasos**, y excluye de la tienda a los que no lo llevan. Lo avisa al subir el AAB ("esta versión ya no admite N dispositivos que sí admitía la anterior"), no al compilar. Arreglado declarando los sensores como OPCIONALES en el manifiesto del módulo (`uses-feature ... required="false"`). **Al añadir un permiso nuevo, mirar siempre esa advertencia de Play antes de publicar**: no es un error, es un aviso fácil de pasar por alto, y te deja la app invisible para miles de móviles.
- **Las calabazas no se veían en ANDROID, y en iPhone sí** (3-oct-2026): los marcadores del mapa llevaban `tracksViewChanges={false}` con una `<Image>` dentro. Con eso, react-native-maps dibuja el marcador UNA vez al crearlo y no lo vuelve a mirar; en Android eso ocurre **antes de que la imagen haya cargado**, así que captura un cuadro vacío y se queda así. Síntomas: calabazas invisibles al abrir, que aparecen al mover el mapa (se crean marcadores nuevos) y vuelven a desaparecer. En iOS no pasa. **Arreglado dejando `tracksViewChanges` en true durante 1,5 s cada vez que cambia la lista** y apagándolo después — dejarlo siempre encendido redibuja cada marcador en cada fotograma y hunde el mapa. **Regla: un `<Marker>` con imagen dentro necesita ese margen al nacer.** Confirmado en el Xiaomi con la vc74: las calabazas salen a la primera.
- **La app de Strava está INACTIVA** (comprobado el 23-sep-2026 con el botón "Comprobar Strava" del panel): `403 {"resource":"Application","field":"Status","code":"Inactive"}`. Strava exige suscripción de pago al dueño de la app y limita las nuevas a 10 atletas. `STRAVA_ENABLED = false` se queda así: reactivarlo sin resolver esto deja a la gente con un botón que no lleva a ninguna parte. **La vía gratis para las carreras de Strava es el iPhone: Strava escribe la ruta en Salud y CORRR ya la importa** (ver "Tus otras carreras" en Perfil). En Android, Strava solo manda a Health Connect tiempo/distancia/calorías, sin ruta: no hay camino gratis hoy.
- **⚠️ `apps/mobile/ios/` NO está en git** (sí `android/`): el `Podfile` con el arreglo de Xcode 27, el permiso de HealthKit en `CORRR.entitlements` y el `Info.plist` solo existen en este Mac. Si se pierde, hay que rehacerlos. Pendiente decidir si se versiona.

## 9-bis. Juego del mapa: objetos (calabazas)

Tabla `objetos` (tipo, celda, puntos, desde/hasta, tomado_por). Se siembran
sobre celdas de `cells` —calles ya pisadas por alguien— con separación mínima
de 300 m; las recoge el SERVIDOR dentro de `POST /runs` mirando las celdas de
la carrera (`src/services/objetos.ts`), y por cada una comida nace otra cerca
heredando la fecha de fin. Endpoints: `/objetos/viewport`, `/objetos/ranking`
y `/admin/objetos` (sembrar, estado, retirar), con su apartado en el panel.

**Cómo se cogen** (decidido el 2-oct, opción B): **pisándolas**, y también las
que queden dentro de un **círculo cerrado en la MISMA carrera** —el relleno del
circuito entra como celdas de esa carrera y `recoger` mira todas—. Los **cercos
entre días NO las recogen**: el territorio pasa a ser tuyo, las calabazas de
dentro siguen ahí. Es a propósito: un cerco puede llegar a 10 km² y barrería el
evento entero el primer día sin pisar ninguna.

Sin tope por carrera: si pisas diez, te llevas las diez (2.000 puntos y los diez
mensajes). El desbloqueo de mensajes sí tiene techo de 10; el ranking no — gana
quien más coja. Las que renacen salen del mismo mapa de calles, así que el
evento va llevando a la gente por sitios nuevos.

**Mapa de calles** (`calles`, `scripts/bajar-calles.mjs`): celdas sacadas de
OpenStreetMap para poder sembrar por CUALQUIER calle, no solo por donde ya ha
corrido alguien. Cubre las zonas con corredores (con 3 km de margen) más 27
capitales y ciudades grandes. **No se puede sembrar al azar por España**: una
calabaza son 10×10 m y hay que pisar ese cuadrado, así que casi todas caerían en
el campo o en el mar. Si la tabla está vacía, la siembra se cae con elegancia a
las celdas ya pisadas.

**Halloween 2026**, calendario (fijado el 2-oct, contando hacia atrás desde el
día que tiene que empezar):

| Cuándo | Qué |
|---|---|
| **19 oct** (lunes) | **Subir a las dos tiendas.** Es la fecha tope: Apple se toma hasta tres días |
| En cuanto publique cada una | Anunciar esa tienda (§4 punto 5) |
| **22 oct** (jueves, noche) | `MIN_APP_VERSION = 1.11.11` en Railway **y** sembrar las calabazas |
| **23 oct (viernes) – 1 nov (domingo)** | El evento |
| **2 nov** | Nombrar al que más cogió en un aviso, y bajar `MIN_APP_VERSION` |

**Por qué empieza el 23 y no el 29**: los mensajes que se desbloquean cogiendo
calabazas hay que poder usarlos. Arrancando el viernes 23 entran el fin de
semana del 24-25, la semana entera y el fin de semana de Halloween. Con los
días 29-31 (jueves a sábado) se desbloqueaban casi sin tiempo de mandarlos.

**Mensajes de Halloween** (`TauntSelector.tsx`): 10 + 10 respuestas, ids **101-110**
(los clásicos son 1-10; si se repitieran, a quien lo recibe le saldría el
cartel clásico de ese número). Se desbloquean de uno en uno, **una calabaza un
mensaje**; sin calabazas la pestaña dice "próximamente". Las miniaturas de la
cuadrícula son verticales (`-v.jpg`, 288×512) y aparte de la imagen grande: la
grande en veinte celdas a la vez se come la memoria del móvil.

## 9-quater. Cercos: lo que rodeas es tuyo

`src/services/territorio.ts`. Si el perímetro de una zona es todo tuyo, el
interior pasa a ser tuyo, lo hayas cerrado en un día o en cinco. Se calcula
inundando desde fuera y pasando solo por celdas que NO son tuyas: lo que el
agua no alcanza está rodeado. La inundación va en cruz, así que una escalerilla
en DIAGONAL sella — eso perdona el zigzag del GPS, que es lo que rompería un
cerco por un pelo.

Se aplica sola al guardar una carrera (dentro de `POST /runs`, mirando 3 km
alrededor de lo corrido, no toda la ciudad). Para los cercos cerrados ANTES de
que existiera la regla hay un botón a mano en el panel (Herramientas → Cobrar
un cerco), que sí repasa todo el territorio del corredor.

Puntos, igual que pisando: **+1** la celda libre, **+2** la que le quitas a
alguien, **−1** al robado, y a este le llega solo un aviso ("Te han cercado").

**Tope: 10 km² (`MAX_CELDAS_CERCO = 100_000`)**, el mismo en los tres caminos.
No es una regla del juego, es una red de seguridad por si un salto del GPS deja
a alguien con forma de anillo alrededor de media ciudad. Estuvo en 2 km² y era
demasiado poco: KarolK cerró 4,7 km² en una vuelta real. Cuando se pasa del
tope **se avisa al corredor** (`avisarCercoEnorme`, uno solo mientras el cerco
siga ahí) en vez de callarse, y ese aviso sale también en la lista del panel.

**Dos topes, no uno.** Además del de 10 km² está la CAJA DE TRABAJO
(`MAX_CAJA_CERCO`, 10×10 km): el trozo de mapa que se inunda. Al guardar una
carrera se pide la caja de lo corrido **con hasta 3 km de margen**, porque el
resto del perímetro se corrió otro día. Ese margen se **encoge** si no cabe
(`cajaDeTrabajo`): antes era fijo, se comía él solo 361.201 de las 500.000
celdas que se permitían, y CUALQUIER carrera de más de 1,1 km de ancho se
saltaba el cerco **en silencio** — por eso hubo que darle cercos a mano a
Zuckerbax y a fausrunner. **No volver a saltarse el cálculo sin dejar rastro:
si algo no cabe, se encoge o se avisa.**

**Y por ZONAS, no por territorio entero** (`gruposDeCeldas`). Quien ha corrido
en Barcelona y un fin de semana fuera tiene una caja con cientos de km de vacío
en medio: no cabía, y a esa persona no se le miraba el cerco NUNCA (ni la regla
ni el botón del panel). Se separan las zonas —celdas cuyas casillas de 1,28 km
se tocan— y se mira cada una por su cuenta. Con eso pasaron de 13 a 18 los
corredores que se pueden comprobar, y aparecieron 3 cercos sin cobrar más.

Inundar es barato (medido: peor caso de 10×10 km, 16 ms y 15 MB), así que el
tope de la caja no es por velocidad sino por memoria. La cola va en
`Int32Array` justo por eso.

Tras tocar esto: `npm run test:territorio`.

## 9-ter. El panel de administración

Vive entero en la plantilla HTML de `apps/backend/src/routes/index.ts` (no hay
build ni framework: se escribe el HTML a mano y Railway lo sirve). Desde el
29-sep-2026 está repartido en **seis pestañas** —Resumen, Gente, Avisos, Juego,
Correos, Herramientas— con una barra superior fija. Al añadir un apartado nuevo,
métele `<h2>` dentro de la pestaña que le toque y envuélvelo en `.caja`; la
pestaña activa se recuerda en `sessionStorage` (`corrr_panel_pestana`). Lo que
borra o manda algo va en Herramientas o Correos, nunca en Resumen.

## 10. Workflow típico de release

Ver `docs/publicar-version.md` (el usuario lo sigue a mano). Resumen:

1. Cambios, type-check, `npm run test:gps`.
2. Subir la versión en los cinco sitios de la §4 (menos el aviso).
3. AAB → `builds/corrr-vX.Y.Z-vcN.aab`; iPhone archivado en Xcode.
4. Commit y push (Railway auto-deploya el backend).
5. Usuario: TestFlight + prueba en la calle (`docs/prueba-gps.md`) si se tocó mapa/GPS.
6. Usuario: App Store Connect y Play Console → enviar a revisión.
7. Publicada en cada tienda → anunciar esa tienda (§4 punto 5).

## 11. Para más historia y contexto

Ver `context.md` en la raíz del repo — incluye lenguaje de dominio detallado, decisiones de arquitectura, y la auditoría sistemática que se hizo en 1.10.4.
