# Prueba del GPS antes de cada build

Siempre que se toque el mapa, el GPS o `apps/mobile/src/tracking/`. Las dos
partes. Si una falla, no se sube nada a las tiendas.

## 1. Automática — un minuto

```bash
cd apps/mobile && npm run test:gps
```

Tiene que terminar en **"Todo en orden"**. Recorre con puntos simulados cada
cosa que ya se ha roto alguna vez en producción: metros contados dos veces,
la calle recta que se perdía con la pantalla apagada, la deriva sumando metros
sentado, el semáforo, la cuña de A a B, el coche.

Lo que no puede comprobar es que el móvil entregue puntos con la pantalla
apagada. Eso es la parte 2.

## 2. En el móvil — quince minutos, en la calle

Con el permiso de ubicación en **"Mientras se usa la app"**, no en "Siempre":
es el que tiene casi todo el mundo, y con el que se rompía. Una vez en
Android y otra en iPhone.

| # | Qué haces | Qué tiene que pasar |
|---|---|---|
| 1 | Iniciar carrera, andar 2 minutos con la pantalla encendida | Suben los metros y se pintan celdas detrás de ti |
| 2 | Apagar la pantalla con el botón lateral y andar 3 minutos por una calle recta | Android: notificación "CORRR — Carrera en curso". iPhone: indicador azul de ubicación arriba |
| 3 | Encender y desbloquear | Los metros han subido lo andado a oscuras, no siguen donde los dejaste. El rastro de la calle recta está entero, sin corte |
| 4 | Pararte un minuto en un semáforo | Los metros no suben. Sale la pausa automática |
| 5 | Seguir andando | Se reanuda sola |
| 6 | Pulsar STOP | Sale la cartela de zona y, al cerrarla, **el resumen** con km, tiempo y puntos |
| 7 | Abrir Estadísticas | La carrera está, con los mismos km que el resumen |
| 8 | Mirar el mapa | Solo está pintado por donde pasaste. Ninguna cuña entre el inicio y el final |

## Emulador Android (opcional, sin salir de casa)

`apps/mobile/scripts/gps-emulator.sh` hace los pasos 1 a 3 con una ruta
simulada y la pantalla apagada de verdad. Necesita la app con sesión iniciada
y la carrera empezada; al terminar cierra la app sin guardar.
