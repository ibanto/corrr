# Notas de la versión 1.11.16 (solo iPhone · build 40)

**Por qué existe** (10-nov-2026): Apple aprobó la 1.11.15 del iPhone con la build 38, la del 7-nov, antes de que
llegaran los tres arreglos del 10-nov. Esos arreglos van al iPhone como 1.11.16. En Android los lleva la
**1.11.15 vc93**: es el mismo código, solo cambia el número (`store/notas-1.11.15.md`).

**Lo que lleva sobre la 1.11.15 del iPhone (build 38):**
- Con la pantalla apagada los puntos del GPS se apuntan pero no se pintan uno a uno; al volver se pinta una vez.
  (El cuelgue era de Android; en iPhone se ahorra trabajo a ciegas.)
- El GPS de una carrera que murió sin PARAR se apaga al abrir la app, aunque no se llegue al mapa.
- La copia de la carrera en el móvil se guarda más pequeña cuando es una vuelta grande.

**Estado:** build 40 subida a TestFlight el 10-nov a las 19:51. Versión 1.11.16 creada en App Store Connect con
los textos de abajo, la build 40 elegida y «Publicar esta versión manualmente». **Enviada a revisión de Apple el
10-nov a las 21:05** (la cuenta de revisión no existía; Iban la creó antes en el panel, §15 del CLAUDE.md). Falta
la prueba en la calle del iPhone, mientras Apple revisa.

## App Store Connect

**Sin nombrar Android, Google ni Strava** (rechazo del 15-oct, §15).

Novedades de esta versión:

```
Arreglos para que no se pierda ninguna carrera.

Si llevas mucho rato corriendo sin mirar el móvil, al abrirlo todo sale al día al momento.

Y si una carrera se quedó a medias, el GPS ya no se queda encendido: se apaga al volver a abrir la app.
```

Texto promocional (el mismo de la 1.11.15):

```
Vaciles nuevos para devolver los robos, mapa más rápido y, en Retos, lo que viene: el gran reto de Navidad, con premio.
```

Después de que Apple la publique: `LATEST_IOS_VERSION` = 1.11.16 · `LATEST_IOS_BUILD` = 40 (Railway, o el valor
por defecto en `routes/index.ts` y push). **`MIN_APP_VERSION` NO se toca** con gente corriendo (§9).
