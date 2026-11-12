# Notas de la versión 1.11.17 (Android vc95 · iPhone build 42)

**Por qué existe** (12-nov-2026): los retos terminados. El servidor ya los manda como FINALIZADO con sus
ganadores a todas las apps (commit `ccf489d`, §9-quinquies del CLAUDE.md), pero las de hasta la 1.11.16 siguen
enseñando el botón ME APUNTO / DESAPUNTARME en un reto que ya ha acabado. Iban: «y las nuevas builds».

**Lo que lleva sobre la 1.11.15 de Android (vc93) y la 1.11.16 del iPhone (build 40)**, que son el mismo código:
- **Reto terminado**: sello FINALIZADO, tabla de GANADORES (con «¡Enhorabuena!» si estás entre ellos), el premio
  y la CLASIFICACIÓN FINAL. Sin botón de apuntarse.
- **Lista de retos en dos pestañas, Activos y Finalizados**; los terminados salen apagados y con su sello, y cada reto
  dice en qué ciudad es. Sin ningún reto en marcha, Activos enseña el anuncio de «Próximamente».
- Solo cambian `RetosScreen.tsx` y `services/api.ts`. **No se tocó el mapa ni el GPS**: no pide prueba en la calle.

**Estado (12-nov, 12:05):** AAB en `apps/mobile/builds/corrr-v1.11.17-vc95.aab`, comprobado por dentro (1.11.17, vc95, firma
SHA-256 de siempre, servidor de producción, sin depuración); **falta que Iban lo arrastre a Play Console**. iPhone archivado como
`CORRR-1.11.17-build42` y **subido a App Store Connect (TestFlight) el 12-nov a las 12:03**. **La build 41 de TestFlight no vale** (se
montó sin las pestañas).

**Android EN PRUEBA INTERNA el 12-nov a las 13:44**: «95 (1.11.17) · Disponible para testers internos» (el AAB lo arrastró Iban; las
notas y «Guardar y publicar», Claude). **Falta promocionarla a producción** y enviarla a revisión de Google, con el OK de Iban.

**iPhone ENVIADO A REVISIÓN el 12-nov a las 13:37** (con el OK de Iban, por Claude con el Chrome de Iban): versión 1.11.17 creada con la
**build 42**, las novedades y el texto promocional de abajo y «Publicar esta versión manualmente». Estado: «Pendiente de revisión»
(hasta 48 h). Cuando Apple apruebe: «Publicar esta versión», con el OK de Iban.

## App Store Connect

**Sin nombrar Android, Google ni Strava** (rechazo del 15-oct, §15). Antes de enviar a revisión: mirar que la
cuenta de revisión existe (`GET /admin/cuenta-revision?email=applereview@corrr.es`; el 12-nov, `puedeEntrar: true`).

Novedades de esta versión:

```
Retos, de principio a fin.

Ahora van en dos pestañas: los que están en marcha y los que ya han terminado.

Cuando un reto termina se ve claro: sale como finalizado, con la lista de ganadores y la clasificación final.

Y cada reto dice en qué ciudad se juega. Apúntate al que quieras.
```

Texto promocional (el mismo de la 1.11.16):

```
Vaciles nuevos para devolver los robos, mapa más rápido y, en Retos, lo que viene: el gran reto de Navidad, con premio.
```

## Google Play Console

Notas de la versión (máximo 500 caracteres):

```
Retos, de principio a fin: ahora van en dos pestañas, los que están en marcha y los que ya han terminado. Cuando un reto termina sale como finalizado, con la lista de ganadores y la clasificación final. Cada reto dice en qué ciudad se juega, y puedes apuntarte al que quieras.
```

## Después de publicar

Cuando cada ficha enseñe la 1.11.17: Android `LATEST_APP_VERSION` = 1.11.17 · `LATEST_APP_VC` = 95; iPhone
`LATEST_IOS_VERSION` = 1.11.17 · `LATEST_IOS_BUILD` = 42 (Railway, o el valor por defecto en `routes/index.ts` y
push). **`MIN_APP_VERSION` NO se toca** con gente corriendo (§9).
