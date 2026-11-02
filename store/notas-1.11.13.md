# Notas de la versión 1.11.13 (Android vc89 · iPhone build 35)

Sale en **las dos tiendas**. En iPhone es la primera desde la 1.11.11, así que
lleva también los arreglos de la carrera de la 1.11.12 de Android.

Las de Apple y las de Google **no se sincronizan solas**: hay que pegarlas en
los dos sitios, y si cambias una, acordarse de la otra.

**Lo que lleva:**
- **Retos sin Halloween** (Iban, 2-nov): si hay campaña de marca, la campaña; si
  no, «Próximamente» con el anuncio que mande el servidor (`PROXIMAMENTE` en
  `routes/index.ts`; hoy, «GRAN RETO DE NAVIDAD · ¡CON PREMIO!»). Cambiar ese
  anuncio ya no pide versión nueva.
- **Campañas de marca desde el panel** (CLAUDE.md §9-quinquies): logo, cartel y
  Retos vienen del servidor.
- Solo iPhone: los tres arreglos de la carrera de la 1.11.12 (carrera viva al
  volver a la app, GPS al pulsar INICIAR, copia pendiente que no se manda dos
  veces).

**Antes de subir:** la prueba en la calle de `docs/prueba-gps.md` en los dos
móviles (se ha tocado `MapScreen.tsx`). Y antes de mandarla a Apple, el botón
«¿Está viva?» del panel (cuenta de revisión) y repasar las Novedades buscando
Android, Google o Strava (§15 del CLAUDE.md).

---

## 1 · Para la prueba interna / TestFlight

```
Retos ya no habla de Halloween: anuncia el gran reto de Navidad, con premio.

Preparada para las campañas de marca: el logo, el cartel y la pantalla de
Retos vienen del servidor, sin sacar versión cada vez.
```

---

## 2 · Para producción, cuando la prueba en la calle salga bien

### Google Play — "Novedades" (máx. 500 caracteres; esto son 288)

```
Se acabó Halloween. Gracias a todos los que salisteis a cazar calabazas 🎃

Ahora toca lo siguiente: en la pestaña Retos ya puedes ver lo que viene, el gran reto de Navidad. Con premio.

Y por dentro, CORRR ya está preparada para retos nuevos sin que tengas que actualizar la app cada vez.
```

### App Store Connect — "Novedades de esta versión"

**Sin nombrar Android, Google ni Strava** (rechazo del 15-oct, §15).

```
Se acabó Halloween. Gracias a todos los que salisteis a cazar calabazas.

Ahora toca lo siguiente: en la pestaña Retos ya puedes ver lo que viene, el gran reto de Navidad. Con premio.

Y arreglos por dentro para que no se pierda ninguna carrera.
```

Después de que cada tienda la publique: Android `LATEST_APP_VERSION` = 1.11.13 ·
`LATEST_APP_VC` = 89; iPhone `LATEST_IOS_VERSION` = 1.11.13 · `LATEST_IOS_BUILD`
= 35 (Railway, o el valor por defecto en `routes/index.ts` y push).
**`MIN_APP_VERSION` NO se toca** con gente corriendo (§9).
