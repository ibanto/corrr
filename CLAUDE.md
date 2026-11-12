# CLAUDE.md — CORRR

Instrucciones para Claude trabajando en este repo. Léelo entero antes de tocar nada.

---

## 0. Dónde estamos (leer esto primero)

*Al día a 2-nov-2026, mediodía (la parte de la 1.11.11/1.11.12 es del 26-oct). Si algo de aquí abajo contradice a este apartado, manda este. Iban sigue el 2-nov desde OTRO perfil de Claude: todo lo de hoy está aquí y en `REDES/agenda.md` («Traspaso del 2-nov»).*

**En las tiendas**: **1.11.11 publicada y ANUNCIADA en las dos** (Android
vc87, iPhone build 34). 54 personas. Ya no queda nada de la subida.

**1.11.12 (SOLO Android, vc88) — PUBLICADA EN PRODUCCIÓN el 26-oct (~12:30) y ANUNCIADA** (prueba en la calle de Iban OK el 24-oct)
(`apps/mobile/builds/corrr-v1.11.12-vc88.aab`, notas en
`store/notas-1.11.12.md`). Google la aprobó y, como Play Console tiene la
**«Publicación gestionada» activada**, se quedó esperando en *Resumen de
publicación* hasta que Iban pulsó «Publicar 1 cambio» (ojo la próxima vez:
aprobada no es publicada). La ficha mostró 1.11.12 a los pocos minutos y se
anunció cambiando los valores por defecto de `LATEST_APP_VERSION`/`LATEST_APP_VC`
en `routes/index.ts` (en Railway esas variables no existen). **`MIN_APP_VERSION`
NO se toca** (§9, «subir la versión mínima con gente corriendo»). El iPhone se queda en la 1.11.11.
Lleva tres arreglos, todos en `MapScreen.tsx` (runTracker no se toca):
1. **La carrera ya no se pierde cuando Android cierra la pantalla de la app**
   (§9, «carrera viva»). Lo sufría un corredor con un Xiaomi.
2. **El GPS de la carrera se enciende al pulsar INICIAR**, sin esperar a una
   lectura suelta que en Android no caduca nunca; si falla, se reintenta, y
   al volver a primer plano se vuelve a encender si hace falta. Mientras no
   ha entrado ningún punto sale «Buscando GPS…» sin vibrar (tope 90 s).
3. **La copia pendiente ya no se manda dos veces** ni la borra el reenvío de
   otra carrera (contador de envíos + `borrarCopiaSiEsLaMisma`).
Probado en el emulador con «No mantener actividades» (cinco escenarios, dos
vueltas de revisión a la contra). Lo que NO cubre: el proceso muerto entero
(§14) y una falsa alarma que viene de antes (quieto >25 s con GPS bueno →
AUTO-PAUSA y «Sin señal GPS» con vibración). Las dos, después de Halloween.

**OJO para la próxima subida**: `itunes.apple.com/lookup` siguió devolviendo
1.11.10 **más de doce horas** después de publicar. No sirve para decidir cuándo
anunciar; la ficha web sí (ahí sale "Versión 1.11.11" como actual con su fecha).

**12-nov, 13:37 — iPHONE 1.11.17 (build 42) ENVIADA A REVISIÓN DE APPLE, con el OK de Iban («Sí, envíala»).** En App Store Connect sale
«1.11.17 Pendiente de revisión» (hasta 48 h), con «Publicar esta versión manualmente», las novedades y el texto promocional de
`store/notas-1.11.17.md` y la cuenta de revisión comprobada ese mismo rato (`puedeEntrar: true`). La hizo Claude con el Chrome de Iban.
**Cuando Apple la apruebe**: «Publicar esta versión» (con el OK de Iban) y, cuando la ficha enseñe la 1.11.17, anunciarla.
**12-nov, 13:44 — ANDROID 95 (1.11.17) EN PRUEBA INTERNA** («Disponible para testers internos»). Iban arrastró el AAB vc95 a la página
«Crear versión de prueba interna» que le abrió Claude en su Chrome, y Claude puso las notas y pulsó «Siguiente» → «Guardar y publicar»
(«pon los textos y haz el resto»). Solo avisó de lo de siempre: sin archivo de desofuscación.
**12-nov, 14:04 — ANDROID 95 (1.11.17) ENVIADA A REVISIÓN DE GOOGLE para producción, con el OK de Iban («Sí, mándala»).** En «Resumen de
publicación» sale en **«Cambios en revisión»: Producción · 95 (1.11.17) · Iniciar lanzamiento completo**, al 100 % y con las notas de
`store/notas-1.11.17.md`. **«Publicación gestionada» sigue activada**: aunque Google apruebe, se queda esperando hasta pulsar «Publicar
cambios» (con el OK de Iban). En producción sigue la 93 (1.11.15). Otra vez «Promocionar versión → Producción» salía en gris («El canal ya
tiene una versión en borrador»): había un borrador vacío («Versión sin nombre») en Producción → Versiones; se entró con «Editar versión»,
«Añadir de la biblioteca» → 95, notas, «Siguiente» → «Guardar» → «Enviar 1 cambio a revisión». **Las dos tiendas están ya en revisión;
cuando aprueben las dos, publicar a la vez y anunciar** (valores en el bloque de abajo).
**OJO con «Claude in Chrome»**: ese día el único navegador conectado al principio era **el Chrome de un compañero de Iban**, no el suyo
(`isLocal: true` solo dice que es un Mac). Claude abrió allí Play Console y la entrada de App Store Connect hasta que Iban avisó y conectó
su Chrome. Antes de abrir nada de Iban: `list_connected_browsers` y usar solo el que diga **`onThisComputer: true`**.

**12-nov, 12:05 — 1.11.17 MONTADA Y SUBIDA A TESTFLIGHT (Android vc95, iPhone build 42), pedida por Iban («y las nuevas builds… súbelos a sus respectivos»).**
Lleva SOLO la pantalla de Retos nueva: la lista en **dos pestañas, Activos y Finalizados** (Iban, ese mismo día), y la ficha de un reto
terminado con su sello, sus ganadores, la clasificación final y sin botón; cada reto dice su ciudad. Cambian `RetosScreen.tsx` y
`services/api.ts`. **No se tocó el mapa ni el GPS: no pide prueba en la calle.** Es el paso de app de lo de abajo (el servidor ya lo sirve
a todas las versiones). Notas de las dos tiendas en `store/notas-1.11.17.md`.
- **Android**: `apps/mobile/builds/corrr-v1.11.17-vc95.aab` (95 MB; por dentro: 1.11.17, vc95, firma SHA-256 de siempre, servidor de
  producción, sin depuración). **Falta que Iban lo arrastre a Play Console**: Claude no puede (la herramienta de Chrome no sube más de
  10 MB). Que ese día la cuenta de Play «no saliera en ningún perfil `/console/u/0` a `/u/4`» no significa nada: el Chrome conectado
  era el de un compañero (ver arriba). Dónde está la cuenta de CORRR lo dice la nota de las 08:30 de más abajo (perfil 2, `/console/u/2/`).
- **iPhone**: archivado como `CORRR-1.11.17-build42` y **SUBIDO a App Store Connect (TestFlight) el 12-nov a las 12:03** por terminal.
  **HECHO el 12-nov a las 13:37** (ver arriba): versión 1.11.17 creada en App Store Connect con la **build 42** y enviada a revisión.
  La cuenta de revisión existe (`GET /admin/cuenta-revision?email=applereview@corrr.es` → `puedeEntrar: true`, mirado el 12-nov).
- **OJO, hay una build 41 en TestFlight que NO vale** (y hubo un AAB vc94, ya borrado): se montaron a las 11:50 sin las pestañas, Iban las
  pidió cinco minutos después y se volvió a montar todo. En App Store Connect, elegir la 42.
- **Después**: publicar en cada tienda (las dos con publicación manual) y anunciarlas (Android `LATEST_APP_VERSION` 1.11.17 /
  `LATEST_APP_VC` 95; iPhone `LATEST_IOS_VERSION` 1.11.17 / `LATEST_IOS_BUILD` 42). Los commits de la versión (`c0eecd9`, `60fb39e` y el
  de la vc95) están **SUBIDOS a GitHub el 12-nov a las 13:40 con el OK de Iban** («Sí, súbelos»; `/health` → `0357d6f`; no cambian el
  servidor, y `/app/version` sigue anunciando Android 1.11.15 vc93). Play Console de CORRR, prueba interna:
  `play.google.com/console/u/2/developers/6827237561288468443/app/4972872541990548685/tracks/internal-testing` → «Crear nueva versión».

**12-nov, mediodía — RETOS TERMINADOS Y RETOS DE TODAS LAS CIUDADES: commit `ccf489d`, SUBIDO el 12-nov a las 11:30 con el OK de Iban («Sí, súbelo»).**
Detalle en §9-quinquies («Un reto terminado se ve terminado»). En corto:
- **Servidor (ya en producción: llega a todo el mundo, sin build)**: un reto cuyos logos han caducado sale como **FINALIZADO** con su lista de
  **ganadores** (los primeros de la clasificación; cuántos, casilla nueva **«Cuántos ganan»** del panel, 3 si no se pone nada), va al final
  de la lista y ya no admite apuntarse ni borrarse. Y **los retos encendidos los ve y se apunta cualquiera, sea de la ciudad que sea**
  (antes solo los de la ciudad de su perfil). A las apps ya instaladas (1.11.15 / 1.11.16) les llega metido en los textos del reto.
- **App (va en la 1.11.17, montada el mismo día, ver arriba)**: la ficha de un reto terminado con su sello, su tabla
  de ganadores y la clasificación final, y sin botón. Hasta entonces las apps instaladas siguen enseñando el botón ME APUNTO /
  DESAPUNTARME en un reto terminado (el servidor lo rechaza y la app dice «No ha salido. Prueba otra vez.»).
- **El reto de prueba de producción** (`la-tienda-prueba`, en prueba para Ibanto): sus logos caducaron el 10-nov a las 17:33. Sale
  FINALIZADO y **sin ganadores**: los 2 logos que cogió Ibanto eran de la tanda del 5 al 7, y al sembrar otra tanda con otra fecha la
  cuenta empezó de cero (DE_ESTE_EVENTO). Cuando no se quiera ver más: apagarlo o eliminarlo en el panel.
- **Antes del reto de Navidad**: poner «Cuántos ganan» = 3 en su campaña; y, ya que ahora lo ve toda España, que el título diga la ciudad.

**12-nov, ~08:30 — PUBLICADAS LAS DOS (con el OK de Iban, «sustitúyelas y publicamos»), por Claude con el Chrome de Iban:** iPhone **1.11.16 (build 40)**
(App Store Connect → «Publicar esta versión», España; queda «Listo para distribución») y Android **93 (1.11.15)** (Play Console → «Publicar 1 cambio»,
«Última publicación el 12 de noviembre»; Google tarda hasta 1 h en enseñarla). **ANUNCIADAS el 12-nov a las 09:40** (las dos fichas ya enseñaban su versión; commit `042bd94`; `/app/version` → Android 1.11.15 vc93, iPhone 1.11.16 build 40).
**Falta**: encender las pestañas de vaciles desde el panel: **hoy están Tótems «en prueba para Ibanto», Aura «no» y Navidad «no»**.
Antes de publicar se **sustituyeron dos carteles de Tótems** (la pareja 01 «lobo naranja», ahora con león y lobo nuevos, y la provocación de la 05 «soldado
verde») con `subir-vaciles.mjs --nombre "Tótems" --modo prueba --probadores Ibanto --orden 0` (OJO: el script REESCRIBE modo, orden y probadores de la
pestaña con lo que se le pase; hay que pasar los valores actuales, que se leen con `GET /admin/vaciles`). Mismos ids (1001-1010).
**Play Console**: la cuenta de desarrollador de CORRR está en el **perfil 2 de Google del navegador de Claude** (`/console/u/2/`), no en el 0 ni el 1.
**10-nov: la 1.11.15 se vuelve a montar como Android vc93 / iPhone build 39** (la vc92 / build 38 no se publica).
Lleva, además de lo de abajo, tres arreglos de la app (§9): **la carrera ya no se cuelga al mirar el móvil tras
mucho rato con la pantalla apagada** (**probado en la calle en Android**, ver abajo), **la copia de una vuelta grande se puede volver a
leer en Android** y **el GPS de una carrera que murió sin PARAR se apaga al abrir la app**. Notas en `store/notas-1.11.15.md`.
Commit `4607a90`, **subido a GitHub el 10-nov a las 17:30 con el OK de Iban** (`/health` → `4607a90`; el servidor no cambia
con él, y `/app/version` sigue anunciando Android 1.11.12 e iPhone 1.11.11: no se anuncia nada hasta que cada tienda publique).
AAB en `apps/mobile/builds/corrr-v1.11.15-vc93.aab` (95 MB; por dentro: 1.11.15, vc93, firma SHA-256 de siempre, servidor de
producción, sin depuración). iPhone archivado como `CORRR-1.11.15-build39` y **SUBIDO a App Store Connect (TestFlight) el 10-nov
a las 17:26**.
**PRUEBA EN LA CALLE, ANDROID: OK** (Iban, 10-nov, con la vc93 desde la prueba interna): carrera de 30 minutos, **20 de ellos con
la pantalla apagada sin mirar el móvil**; al encender, todo al día y ningún error. Es la confirmación del arreglo del cuelgue que
no se pudo acabar en el emulador. **Falta**: la misma prueba en el iPhone (build 39, TestFlight) y, si puede, que la pruebe el
corredor del audio.
**10-nov, 19:45 — EL iPHONE VA POR OTRO NÚMERO: 1.11.16 (build 40).** Apple aprobó la 1.11.15 con la **build 38** (la del
7-nov, SIN los tres arreglos del 10-nov) y en App Store Connect ya sale «1.11.15 Lista para distribución» (la ficha pública
aún enseñaba la 1.11.14). La build 39 (1.11.15) ya no sirve para nada: una versión publicada no admite otra build, y la app
solo compara el NÚMERO de versión (`isNewerVersion` en `checkForUpdates.ts`), así que publicarla como «1.11.16» con 1.11.15
dentro dejaría el aviso de «nueva versión» saliendo siempre. Por eso se montó la **1.11.16 (build 40)**: el mismo código que
la vc93 de Android, solo cambia el número. Archivada como `CORRR-1.11.16-build40`, comprobada por dentro y **subida a
TestFlight el 10-nov a las 19:51**. En App Store Connect **la versión 1.11.16 ya está creada** (la creó Claude con el Chrome
de Iban, a petición suya) con su texto promocional, sus novedades (`store/notas-1.11.16.md`), **la build 40 ya elegida** y
«Publicar esta versión manualmente». **Enviada a revisión el 10-nov a las 21:05** (ver el punto 1 del plan).
**Android se queda en 1.11.15 vc93** (la probada en la calle): se promociona de prueba interna a producción, sin volver a
subir nada. **El repo ya está en 1.11.16**: en `build.gradle` y `app.json` pone `versionCode 94`, pero **el AAB vc94 NO se
ha montado**; el próximo AAB será 1.11.16 vc94 o posterior (lo que hay en Play es el commit `4607a90`).
**Plan de Iban (10-nov): publicar en las dos tiendas a la vez, en cuanto Apple apruebe.** Orden:
1. iPhone: **HECHO el 10-nov a las 21:05: la 1.11.16 (build 40) está «Pendiente de revisión» en Apple** (hasta 48 h),
   con «Publicar esta versión manualmente». Antes faltaba la cuenta de revisión: `GET /admin/cuenta-revision` decía
   `{"existe":false}` para `applereview@corrr.es`; Iban la creó en el panel (Herramientas → «Cuenta para la revisión de
   Apple») y el servidor ya contesta `puedeEntrar: true`. **Regla de siempre (§15): antes de cada envío a Apple, mirar
   que esa cuenta existe; se había vuelto a perder.** Falta la prueba en la calle del iPhone (TestFlight, 1.11.16 (40)),
   que puede hacerse mientras Apple revisa.
2. Android: **HECHO el 10-nov (~21:20), por Claude con el Chrome de Iban y su OK**: la **93 (1.11.15) está en «Cambios en
   revisión»** de Google, producción al 100 %, con las notas de producción. Con la «Publicación gestionada» se queda
   esperando aunque Google la apruebe. Cómo se llegó: «Producción» salía en gris («El canal ya tiene una versión en
   borrador») porque quedaba la **89 (1.11.13)** del 2-nov, aprobada y sin publicar, más un borrador vacío. Se quitó la 89
   de «listos para publicarse» (Resumen de publicación → «Eliminar cambios»; vuelve a «aún no enviados», no se borra) y la 93
   se metió en el borrador vacío con «Añadir de la biblioteca» (Producción → Versiones → «Editar versión»); al guardarla
   sustituyó a la 89. **Lección: si «Promocionar a producción» sale en gris, mirar Producción → Versiones.** En producción
   sigue la vc88 (1.11.12) hasta que se publique la 93.
3. Con las dos aprobadas: «Publicar esta versión» en App Store Connect y «Publicar 1 cambio» en Play Console.
4. Cuando cada ficha enseñe la suya: anunciarlas (Android `LATEST_APP_VERSION` 1.11.15 / `LATEST_APP_VC` 93; iPhone
   `LATEST_IOS_VERSION` 1.11.16 / `LATEST_IOS_BUILD` 40; lo hace Claude con un push, con el OK de Iban) y encender Tótems,
   Aura y Navidad en el panel. La 1.11.15 del iPhone (build 38) no hace falta anunciarla si la 1.11.16 sale en pocos días.
**1.11.15 (Android vc92, iPhone build 38) — MONTADA el 7-nov. iPhone SUBIDO a App Store Connect (TestFlight) el 7-nov ~13:27; falta que Iban suba el AAB a la prueba interna de Play Console y haga la prueba en la calle.**
**La 1.11.14 del iPhone (build 37) YA la aprobó Apple y espera a que Iban pulse «Publicar esta versión»** (visto en
App Store Connect el 7-nov: «1.11.14 Pendiente de publicación»; antes yo la di por no publicada, error mío).
**Mientras esté así, App Store Connect NO deja crear la versión 1.11.15** (solo admite una versión nueva a la vez).
Orden: publicar la 1.11.14 → «+» 1.11.15 → elegir la **build 39** (la del 10-nov, no la 38) → enviar a revisión, **después de la prueba en la calle**.
Si se publica la 1.11.14, no hace falta anunciarla (`LATEST_IOS_*`) si la 1.11.15 va a salir en pocos días.
En Android la 1.11.15 (vc92) sustituye a la vc91.
Commit `f78d37f` (versión) y `ddfcde7` (panel). AAB en `apps/mobile/builds/corrr-v1.11.15-vc92.aab`
(95 MB; versión 1.11.15, firma SHA-256 de siempre, servidor de producción), iPhone archivado como
`CORRR-1.11.15-build38` (Xcode → Organizer). Lleva, además de lo de la 1.11.14: las **pestañas de vaciles
desde el panel** con la **portada de colecciones** (§9-sexies), el **interruptor de la pestaña Halloween**,
el **mapa que pinta el último territorio guardado al abrir** (§0, «El mapa, rápido») y el logo de campaña que
renace a los 5 min. Notas de tienda y pasos en `store/notas-1.11.15.md`. Se tocó `MapScreen.tsx`:
**hace falta la prueba en la calle** (`docs/prueba-gps.md`) en los dos móviles.
**Cómo se subió el iPhone sin tocar Xcode** (Iban pidió «las subes tú, yo solo verifico»): `xcodebuild archive`
con `-allowProvisioningUpdates` y luego `xcodebuild -exportArchive` con `docs/ExportOptions-appstore.plist`
(`method app-store-connect`, `destination upload`): usa la cuenta de Apple que ya tiene Xcode, sin claves
nuevas. **El Android NO se puede subir desde aquí**: la herramienta del navegador solo sube archivos de
menos de 10 MB y no hay clave de la API de Play; lo arrastra Iban a Play Console (Pruebas internas →
Crear versión). Las tiendas no se tocan más allá de la prueba: producción y anuncio, con su OK.
**Al publicarla en las dos tiendas**: encender Tótems, Aura (y la pestaña Halloween si se quiere) desde el panel.

**1.11.14 (Android vc91, iPhone build 37) — MONTADA el 2-nov. iPhone: probado en la calle el 5-nov (OK), enviado a Apple y APROBADO, pendiente de publicar (7-nov). Android: la vc92 de la 1.11.15 la sustituye.**
Sustituye a la 1.11.13 (vc89/vc90, builds 35/36), que solo llegó a prueba: esa no se
publica. AAB en `apps/mobile/builds/corrr-v1.11.14-vc91.aab`, iPhone archivado como
`CORRR-1.11.14-build37` (Xcode → Organizer: «CORRR 1.11.14 (37)»). Lleva el ranking con
España / Mi ciudad con buscador / Amigos y la lista de retos con ME APUNTO (§9-quinquies) y Retos sin Halloween, con el anuncio de
Navidad que manda el servidor. Commit `9ef6e21`, subido; el servidor ya lo
tiene desplegado (`/health` → `9ef6e21`). Notas de las dos tiendas y pasos en
`store/notas-1.11.14.md`.

Comprobado el 2-nov: el AAB por dentro (versión 1.11.13, firma SHA-256 de
siempre, servidor de producción y no el de pruebas, la imagen nueva), el
archivo del iPhone (1.11.13 (35), misma firma que la build 34, servidor de
producción) y la app arrancando en un simulador de **iOS 27.2** en Release.
Retos probado en el emulador contra `mock-api` en los tres casos (anuncio de
Navidad, sin anuncio y con campaña). **Sin ver todavía**: el anuncio contra el
servidor de VERDAD (`/app/evento` pide sesión); se verá en TestFlight.

**Prueba del iPhone, 5-nov (Iban, desde TestFlight): todo bien.** 17 minutos con
la pantalla apagada, y al pulsar STOP sale el resumen. Creó una campaña en el panel: ME APUNTO
y DESAPUNTARME funcionan, y al borrarla Retos enseña «Próximamente · Gran reto de
Navidad» (o sea, el anuncio visto ya contra el servidor de verdad). El ranking
enseña Mi ciudad con su buscador. **Falta la prueba en el Android**: subir la vc91
a la prueba interna de Play Console y hacer la misma prueba en la calle.

**El evento de Halloween fue del 23-oct al 1-nov** (§9-bis). **Ya acabó**
(~02:00 del 2-nov). Marcador final: 113 calabazas, 197 fantasmas; 1.º KarolK
(42 calabazas), 2.º carlos (26), 3.º Oriol15 (19). Publicado en redes el 2-nov
con sus nombres (Iban lo pidió).

### El mapa, rápido (6-nov-2026, tarde; commit `209891d`, desplegado)

**Servidor, ya en producción**: las tiras del mapa se guardan YA HECHAS en la tabla
`tiras_casilla` (por casilla de 128 celdas y dueño), se rehacen al guardar cada carrera y
cada 5 min se comparan con `cells`; caché del mapa de 5 min; pool caliente. Medido en
Barcelona: territorio sin caché **300-2.200 ms → 60-180 ms**; tras 50 s sin peticiones
**300-1.400 ms → 165-240 ms**; en Postgres, de 150-240 ms leyendo 122.000-138.000 celdas
a ~2 ms leyendo 29-32 filas. Comprobado en producción que la tabla da exactamente las
mismas tiras que calcularlas al vuelo (`scripts/medir-mapa/comprueba-tiras.mjs`, solo lee).
Detalle y cómo se mantiene: §9, «El mapa tardaba en salir».

**App, para la versión siguiente a la 1.11.14** (en el repo, SIN build ni versión nueva):
el mapa ya no espera a las zonas antiguas (`/zones/nearby`, 156 KB × 3 por arranque, que no
se pintaban) y guarda el último territorio en el móvil para pintarlo al instante al abrir.
**Probado en el emulador la noche del 6-nov** (APK de release contra `npm run mock`, con
sesión metida, §3): en un arranque recién instalada pide el territorio DOS veces (Madrid y
la posición) y nunca `/zones/nearby`; con vista guardada, UNA; y con el servidor de mentira
APAGADO el mapa sale igualmente pintado con el territorio guardado, sin pantalla de
«ACTUALIZANDO MAPA» (captura a los 3 s de `am start`, lo que tarda en cargar el JavaScript).
`npm run test:gps` pasa. **Falta la prueba en la calle** cuando se monte esa versión.

### Lo siguiente que hay que hacer (2-nov)

1. **Subir la 1.11.14** — lo hace Iban, en este orden:
   - iPhone a TestFlight: Organizer → «CORRR 1.11.14 (37)» → Distribute App.
   - **Prueba en la calle** con los dos móviles (`docs/prueba-gps.md`): se tocó
     `MapScreen.tsx`. Mirar también Retos: tiene que salir el anuncio de Navidad.
   - Play Console (producción) con el AAB, y App Store Connect. Antes de Apple:
     panel → «¿Está viva?» (cuenta de revisión, §15). Google tiene la
     publicación gestionada: aprobada NO es publicada, hay que pulsar
     «Publicar 1 cambio».
   - Publicada cada tienda → anunciarla (`LATEST_*`, §4 punto 5).
2. **NO apagar el interruptor de Halloween** hasta que la 1.11.14 esté en las
   dos tiendas: las 1.11.11/1.11.12 instaladas enseñan en Retos el cartel de
   Halloween escrito en la app; encendido dice «HAY CALABAZAS… HASTA EL 1 DE
   NOVIEMBRE» con el marcador final, y apagado diría «ESTE HALLOWEEN,
   PREPÁRATE», que es peor. Las calabazas ya caducaron y la siembra automática
   solo actúa con el evento vivo, así que encendido no siembra nada. Desde el
   6-nov los logos de campaña se cogen con Halloween apagado o encendido, da igual.
3. **El anuncio de Retos** («GRAN RETO DE NAVIDAD · ¡CON PREMIO!») está en
   `PROXIMAMENTE` de `routes/index.ts`. **Ese reto de Navidad NO existe
   todavía**: falta decidir con Iban qué es, fechas y premio (lo natural es
   montarlo como campaña desde el panel, §9-quinquies: al encenderla, Retos la
   enseña en lugar del anuncio). Después de Navidad, cambiar o quitar
   (`null`) ese anuncio con un push.
4. **Nombrar en la app al que más calabazas cogió** (KarolK): panel → Juego →
   *Marcador del evento*, o un aviso desde la pestaña Avisos. Es botón de
   Iban; sin hacer el 2-nov a mediodía.
5. **`MIN_APP_VERSION`** sigue en `1.11.11` en Railway desde el 22-oct. El
   plan era bajarla a `1.0.0` el 2-nov, pero **no se ha tocado**: bajarla deja
   volver a apps viejas que piden el mapa en el formato viejo, que gasta más
   cuota de Supabase (§9, «El mapa se comía la cuota»). Decidirlo con Iban;
   si se cambia, **de madrugada** y pulsando «Deploy» en Railway.
6. **Lo primero de §14** (ya es «después de Halloween»): devolver la carrera
   que se pierde cuando Android mata la app.
7. **Vaciles desde el panel** (§9-sexies, 6-nov): el servidor y el panel ya lo
   tienen, de textos y **de carteles** (commit `167867b`, desplegado); la app lo
   lleva en la **1.11.15** (la siguiente a la 1.11.14). Hasta que esa esté en las
   dos tiendas, las pestañas nuevas solo **en prueba**. **Subidas el 6-nov con
   `subir-vaciles.mjs`: «Tótems» (id 1, mensajes 1001-1010) y «Aura» (id 2, 1011-1020),
   las dos EN PRUEBA para Ibanto.** Cuando la 1.11.15 esté en las dos tiendas, encenderlas
   desde el panel. Ojo: el `.env` de `apps/backend` lleva desde ese día la `ADMIN_KEY` de
   producción (antes tenía una de pruebas y el servidor decía «Acceso denegado»).
   **7-nov**: Iban cambió los diez PNG de Tótems (letra nueva, de brocha; el zip de la carpeta
   es la versión vieja) y se resubieron con el script: mismos ids. Y **la pestaña HALLOWEEN
   (dibujada en la app) tiene ya su interruptor en la caja Vaciles del panel**, apagada
   mientras nadie lo toque: solo manda en la 1.11.15 o más nuevas (las anteriores la enseñan
   siempre). Pedido por Iban: «ahora no tiene sentido Halloween, y pronto vendrán vaciles
   navideños» (esos irán como una pestaña de carteles más, sin tocar la app).
   **7-nov: pestaña «Navidad» subida con el script** (id 3, 4 parejas, mensajes 1021-1028, **EN PRUEBA para Ibanto**; carpeta `apps/mobile/assets/taunts/navidad/`, sin commitear; el `LEEME.txt` de la carpeta dice qué archivo era cuál). Los PNG de Iban son 941×1670: el servidor los encaja en 592×1280 con una banda negra fina arriba y abajo. Cuando la 1.11.15 esté en las dos tiendas, encenderla desde el panel.
   **Y en el panel cada pestaña es ya un desplegable con su botón Apagar/Encender** (§9-sexies).
8. **Vueltas de más de 10 km² (10-nov)**: el servidor ya las guarda (commit
   `1e8d52d`, subido con el OK de Iban, `/health` → `1e8d52d`). La parte de la
   app (la copia que Android no relee) va en la 1.11.15 vc93 / build 39 (§9).

#### Lo que se hizo la noche del 22 (histórico)

La noche del 22 se hicieron los tres primeros pasos, comprobados uno a uno:

1. ✅ **Sembrado** con el botón morado: **1.123 calabazas y 2.800 fantasmas**
   repartidas por ~47 zonas, del 23-oct al 1-nov, 200 puntos cada una. Salen
   1.123 y no 2.600 porque la separación mínima de 300 m descarta las que
   caen demasiado juntas.
2. ✅ **Halloween encendido para todo el mundo** (`ajustes_juego` = `si`).
3. ✅ **`MIN_APP_VERSION = 1.11.11`** en Railway, comprobado en
   `/app/version` para android e ios. **OJO**: en Railway las variables se
   quedan EN ESPERA hasta que se pulsa el botón de desplegar — la fila sale
   resaltada en morado con el valor a la vista. No basta con guardarla.
4. ⏳ **Falta el AVISO dentro de la app**, el del botón "ME APUNTO"
   (`docs/aviso-halloween.md`). Con notificación al móvil.

**OJO con la hora**: las fechas se guardaron como las 02:00 del 23 (el
servidor va en UTC y España está en +2 en octubre). O sea que las calabazas
aparecen a las 2 de la madrugada del viernes, no a medianoche, y el evento
acaba sobre las 2 de la madrugada del 2-nov. Se decidió dejarlo: son dos
horas en las que no corre nadie.

**El 2 de noviembre** (plan de entonces; cómo quedó, en los puntos 4 y 5 de
arriba): nombrar al que más cogió (panel → Juego → *Marcador del evento*) y
bajar `MIN_APP_VERSION` a `1.0.0`.

### Ya funcionando en producción (servidor, sin build)

Cercos entre días (§9-quater) · Avisos con notificación al móvil (§9-ter) ·
Panel por pestañas (§9-ter) · Calabazas y su interruptor de tres estados
(§9-bis) · Mapa por tiras · Colores de corredor repartidos por el servidor ·
Historial de robos (`/robos`) · **Pestañas de vaciles desde el panel** (§9-sexies,
6-nov-2026: el servidor y el panel ya; la app las enseña desde la **1.11.15**, la
siguiente a la 1.11.14, que está en revisión de Apple y no se toca) · **La pestaña HALLOWEEN se
enciende y apaga desde esa misma caja** (7-nov; manda en la app desde la 1.11.15).

### Qué lleva la 1.11.11 sobre la 1.11.10

Calabazas en el mapa · 10+10 mensajes de Halloween y selector rehecho · pantalla
de Retos con el cartel del evento · detector automático de carrera en Android ·
ficha del corredor (ranking y mapa, la misma) · resumen de administración ·
el cartel de robo dice quién fue · historial "te han robado" en Stats · colores
que no se repiten · territorio que deja ver las calles · calabazas y fantasmas
que se esconden al alejar el mapa, igual que el territorio · **buscador de
ciudad** en el mapa · el resumen de administración con NOMBRES (quién ha
corrido, quién ha robado a quién, altas, quién ha abierto) · la bandeja con el
número delante en vez de un párrafo · **calabazas y fantasmas que se agrupan**
al alejar el mapa, con cuántas lleva cada montón · la tarjeta del perfil dice
cuánto llevas y QUÉ te falta para los +50 puntos · y los arreglos de puntos
partidos, vueltas grandes sin rellenar, calabazas que tardaban 18 s, el botón
de centrar el mapa, el número del montón cortado en Android, la chapa de la
pestaña que se salía de la pantalla y **la carrera que se reescribía entera en
el disco cada tres segundos** con la pantalla apagada (§9) · y **fuera todo
lo que nombraba a Strava** en el perfil.

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

**Calabazas**: hay **70 de PRUEBA** sembradas el 16-oct (barrio de Iban +
Zaragoza, de la prueba de la siembra automática) que **caducan solas el 19**.
No hace falta quitarlas y no ensucian el ranking (el contador va por evento). En la
tabla siguen las **8 cogidas probando** (7 de Ibanto, 1 de fausrunner el 2-oct)
y no se borran: desde el 15-oct **el contador es por evento** y lo de antes no
suma (§9-bis). El interruptor de Halloween sigue en `prueba:Ibanto`; el 22 por
la noche pasa a `todos`.

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

#### Probar la app contra datos de mentira (recorrerla entera)

Lo de arriba comprueba que la app ABRE. Esto sirve para RECORRERLA: mapa,
stats, ranking, retos, perfil, la bandeja, la ficha de un corredor. Hay un
servidor de mentira en `scripts/mock-api.mjs` que contesta lo que la app pide,
con datos de sobra o con todo a cero (`MODO=vacio`, que es como lo ve una
cuenta recién hecha, y donde más se rompe). `MODO=campana` enseña Retos con un
reto en marcha, uno de otra ciudad y dos terminados (con ganadores y sin ninguno).

```bash
cd apps/mobile && npm run mock          # o: MODO=vacio npm run mock

# Apuntar la app al servidor de mentira. Las DOS cosas, y DESHACERLAS después:
#   src/theme/index.ts  → API_BASE = 'http://10.0.2.2:8787'   (10.0.2.2 = este Mac visto desde el emulador)
#   android/app/src/main/AndroidManifest.xml → <application android:usesCleartextTraffic="true" …
cd android && ./gradlew assembleRelease -PcorrrDebuggable=1
adb install -r app/build/outputs/apk/release/app-release.apk
adb emu geo fix -2.935 43.263           # Bilbao, para que el mapa tenga calles

# Entrar con cualquier correo y contraseña: el servidor de mentira dice que sí.
adb shell input tap <x> <y>  ·  adb exec-out screencap -p > /tmp/x.png
adb logcat -d | grep -E "ReactNativeJS: E|JavascriptException"   # los errores de verdad
```

**Y MIRAR LAS CAPTURAS**, no solo los errores: lo que salió así fue texto
equivocado —las fechas viejas de Halloween—, que no da ningún error. Al cerrar
el servidor de mentira con Ctrl-C imprime las rutas que no supo contestar; si
hay alguna, esa pantalla se ha quedado sin probar.

**Deshacer siempre las dos líneas** antes de montar lo que se sube, y
comprobarlo con `git status`. `-PcorrrDebuggable=1` NO va en el AAB.

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

**Versión actual** (ver §0, que manda; esto es de 2-oct-2026): Android `1.11.10` vc67 y iPhone `1.11.10` build 17 publicadas y **anunciadas las dos** (`/app/version`). **La 1.11.11 (vc68 / build 18) está CONSTRUIDA**: AAB en `apps/mobile/builds/corrr-v1.11.11-vc68.aab`; falta archivar el iPhone en Xcode, la prueba de calle y subir a las tiendas. **No anunciar hasta que cada tienda la haya publicado.**

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
- **Huella del certificado** (para verificar cualquier copia, es la **SHA-256**):
  `74:45:0F:D6:82:05:25:32:B4:B0:F3:2F:28:22:28:71:62:71:ED:A5:B1:15:42:D2:4B:4B:A8:9D:5E:37:86:5D`.
  Se saca del propio AAB: `unzip -o x.aab 'META-INF/*.RSA'` y `keytool -printcert -file META-INF/CORRR.RSA`.

**CRÍTICO**: Sin este keystore no puedes firmar AABs nuevos. Backups en ubicación segura.

## 6. Modelo de dominio

### Territorios (sistema actual v1.6+)

- **Cell**: cuadrícula de 10×10m identificada por `(cell_x, cell_y)` enteros. Tabla `cells`.
- **Claim**: el usuario "claimea" una cell al pisarla durante un run. La cell apunta a `owner_id`.
- **Robo / Steal**: pisar una cell de OTRO usuario te la roba. Backend trackea via UPSERT `ON CONFLICT (cell_x, cell_y) DO UPDATE`.
- **Line bridge**: entre dos lecturas GPS consecutivas, rellenamos las cells del camino con `cellLine` (4-connected). Evita huecos.
- **Relleno de vueltas**: al cerrar un circuito, las cells INTERIORES se claimean también. Lo hace `claimLoopInterior` en `runTracker.ts`, vuelta a vuelta y solo si la caja de esa vuelta no pasa de 250.000 celdas (~5×5 km) y la vuelta mide como mucho 50 km. `fillEnclosedCells` sigue en el archivo pero es **código muerto** desde la 1.11.5.
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
- **Tres familias por el id** (`taunt_id`): clásicos 1-10 y Halloween 101-110 van DIBUJADOS dentro de la app; desde el 1001, los escritos en el panel (§9-sexies), que viajan como texto.
- **La pestaña HALLOWEEN del selector sale solo si el panel la tiene encendida** (ajuste `pestana_halloween`, §9-sexies; apps 1.11.15+). CLÁSICOS sale siempre.

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
| Ranking | `RankingScreen.tsx` | Tabs: España / Mi ciudad (con buscador de ciudades) / Amigos |
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

- **Cambiar un dibujo y que la build se lleve el viejo** (4-oct-2026): se sustituyeron `calabaza.png` y `zombi.png` y el APK seguía trayendo los anteriores. Gradle guarda una copia en `android/app/build/generated/res/createBundleReleaseJsAndAssets/` y **no la refresca aunque el fichero de `assets/` haya cambiado**; borrar `generated/res/react` o `merged_res` no sirve, es esa carpeta. Se vio porque los dibujos salían con un recuadro negro en la app teniendo el PNG transparente. **Al tocar cualquier imagen de `assets/`: `rm -rf android/app/build/generated/res/createBundleReleaseJsAndAssets android/app/build/intermediates/packaged_res` antes de montar, y comprobar el dibujo DENTRO del AAB** (descomprimirlo y mirarlo), no solo el fichero de origen.
- **Reducir la paleta de un PNG le quitó la transparencia** (4-oct-2026): al adelgazar los dibujos nuevos con `quantize(method=MEDIANCUT)` el fondo transparente se volvió negro, y en la app salía un recuadro. `FASTOCTREE` sí respeta el canal alfa (y encima dejó los ficheros más pequeños). **Y la comprobación hay que hacerla sobre un color CHILLÓN, no sobre negro**: la primera vez se montó sobre fondo oscuro y el recuadro negro no se veía.
- **El resumen de carrera no decía de dónde salían los puntos** (hasta la build 23 / vc77): el 4-oct una carrera de 3,46 km dio 8.000 puntos y las líneas del desglose sumaban 1.847. Faltaba la que más pesa: **lo que se queda uno al cerrar un cerco**. El servidor sí lo mandaba (`puntosCerco`, `cercadas`); la app simplemente no lo pintaba, y el tope tampoco se decía. Un total que no cuadra con ninguna línea parece un error nuestro. Arreglado con dos filas nuevas y el orden puesto para que la cuenta se lea de arriba abajo: cerco → multiplicadores → tope → calabazas (que van por fuera). **Al añadir una fuente de puntos nueva, ponerla TAMBIÉN en el desglose** — si no, el número final deja de poder explicarse.
- **El tope de puntos era plano y premiaba igual la vuelta corta que la paliza** (hasta vc77): 8.000 para todos, y una carrera de 3,4 km los alcanzaba enteros gracias a un cerco. Ahora el tope **se gana corriendo**: 2.000 puntos por km, con techo de 20.000. Las calabazas van **por fuera** (200 son 200 aunque la carrera se tope) y tienen su propio ranking.
- **Valencia estaba partida en dos ciudades** (hasta el 4-oct-2026): `València` (3 personas) y `Valencia` (1), con rankings de ciudad distintos que no se veían entre ellos. El GPS devuelve "València" y quien lo escribió a mano puso "Valencia". Arreglado con la función `corrr_ciudad` en la base de datos, que compara sin acentos ni mayúsculas; se guarda lo que escribió cada uno, porque quitarle los acentos a un nombre catalán o gallego para enseñarlo sería escribirlo mal. **Toda comparación de ciudad va por esa función**, nunca por `LOWER(city)` a secas.
- **El servidor NO tenía ningún límite de peticiones, y el código decía que sí** (hasta el 3-oct-2026): los topes estaban escritos —500/min general, 10 en el login, 3 en "he olvidado mi contraseña", 20 carreras/hora— y **no se aplicaba ninguno**. Se podían probar contraseñas sin parar. La causa: `app.register(...)` **sin `await`**. Fastify no carga el plugin ahí, lo apunta para el arranque; las rutas se declaran justo debajo, o sea ANTES, y el limitador se engancha ruta por ruta al cargarse → no cogió ninguna. No daba error, no se veía en los registros, y el código parecía correcto. **Lección: un límite declarado no es un límite. Hay que medirlo.** Se midió a pelo contra producción —540 peticiones a un endpoint con tope de 500, las 540 contestadas— y se reprodujo en local con las mismas versiones. Arreglado poniendo `await` a los tres plugins. **Si se añade otro plugin de Fastify, va con `await` y se comprueba que hace algo.** Debajo había un segundo fallo: `errorResponseBuilder` no devolvía `statusCode`, así que al pasarse del tope contestaba 500 en vez de 429. Comprobado en producción el 3-oct: corta en el intento 21 de 20, con 429, y el contador baja uno por petición **de cada IP por separado** (o sea, el tope no se comparte entre toda la gente: `trustProxy: true` está haciendo su trabajo).
- **La app anunciaba las fechas viejas de Halloween** (3-oct-2026, 1.11.11 build 22 / vc76, retiradas): la pantalla de Retos decía *"DEL 29 AL 31 DE OCTUBRE"* y *"HASTA EL 31 DE OCTUBRE"*, de cuando el evento iba a ser el fin de semana de Halloween. El evento es **del 23 de octubre al 1 de noviembre**, y el cartel que se escribe desde el panel sí lo decía bien: la app iba a contradecir al cartel durante los diez días del evento. Esas fechas van ESCRITAS DENTRO de la app, así que no había forma de corregirlas sin otra versión en las tiendas. Salió recorriendo la app contra datos de mentira (§3), no leyendo el código. **Al mover una fecha del juego, buscarla también dentro de la app** — `RetosScreen.tsx` — y no solo en el panel. Lo mismo con los 200 puntos por calabaza: están escritos en esa pantalla y en el panel al sembrarlas; si se cambia en uno hay que cambiarlo en el otro.
- **La app se cerraba sola al abrirla, en iPhone y en Android** (3-oct-2026, 1.11.11 build 21 / vc75, retiradas): un `useEffect` nuevo —el de las notas sin ver— quedó escrito DEBAJO de los `return` de `App.tsx` (versión caducada, pantalla de carga, pantalla de bienvenida). React cuenta los hooks que ejecuta en cada pintada y exige que siempre sean los mismos: mientras cargaba se ejecutaban 14 y, en cuanto restauraba la sesión guardada, 15 → `Error: Rendered more hooks than during the previous render` y la app abajo, en las dos plataformas. Lo peor es cómo se esconde: **recién instalada funcionaba** —nunca pasaba del `return` de bienvenida—, así que en el emulador parecía sana; solo se cae a quien ya tiene sesión, o sea a todo el mundo menos a quien la acaba de instalar. Ni TypeScript ni el compilador dicen nada. Arreglado subiendo el hook con los demás, y con `npm run test:hooks` (`scripts/hooks-check.mjs`, ya dentro de `npm run test:gps`), que busca hooks detrás de un `return`. **Regla: TODOS los hooks van arriba del todo, antes del primer `return` — sin excepciones.** Y antes de dar una build por buena, probar el arranque CON SESIÓN, no solo recién instalada (§3).
- **Un `catch {}` vacío convirtió un fallo en silencio durante meses** (botón de
  centrar el mapa, arreglado el 6-oct-2026): el botón hacía
  `getCurrentPositionAsync({ accuracy: High })` dentro de un `try` con el `catch`
  vacío. Tres caminos acababan igual —sin permiso, GPS frío bajo techo, o la
  lectura que no llega nunca— y en los tres **no pasaba nada y nadie lo decía**:
  ni error, ni aviso, ni señal de que estuviera trabajando. Desde fuera se veía
  como "a veces no funciona". Arreglado con cuatro cosas, y las cuatro hacen
  falta: pedir primero `getLastKnownPositionAsync` (instantáneo, el mapa se mueve
  ya), `Balanced` en vez de `High` (para centrar un mapa de 1,3 km sobran 100 m
  de precisión y llega mucho antes), un reloj de 10 s con `conTiempo` para que un
  `await` que no vuelve no deje la app esperando para siempre, y un aviso cuando
  de verdad no se puede. **Regla: un `catch {}` vacío en algo que el usuario ha
  PULSADO es un fallo**; si no se puede hacer, hay que decirlo, y mientras se
  intenta hay que verse.
- **react-native-maps le hace la foto al marcador CON EL TAMAÑO DEL DIBUJO**
  (Android, 8-oct-2026): el número del montón de calabazas colgaba de la esquina
  con `right: -7` y en el Xiaomi de Iban salía cortado. Parece el recorte normal
  de Android —que no deja pintar fuera de la vista madre— pero no lo es, y por
  eso las dos soluciones obvias EMPEORAN la cosa: dejando hueco con relleno, y
  también dando medidas explícitas a la caja, lo que salía cortado era **la
  propia calabaza**, por la derecha y por abajo. Las dos se probaron en el
  emulador y se vieron. Lo que pasa es que la foto se toma del tamaño de la
  imagen, así que todo lo que sobresalga se pierde, mida lo que mida la caja.
  **Regla: lo que tenga que verse en un `<Marker>` va DENTRO del dibujo.**
  Y ojo: en el emulador el fallo ORIGINAL no se reproducía — hizo falta su
  captura para saber que existía.
- **La chapa de aviso de una pestaña se salía de la pantalla** (8-oct-2026, en
  iPhone y en Android): los iconos de la barra miden 88 y cada celda mide
  pantalla/5 (72 en un móvil de 360), así que el icono se sale por los lados. La
  chapa colgaba del ICONO, y en la última pestaña acababa fuera de la pantalla y
  salía cortada. Arreglado colgándola de la CELDA. **Si un adorno va pegado a
  algo más ancho que su hueco, cuélgalo del hueco.**
- **La app se moría "a los 60 minutos" corriendo con la pantalla apagada**
  (13-oct-2026): la tarea de fondo guardaba cada tanda de puntos GPS haciendo
  `getItem` + `JSON.parse` + `JSON.stringify` + `setItem` de **TODA la carrera**,
  cada tres segundos. Coste cuadrático: medido, **una hora escribe 69,7 MB en
  disco para guardar 125 KB de puntos**, y la última guardada cuesta seis veces
  más que la primera. Arreglado guardando CADA TANDA EN SU PROPIA CLAVE
  (`corrr:bg-loc-buffer:<hora>:<n>`) y juntándolas una sola vez al volver a la
  app, ordenadas por hora: 69,7 MB → 120 KB, 594 veces menos.
  **Lo encontró un corredor, no el emulador**: dijo "me parece que se cierra a
  los 60 minutos" y que le quedaba "la zona marcada pero sin cerrar el círculo".
  El camino del disco solo se usa cuando Android ha tirado la app de memoria
  pero mantiene el servicio, y eso no se sabe forzar en el emulador.
  **Antes de dar esto por bueno se descartaron MIDIENDO dos sospechas que
  parecían obvias y eran falsas**: fusionar el territorio (11-34 ms, y NO crece
  con la carrera) y buscar el círculo cerrado (también barato). **Regla: en un
  bucle que corre cada pocos segundos, nunca leer-modificar-escribir una
  estructura que crece.**
- **La notificación "Carrera en curso" se quedaba para siempre** (14-oct-2026,
  foto de un corredor): si Android tumba la app a mitad de carrera, `stopRun`
  nunca se ejecuta y el servicio de ubicación de expo **sigue vivo**. El
  corredor se queda con "CORRR — Carrera en curso · Registrando tu recorrido" en
  la barra, con la app cerrada, gastando batería y sin forma de pararlo salvo
  desinstalando. No había NADA que limpiara al arrancar. Arreglado con un
  `useEffect` de montaje que, si encuentra la tarea registrada, la para: si el
  componente se está montando es que el JavaScript arrancó de cero, así que lo
  que haya registrado es de una carrera muerta. El buffer NO se toca ahí —esos
  puntos son lo único que queda de lo corrido (§14). Comprobado en el emulador:
  carrera → servicio y aviso vivos → `am force-stop` → al reabrir, el servicio
  muere y la barra queda limpia. **La marca de la tarea sobrevive al reinicio de
  la app; el servicio, no siempre. Por eso hay que mirarlo SIEMPRE al arrancar.**
- **Cambiar el formato del buffer y no cambiar el borrado** (13-oct-2026,
  metido y corregido sin llegar a publicarse): al pasar a una clave por tanda,
  los tres `AsyncStorage.removeItem(BG_BUFFER_KEY)` se quedaron buscando la
  clave VIEJA, así que al parar una carrera las tandas nuevas seguían en disco y
  se habrían colado en la SIGUIENTE. Medido: la distancia no se inflaría (el
  tope de 30 km/h descarta el salto entre carreras) pero sí se volvería a
  reclamar el territorio de la anterior, con avisos de robo a gente a la que no
  se le quitó nada ese día. Arreglado con `borrarBufferDeFondo()`, que limpia
  por prefijo, y con una segunda red: al recoger el buffer se descarta todo
  punto ANTERIOR al arranque de la carrera en curso. **Al cambiar cómo se
  GUARDA algo, buscar todos los sitios donde se BORRA.**
- **La carrera desaparecía al guardar el móvil en un Xiaomi** (23-oct-2026,
  arreglado en la 1.11.12 de Android): «cada vez que guardaba el móvil y lo
  volvía a sacar, el marcador salía a cero». Android (los fabricantes con
  ahorro agresivo) DESTRUYE la Activity con el proceso vivo; React Native 0.81
  (bridgeless) desmonta el árbol con el JavaScript VIVO y lo vuelve a montar al
  volver. Toda la carrera vivía en refs de MapScreen → mapa con «INICIAR
  CARRERA» y 0,0 km. Y el efecto de montaje de la 1.11.11 que paraba la tarea
  «huérfana» suponía que montar = JavaScript arrancado de cero: **mataba
  carreras vivas** y expo tiraba los puntos del bolsillo («Task or consumer not
  found»). Arreglado con la **carrera viva** a nivel de módulo (tracker,
  tiempos, pausas, trazo): al remontar se retoma y se reengancha; solo se para
  la tarea si NO hay carrera viva. **Se reproduce en el emulador activando
  «No mantener actividades» DESDE Ajustes → Opciones de desarrollador** (por
  adb `always_finish_activities` no tiene efecto) y saliendo con HOME; con la
  pantalla apagada sola no basta. Con la Activity viva nunca pasó: por eso no
  se vio antes. Datos que lo confirmaron: sus carreras guardadas estaban
  enteras y entre ellas había 78 minutos con la app abierta y nada guardado.
  **Lección: «el componente se monta» no significa «la app ha arrancado».**
- **El arranque de carrera esperaba a un GPS que no caduca** (arreglado en la
  1.11.12): `await getCurrentPositionAsync({Balanced})` ANTES de encender la
  tarea de fondo y el vigilante. En Android esa petición no tiene duración
  (Play Services: `durationMillis = Long.MAX_VALUE`) y, con el GPS frío, la
  carrera corría sin servicio ni notificación y a 0,00 km. Es el mismo fallo
  que el botón de centrar del 6-oct, y se quedó sin arreglar aquí.
  **Todo `await` de ubicación lleva `conTiempo` o va detrás de lo importante.**
- **El servidor tiraba las vueltas grandes enteras** (22-oct-2026, arreglado
  el 23 en el servidor, sin build): `POST /runs` rechazaba con 400 toda
  carrera de más de 50.000 celdas, y la app manda el recorrido MÁS el interior
  relleno de la vuelta. Una vuelta de unos 6 km² (~61.000 celdas) se perdía
  ENTERA, km incluidos, mientras la app decía «se mandará sola» y fallaba
  siempre. Ahora el tope es `MAX_CELDAS_POR_PETICION` = 100.000 (10 km², el
  mismo que el cerco), con `cajaDe` en vez de `Math.min(...xs)` (el spread
  revienta la pila hacia 110.000 en Node 20), un SAVEPOINT alrededor del cerco
  (un fallo ahí dejaba la transacción abortada y se perdía la carrera) y las
  celdas con coordenadas raras fuera en vez de un 500. La carrera perdida
  (21raulnicolas, 15,8 km) se metió a mano con un script a medida en `soporte/`
  (fuera de git).
  **Y por encima de 100.000 ya no hay 400** (10-nov-2026, servidor, sin build;
  decisión de Iban del 27-oct, «opción A»): `celdasParaGuardar`
  (services/territorio.ts) apunta solo el BORDE (`soloElBorde`) y lo de
  dentro lo decide la regla de los cercos al guardar: si cabe en su tope de
  10 km² lo da (`ocuparCercadas`), y si no, aviso «Cerco demasiado grande»
  (`avisarCercoEnorme`, que también sale cuando la carrera pasa de 10 km de lado
  y el cerco ni se mira). La carrera se guarda siempre, con sus km y su racha;
  los puntos son los del recorrido, no el tope de 20.000 que daría el
  interior, y a los demás no se les quita nada de dentro. Solo se rechaza si ni
  el borde cabe (eso no es un recorrido, es una petición fabricada). Medido el
  27-oct con el `RunTracker` de verdad y los recorridos oficiales
  (`soporte/vueltas-grandes-27oct/`, fuera de git): el **Maratón de Valencia
  manda ~55.000 celdas** y ya se guardaba (luego el cerco le da ~59.000 más);
  lo que se perdía eran las **vueltas compactas de 12,8 a 20 km que vuelven a
  la salida** (3,2×3,2 km → 102.450 celdas; 5×4,9 km → 244.482). Por encima de
  ~5×5 km la app ya no rellena y no pasa nada. Probado de punta a punta con el
  servidor de verdad y Postgres en memoria (`soporte/vueltas-grandes-27oct/e2e/`,
  `node probar.mjs 4 3`): antes 400, ahora 201 con los 14 km, 1.395 celdas de
  borde y el aviso; con `3.16 3.16 12` (101.365 celdas) lo de dentro vuelve
  entero por el cerco. Ojo: el borde es lo que da al EXTERIOR, así que la cara
  interior del recorrido y lo pisado por dentro de la vuelta caen con el
  relleno. Desplegado el 10-nov (`/health` → `1e8d52d`).
- **La copia de una vuelta grande no se podía volver a leer en Android**
  (10-nov-2026, arreglado en la app, 1.11.15 vc93 / build 39): la carrera se
  guarda en el móvil ANTES de mandarla (`@corrr_carrera_pendiente`) y se
  reenvía sola al abrir la app si el envío falló. Pero AsyncStorage guarda en
  SQLite y en Android una fila de más de ~2 MiB se ESCRIBE y no se puede LEER
  (no cabe en la ventana del cursor): una vuelta rellena de 3×3 km son 89.881
  casillas, 1,97 MiB; la de 5×4,9 km, 5,36 MiB (y la base entera tiene un tope
  de 6 MB). Si no se mandaba a la primera (meta con la red saturada), se perdía
  aunque estuviera en el disco. Ahora `src/tracking/copiaCarrera.ts` guarda las
  casillas en TIRAS (fila, primera x, cuántas) cuando la copia pasa de 500.000
  caracteres: la de 3×3 km queda en **5,7 KB** y la de 5×4,9 km en **9,3 KB**,
  y vuelven todas. Por debajo del umbral la copia es idéntica a la de antes, y
  las copias viejas se leen igual. Al servidor se le manda siempre la carrera
  de siempre. Probado con el `RunTracker` de verdad en `scripts/copia-check.ts`
  (dentro de `npm run test:gps`). **Al guardar algo grande en AsyncStorage,
  medirlo: en Android lo que pasa de 2 MiB no vuelve.**
- **La carrera se colgaba al mirar el móvil tras mucho rato con la pantalla
  apagada** (10-nov-2026, un corredor por audio; arreglado en la 1.11.15 vc93 /
  build 39): «si miro el móvil cada 10 minutos no pasa nada; si paso más de 15
  sin mirarlo, al abrirlo tarda en ponerse al día, un segundo por cada minuto,
  y cuando pasa de 15 segundos se cuelga y se para». La causa, leída en el
  código de React Native (`FabricUIManager.onHostPause` →
  `mDispatchUIFrameCallback.pause()`): **en Android, con la app en segundo
  plano los cambios de pantalla NO se aplican, se ENCOLAN, y al volver se
  aplican todos de golpe** en el hilo principal. Y la app pintaba con cada
  tanda de puntos que entraba con la pantalla apagada (`handleReading` hacía
  `setCurrentPath`, `setClaimedCellsTick`, `setDistance`…): el trazo ENTERO y
  los polígonos del territorio, que siguen montados debajo de la pantalla de
  carrera. Medido en el emulador: en 10 minutos apagada la tarea de fondo
  entregó 74 tandas, o sea 74 repintados encolados (con territorio grande, más
  caros). Si el hilo principal pasa de 5 s sin responder, Android saca «CORRR
  no responde» y cerrar la app se lleva la carrera (no hay rescate, §14).
  **Arreglo** (`MapScreen.tsx`): sin pantalla (`appALaVista()`,
  `AppState.currentState !== 'background'`) el punto entra en el registro (km,
  celdas, trazo, pausas, logos) y NO se pinta ni se mueve la cámara; al volver
  (`handleAppState`, 'active') `pintarCarrera()` lo pinta todo UNA vez. Con la
  pantalla encendida no cambia nada. En iPhone no había cola (ahí se pinta al
  momento), pero se ahorra pintar a ciegas. **Regla: con la app en segundo
  plano no se toca el estado de React en cada punto; se guarda en referencias
  y se pinta al volver.**
  **Qué se probó y qué no** (emulador, `-PcorrrDebuggable=1` contra el servidor
  de mentira en `MODO=vacio`, GPS a 12 km/h con `adb emu geo fix`): SIN el
  arreglo, 10 min apagada → 2,25 km bien contados y la pantalla al día a los
  ~10 s de encender (con territorio vacío y una recta; con territorio de
  verdad cada repintado pesa mucho más). CON el arreglo, lo corrido con la
  pantalla apagada se cuenta igual (1,09 km en los 4,3 min que el emulador
  entregó puntos) y al volver sale de golpe, con su auto-pausa. **La prueba de
  10 min con el arreglo NO se pudo completar**: el Mac estaba renderizando en
  After Effects y el emulador se ahogó (disco y CPU del Android simulado
  saturados; ANR de `TaskJobService` y de los servicios de Google, no de la
  app). **Lo confirmó la prueba en la calle** (Iban, 10-nov, Android, vc93): 30
  minutos de carrera, 20 con la pantalla apagada sin mirar el móvil, y al
  encender todo al día y sin un error. Ojo al probar en el emulador: recién arrancado y con el Mac
  cargado da ANR él solo; mirar `adb shell cat /proc/pressure/io` antes de
  creerse un cuelgue.
- **El GPS seguía encendido con la app cerrada** (10-nov-2026, un usuario:
  «aun estando cerrada sigue haciendo llamadas al GPS»; arreglado en la 1.11.15
  vc93 / build 39). Si la app muere a mitad de carrera sin PARAR, la tarea de
  fondo se queda registrada: en Android sobrevive a la muerte del proceso y
  vuelve tras reiniciar o actualizar (receptor de expo-task-manager), y en
  iPhone, además de GPS, se apunta al «cambio de ubicación significativo» y
  iOS vuelve a abrir la app por detrás. Solo la paraba el MAPA al montarse, y
  el mapa no se monta sin sesión: con el iPhone bloqueado SecureStore no deja
  leer el token y la app arranca sin sesión, así que el huérfano no se limpiaba
  nunca. Ahora `pararSeguimientoHuerfano()` (MapScreen.tsx) se llama también
  desde App.tsx al arrancar, antes de leer la sesión; misma regla de siempre
  (solo sin carrera viva) y sin tocar los puntos del disco (§14). **Queda sin
  arreglar**: en Android, el huérfano que vuelve tras reiniciar el móvil sigue
  hasta que se abre la app (pararlo desde la propia tarea toca la pieza
  delicada); en iPhone se pide el permiso «Siempre» en cada carrera y no hace
  falta (con «Mientras se usa» la tarea funciona, y sin «Siempre» iOS no
  relanza la app); y `getCurrentPositionAsync` al abrir el mapa no tiene tope
  en Android (si no hay señal, el GPS sigue buscando un rato aunque salgas).
  Revisión entera del 10-nov: tarea de fondo, mapa, HealthKit y detector de
  carrera; lo demás no pide ubicación con la app cerrada.
- **El mapa se comía la cuota gratis de Supabase** (24-oct-2026, arreglado en
  el servidor sin build): el plan gratis da 5 GB/mes de datos de SALIDA
  (egress) y CORRR gastaba ~1,1 GB AL DÍA; el ciclo anterior se pasó ~6 veces
  y Supabase llegó a restringir la organización. El 80-90 % era GET
  /cells/viewport?formato=tiras: traía el territorio CELDA A CELDA (~93 B por
  fila, 20.000-57.000 filas por vistazo, con nombre y grito repetidos) para
  agruparlo en Node. Ahora Postgres manda mapas de bits por dueño, fila y trozo
  de 32 columnas y Node rehace las mismas tiras (`SQL_TIRAS` y
  `tirasDesdeDuenos` en services/tiras.ts): 185-276 veces menos, comprobado
  igual en 10 cajas reales y en la tabla entera (`soporte/egress-supabase/`,
  fuera de git). El segundo era ownerAvatars, que traía la foto ENTERA en
  base64 (hasta 2,4 MB) en cada vistazo: ahora la miniatura, con caché en
  memoria que se borra al cambiar o borrar la foto. **Mirar el egress en el
  panel de Supabase (Organization → Usage) antes de añadir cualquier consulta
  que devuelva muchas filas, y nada de emulador contra producción mientras
  sigamos en el plan gratis.** El formato viejo del viewport también va
  agrupado (~6 veces menos); no bajar `MIN_APP_VERSION` a 1.0.0 sin mirarlo.
- **Subir la versión mínima con gente corriendo** (22-oct, probable): la
  pantalla de «actualiza» desmonta el mapa y la carrera en marcha se pierde
  (con la 1.11.10, sin copia). `MIN_APP_VERSION` se cambia **de madrugada** o
  no se cambia.
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
- **NO SE NOMBRA A STRAVA en nada que vea el usuario** (Iban, 13-oct-2026).
  En Perfil había una tarjeta solo de Android —"¿Corres con Strava? Llévalas a
  la vez… Estamos en que CORRR se entere solo"— que prometía una integración
  que no existe; borrada. Y "Tus otras carreras" (iPhone) la nombraba como
  gancho; ahora dice lo que de verdad hace: **leer SALUD**, le dé igual qué app
  haya escrito ahí. Lo único que queda con la palabra en el código es el botón
  de conectar, oculto desde septiembre tras `STRAVA_ENABLED = false`. Ojo: en
  iPhone, quien tenga "Enviar a Salud" activado en Strava SÍ sigue trayendo sus
  carreras — lo que ya no se hace es anunciarlo.
- **La app de Strava está INACTIVA** (comprobado el 23-sep-2026 con el botón "Comprobar Strava" del panel): `403 {"resource":"Application","field":"Status","code":"Inactive"}`. Strava exige suscripción de pago al dueño de la app y limita las nuevas a 10 atletas. `STRAVA_ENABLED = false` se queda así: reactivarlo sin resolver esto deja a la gente con un botón que no lleva a ninguna parte. **La vía gratis para las carreras de Strava es el iPhone: Strava escribe la ruta en Salud y CORRR ya la importa** (ver "Tus otras carreras" en Perfil). En Android, Strava solo manda a Health Connect tiempo/distancia/calorías, sin ruta: no hay camino gratis hoy.
- **⚠️ `apps/mobile/ios/` NO está en git** (sí `android/`): el `Podfile` con el arreglo de Xcode 27, el permiso de HealthKit en `CORRR.entitlements` y el `Info.plist` solo existen en este Mac. Si se pierde, hay que rehacerlos. Pendiente decidir si se versiona.
- **El mapa tardaba en salir, y cada vez más** (6-nov-2026, servidor desplegado la misma
  tarde): la app bloqueaba el mapa («ACTUALIZANDO MAPA») hasta que contestaba
  `/zones/nearby` —zonas antiguas que ya no se pintan desde la 1.11.x, 156 KB y tres
  peticiones por arranque— y pedía el territorio tres veces (Madrid, última posición, GPS).
  Y el servidor, sin caché, leía en Postgres TODAS las celdas del encuadre (122.000-138.000
  en Barcelona, 150-240 ms, con la ordenación yéndose a disco por `work_mem` de 2 MB) para
  comprimirlas en tiras; con `cells` ×10 desde el 21-sep (1.000.935 celdas) eso iba a ser
  segundos. Las campañas NO pesan (0,6 ms). Medido con `apps/backend/scripts/medir-mapa/`
  (solo lectura, `LEEME.md`): **antes** sin caché 300-2.200 ms en Barcelona, con caché
  40-60, tras 50 s en silencio 300-1.400 (el pool cerraba las conexiones a los 30 s);
  **después** 60-180, 50-70 y 165-240. Qué se hizo: (1) tabla **`tiras_casilla`**
  (`services/tiras.ts`): las tiras ya hechas por casilla de 128 celdas y dueño, coordenadas
  relativas 0-127; `/cells/viewport?formato=tiras` lee decenas de filas (29-32 en Barcelona,
  ~2 ms) y las pega (`tirasDesdeCasillas`), dando EXACTAMENTE las mismas tiras que
  `SQL_TIRAS` (`npm run test:tiras`, PGlite; y `comprueba-tiras.mjs` contra producción).
  Se rehacen DENTRO de la transacción de `POST /runs`, de la importación y de los cercos del
  panel (`recalcularCasillas`: bloqueo consultivo por casilla en orden x,y para que dos
  recálculos no se pisen, y SAVEPOINT: un fallo nunca cuesta una carrera), y cada 5 min
  `comprobarTirasCasilla` compara `cells` con la tabla casilla a casilla (`SQL_TIRAS_DESCUADRE`,
  0,8-3,4 s, devuelve 0 filas si todo cuadra) y rehace lo que no: es la red para lo que
  escribe en `cells` por fuera (`importar-carrera.mjs`, `sembrar-ejercito.mjs`). Mientras
  la tabla no está comprobada o una casilla está en duda, ese encuadre se calcula al vuelo
  como antes. (2) Caché del mapa de 30 s a **5 min**, invalidada por casilla también DESPUÉS
  del COMMIT. (3) Pool con `idleTimeoutMillis` de 10 min, `keepAlive` y un `SELECT 1` por
  minuto. (4) `SET LOCAL work_mem = '32MB'` para `SQL_TIRAS` y el formato viejo
  (`consultaConMemoria`). El formato viejo (apps < 1.11.10) sigue igual, solo con más caché
  y memoria. En la app (siguiente versión): fuera `loadZones`, `checkForStolenZones`
  (superado por los avisos de robo del servidor) y el cruce con zonas rivales de `closeLoop`;
  `src/map/territoryCache.ts` guarda cada respuesta por casilla del servidor (misma regla
  de redondeo, por usuario, 8 cajas) y la última vista, y al abrir se pinta lo guardado y
  se quita la pantalla de carga; sin Madrid si hay vista guardada; y `loadCellsSiNueva` no
  repite la misma casilla en 15 s. **Regla: nada que el usuario vea depende de una petición
  que no se pinta; y el territorio se precalcula al escribir, no al leer.**

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

**Al alejar el mapa se agrupan** (`agruparObjetos` en `MapScreen.tsx`, 7-oct):
veinte calabazas del mismo barrio caían en un puñado de píxeles y salían
amontonadas, sin poder verse ninguna ni saber cuántas había. Se parte el mapa en
casillas del ancho de una chincheta —**medido en PÍXELES, no en metros**, porque
lo que se tapa se tapa en pantalla— y lo que cae en la misma casilla sale como un
montón con el número. Al acercarte la casilla se encoge y los montones se
deshacen solos. Dos detalles que hacen falta: el montón se arrastra hacia el
CENTRO de su casilla (`ARRASTRE_AL_CENTRO`, 0,7) porque si no dos montones
vecinos pueden caer pegados al borde que comparten y volver a taparse; y el
`tracksViewChanges` va por los GRUPOS y no por los objetos, porque al cambiar el
zoom nacen chinchetas nuevas y en Android se quedarían en blanco (§9).

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

**Medido antes de sembrar** (16-oct-2026, todo leyendo producción):

| | |
|---|---|
| Zonas sobre las que siembra el botón morado | **26** (una por corredor con territorio) |
| Tamaño de esas zonas | de 1,7 a 81,7 km² — son ciudades, no cajas locas |
| Lo que tarda el botón morado | **5,4 s solo de consultas**, 10-30 s en total |
| `/objetos/viewport` con 10.000 objetos | **1,9 ms** — hay `LIMIT 500` y la tabla es minúscula |
| Chinchetas que puede pintar la app a la vez | **133** en un móvil de 360 dp, 285 en un iPad |

Ese techo de chinchetas es GEOMÉTRICO y no depende de cuántas haya en España:
más allá de `MAX_DELTA_FOR_CELLS` no se ve ninguna, y justo por debajo la
pantalla solo da para ~133 casillas de agrupación de 300 m. Sembrar 100 por
zona son del orden de 1.500 calabazas y 3.750 fantasmas en todo el país, y la
app nunca recibe más de 500 de golpe ni pinta más de 133.

**EL AGUJERO GORDO: la siembra se colgaba del TERRITORIO, y media comunidad
no tiene** (16-oct). El botón del panel siembra alrededor de cada corredor con
celdas. Medido: de **54 personas, 33 no habían corrido nunca**, repartidas por
**25 ciudades donde nadie ha corrido** —Bilbao, Sevilla, Málaga, Zaragoza,
Burgos, Jaén, Cádiz, Albacete, Plasencia, Terrassa…— con **27 personas dentro,
la mitad**. A todas ellas el evento **no les habría existido**, y a quien se
diera de alta durante los diez días tampoco: el mapa se siembra el día 22 y no
alcanza a quien llega después. Iban lo vio antes que nadie ("si esta semana se
da de alta gente, ¿no tendrán calabazas?").

Arreglado con **siembra automática en `/objetos/viewport`** (`sembrarDondeMira`):
si durante el evento alguien mira su zona y ahí no hay NADA, se siembra en ese
momento y le salen en esa misma respuesta. No tiene que correr antes ni esperar
a nadie. **Es cambio de servidor: no necesita versión nueva en las tiendas.**
Cinco frenos, porque escribe desde una consulta que se llama al mover el mapa:
evento vivo (hereda su fecha de fin y sus puntos, §9-bis) · solo a quien le toca
Halloween · encuadre pequeño (su barrio, no España) · nada libre en 5 km a la
redonda · una vez cada 6 h por persona y techo de 20.000 objetos. La marca de
"ya se le sembró" (`users.objetos_sembrados_at`) se pone AUNQUE no se haya
podido sembrar, que si no se reintenta lo caro en cada movimiento del mapa.

**EL MAPA DE CALLES, TERMINADO** (17-oct). Se bajó de OpenStreetMap y se subió
con permiso de Iban. Cubre **todos los municipios de España de 2.000 habitantes
para arriba** más las ciudades de la gente registrada: 811 zonas, 1.928 trozos
de 3×3 km, unas 20 horas de descarga.

| | Antes | Ahora |
|---|---|---|
| Celdas de calle | 159.900 | **860.227** |
| Superficie | 1.599 km² | **8.602 km²** |
| Tabla `calles` | 10 MB | **55 MB** |
| Base de datos | 181 MB | **225 MB** de 500 |

Comprobado ciudad por ciudad después de subirlo, incluidas tres **donde no vive
nadie registrado** (Salamanca, Lugo, Teruel) para confirmar que quien se
instale la app ahí durante el evento también tendrá calabazas. Burgos pasó de
**0 a 793** trozos de calle, y las calabazas ya se ven ahí.

Tres cosas aprendidas bajando esto, por si hay que repetirlo:
- **Las cajas se ajustan a los trozos de descarga, un pelo por debajo.** Una
  caja de 3 km sale como 3,0000000000005 al convertir grados a km, y el `ceil`
  la parte en DOS trozos. Poniendo 2,99 se arregla: 2.836 trozos → 1.928.
- **Overpass: un solo servidor.** Se probó turnar tres y fue peor — los otros
  dos contestan 500 a nuestra consulta (la del regex con once tipos de vía),
  siempre y al instante. Si se añade otro, **probarlo con la consulta real**.
- **Las zonas van de ciudad más grande a más pequeña**, así que si la descarga
  se corta, lo que falta es lo que menos gente cubre.

**NADA DE REPASO NOCTURNO** (decidido por Iban el 16-oct). Se planteó un
trabajo a las 00:00 que volviera a sembrar cada noche para que la gente nueva
recibiera calabazas. **No se hace, y no se vuelve a proponer**: la siembra al
mirar el mapa ya lo resuelve y encima al instante —quien se instala la app un
viernes a las 10 de la mañana no tiene que esperar a medianoche— y un trabajo
nocturno no arregla el agujero de verdad, que es no tener calles donde ponerlas.
Además `node-cron` está en el `package.json` pero **no se usa en ningún sitio**:
sería maquinaria nueva a seis días del evento.

**Y hace falta que haya DÓNDE ponerlas**: sin calles descargadas ni celdas
corridas, no cabe ninguna. De las 37 ciudades de la gente registrada, **23 no
estaban en el mapa de calles**. Se geocodificaron con Nominatim (gratis, de
OpenStreetMap; **España primero y luego Francia** — buscando en las dos a la
vez, "Arona" salía en Allier en vez de en Tenerife) y se añadieron a
`datos/zonas.json`. `npm run calles` solo baja los trozos que faltan, y
`npm run calles:subir` solo AÑADE (`ON CONFLICT DO NOTHING`).

**Dos cosas más que salieron de medir:**

1. **El respaldo del mapa de calles iba por TABLA y no por CAJA.** Solo se
   miraba si `calles` estaba vacía del todo; si lo que estaba vacío era la
   ciudad de alguien, la consulta devolvía cero candidatas y se sembraban CERO
   calabazas **en silencio**. Pasaba en 2 de las 26 zonas: **Alcázar de San
   Juan** (21raulnicolas, 28.042 celdas corridas) y **Girona** (Clara) — el
   mapa de calles se bajó antes de que ellos se dieran de alta. Ahora, si en
   esa caja no hay calles, se siembra sobre lo que ya ha pisado esa persona.
   Comprobado: Barcelona sigue usando calles, esas dos pasan a pisadas.
   **Lo suyo es bajar las calles de esas dos ciudades** (`npm run calles`),
   que permite sembrar por cualquier calle y no solo por donde ya corrió.
2. **El botón morado no se bloqueaba al pulsarlo.** Tarda entre 10 y 30
   segundos y el panel parece colgado; el segundo clic **siembra otra vez**,
   porque las calabazas se suman, no se reemplazan. Ahora los botones se apagan
   y el cartel va contando los segundos.

**El contador es POR EVENTO** (15-oct). Las filas de `objetos` no se borran
nunca, así que al empezar Halloween el ranking arrancaba con las 8 calabazas de
las pruebas de octubre y con sus mensajes ya desbloqueados. Un evento se
reconoce por su **fecha de fin**: todo lo sembrado de una vez la comparte y la
que nace al comerse una la hereda (`objetoHasta`), así que "este evento" es la
fecha de fin más alta que haya (`DE_ESTE_EVENTO`, en `routes/index.ts`). En
cuanto se siembre con fin el 1 de noviembre, lo anterior deja de contar solo:
no hay nada que reiniciar a mano, ni este año ni el que viene. Afecta a
`/objetos/ranking` (el ranking y "las mías", que son las que desbloquean los
mensajes) y a `/admin/objetos`; el panel enseña aparte cuántas hay guardadas de
antes, para que se vea que no se ha borrado nada. **Los PUNTOS que dieron
aquellas pruebas siguen en el marcador de cada uno** (Ibanto −2.600 netos entre
calabazas, fantasmas y zombis; fausrunner +200): quitarlos sería escribir en la
base de datos y eso lo decide Iban.

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

## 9-quinquies. Campañas de marca sin sacar versión (preparado el 1-nov-2026, sale con la 1.11.13)

Iban: «cada vez que saquemos una campaña no necesitemos versión nueva». Halloween llevaba
la calabaza, el fantasma, el cartel al pisarla y la pantalla de Retos ESCRITOS en la app.
Ahora, para un objeto que la app no lleva dentro (el logo de una tienda), todo sale del
servidor:

- **Panel → Juego → «Campaña de marca»**: identificador (`objetos.tipo`), nombre, dibujo
  (https a un PNG cuadrado y transparente, como la imagen de los avisos), cartel al pisarlo
  (`{puntos}`), y Retos: fechas, título, texto y premio. Interruptor de tres estados
  (apagado / prueba para uno / todos). Se guarda en `ajustes_juego` (`campana` en JSON y
  `campana_modo`). El logo se SUBE como archivo (`POST /admin/campana/logo`): sharp lo
  encaja en 256×256 con fondo transparente, se guarda en `campana_logos` y se sirve en
  `/campana/logo/<tipo>.png?v=<hash>` con caché de un año. Cada campaña lleva **ciudad**
  (hasta el 12-nov-2026 solo la veía en Retos quien tuviera esa ciudad; ahora la ve todo el mundo, ver más abajo) y se planta en **toda
  la ciudad** (Iban, 1-nov): al guardar se piden a Nominatim los límites del municipio
  (`limites`, y `lugar` para confirmar en el panel); ahí se siembran los logos y ahí
  RENACEN. Municipios como Murcia incluyen pedanías, pero el mapa de calles pesa por
  longitud de calle y casi todo cae en el casco. Una campaña a la vez.
  **Los logos se cogen pasando a 2 cuadrados (20 m)**, no solo pisando el suyo
  (`RADIO_LOGO` en services/objetos.ts): con las calabazas había que cruzar por mitad
  de la calzada y la gente corre por la acera. Halloween sigue siendo pisar.
- **Servidor**: `GET /app/evento` (la campaña si le toca), `/objetos/viewport` añade
  `tipos` con dibujo y cartel, y el desglose de `POST /runs` lleva `campana`
  {nombre, cuantos, puntos}. La siembra, el ranking por tipo y el renacer al cogerlo ya
  servían para cualquier tipo.
- **App**: `prepararTipos` (MapScreen) BAJA el dibujo antes de pintar los objetos y solo
  lo usa si ha llegado entero (en Android el marcador se fotografía al nacer, §9); si no,
  calabaza. Los objetos se ven con Halloween **o** con campaña. Retos enseña la campaña
  si la hay, y si no, **«Próximamente»** con el ANUNCIO que mande el servidor:
  `PROXIMAMENTE` en `routes/index.ts` (título, cinta naranja y una línea), que viaja en
  `GET /app/evento`. Desde el 2-nov: «GRAN RETO DE NAVIDAD · ¡CON PREMIO!» (Iban). Para
  cambiarlo, esa constante y un push; `null` deja la imagen de siempre
  (`assets/proximamente.png`). El cartel de Halloween se QUITÓ de Retos el 2-nov (Iban:
  «quitar de la app en retos lo de las calabazas»): ya no hay ninguna fecha ni texto de
  evento escrito en la app. Las 1.11.11/1.11.12 instaladas lo siguen enseñando hasta que
  actualicen. `MODO=campana npm run mock` la recorre; `MODO=vacio`, sin anuncio.
- **Varios retos con «Me apunto» (Iban, 2-nov; servidor subido, app desde la 1.11.14)**: la
  campaña única pasa a tabla `campanas` (`tipo`, `datos` JSONB, `modo`) y quien se apunta a
  `campana_apuntados`. Lo de ajustes_juego (`campana`, `campana_modo`) se migra una vez al
  arrancar y se borra. Panel: pestaña **Campañas**, un desplegable por reto con **Quitar
  logos** y **Eliminar campaña** (borra el reto, sus apuntados, su logo y los logos sin coger;
  los cogidos se quedan). App: `GET /app/retos` (lista de su ciudad; el que prueba la ve aunque
  sea de otra), `POST`/`DELETE /app/retos/:tipo/apuntarme`; Retos es lista → ficha con ME APUNTO
  / DESAPUNTARME y el mapa se refresca con `RETOS_CAMBIADOS_EVENT`. **Sin apuntarse, un logo
  ni se ve ni se coge** (`LOGO_ES_SUYO`, en `/objetos/viewport` y en `recoger`), y en la
  clasificación solo salen los apuntados. Si el reto se apaga, sus logos dejan de existir para
  todos. **Los cercos no dan logos**: solo pasar a 20 m. `/app/evento` devuelve `evento: null`:
  la vc89 / build 35 no tiene botón, así que no ve retos ni logos.
- **La hora de «Desde» y «Hasta» (arreglado el 5-nov-2026, commit `81c3f0c`)**: el campo de
  fecha del panel da la hora SIN zona (`2026-11-05T21:39`) y el servidor, en UTC, la leía como
  hora de Londres. La primera campaña de prueba de Iban (LA TIENDA) se sembró a las 21:39 y los
  logos no salían: estaban programados para las 22:39 de España. Es el mismo fallo que hizo
  empezar Halloween a las 2 de la madrugada. Ahora el panel pasa la hora a UTC en el navegador
  (`horaServidor`) al sembrar logos y calabazas. **Lo sembrado antes del arreglo conserva su
  hora corrida**: para corregirlo, «Quitar logos» y volver a sembrar.
- **Varias ciudades, varios probadores y logos sin Halloween (6-nov-2026)**, pedido por Iban:
  - **Los logos ya no dependen del interruptor de Halloween.** Hasta entonces `POST /runs` solo
    llamaba a `recoger` si a ese corredor le tocaba Halloween: con el interruptor apagado los
    logos se veían en el mapa y NO se cogían. Ahora `recoger` lleva un `conHalloween`: las
    calabazas, fantasmas y zombis siguen yendo por el interruptor, y los logos por su reto
    (`LOGO_ES_SUYO`). Se puede apagar Halloween sin tocar las campañas.
  - **Ciudades**: el campo del panel admite varias separadas por comas («Barcelona, Badalona»,
    diez como mucho). Cada una se busca en Nominatim al guardar (las que ya estaban guardadas no
    se vuelven a pedir; entre peticiones nuevas, 1,1 s) y va a `datos.zonas[]` {ciudad, lugar,
    limites}; `ciudad`, `lugar` y `limites` se quedan con la primera por compatibilidad, y las
    campañas guardadas antes (sin `zonas`) siguen valiendo (`cajasDeCampana`). El reto lo ve en
    Retos quien sea de CUALQUIERA de ellas; «Sembrar» pone `cuantos` EN CADA ciudad y el panel
    dice cuántos han cabido en cada una (`vacias`: las que no tienen calles cargadas ni nadie
    ha corrido → `npm run calles`); un logo cogido **renace a los 5 minutos y a menos de 500 m
    de donde estaba** (`ESPERA_REAPARICION_LOGO_MS`, `RADIO_RENACER_LOGO`; recortado a su ciudad,
    y si ahí no cabe guardando los 300 m con los demás, en toda la ciudad), no a los 10 min en
    cualquier punto como las calabazas (Iban, 6-nov, tras probar la campaña). Se coge pasando a
    2 cuadrados (20 m, `RADIO_LOGO`) y lo da el SERVIDOR al guardar la carrera; la app avisa en
    vivo con el mismo radio desde la 1.11.15 (hasta la 1.11.14 solo al pisar el cuadrado exacto,
    por eso parecía que a 15 m no se cogía). OJO: la
    zona es el RECTÁNGULO que da OpenStreetMap, no el término municipal: el de Barcelona mete
    L'Hospitalet y Sant Adrià. **Antes de añadir una ciudad a una campaña, mirar que sus
    calles estén cargadas en TODO su rectángulo**, no solo en el centro: Sant Cugat del Vallès
    tenía el centro (zona de 6×6 km) y le faltaban Valldoreix, el norte y Collserola; se cargó
    el municipio entero el 6-nov-2026 (+1.243 celdas, 9.039 en total). `datos/` está en el
    `.gitignore`: `zonas.json` solo vive en el Mac de Iban.
  - **Prueba para varios**: el modo «En prueba» lleva un campo con nombres de la app o correos
    separados por comas (vacío = Ibanto; veinte como mucho). Se guarda como
    `prueba:Nombre1,Nombre2` y `ajusteLeToca` entiende la lista (también valdría para
    Halloween). Es para que el cliente pruebe la campaña antes de encenderla: la ve en Retos
    aunque sea de otra ciudad, se apunta y sale a correr.
  - **«Hasta» con la fecha de los logos ya puestos**: `/admin/campanas` devuelve el `hasta`
    de los logos libres y el panel lo propone al abrir la campaña, con una nota. Si se siembra
    más con OTRA fecha de fin, `DE_ESTE_EVENTO` deja de contar lo cogido antes y el ranking del
    reto empieza de cero.
  - `npm run test:campanas` (`scripts/campanas-check.mjs`): un Postgres en memoria (PGlite,
    solo devDependency; el Dockerfile instala `--omit=dev`) con las consultas tal cual están en
    el código. El panel se probó además en el navegador con un servidor simulado.
- **Un reto terminado se ve terminado, y los retos los ve todo el mundo (12-nov-2026, commit `ccf489d`, subido ese día)**. Iban: «Cuando un reto
  ha finalizado, debe aparecer como finalizado y que salgan los que han ganado en una lista. Ahora veo que ha finalizado, pero
  parece que sigue activo, el de prueba». La causa: el servidor **no sabía que un reto se acaba**; `/app/retos` mandaba el
  de prueba (logos caducados el 10-nov) igual que uno en marcha, con su ME APUNTO y su «QUIÉN VA GANANDO».
  - **Cuándo termina**: cuando caducan sus logos, o sea, la fecha de fin MÁS ALTA de sus `objetos` (el «Hasta» de la siembra;
    la misma idea que `DE_ESTE_EVENTO`). Sin logos sembrados no ha terminado. La campaña no guarda fecha propia: «Retos · fechas»
    es solo un texto. **Si se siembran más logos con otra fecha en un reto terminado, vuelve a estar en marcha y de cero.**
  - **Quién gana** (decidido por Iban el 12-nov: «lo elijo en cada reto»): los primeros de la clasificación; cuántos, casilla
    **«Cuántos ganan»** de la campaña (`datos.ganan`, 1 a 20; sin nada, 3; `cuantosGanan`). La clasificación es la de siempre
    (`clasificacionDe`: logos cogidos de ESTA tanda por los apuntados) y **a igualdad va delante quien llegó antes** a esa cifra,
    como dicen las bases del reto de Navidad. No hay forma de descalificar a nadie desde el panel (ver «pendiente» abajo).
  - **Terminado**: sigue saliendo en Retos, al final de la lista, hasta que se apague o se elimine en el panel; **nadie se
    apunta ni se borra** (`409`): en la clasificación solo salen los apuntados y un ganador que se borrara desaparecería. El
    panel lo marca «FINALIZADO el…» y, al abrirlo, dice quién ha ganado (los mismos que ve la gente).
  - **Todas las ciudades** (Iban, el mismo día: «todo el mundo puede ver los retos de todas las ciudades y se pueden apuntar a
    cualquier reto de cualquier ciudad»): `retosPara` ya no filtra por la ciudad del perfil. Las ciudades de la campaña solo
    dicen **dónde se plantan los logos**; `deAqui` ordena (los de su ciudad, primero). «En prueba» sigue siendo solo para los
    probadores. Lo de más arriba de «solo la ve quien tenga esa ciudad» ya no vale.
  - **Sin versión nueva**: las apps de hasta la 1.11.16 pintan lo que se les mande. A ellas (`retoParaAppDeAntes`) el
    «FINALIZADO», la ciudad (si no es la suya) y los ganadores les llegan DENTRO de `fechas` y `texto`
    («FINALIZADO · DEL 5 AL 7…», «GANADORES / 1.º Fulano · 42 logos»), y `/objetos/ranking` no les manda la tabla de un reto
    terminado (en ellas se titula «QUIÉN VA GANANDO»). Lo que NO se puede quitar desde el servidor: su botón ME APUNTO /
    DESAPUNTARME y la nota de debajo; si lo pulsan, «No ha salido. Prueba otra vez.».
  - **App desde la 1.11.17**: pide `/app/retos?v=2` y `/objetos/ranking?…&v=2` y
    recibe `finalizado`, `ganadores` y `deAqui` aparte. Ficha de un terminado: sello FINALIZADO, tabla GANADORES (con
    «¡Enhorabuena!» si estás), el premio, «CLASIFICACIÓN FINAL» y sin botón; en la lista, apagado y con su sello; cada reto
    dice su ciudad. La lista va en **dos pestañas, Activos y Finalizados** (Iban, 12-nov), con cuántos hay en cada una; sin
    ninguno en marcha, Activos enseña el anuncio de «Próximamente». No se tocó `MapScreen.tsx` (no pide prueba en la calle por
    esto). **Va en la 1.11.17 (vc95 / build 42).**
  - **Probado**: `npm run test:campanas` (24 casos nuevos, con las funciones del servidor tal cual sobre PGlite) y el emulador
    contra el **servidor de verdad con una base de datos en memoria**, con la app de las tiendas y con la nueva: en marcha,
    terminado con ganadores y terminado sin ninguno. El montaje y las capturas, en `soporte/retos-finalizados-12nov/` (fuera
    de git; su `LEEME.txt` dice cómo arrancarlo). `MODO=campana npm run mock` enseña también los cuatro casos.
  - **Pendiente, sin hacer**: avisar a los apuntados cuando el reto termina (hoy, un aviso a mano desde el panel) y poder
    quitar a un tramposo de los ganadores (las bases dicen que se revisa el top 3).
- **Puntos por logo (12-nov-2026, Iban: «puntos por logo 1, no entiendo por qué hay que poner 200»)**: la casilla «Puntos de cada logo» del panel traía 200 por defecto (copiado de las calabazas); ahora trae **1** (commit `f9be519`, sin build: los puntos van en cada logo al sembrar y la app solo enseña lo que manda el servidor). Los logos que se siembren con otro valor, lo llevan. Los logos de dentro de un círculo cerrado en la MISMA carrera ya los daba `recoger` (el relleno entra como celdas de la carrera); los cercos entre días siguen sin darlos.
- **Las apps de antes de la 1.11.13 no saben nada**: con Halloween apagado no ven los
  logos; encendido, los pintan como calabazas. Antes de lanzar una campaña de verdad,
  que la 1.11.13 esté en las dos tiendas (y valorar `MIN_APP_VERSION`, §9).

## 9-sexies. Vaciles desde el panel, sin sacar versión (6-nov-2026; app desde la 1.11.15)

Iban: pasar una tanda nueva de vaciles y que salgan como una pestaña más del selector,
junto a «Clásicos» y «Halloween», sin tocar las tiendas. Los de siempre van DIBUJADOS
dentro de la app (diez carteles por colección, ids 1-10 y 101-110). Una pestaña del panel
es de uno de dos tipos:

- **De textos**: frases, una por línea; la app las pinta en una tarjeta de CORRR (negra,
  marco naranja, letra condensada, `VacileTarjeta.tsx`).
- **De carteles** (los «tótems» y «Aura» de Iban, 6-nov-2026): parejas de PNG de
  **592×1280** como los clásicos, la provocación y la respuesta del ladrón. El servidor los
  guarda (tabla `vacile_imagenes`), les hace la miniatura 288×512 JPG con sharp y los sirve
  en `/vaciles/imagen/<id>.png` y `<id>-v.jpg` (caché de un año, `?v=` por versión, en
  memoria del proceso como los logos de campaña). Cada uno lleva de texto el nombre del
  archivo («lobo naranja»): si a un móvil no le llega el dibujo, enseña la tarjeta con ese
  nombre, nunca un hueco.

**Cómo se ve en el panel** (7-nov-2026, pedido por Iban): cada pestaña es un **desplegable**
(`<details class="vpest">`). Cerrada enseña su nombre, cuántos mensajes o parejas tiene, su
estado y **el botón Apagar / Encender de la cabecera**; abierta, el formulario de siempre
(un solo `<form id="fv">` que se MUEVE dentro de la pestaña que se abre; al repintar la lista
se aparca antes en `#v_guardado`, o se iría con ella). Solo hay una abierta a la vez. El
botón enciende **para todo el mundo** (pide confirmación) o apaga, y llama a
`POST /admin/vaciles/modo {id, modo, corredores}`, que cambia SOLO el interruptor (no
reenvía textos ni toca carteles); «En prueba» se elige dentro. Si se pulsa con el formulario
abierto, el desplegable del interruptor se sincroniza. Clásicos sale como fila fija, sin
botón. Halloween es otro desplegable con su botón y, dentro, el selector de tres estados.
Probado en el navegador con un servidor de mentira (abrir, cerrar, cambiar interruptor,
guardar y que la pestaña siga abierta con su aviso, «Nueva pestaña»); `test:panel` exige los
ids `vh_inter` y `v_msg_lista`, `test:vaciles` prueba `cambiarModoPestanaVaciles`.

**Las dibujadas también se encienden y apagan desde esa caja** (7-nov-2026): Clásicos va
siempre; **Halloween** tiene su interruptor de tres estados (ajuste `pestana_halloween` en
`ajustes_juego`, con los mismos valores 'no' / 'prueba:A,B' / 'si'; **apagada mientras nadie
lo toque**). Apagada, la pestaña HALLOWEEN **no sale** en el selector (apps 1.11.15 o más
nuevas; las anteriores la enseñan siempre, con «próximamente» si el evento está apagado).
Es aparte del interruptor del EVENTO de Halloween (§9-bis, en el histórico del panel), que
sigue mandando en las calabazas y en si los diez mensajes se abren. Cuando vuelva Halloween:
encender los dos. Los vaciles de Navidad que vendrán son una pestaña de carteles más.

Se mandan y llegan exactamente igual que uno clásico: por `POST /taunts` con el id del
mensaje, con el mismo hilo de una ida y una vuelta y la misma notificación.

**Cómo se sube una pestaña de textos** (Iban pasa las frases; lo hace él o Claude):

1. Panel → **Juego** → *Vaciles* → «Nueva pestaña», tipo «De textos». Nombre corto (en la
   app sale en mayúsculas, 18 letras como mucho), los **mensajes uno por línea** (los que
   manda quien ha sufrido el robo; 140 letras cada uno, 50 por pestaña) y, si se quieren
   distintas, las **respuestas** del ladrón, también una por línea (en blanco = valen las
   mismas). `{nombre}` se cambia por el nombre de quien lo recibe. El orden decide en qué
   sitio sale.
2. Guardarla **en prueba** (vacío = Ibanto; o varios nombres o correos, como las campañas),
   abrir el selector en el móvil (robo → Devolver) y mirarla. Los cambios se ven al abrir
   el selector: no hace falta reiniciar la app.
3. **Encender para todo el mundo**. Para apagarla, el mismo desplegable; «Eliminar» la
   quita de la lista pero no borra nada: los vaciles ya enviados se siguen leyendo.

**Cómo se sube una carpeta de carteles** (Iban pasa la carpeta; lo hace Claude con el
script, o él desde el panel):

- Los archivos se llaman `NN_PROVOCACION_<nombre>.png` y `NN_RESPUESTA_<nombre>.png`
  (también vale `NN_01_PROVOCACION_…` / `NN_02_RESPUESTA_…`): se emparejan por el número
  y el nombre lo da la provocación. Un zip o una `vista_general.jpg` en la carpeta se ignoran.
  **Las carpetas de Iban están en `apps/mobile/assets/taunts/vaciles/` (tótems) y
  `…/taunts/AURA/`: NO se commitean** (el repo es público y la app no las necesita dentro).
- Por script, desde `apps/backend` (lee `ADMIN_KEY` del `.env` y no la imprime):
  `node scripts/subir-vaciles.mjs --carpeta ../mobile/assets/taunts/vaciles --nombre "Tótems" --modo prueba`
  (`--solo-mirar` enseña las parejas sin subir nada; `--probadores "Ibanto, Otro"`, `--orden N`).
  Si ya hay una pestaña con ese nombre se reutiliza, y una pareja con el mismo nombre
  sustituye a la anterior **sin cambiar los ids**.
- Desde el panel: «Nueva pestaña», tipo «De carteles», elegir los PNG de la carpeta todos a
  la vez y «Guardar»: se guarda la pestaña y se suben las parejas una detrás de otra (una
  petición por pareja, medio mega cada cartel). Cada pareja tiene su botón «Quitar».
- Después, igual que las de textos: prueba → mirar en el móvil → encender.

**Hasta que la 1.11.15 esté en las dos tiendas, no encender ninguna para todos**: las
apps 1.11.14 y anteriores no enseñan la pestaña, y si reciben un vacile de estas ven la
pantalla negra con «Fulano te ha enviado un mensaje» y el botón, sin cartel (es lo que
hacía ya la app con un id que no conoce). Es la misma regla que las campañas.

Por dentro:

- **Servidor** (`services/vaciles.ts`, rutas en `routes/index.ts` detrás de `/taunts/read`):
  tablas `vacile_pestanas` (nombre, orden, `tipo` texto/imagen, `modo` 'no' / 'si' /
  'prueba:A,B' como las campañas, `borrada`), `vacile_mensajes` (texto, `tipo`
  mensaje/respuesta, orden, `activo`) y `vacile_imagenes` (png, jpg, version, por mensaje).
  Rutas de carteles: `POST /admin/vaciles/imagen` (una pareja en base64),
  `POST /admin/vaciles/quitar-pareja` y `GET /vaciles/imagen/:archivo`. En una pestaña de
  carteles, guardar el nombre o el interruptor no toca los carteles.
  **Los ids de los mensajes empiezan en 1001** (columna identity) para no pisarse con los
  dibujados: si coincidieran, a quien lo recibiera le saldría el dibujo de ese número. Al
  editar una lista, los textos que siguen **conservan su id** (es lo que viaja en cada
  vacile enviado), los quitados se apagan y uno que vuelve revive con su id de antes.
  `GET /app/vaciles` da las pestañas que le tocan al corredor (`ajusteLeToca`), con
  `imagen` y `miniatura` por mensaje en las de carteles, y `GET /taunts/unread` añade
  `texto` (ya con `{nombre}` cambiado por quien lo recibe), `pestana` e `imagen` a los
  vaciles del panel; en los dibujados van a null. Panel: `GET/POST /admin/vaciles`,
  `DELETE /admin/vaciles/:id`.
  **La pestaña HALLOWEEN**: `GET /app/vaciles` añade `dibujadas.halloween` (si le sale a ese
  corredor: `pestanasDibujadasPara` sobre el ajuste `pestana_halloween`), `GET /admin/vaciles`
  lo da como `dibujadas.halloween = { modo, corredores }` (`interruptorParaPanel`) y
  `POST /admin/vaciles/dibujada` lo guarda pasando por `modoDesdePanel`.
- **App**: `services/vaciles.ts` pide las pestañas al arrancar y cada vez que se abre el
  selector, **guarda lo último recibido** (`{ pestanas, halloween }` en `corrr_vaciles_panel_v1`
  de AsyncStorage; vale también la lista a secas que se guardaba antes) y
  **baja por adelantado los carteles** (`Image.prefetch`, miniaturas primero, tope de 8 s):
  sin red salen las de la última vez; si el servidor no contesta no se borra nada. El
  selector (`TauntSelector.tsx`) abre con una **PORTADA de colecciones** (boceto de Iban, 7-nov:
  una imagen por colección con su nombre debajo, dos columnas como los mensajes): CLÁSICOS, las
  del panel por su `orden` y, **solo si el panel la tiene encendida**, HALLOWEEN. La imagen es
  el primer cartel de la colección (en el modo que toque, provocación o respuesta; una pestaña
  de textos enseña su primera frase en la tarjeta). Al tocar una se entra en su cuadrícula, con
  una barra con su nombre bajo el encabezado; **la X de dentro vuelve a la portada y la de la
  portada cierra el selector**, y cada vez que se abre se empieza por la portada; las del panel están todas abiertas (no se ganan con robos ni
  calabazas). `VacileTarjeta` pinta el cartel ENCIMA de la tarjeta de texto, **invisible
  hasta que avisa de que ha cargado el suyo**: con la arquitectura nueva, iOS reutiliza la
  vista nativa de una imagen recién desaparecida (la cuadrícula del selector) y, sin eso,
  al recibir un tótem justo después de enviar otro salía el cartel de OTRO mensaje (visto
  el 6-nov-2026 en el simulador). Si el dibujo no llega, queda la tarjeta con el nombre.
  Al recibir uno, `MapScreen` enseña el cartel o la tarjeta si no hay dibujo dentro de la app.
- **Comprobar**: `npm run test:vaciles` (PGlite, como `test:campanas`: crear, editar sin
  cambiar ids, quién ve qué, carteles con sharp, y la consulta de la bandeja tal cual está
  en el código) y `npm run test:panel`. En la app, `npm run mock` lleva Tótems y Aura (carteles servidos desde
  `assets/taunts/vaciles/` y `…/AURA/`; con `MODO=textos`, además Navidad y Picantes de texto) y
  vaciles de texto y de cartel en la bandeja; la pestaña HALLOWEEN sale con `HALLOWEEN=1` (y con
  `MODO=vacio`, que no trae ninguna del panel).

## 9-ter. El panel de administración

**Intro no recarga el panel (desde el 6-nov-2026).** Todos los formularios van por
botones `type="button"`, y un bloqueo general (`querySelectorAll('form')` +
`preventDefault`) para el envío. Antes, escribir «200» en «Cuántos logos» y pulsar
Intro enviaba el formulario a la nada: el panel se recargaba y el campo volvía a 30,
así que Iban creyó sembrar 200 logos y se sembraron 30. Y **ningún id se repite**:
Correos tenía `<form id="fc">` y `c_msg`, iguales que los de Campañas, y
`getElementById` solo ve el primero (ahora `fcorreos` y `correos_msg`).
`npm run test:panel` vigila las dos cosas.

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

---

## 12. Auditoría del 3-oct-2026: lo que queda pendiente

Lo que se arregló ese día está en el §9 y en el historial — **incluido el gordo:
el servidor no tenía ningún límite de peticiones**. Esto es lo que queda:

**Comprobado y funcionando** (medido contra producción, no leído): límite de
peticiones, CORS, compresión, los POST con el cuerpo vacío, las cinco pestañas
de la app con datos y sin ellos.

**La seguridad a nivel de fila: COMPROBADA el 19-oct-2026** y está bien. Salió
a raíz de un vídeo que Iban mandó sobre apps hechas con IA que se arruinan.
Medido, no leído:

- **RLS activa en las 22 tablas** del esquema. La única sin ella es
  `spatial_ref_sys`, que es la tabla de referencia de PostGIS: datos públicos
  de sistemas de coordenadas, cero riesgo.
- Las **13 políticas** que hay son todas `service_full_access` y **solo para el
  papel `postgres`**. El papel `anon` —el de la API pública de Supabase— no
  tiene ni una, así que RLS le niega todo por defecto. Ojo: `anon` SÍ tiene
  permisos de tabla (SELECT, INSERT, UPDATE…, los que pone Supabase de serie);
  **lo único que lo frena es RLS**, así que apagarla en una tabla la deja
  abierta de par en par.
- **La app NO habla con Supabase**: no tiene `supabase-js`, solo llama a
  nuestra propia API. En el repositorio público no hay ninguna clave ni URL de
  Supabase (`git grep` de `supabase.co`, `SUPABASE_*` y del prefijo de los JWT:
  cero resultados).
- Probado desde fuera y sin credenciales: `GET /rest/v1/users`, `/runs` y
  `/cells` contra el proyecto contestan **401 "No API key found"**.

Es justo el fallo del vídeo —tablas con RLS apagada y la clave anónima dentro
del JavaScript— y aquí no se da por las dos cosas a la vez.

**Lo que sigue sin comprobarse**: que el índice único de `display_name` exista
de verdad (se crea con el mismo `.catch(() => {})` silencioso).

**Una factura disparada: CUBIERTO** (19-oct-2026). Salió de un vídeo que mandó
Iban sobre apps hechas con IA que se arruinan, y los cinco avisos se miraron
uno a uno. El del dinero era el único con algo que hacer, y ya está hecho:

- **Tope de gasto en Railway**: *Usage → Set limits → COMPUTE*. **Aviso por
  correo a los $10 y corte a los $25.** La columna AGENT se deja en blanco:
  es de los asistentes de Railway, que CORRR no usa.
- **Lo que gasta de verdad**, medido el mismo día: **$1,58 al mes** (memoria
  $1,26, CPU $0,03, tráfico $0,28 por 5,66 GB). Plan Hobby, que incluye $5.
  Hacen falta **quince veces** el consumo actual para que salte el corte.
- Y por qué no se puede disparar: la respuesta más pesada (Barcelona, 42.416
  celdas) son **124 KB comprimida** y **exige sesión**; lo que puede pedir
  alguien sin cuenta son **25 rutas que devuelven menos de 2 KB**; y el límite
  de peticiones corta a 500/min por IP (medido en producción el 3-oct).

Para comparar: los 189 TB del vídeo, a los $0,05/GB que cobra Railway, serían
**9.450 dólares**. CORRR lleva 5,66 GB.

**El espacio de la base de datos** (medido el 6-nov-2026 con `scripts/espacio.mjs`,
solo lectura; Iban: «¿vamos a tener que comprar algo más?»): **235 MB de los 500 MB
del plan gratis de Supabase** (al pasarse, el proyecto se queda en solo lectura).
`cells` 145 MB (77 de datos + 68 de índices, 1.000.935 filas, 152 bytes por celda,
108.000 filas muertas que el autovacuum irá limpiando); `calles` 55 MB (fija);
`users` 12 MB, casi todo **14 fotos de perfil en base64** (`avatar_url` entera; la
miniatura, 63 kB); el resto, menos de 2 MB entre todas. El ritmo: 50.000-180.000
celdas reclamadas por semana (la semana del 27-sep fueron 416.000: el ejército
CORRR), unos 10-25 MB por semana de `cells` → **el tope de 500 MB llega hacia
febrero-abril de 2027 al ritmo de hoy**; antes si entra gente. Entonces toca
Supabase Pro ($25/mes, 8 GB) y nada más: Railway sigue en ~$1,6/mes de los $5 del
Hobby. Ahorros a mano si hace falta: guardar la foto de perfil reducida (512 px) y
no la original (−11 MB) y `VACUUM` de `cells`. Mirarlo cada mes o dos.

Los otros cuatro avisos del vídeo, en una línea: **no mandamos SMS** (el caso
de los 5 M$ es por SMS en EE. UU.) y el correo cumple la LSSI con baja de un
clic (§ del correo de Halloween); **el único robot** que hay baja calles de
OpenStreetMap, que es gratis y corre en el Mac de Iban, no en el servidor;
**las tablas abiertas** no aplican (ver arriba, RLS comprobada); y la **demanda
por accesibilidad** es una ley estadounidense contra webs — CORRR es una app
española y gratis, riesgo bajo y nada urgente.

**Lo que NO se puede arreglar desde el código:**

- **La contraseña del keystore de Android está en el historial público de git**
  (`corrr2026`, commit `f7af8ad`, hasta `df3a863`). El keystore en sí nunca se
  subió, que es lo único que evita que cualquiera firme como CORRR. Borrarla del
  historial exige reescribirlo entero y no sirve de nada: GitHub guarda copias de
  los commits viejos. Lo que sí sirve: en Play Console, si está activada la firma
  de apps de Google, **cambiar la clave de SUBIDA** (Configuración → Firma de la
  app → Solicitar cambio de clave de subida). Mientras tanto, el keystore no sale
  de este Mac y de su copia de seguridad.
- **La clave de Google Maps viaja dentro de la app** (`app.json`), y eso no tiene
  arreglo: toda app que lleve mapas lleva su clave dentro, y quien descargue el
  APK la saca. **Comprobado el 3-oct-2026: por el lado del dinero está cubierta.**
  En Google Cloud (APIs y servicios → Credenciales → "Maps Platform API Key") las
  "Restricciones de API" ya dejan solo `Maps SDK for Android` y `Maps SDK for iOS`,
  que son gratis e ilimitados; no puede tocar Geocoding, Places ni Directions, que
  son los que se cobran. Google sigue avisando en amarillo porque las
  "Restricciones de aplicaciones" están en **Ninguno**, y ahí se quedan: una clave
  admite atarse a Android **o** a iOS, nunca a las dos, y la misma clave sirve para
  las dos plataformas. **Para cerrarlo hay que partirla en dos claves** (una por
  plataforma, cada una con su restricción: paquete `app.corrr` + huella SHA-1 en
  Android, `app.corrr` en iOS), y eso toca `app.json` → versión nueva.
  **Pendiente para la primera build después de Halloween.**
- ~~**La clave del panel (`ADMIN_KEY`)**~~ — **comprobado el 3-oct-2026: 66
  caracteres, de sobra.** El panel admite 20 intentos por minuto (medido en
  producción, de verdad) y no acepta la clave por la URL.
- **Fastify 4 ya no recibe arreglos** (la versión instalada es la 4.29.1; la
  rama 4 está fuera de soporte). `npm audit` saca 7 avisos que vienen todos de
  ahí. Mirados uno a uno, hoy no afectan: son de validación por esquema —que
  este servidor no usa, valida a mano— y de cabeceras de proxy —que tampoco
  lee—. Pero no van a arreglarse solos: **pasar a Fastify 5 después de
  Halloween**, con tiempo, no en vísperas de una subida.
- **Los avisos personales se reparten por NOMBRE, no por identificador**
  (`avisos.corredor` contra `users.display_name`). Desde el 3-oct no se puede
  coger el nombre de otro —antes `PUT /users/me` no comprobaba nada—, pero si
  alguien se cambia de nombre, sus avisos viejos se quedan huérfanos y podría
  heredarlos quien coja ese nombre después. Arreglarlo de verdad es guardar el
  identificador en `avisos`; no corre prisa con 46 corredores que se conocen.

---

## 15. El rechazo de Apple del 15-oct-2026 (y cómo no repetirlo)

Dos motivos, los dos de **metadatos**: el paquete (build 34) estaba bien y no
hizo falta compilar nada.

**2.3.10 — nombrar a otra plataforma.** En "Novedades de esta versión" había
*"En Android, el móvil te avisa si detecta que has salido a correr"*. Apple no
admite referencias a Android, Google Play ni a apps de la competencia en los
textos de la ficha, y rechaza la VERSIÓN entera, no solo el texto. Las notas de
Google Play sí pueden decirlo: son dos textos distintos y **no se copian solos**
—que es justo por lo que se coló—. El texto bueno está en
`store/notas-1.11.11.md`, con el aviso al lado.

**2.1 — la cuenta de prueba no existía.** `store/apple-review-notes.md` decía
desde hacía meses que `applereview@corrr.es` estaba *"already created, verified
and ready"*, y **en la base de datos no había ninguna cuenta con ese correo**.
Lo más probable es que se completara el borrado al grabar el vídeo del flujo de
"Eliminar cuenta" — el propio documento avisaba de no hacerlo.

Lo peligroso es que **es la única cuenta de CORRR que no usa nadie**: si se cae,
no hay ningún corredor que se queje, no sale en ningún contador (el resumen y
las campañas ya dejan fuera cualquier `@corrr.es`), y el único que se entera es
Apple, rechazando. Por eso ahora se crea y se comprueba desde el panel
(Herramientas → *Cuenta para la revisión de Apple*, endpoints
`POST`/`GET /admin/cuenta-revision`), la contraseña se escribe ahí y no está en
el código, y `panel-check.mjs` vigila que los dos botones sigan enganchados.

**Regla: antes de enviar a Apple, el botón "¿Está viva?" y una lectura del
texto de "Novedades" buscando Android, Google o Strava.** Las dos cosas están
escritas como paso 1 y 2 en `store/notas-1.11.11.md`.

De paso se limpió lo que quedaba de Strava en los textos de Apple: la ficha
prometía *"IMPORTA DESDE STRAVA"* y *"Integración con Strava"*, y esa conexión
está apagada desde septiembre (§9). Lo que de verdad hace el iPhone es leer
**Salud**, y así se cuenta ahora en las notas de revisión.

---

## 13. EJÉRCITO CORRR (decidido el 4-oct-2026, se monta en noviembre)

**No se toca antes de Halloween.** El evento acaba el 1 de noviembre y esto mete
mano al motor de territorio: es la mejor forma de romper algo la semana que más
gente mira.

### Para qué es

De 47 corredores, **26 no han corrido nunca**, y hay 27 ciudades con una sola
persona. Quien se da de alta en Burgos abre el mapa, lo ve gris y no vuelve.
El trabajo del ejército no es tanto picar como **que la primera vez que abres la
app no parezca un pueblo fantasma** — y, si ya corres solo en tu ciudad, que al
menos pase algo.

### Qué NO es

No son personas falsas. Iban descartó disimular, y con razón: en una comunidad
donde se conocen, el día que alguien lo descubra no piensa "qué listo", piensa
"¿entonces el ranking también es mentira?" — y justo se acaba de montar lo de
*quién* te ha robado. Son de la casa y lo dicen.

### Cómo se ven

Cinco, para toda España, con nombre propio y único:

> **El Galgo · La Liebre · El Zorro · El Lobo · La Gaviota**

Debajo del nombre, donde los demás llevan su ciudad, va **EJÉRCITO CORRR**. En
el ranking, en la ficha y en el aviso de robo. El nombre queda limpio —"CORRR ·
Patas Largas" no pica a nadie— y aun así nadie se come ningún engaño.

Color distinto cada uno (`colorDeCorredor` ya los reparte bien separados).

### Cómo se portan

| | |
|---|---|
| Cuántos | **5 en toda España**, no uno por ciudad |
| Dónde | rotando; más visitas donde menos gente hay |
| Ruta | 3-6 km, sobre el mapa de calles (`calles`) |
| Cerco | **sí**, pero solo si la vuelta no pasa de **3 km** |
| Lo que se lleva al cerrar | ~2.500-3.000 celdas (unos 500 × 500 m) |
| Puntos que ganan | **10 por carrera**. Nada por celdas |
| Puntos que te quitan al robarte | **la mitad** de lo normal |
| Recuperarles territorio | paga **×1** (ni el ×2 ni el ×0,5 de `factorRobo`) |
| Entre ellos | no se roban |
| Ranking nacional | **fuera**. Solo en el de su ciudad y en el mapa |

**El cerco va con tope de 3 km por una razón medida**: la carrera de Iban del
4-oct, de 3,46 km, cerró unas 3.400 celdas. Sin tope, cinco bots se comen Madrid
en tres meses, y demasiado territorio espanta más que el mapa vacío — el que
llega mira y piensa "esto ya está cogido".

### El ritmo: corren una vez y esperan

La regla que lo limita todo, y es de Iban:

> **Un bot corre UNA vez y se queda quieto hasta que alguien de verdad corra en
> su ciudad.** Si no hay movimiento, espera. Cuanta más gente aparece, menos
> corre.

Con esto no hace falta ningún techo de acumulación: se frena solo, y solo actúa
cuando hay alguien con quien jugar. Su territorio se queda ahí de decorado,
que es justo lo que hace falta en una ciudad vacía.

**Matiz**: despierta cuando alguien corre EN SU CIUDAD, no solo cuando le roban
a él. Con 26 personas que no han corrido nunca, esperar a que le roben a un bot
es esperar sentado. Y que su siguiente ruta caiga cerca de donde ha corrido esa
persona, para que los territorios se toquen y haya pique.

### Lo que el ejército NO toca: calabazas ni zombis

**Un bot pasa por encima de una calabaza y no pasa nada.** Ni la coge, ni la
hace renacer en otro sitio, ni sale en el ranking de calabazas. Con los zombis,
igual: le dan lo mismo. Y lo que quede dentro de un cerco suyo, también sigue
ahí.

Dos motivos, y los dos importan:

- **Vaciarían el mapa.** Cinco bots corriendo por las ciudades donde no hay
  nadie se comerían las calabazas de esas ciudades antes de que las viera la
  persona para la que están puestas. Justo al revés de para lo que están.
- **Ensuciarían el ranking de calabazas**, que es el de la pestaña de Retos y
  cuenta personas. Un bot en esa tabla no tiene ningún sentido.

En el código es no llamar a `recoger` en la carrera de un bot. El evento es de
la gente; el ejército solo pone territorio.

### Las rutas: por la calle, no en cuadrados

Lo pidió Iban y es lo que separa un bot creíble de uno que canta: **la ruta
tiene que ir POR LA CALLE**, doblando esquinas, no un cuadrado ni un círculo
dibujado sobre el mapa.

**Y aquí hay un trabajo que no está hecho.** La tabla `calles` son 159.900
puntos sueltos — una nube de celdas, adelgazada a una cada 100 m. Vale para
sembrar calabazas (solo hace falta saber que ahí hay asfalto) pero **no dice qué
calle conecta con cuál**, así que no se puede caminar por ella: un bot que fuera
saltando al punto más cercano cortaría por dentro de las manzanas.

Para rutas de verdad hace falta la RED, no la nube. O sea, volver a bajar de
OpenStreetMap las mismas vías pero **guardando su geometría** (la lista de
puntos de cada calle, que es lo que `bajar-calles.mjs` convierte a celdas y
tira). Con eso, una ruta es: elegir un punto de salida, ir enlazando calles que
se tocan hasta juntar los kilómetros que toquen, y si se quiere cerrar un cerco,
volver al principio.

Es el mismo `bajar-calles.mjs` cambiando qué se guarda, y solo para las ciudades
donde haya bots. Hay que contarlo en la estimación: es la parte más gorda de
todo esto.

### Lo tedioso, que es lo que hay que hacer con cuidado

Un bot es una fila en `users`, así que aparecería donde NO debe. Hace falta una
marca `es_bot` y sacarlos de:

- la **campaña de correos** (`emailReactivacion`): si no, a los dos días les
  mandas "¿te has olvidado de CORRR?" a cinco direcciones inventadas, y los
  rebotes te ensucian la reputación de envío;
- los contadores del **resumen** (`/admin/resumen`): "dormidos", "sin estrenar",
  el total de gente;
- el **podio** semanal y el **ranking nacional**;
- las **notificaciones push** (no tienen móvil) y las **solicitudes de amistad**.

### Detalles que se notan

- Si contestan a un taunt, que **no sea al segundo**. Un rato aleatorio, y a
  veces que no contesten. Contestar es barato: un taunt es un número en la tabla
  y el dibujo ya lo lleva la app (`respuesta1.png`…).
- Que tengan **foto**. Sin ella sale la inicial en un círculo y cinco círculos
  iguales en el ranking quedan raros.

---

## 14. Para DESPUÉS de Halloween

- **🔴 LO PRIMERO DESPUÉS DEL EVENTO: devolver la carrera que se pierde cuando
  Android mata la app.** Van **TRES** corredores: Oriol15 (4-oct), el que
  escribió en catalán (13-oct) y el del audio (14-oct), que apagó la pantalla a
  los 7 segundos, corrió entero, y al volver se encontró la app congelada en
  "0,0 km · 7 s", luego cerrada, y la carrera perdida.
  **Y lo que más duele: los puntos SÍ estaban guardados en su móvil.** La tarea
  de fondo los deja en disco; lo que falta es que al arrancar la app se dé
  cuenta de que quedó una carrera a medias y se la devuelva. No hay que cambiar
  cómo se graba — solo rescatar lo que ya hay.
  Ya existe la pieza que lo hace: `src/tracking/importWorkout.ts` repasa una
  ruta entera por el mismo `RunTracker` (es lo que hace con las del reloj).
  **10-nov-2026: encontrada una de las causas, y arreglada en la 1.11.15 vc93**
  (§9, «La carrera se colgaba al mirar el móvil»): con la pantalla apagada mucho
  rato, al volver la app se bloqueaba poniéndose al día y Android ofrecía
  cerrarla. Encaja con el del audio del 14-oct («congelada en 0,0 km · 7 s,
  luego cerrada»). El rescate de lo que queda en disco sigue pendiente.
  **Decisión de Iban (14-oct): se hace DESPUÉS de Halloween.** "Si hacemos este
  arreglo y reventamos el mapa, la gente se desmotiva." Toca la pieza más
  delicada a ocho días de subir, y el evento manda.
- **Al activar "Tus otras carreras", traerse los ÚLTIMOS 7 DÍAS.** Hoy solo
  entran los entrenos POSTERIORES a activarlo (decisión de sept-2026, para que
  nadie se traiga su histórico de golpe). Tiene sentido, pero a quien se acaba
  de instalar la app le deja la sensación de que **no funciona**: lo activa, no
  pasa nada, y se va. Pasó literalmente el 20-oct — un usuario con Garmin →
  Strava → Salud escribió diciendo que no le entraba nada y que *"si no puedo
  sincronizar las carreras no usaré la app"*. El tope de 7 días (`MAX_AGE_MS`)
  ya existe en `healthkit.ts`: es cambiar `since` para que no mire
  `connectedAt`, y avisar en el aviso de conexión de lo que va a entrar.
  **Pendiente de saber en qué quedó ese caso**: puede que lo suyo fuera
  simplemente que Strava manda el entreno a Salud SIN la ruta, y sin ruta no
  hay territorio. La pregunta que lo decide es si ve el mapa en la app Fitness.
- **Guardar la carrera en el móvil MIENTRAS se corre.** Hoy solo se guarda al
  pulsar PARAR (que es lo que mató la carrera de Oriol15 el 4-oct y ya está
  arreglado), y en segundo plano. Con la app abierta en pantalla, los puntos
  viven solo en memoria: si se cae a mitad, se pierde lo corrido.
  **Cómo, sin que se note**: un trocito cada 15 s (unos 20 puntos, 2 KB), NO la
  lista entera cada segundo — eso al final de una hora sería reescribir 300 KB
  por segundo y se notaría en tirones y batería. Al volver, los puntos se pasan
  por el mismo `RunTracker` y sale la misma distancia y el mismo territorio.
  **Se aparcó a propósito**: toca el motor de la carrera, que es la pieza más
  delicada, y a quince días del evento no compensaba el riesgo.
- **El EJÉRCITO CORRR de verdad** (§13): rutas por la red de calles, robar,
  reaccionar cuando alguien corre en su ciudad. Lo que hay ahora es solo
  decorado pintado, más el taunt cuando les quitas territorio.
- **Partir la clave de Google Maps en dos** (§12), una por plataforma, para
  poder atarla a la app.
- **Cambiar la clave de subida de Android** (§12).
- **Pasar a Fastify 5** (§12): la rama 4 está fuera de soporte.
- **Repartir los colores de corredor con una paleta, no con el ángulo áureo**
  (medido el 7-oct-2026, y APARCADO a propósito: Iban prefirió tocar solo la
  pareja que cantaba). El ángulo áureo reparte bien los N PRIMEROS números, pero
  dos índices separados por un número de **Fibonacci** caen pegados — y los
  `color_idx` que se usan tienen huecos (cuentas borradas, el ejército), así que
  esa coincidencia sale. Medido sobre los 24 corredores con territorio, **vistos
  al 50% sobre el mapa**, que es como se ven de verdad:

  | | |
  |---|---|
  | fausrunner (idx 24) y Oriol15 (idx 3) | dE **3,1** — el mismo verde, y vecinos en Barcelona |
  | parejas por debajo de dE 15 | 8 |
  | …y de esas, vecinas en el mapa | 4 (La Liebre/MisuraMano, fausrunner/Oriol15, Ibanto/Olga, El Zorro/afarbis) |

  24−3 = **21**, Fibonacci, y además múltiplo de 3 — así que la alternancia de
  luminosidad (`idx % 3`) les daba también la misma luz. Doble coincidencia.

  **El arreglo probado**: una lista fija de 96 colores construida eligiendo cada
  vez el más lejano de los ya elegidos (muestreo del punto más lejano en espacio
  Lab), dejando fuera lo que se parezca al naranja propio o al azul del mapa.
  Tiene la propiedad que hace falta — **los N primeros están bien repartidos
  para cualquier N, y por tanto cualquier subconjunto también** —, así que NO
  hace falta tocar los `color_idx` que ya tiene cada uno. Medido con los índices
  reales: la peor pareja pasa de dE 4,4 a **19,0** y las parejas confundibles de
  8 a **0**. Es cambio de SERVIDOR: no necesita build (la app solo se inventa un
  color si el servidor no le manda ninguno).

  **Mientras tanto** (7-oct): a Oriol15 se le puso a mano `color_idx = 327`
  (fucsia `#ca2175`), que lo deja a dE 91,5 de fausrunner y a dE 50 del naranja
  propio. Los números de color se reparten por orden de alta, así que el 327 no
  se lo va a llevar nadie hasta que haya 328 corredores. **Las otras tres
  parejas siguen igual.**
