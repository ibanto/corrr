# Próximos pasos — investigación de septiembre 2026

Tres temas planteados tras publicar en las dos tiendas. Uno arreglado, dos
investigados con datos reales.

---

## 1. Botón de refrescar fuera de pantalla — ARREGLADO

La cabecera del mapa repartía con `space-between`, pero el bloque del nombre
de ciudad no tenía límite de ancho. Con nombres largos ("Sant Cugat del
Vallès") crecía hasta empujar el botón fuera.

Arreglado: el título cede ancho y se corta con puntos suspensivos; el botón
nunca cede. **Falta verlo en pantalla en la próxima build.**

---

## 2. Contar kilómetros de Strava, Garmin y Apple Watch

La gente lo pide. Investigado el estado real de las tres vías, que es muy
distinto de lo que parece desde fuera.

### Strava — construido, apagado a propósito

**Lo que ya existe** (y sorprende): la integración no solo cuenta
kilómetros, **pinta territorio**. Decodifica el recorrido de la actividad,
lo convierte en celdas con puente continuo y rellena los circuitos cerrados,
exactamente igual que una carrera nativa. Es código completo y funcionando.

Está oculto por una bandera:

```js
// apps/mobile/src/config/features.ts
export const STRAVA_ENABLED = false;
```

Se apagó porque Strava empezó a cobrar. **Cero de 23 usuarios lo tienen
conectado y cero carreras importadas**, no porque falle, sino porque nadie
puede llegar al botón.

**Cómo está el asunto hoy (junio 2026 en adelante):**

| Nivel | Atletas | Coste | Cómo se consigue |
|---|---|---|---|
| Standard | **10 máximo** | Suscripción Strava (11,99 $/mes) | Automático |
| Extended Access | **10.000+** | Sin coste añadido | Solicitud + revisión |

El nivel Standard **no sirve**: con 23 usuarios ya te pasas del tope de 10.

**El camino es solicitar Extended Access.** Es gratis pedirlo, pero lo
revisan uno a uno. Piden que la app "complemente la experiencia de Strava",
cumpla su estándar de calidad y trate los datos según su acuerdo. No aprueban
apps que expongan datos a herramientas de IA.

CORRR encaja razonablemente: añade una capa de juego sobre carreras que ya
existen, no compite con el feed de Strava y no toca IA. **No está
garantizado** — ellos mismos avisan de que "el acceso ampliado no es una
garantía".

### Garmin — cerrado, no perder tiempo

- Solo para **entidades legales** (empresa, universidad, hospital). No hay
  vía para un desarrollador individual.
- El acceso de producción a la Health API tiene una **tasa única de 5.000 $**.
- En 2026 las altas nuevas están **pausadas**.

**Pero no hace falta:** la mayoría de relojes Garmin sincronizan
automáticamente con Strava. Si consigues Extended Access, cubres a los
usuarios de Garmin sin integrar nada de Garmin.

### Apple Watch — la mejor opción, y es la única que depende solo de ti

HealthKit. Sin aprobaciones, sin cuotas, sin que ninguna empresa pueda
decirte que no.

La librería `@kingstinct/react-native-healthkit` expone `getWorkoutRoutes`,
que devuelve **los puntos GPS del entrenamiento** — no solo el resumen. Eso
es justo lo que CORRR necesita: sin recorrido no hay territorio que pintar.
Y trae plugin de Expo, así que encaja con cómo ya se compila la app.

Requiere build propia (no funciona en Expo Go), que ya es lo que hacéis.

### Orden recomendado

1. **Apple Watch / HealthKit.** Nadie te puede bloquear, no cuesta dinero, y
   ahora que estáis en iOS tiene sentido.
2. **Solicitar Extended Access de Strava.** Pedirlo es gratis; mientras lo
   revisan no bloquea nada. Cubre Strava **y** Garmin de una vez.
3. **Garmin directo: descartado** hasta que la app sea una empresa con
   volumen que justifique 5.000 $.

### Un aviso de diseño, antes de programar nada

Importar carreras de fuera **no es lo mismo** que correr en la app:

- Una carrera importada puede robarle celdas a alguien **horas después** de
  haber ocurrido. La víctima recibe una notificación de un robo "del
  pasado". Hay que decidir si eso se avisa, se silencia o se marca distinto.
- La validación anti-trampas está calibrada para carreras en vivo. Un
  recorrido importado tiene otra forma (menos puntos, más espaciados) y
  puede disparar la marca de "geometría inusual" sin ser tramposo.
- Si alguien corre con CORRR **y** con Strava a la vez, la misma carrera
  entra dos veces. Hace falta detectar duplicados por hora y lugar, no solo
  por identificador de Strava.

---

## 3. "La gente liga corriendo" — funciones sociales

La observación es buena y el material ya está medio puesto: en CORRR ves
quién es dueño del territorio de al lado, y existe un canal de mensajes
(los taunts). El salto a lo social es corto.

**Pero hay un orden que no se puede saltar.**

### Lo que falta antes de tocar nada social

CORRR **no tiene forma de bloquear ni de reportar a nadie**. Hoy eso ya es
una exposición: la directriz 1.2 de Apple lo exige para apps con contenido
de usuarios, y el grito de guerra es texto libre que se muestra a los
rivales en el mapa.

Con funciones sociales encima deja de ser un riesgo y pasa a ser un
problema seguro. Y no solo con Apple: **CORRR enseña por dónde corre la
gente**. El territorio de alguien dibuja sus rutas habituales, que salen de
su casa y se repiten a las mismas horas. Montar "conoce gente" sobre eso,
sin poder bloquear a nadie, es poner a tus usuarias en una situación que no
eligieron.

### Orden propuesto

**Fase 0 — obligatoria, antes de cualquier función social**
- Reportar a un usuario (nombre o grito de guerra ofensivo)
- Bloquear: dejar de ver a esa persona y que no pueda mandarte nada
- Un correo de contacto visible para denuncias

Es lo que pide Apple y es lo que hace que lo demás se pueda construir sin
crear un problema.

**Fase 1 — hacer social la rivalidad que ya existe**
La gracia de CORRR ya es social: te roban y quieres revancha. Antes de
inventar nada nuevo, exprimir eso — perfiles con algo de personalidad,
historial de piques con un rival concreto, "tu némesis del mes".

Es más natural que un apartado de contactos, y no expone a nadie: la
relación ya existía porque compartís calles.

**Fase 2 — visibilidad, siempre voluntaria**
Si después se quiere ir a más, la regla es que **nadie aparezca sin
haberlo pedido**. Apagado por defecto, con dos condiciones que no son
negociables:

- Nunca enseñar el territorio de otra persona con precisión suficiente para
  esperarla en la calle
- Nunca revelar horarios ni patrones ("suele correr a las 7:00")

### Lo que yo no haría

Un modo "ligar" explícito. Convierte una app de correr en una app de
citas, con todo lo que eso arrastra: moderación, verificación de edad de
verdad (no una casilla), denuncias, y una categoría en las tiendas mucho
más vigilada.

La gente ya liga en los clubs de running sin que nadie monte un Tinder: lo
que hace falta es **una excusa para coincidir**, no un catálogo de
personas. Y esa excusa, en CORRR, se llama quedada para conquistar un
barrio.
