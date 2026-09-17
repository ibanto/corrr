# Publicar una versión nueva

De la build a las tiendas y al aviso de actualización. Lo de Claude va marcado;
el resto se hace a mano en Xcode, App Store Connect, Play Console y Railway.

## 1. Preparar (Claude)

- Cambios, `npx tsc --noEmit` y `npm run test:gps` ("Todo en orden").
- Subir la versión en **todos** los sitios a la vez (ejemplo: 1.11.7):

| Dónde | Qué |
|---|---|
| `apps/mobile/app.json` | `version` y `android.versionCode` |
| `apps/mobile/android/app/build.gradle` | `versionName` y `versionCode` (+1, nunca se repite uno ya subido) |
| `apps/mobile/ios/CORRR/Info.plist` | `CFBundleShortVersionString` y `CFBundleVersion` (build, +1 en cada subida) |
| `apps/mobile/src/utils/checkForUpdates.ts` | `CURRENT_VERSION` |

- Android: `cd apps/mobile/android && ./gradlew bundleRelease` y copiar a
  `apps/mobile/builds/corrr-vX.Y.Z-vcN.aab`.
- iPhone: archivar en Xcode (queda en Organizer como `CORRR X.Y.Z (N)`).
- Textos de novedades para las dos tiendas.

## 2. Probar

1. Subir la build de iPhone (paso 3.1) e instalarla desde TestFlight.
2. Si se ha tocado el mapa o el GPS: prueba en la calle de
   [prueba-gps.md](prueba-gps.md), con la pantalla apagada, en Android y en iPhone.

## 3. iPhone — App Store Connect

1. **Subir la build.** Xcode → Window → Organizer → Archives → `CORRR X.Y.Z (N)`
   → **Distribute App** → **App Store Connect** → **Distribute**. En 10–30 min
   llega un correo de que está procesada.
2. **Crear la versión.** [App Store Connect](https://appstoreconnect.apple.com)
   → Apps → CORRR → pestaña **Distribución** → **+** junto a "App para iOS" →
   escribir el número (X.Y.Z).
3. **Rellenar.**
   - **Novedades de esta versión**: el texto preparado.
   - **Compilación** → **Añadir compilación** → la build nueva (comprobar el número).
   - **Publicación de la versión**: **Publicar esta versión manualmente**.
4. **Guardar** → **Añadir para revisión** → **Enviar para revisión**.
5. Apple tarda 1–2 días. Con el estado "Pendiente de publicación por parte del
   desarrollador" → **Publicar esta versión**.

No pregunta por el cifrado: `ITSAppUsesNonExemptEncryption` es `false` en el Info.plist.

Si la versión toca HealthKit, añadir en **Notas para la revisión** para qué se
usa y dónde se activa (Perfil → Apple Watch).

## 4. Android — Google Play Console

1. [Play Console](https://play.google.com/console) → **CORRR** (`app.corrr`),
   no NOT TOURIST PLAN.
2. **Probar y publicar** → **Producción** → **Crear nueva versión**.
3. **Subir** `apps/mobile/builds/corrr-vX.Y.Z-vcN.aab`.
4. **Notas de la versión**: el texto preparado (máximo 500 caracteres).
5. **Siguiente** → revisar avisos → **Guardar**.
6. **Resumen de la publicación** → **Enviar cambios a revisión**.
7. Google tarda de horas a días. Aprobada, sale sola.

## 5. Avisar a los usuarios — solo cuando ya esté publicada

Cada tienda por separado, cuando la aprueben. Si se anuncia antes, la app pide
actualizar a una versión que aún no está en la tienda.

En Railway (servicio del API → Variables → **Deploy**), o pedírselo a Claude,
que cambia los valores por defecto en `apps/backend/src/routes/index.ts` y hace push:

| Tienda | Variables |
|---|---|
| Android | `LATEST_APP_VERSION` = X.Y.Z · `LATEST_APP_VC` = N |
| iPhone | `LATEST_IOS_VERSION` = X.Y.Z · `LATEST_IOS_BUILD` = N |

Comprobar:

```bash
curl -s https://corrr-api-production.up.railway.app/app/version
curl -s "https://corrr-api-production.up.railway.app/app/version?platform=ios"
```
