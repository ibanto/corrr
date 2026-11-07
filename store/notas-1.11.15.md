# Notas de la versión 1.11.15 (Android vc92 · iPhone build 38)

En Android sustituye a la 1.11.14 (vc91). En iPhone la 1.11.14 (build 37) **ya está aprobada por Apple y
pendiente de publicar** (7-nov): hasta que se publique, App Store Connect no deja crear la versión 1.11.15.
Orden en iPhone: publicar la 1.11.14 → «+» 1.11.15 → build 38 → enviar a revisión. Sale en **las dos tiendas**.

Las de Apple y las de Google **no se sincronizan solas**: hay que pegarlas en
los dos sitios, y si cambias una, acordarse de la otra.

**Lo que lleva (además de lo de la 1.11.14):**
- **Vaciles desde el panel** (CLAUDE.md §9-sexies): las pestañas nuevas de vaciles (textos o
  carteles) se escriben en el panel y salen en el selector **sin sacar versión**. Ya están
  hechas **Tótems** y **Aura**, en prueba solo para Ibanto hasta que esta versión esté en las dos
  tiendas.
- **Portada de colecciones** (boceto de Iban, 7-nov): al pulsar «Devolver», en vez de pestañas se ve
  una cuadrícula de 2×2 con la imagen de cada colección y su nombre debajo; al tocarla, sus
  mensajes con una barra con el nombre. La X de dentro vuelve a la portada.
- **Pestaña Halloween con interruptor** en el panel (solo manda en esta versión o más nuevas;
  las anteriores siguen enseñándola siempre).
- **Mapa al instante** (6-nov): al abrir pinta el último territorio guardado y ya no espera a las
  zonas antiguas. Se tocó `MapScreen.tsx`: **hace falta la prueba en la calle**.
- **Logo de campaña que renace** a los 5 minutos y cerca; la app lo da a 20 m en vivo.

**Antes de subir a producción:** la prueba en la calle de `docs/prueba-gps.md` en los dos
móviles (pantalla apagada). Y antes de mandarla a Apple, el botón «¿Está viva?» del panel
(cuenta de revisión) y repasar las Novedades buscando Android, Google o Strava (§15 del CLAUDE.md).

**Después de publicarla en las dos tiendas** se encienden Tótems, Aura y la pestaña Halloween
(si se quiere) desde el panel. Antes no: las apps antiguas no las enseñan.

---

## 1 · Para la prueba interna / TestFlight

```
Vaciles nuevos: al pulsar Devolver ahora ves la portada con todas las colecciones. Toca una para ver sus mensajes.

Mapa más rápido: al abrir la app ya sale tu territorio.
```

---

## 2 · Para producción, cuando la prueba en la calle salga bien

### Google Play — "Novedades" (máx. 500 caracteres)

```
Se acabó Halloween. Gracias a todos los que salisteis a cazar calabazas 🎃

Ahora toca lo siguiente: en la pestaña Retos ya puedes ver lo que viene, el gran reto de Navidad. Con premio.

Vaciles nuevos: al devolver un robo eliges entre colecciones. El mapa abre más rápido. Y el ranking cambia: España, tu ciudad y tus amigos.
```

### App Store Connect — "Novedades de esta versión"

**Sin nombrar Android, Google ni Strava** (rechazo del 15-oct, §15).

```
Se acabó Halloween. Gracias a todos los que salisteis a cazar calabazas.

Ahora toca lo siguiente: en la pestaña Retos ya puedes ver lo que viene, el gran reto de Navidad. Con premio.

Vaciles nuevos: al devolver un robo eliges entre colecciones. El mapa abre más rápido. Y el ranking cambia: España, tu ciudad y tus amigos.

Y arreglos por dentro para que no se pierda ninguna carrera.
```

Después de que cada tienda la publique: Android `LATEST_APP_VERSION` = 1.11.15 ·
`LATEST_APP_VC` = 92; iPhone `LATEST_IOS_VERSION` = 1.11.15 · `LATEST_IOS_BUILD`
= 38 (Railway, o el valor por defecto en `routes/index.ts` y push).
**`MIN_APP_VERSION` NO se toca** con gente corriendo (§9).
