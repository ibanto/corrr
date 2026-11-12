# Notas de la versión 1.11.17 (Android vc94 · iPhone build 41)

**Por qué existe** (12-nov-2026): los retos terminados. El servidor ya los manda como FINALIZADO con sus
ganadores a todas las apps (commit `ccf489d`, §9-quinquies del CLAUDE.md), pero las de hasta la 1.11.16 siguen
enseñando el botón ME APUNTO / DESAPUNTARME en un reto que ya ha acabado. Iban: «y las nuevas builds».

**Lo que lleva sobre la 1.11.15 de Android (vc93) y la 1.11.16 del iPhone (build 40)**, que son el mismo código:
- **Reto terminado**: sello FINALIZADO, tabla de GANADORES (con «¡Enhorabuena!» si estás entre ellos), el premio
  y la CLASIFICACIÓN FINAL. Sin botón de apuntarse.
- **Lista de retos**: los terminados salen al final, apagados y con su sello; cada reto dice en qué ciudad es.
- Solo cambian `RetosScreen.tsx` y `services/api.ts`. **No se tocó el mapa ni el GPS**: no pide prueba en la calle.

**Estado (12-nov, 11:55):** AAB en `apps/mobile/builds/corrr-v1.11.17-vc94.aab`, comprobado por dentro (1.11.17, vc94, firma
SHA-256 de siempre, servidor de producción, sin depuración); **falta que Iban lo arrastre a Play Console**. iPhone archivado como
`CORRR-1.11.17-build41` y **subido a App Store Connect (TestFlight) el 12-nov a las 11:53**; falta crear la versión 1.11.17, elegir la
build 41 y enviarla a revisión (con el OK de Iban).

## App Store Connect

**Sin nombrar Android, Google ni Strava** (rechazo del 15-oct, §15). Antes de enviar a revisión: mirar que la
cuenta de revisión existe (`GET /admin/cuenta-revision?email=applereview@corrr.es`; el 12-nov, `puedeEntrar: true`).

Novedades de esta versión:

```
Retos, de principio a fin.

Cuando un reto termina, ahora se ve claro: sale como finalizado, con la lista de ganadores y la clasificación final.

Y cada reto dice en qué ciudad se juega. Apúntate al que quieras.
```

Texto promocional (el mismo de la 1.11.16):

```
Vaciles nuevos para devolver los robos, mapa más rápido y, en Retos, lo que viene: el gran reto de Navidad, con premio.
```

## Google Play Console

Notas de la versión (máximo 500 caracteres):

```
Retos, de principio a fin: cuando un reto termina sale como finalizado, con la lista de ganadores y la clasificación final. Cada reto dice en qué ciudad se juega, y puedes apuntarte al que quieras.
```

## Después de publicar

Cuando cada ficha enseñe la 1.11.17: Android `LATEST_APP_VERSION` = 1.11.17 · `LATEST_APP_VC` = 94; iPhone
`LATEST_IOS_VERSION` = 1.11.17 · `LATEST_IOS_BUILD` = 41 (Railway, o el valor por defecto en `routes/index.ts` y
push). **`MIN_APP_VERSION` NO se toca** con gente corriendo (§9).
