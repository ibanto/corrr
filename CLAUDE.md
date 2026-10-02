# CLAUDE.md — CORRR

Instrucciones para Claude trabajando en este repo. Léelo entero antes de tocar nada.

---

## 0. Dónde estamos (leer esto primero)

*Al día a 30-sep-2026. Si algo de aquí abajo contradice a este apartado, manda este.*

**En las tiendas**: **1.11.10** (Android vc67, iPhone build 17), publicada y anunciada
en las dos. 46 corredores registrados.

**Lo siguiente es la 1.11.11, y tiene fecha**: debe estar publicada **antes del 29 de
octubre** para que se vean las calabazas de Halloween, así que hay que subirla a las
tiendas el **24-25 de octubre** como muy tarde. Calendario completo en §9-bis.

### Ya funcionando en producción (servidor, sin build)

| Qué | Dónde está explicado |
|---|---|
| **Cercos entre días**: si el perímetro es todo tuyo, el interior pasa a serlo | §9-quater |
| **Avisos** (pop-up al abrir la app) escritos desde `/admin`, con notificación al móvil opcional | §9-ter |
| **Panel `/admin` por pestañas** | §9-ter |
| **Calabazas**: sembrar, recoger y ranking, todo del lado del servidor | §9-bis |
| **Mapa por tiras**, sin tope de celdas | §9 (bugs) |

### Escrito y esperando a la 1.11.11

- Los **10 + 10 mensajes de Halloween** y el selector rehecho: cuadrícula vertical,
  dos pestañas (Clásicos / Halloween), sin candados, calabaza dibujada.
- Las **calabazas en el mapa** (la app todavía no las pinta).

### Falta por hacer ANTES de esa build

1. **Detector automático de carrera en Android** (permiso de actividad física, sin
   ubicación "siempre"): notificación "¿estás corriendo?".
2. **Los tres avisos de Google Play**: edge-to-edge, pantallas grandes y DEX/R8
   (plazo de Google: febrero de 2027).

### Estado del juego

Cercos ya repartidos: DaniRC, fausrunner, Oriol15, Zuckerbax, afarbis, GER, raul,
Luiso y Ansgar. **Queda uno sin cobrar a propósito: KarolK** — 34.644 celdas, de las
que 4.553 son de otros (39.197 puntos). Mueve el ranking de verdad, así que lo decide
el usuario. Para ver si hay cercos pendientes: `cd apps/backend && npm run cercos`
(solo lee la BD).

### Cómo trabajar con Iban

- **No es programador.** Todo en castellano y en corto: qué pasa, por qué, y qué tiene
  que pulsar él. Nada de jerga sin traducir.
- **Los botones los pulsa él.** No tengo su clave de administrador; los correos y los
  mensajes a la gente los manda él desde el panel. Yo preparo el texto y le digo dónde.
- **La BD de producción es de SOLO LECTURA**, y pidiendo permiso. No se borra nada sin
  preguntar.
- **No se saca ninguna build a las tiendas** sin que él lo diga.
- **Si manda un boceto, se clava**: proporciones, tipografía y adornos igual, y se
  compara el resultado con el boceto antes de darlo por bueno.
- El repositorio es **público**: ni un secreto en el código.
- Cuando algo no cuadre, **comprobarlo antes de afirmarlo**. En este proyecto ya han
  aparecido tres fallos que se veían "bien" desde fuera y estaban rotos por dentro
  (el panel sin JavaScript, los avisos sin contar vistas, los cercos saltándose en
  silencio). Ninguno daba error: los tres se encontraron mirando.

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

# Build AAB para Play Console
cd apps/mobile/android && ./gradlew bundleRelease
# Output: app/build/outputs/bundle/release/app-release.aab
# Copia a builds/ con nombre versionado: corrr-vX.Y.Z-vcN.aab

# Dev server (hot reload en dev client)
cd apps/mobile && npx expo start --dev-client

# Instalar debug APK por USB (Xiaomi: activa "Instalar via USB")
cd apps/mobile/android && ./gradlew installDebug
```

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

**Versión actual** (30-sep-2026): Android `1.11.10` vc67 y iPhone `1.11.10` build 17 publicadas y **anunciadas las dos** (`/app/version`). **La próxima build es la 1.11.11: build 18 / vc68**, y tiene fecha (§0).

**Bloqueo por versión mínima** (`MIN_APP_VERSION` en Railway, hoy en `1.0.0`): el aviso normal de "hay versión nueva" es **descartable** y sale una vez por sesión, así que no garantiza que nadie actualice. El bloqueo sí, y se pone sin build ni tiendas. Se usará el 28 de octubre (§9-bis).

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
- **La app de Strava está INACTIVA** (comprobado el 23-sep-2026 con el botón "Comprobar Strava" del panel): `403 {"resource":"Application","field":"Status","code":"Inactive"}`. Strava exige suscripción de pago al dueño de la app y limita las nuevas a 10 atletas. `STRAVA_ENABLED = false` se queda así: reactivarlo sin resolver esto deja a la gente con un botón que no lleva a ninguna parte. **La vía gratis para las carreras de Strava es el iPhone: Strava escribe la ruta en Salud y CORRR ya la importa** (ver "Tus otras carreras" en Perfil). En Android, Strava solo manda a Health Connect tiempo/distancia/calorías, sin ruta: no hay camino gratis hoy.
- **⚠️ `apps/mobile/ios/` NO está en git** (sí `android/`): el `Podfile` con el arreglo de Xcode 27, el permiso de HealthKit en `CORRR.entitlements` y el `Info.plist` solo existen en este Mac. Si se pierde, hay que rehacerlos. Pendiente decidir si se versiona.

## 9-bis. Juego del mapa: objetos (calabazas)

Tabla `objetos` (tipo, celda, puntos, desde/hasta, tomado_por). Se siembran
sobre celdas de `cells` —calles ya pisadas por alguien— con separación mínima
de 300 m; las recoge el SERVIDOR dentro de `POST /runs` mirando las celdas de
la carrera (`src/services/objetos.ts`), y por cada una comida nace otra cerca
heredando la fecha de fin. Endpoints: `/objetos/viewport`, `/objetos/ranking`
y `/admin/objetos` (sembrar, estado, retirar), con su apartado en el panel.

**Halloween 2026**, calendario:

| Cuándo | Qué |
|---|---|
| 24-25 oct | Subir la 1.11.11 a las dos tiendas (Apple tarda en revisar) |
| Al publicarse | Anunciar cada tienda (§4 punto 5) |
| **28 oct, noche** | `MIN_APP_VERSION = 1.11.11` en Railway **y** sembrar las calabazas desde el panel |
| 29-31 oct | El evento: 200 puntos por calabaza, la siguiente nace 10 min después y en otro sitio |
| Después | Nombrar al que más cogió en un aviso, y bajar `MIN_APP_VERSION` |

Lo de `MIN_APP_VERSION` no es capricho: el aviso normal de "hay versión nueva"
es **descartable** ("Ahora no") y sale una vez por sesión, así que no garantiza
nada. Quien se quede en 1.11.10 recogerá calabazas **sin verlas** y, si le llega
un mensaje de Halloween, verá una pantalla negra — los dibujos no están en su
app. El bloqueo por versión mínima es el único que lo garantiza, y se pone
desde Railway sin build ni tiendas.

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
