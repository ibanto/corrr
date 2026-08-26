# App Store Listing — CORRR (iOS)

Adaptado desde `google-play-listing.md`. Ojo: los límites y las reglas de
Apple NO son los de Google, así que el texto no se puede copiar tal cual.

---

## Nombre (30 caracteres máx.)

```
CORRR: conquista tu ciudad
```
*(26 caracteres. En Play es "CORRR — Conquista tu ciudad", pero Apple corta a
30 y el guion largo gasta espacio sin aportar.)*

---

## Subtítulo (30 caracteres máx.)

```
Corre, cierra rutas, domina
```
*(27 caracteres. Aparece bajo el nombre en resultados de búsqueda; Play no
tiene este campo. Es de lo más leído de la ficha.)*

---

## Palabras clave (100 caracteres máx., separadas por comas, SIN espacios)

```
correr,running,territorio,zonas,gps,carrera,mapa,conquista,ranking,reto,rutas,km
```
*(80 caracteres.)*

Reglas de Apple que conviene no olvidar:
- NO repitas palabras que ya están en el nombre o el subtítulo: Apple indexa
  ambos campos, así que repetir desperdicia caracteres.
- NO uses nombres de la competencia (Strava, Nike…). Es motivo de rechazo.
- Sin espacios tras las comas: cada espacio cuenta como carácter.
- El plural no hace falta si tienes el singular en la mayoría de casos.

---

## Descripción (4000 caracteres máx.)

```
CORRR convierte cada carrera en una batalla por el territorio de tu ciudad.

Cada calle que pisas se pinta de tu color. Y lo que es tuyo, otro corredor
puede quitártelo.


SAL A CORRER Y CONQUISTA

Empieza a correr y traza tu ruta por las calles. Cuando cierras un circuito
—vuelves sobre tus pasos— todo el terreno que has encerrado pasa a ser tuyo.
Cuanto más grande el área, más puntos.


ROBA A TUS RIVALES

Si tu ruta pisa la zona de otro corredor, se la quitas. Y cuando alguien te
roba a ti, te llega un aviso al instante con el nombre del culpable. Puedes
devolvérsela con un mensaje de los diez que hay para picarse.


COMPITE EN EL RANKING

Escala posiciones en el ranking de tu ciudad y en el nacional. Cada zona
conquistada y cada kilómetro suman. Quien domina más territorio, manda.


PRESUME DE LO TUYO

Al terminar cada carrera puedes compartir una tarjeta con lo que has
conquistado y a quién se lo has robado, lista para tus historias.


IMPORTA DESDE STRAVA

Conecta tu cuenta e importa tus carreras automáticamente. Tu histórico se
convierte en territorio.


ESTADÍSTICAS COMPLETAS

Kilómetros, carreras, zonas, puntos y racha de días seguidos. Tu progreso
semana a semana.


QUÉ INCLUYE

- Mapa en tiempo real con GPS de alta precisión
- Conquista de territorio cerrando circuitos
- Robo de zonas entre corredores
- Avisos cuando alguien te quita territorio
- Mensajes para picarse con tus rivales
- Ranking nacional y por ciudad
- Tarjetas para compartir en redes
- Integración con Strava
- Funciona con la pantalla apagada


CORRR es gratis. Sal a correr y demuestra quién manda en tu barrio.
```

---

## Texto promocional (170 caracteres máx.)

```
Nuevo: comparte tus conquistas en historias y pícate con quien te robe
territorio. Además, mejoras importantes de precisión del GPS.
```

*Campo que Play no tiene. Se puede cambiar SIN pasar por revisión, así que
sirve para anunciar novedades o campañas sobre la marcha.*

---

## Novedades de esta versión (4000 caracteres máx.)

```
Arreglos importantes de GPS: se acabaron las carreras que no contaban o que
se pausaban solas nada más empezar.

Al cerrar un circuito ahora sí se rellena todo el interior.

Nuevo: comparte tus conquistas con una tarjeta diseñada, con frase de pique
incluida.

Los avisos de robo y los mensajes de rivales llegan al instante.
```

---

## Categorías

- **Principal**: Salud y forma física
- **Secundaria**: Deportes

---

## URLs

- **Soporte** (obligatoria): https://ibanto.github.io/corrr/
- **Marketing** (opcional): https://ibanto.github.io/corrr/
- **Política de privacidad** (obligatoria): https://ibanto.github.io/corrr/privacy.html

---

## Clasificación por edades

Responder NO a todo el cuestionario salvo lo siguiente, que hay que
declarar con honestidad porque la app lo tiene:

- **Contenido generado por usuarios / interacción entre usuarios**: SÍ. Los
  corredores se envían mensajes (los taunts). Aunque son imágenes cerradas de
  un catálogo y no texto libre, es interacción entre usuarios.
- **Comparte la ubicación del usuario con otros usuarios**: SÍ, indirectamente
  —el territorio conquistado es visible en el mapa para los demás.

Resultado esperado: **4+**, o **12+** si la interacción se valora al alza.

---

## Etiquetas de privacidad (App Privacy)

Apple exige declarar CADA dato recogido, para qué y si se vincula a la
identidad del usuario. Lo que aplica a CORRR:

### Ubicación
- **Ubicación precisa** — Vinculada al usuario. NO se usa para rastrear (*).
  - Finalidad: **Funcionalidad de la app**
  - Es el dato central: sin él no hay producto.

### Salud y forma física
- **Forma física** — Vinculada al usuario. Distancia, duración y ritmo.
  - Finalidad: **Funcionalidad de la app**

### Información de contacto
- **Correo electrónico** — Vinculado al usuario.
  - Finalidad: **Funcionalidad de la app** (login, recuperar contraseña)

### Identificadores
- **ID de usuario** — Vinculado al usuario.
  - Finalidad: **Funcionalidad de la app**

### Contenido del usuario
- **Fotos** — Vinculado al usuario (avatar de perfil, opcional).
  - Finalidad: **Funcionalidad de la app**

(*) Sobre "usado para rastrear": responder que NO. En terminología de Apple,
"tracking" significa cruzar los datos con los de terceros para publicidad.
CORRR no hace eso. Que la app registre por dónde corres NO es "tracking" en
este sentido.

**Lo que NO hay que declarar**: no hay analítica de terceros, ni publicidad,
ni compras. Si algún día se añade Sentry/Crashlytics, habrá que volver aquí y
declarar datos de diagnóstico.

---

## Notas para el revisor de Apple

Campo "Notas" del envío. Importante rellenarlo bien con una app de ubicación
en segundo plano: es lo que evita idas y venidas.

```
CORRR es una app de running con captura de territorio. El usuario corre por
la calle y las calles que pisa se convierten en territorio suyo en un mapa
compartido con el resto de corredores.

UBICACIÓN EN SEGUNDO PLANO
La app necesita ubicación en segundo plano porque el recorrido debe seguir
registrándose con la pantalla apagada o con el móvil en el bolsillo, que es
el uso normal al correr. Sin ella el recorrido se cortaría y la carrera no
se registraría. Se pide solo al iniciar una carrera y se detiene al
terminarla.

CÓMO PROBARLA
Se puede crear una cuenta con cualquier email. Para ver el registro de
recorrido hace falta moverse físicamente o simular una ruta en el simulador
(Debug > Simulate Location > City Run). Una carrera necesita al menos 50
metros y 5 celdas para guardarse.

CUENTA DE PRUEBA
Email: applereview@corrr.es
Contraseña: CorrrReview2026

SIN COMPRAS
La app es totalmente gratuita. No hay compras integradas ni suscripciones.
```

---

## Pendiente / riesgos conocidos

- **Pestaña "Retos"**: es un placeholder "PRÓXIMAMENTE". Puede provocar
  rechazo por la directriz 2.1 (App Completeness). Riesgo asumido de forma
  consciente en el primer envío.
- **Premium**: oculto en iOS desde la v1.11.0. Mostraba un precio de
  suscripción sin compra integrada, lo que choca con la directriz 3.1.1. Si
  algún día se monetiza en iOS, hay que implementarlo con StoreKit.
