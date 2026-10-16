# El aviso de Halloween — para pegar en el panel

Panel → **Avisos** → *Aviso en la app*. Se manda **la noche del 22**, después de
sembrar y después de encender Halloween para todos.

**No necesita versión nueva de la app**: el aviso vive en el servidor.

---

## Qué hace el botón

El aviso sale al abrir la app. Al pulsar **ME APUNTO** se cierra, y la persona
se queda **en el mapa** — que es exactamente el momento en que el servidor le
siembra sus calabazas si en su ciudad no había ninguna (`sembrarDondeMira`).

O sea: el botón hace de verdad lo que dice. Y quien no lo pulse también entra,
porque la siembra va con mirar el mapa, no con el botón.

**El enlace se deja VACÍO.** El botón no tiene que llevar a ninguna parte: todo
pasa dentro de la app. Un enlace mal escrito solo puede estropearlo.

---

## Los campos, uno a uno

**Línea pequeña de arriba** (máx. 30)
```
DEL 23 AL 1 DE NOVIEMBRE
```

**Título** (máx. 60)
```
LLEGA HALLOWEEN
```

**Sello de la esquina** (máx. 24)
```
TRUCO O TRATO
```

**Texto** (máx. 400)
```
Salen calabazas por toda tu ciudad, en cualquier calle. Píllalas corriendo: 200 puntos cada una, y las que queden dentro de un círculo que cierres también son tuyas.

Al lado de cada calabaza hay dos o tres fantasmas. Pisa uno y te toca +500, -1.000 o nada. Se ven todos iguales, así que ir a por una siempre es una apuesta.

Cada calabaza que cojas desbloquea un mensaje nuevo.
```

**Texto del botón** (máx. 24)
```
ME APUNTO
```

**Nota junto al botón** (máx. 40)
```
EMPIEZA EL VIERNES
```

**Enlace** — vacío.

**Público** — todos.

**Mandar también notificación al móvil** — sí. Es lo que llega a quien no abre
la app ese día, y son justo los que más falta hacen.

---

## El del final (2 de noviembre)

Cuando acabe, nombrar al que más cogió. Los números salen del panel
(Juego → Calabazas → el top de 5) y el ranking es **solo de este evento**, así
que lo de las pruebas de octubre no cuenta.

**Línea de arriba**: `HALLOWEEN 2026` · **Título**: `SE ACABÓ` ·
**Sello**: `HASTA EL AÑO QUE VIENE` · **Botón**: `VALE`

Y ese día también: bajar `MIN_APP_VERSION` en Railway.
