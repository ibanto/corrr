# Strava Extended Access — paso a paso

Objetivo: que las carreras que la gente hace con Strava (y con Garmin, que
sincroniza a Strava) cuenten en CORRR y pinten territorio.

**La buena noticia:** el código ya está hecho. La integración no solo cuenta
kilómetros, decodifica el recorrido y pinta celdas igual que una carrera
nativa. Solo está oculta tras una bandera.

**Lo que hay que conseguir:** capacidad para más de 10 atletas.

---

## EL ORDEN IMPORTA — no te saltes pasos

Strava lo dice literalmente en el formulario:

> *"Exigimos que las apps hayan alcanzado el límite de 10 atletas del nivel
> Standard antes de revisar solicitudes de capacidad adicional. **Las
> solicitudes que no cumplan ese umbral serán denegadas.**"*

Si mandas el formulario hoy, con 0 atletas conectados, te lo deniegan y
quemas la solicitud. La secuencia es:

```
1. Suscripción Strava + subir a Standard  (tú, 10 min)
2. Encender la integración en la app       (yo, + build)
3. Conseguir 10 usuarios conectados        (tú, días)
4. AHORA sí: mandar el formulario          (tú, 20 min)
5. Esperar respuesta                       (Strava)
```

---

## PASO 1 — Suscripción y subida a Standard

Lo haces tú, hoy, y no depende de nadie.

1. Necesitas **suscripción de Strava activa** (11,99 $/mes). Es la
   suscripción normal, no una tarifa aparte de desarrollador.
2. Entra en **https://www.strava.com/settings/api**
3. Ahí verás tu app ya registrada (la que genera vuestro `STRAVA_CLIENT_ID`).
4. **Súbete a Standard** desde ese panel. Es automático, sin revisión.

Con eso pasas de **1 atleta** (el límite por defecto, que es la razón real de
que esto nunca haya funcionado) a:

- **10 atletas**
- 400 peticiones cada 15 minutos
- 4.000 peticiones al día

De paso, **verifica en ese panel**:

- El **dominio de callback** de la autorización, que debe apuntar a vuestro
  backend de Railway. Si está mal, el botón de conectar falla.
- Apunta el **Client ID**, que hace falta en el formulario del paso 4.

## PASO 2 — Encender la integración (esto lo hago yo)

Cuando me confirmes que ya estás en Standard:

- Cambiar `STRAVA_ENABLED` a `true` en `apps/mobile/src/config/features.ts`.
  Eso devuelve el botón "Connect with Strava" al perfil y al alta.
- Añadir el enlace **"View on Strava"** en las carreras importadas. Las
  normas de marca de Strava piden enlazar de vuelta al original cuando
  muestras una actividad suya, y el formulario te hace confirmar que las has
  revisado.
- Registrar la **suscripción al webhook** de Strava. Sin ella, aunque la
  gente conecte su cuenta, las carreras nuevas no llegan solas. Hay un
  endpoint de administración para hacerlo una vez.
- Sacar build de Android y de iOS con eso dentro.

**No enciendas esto antes del paso 1.** Con el límite por defecto de 1
atleta, el primero conecta y a los demás les falla — y la primera impresión
te la cargas.

## PASO 3 — Conseguir 10 atletas conectados

Tienes 23 usuarios: no necesitas a nadie de fuera.

Cuando salga la build, un mensaje a los que corren de verdad:

```
Novedad: ya puedes conectar tu Strava a CORRR.

A partir de ahora, las carreras que hagas con Strava o con
tu reloj cuentan solas — se pintan en el mapa y conquistan
territorio sin que tengas que abrir CORRR para correr.

Está en Perfil → Conectar con Strava. Tarda diez segundos.
```

**Necesitas exactamente 10.** Ni 9. Con 9 te deniegan la solicitud.

Comprueba cuántos llevas pidiéndome el recuento, o desde el panel de Strava.

## PASO 4 — El formulario

Está en:
**https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8**

### Campos sencillos

| Campo | Qué poner |
|---|---|
| First name | Iban |
| Last name | García-Castrillón |
| Email Address | hola@corrr.es (revisa que no filtre a spam los correos de `developers@strava.com`) |
| Company Name | Tu nombre o razón social, si no tienes empresa |
| API Application Name | CORRR |
| Strava Client ID | El del panel de Strava del paso 1 |
| Additional Apps | Vacío, si solo tienes una |
| Number of Currently Authenticated Users | **10** (el número real, y tiene que ser 10) |
| Number of Intended Users | 5000 |
| Support URL | https://ibanto.github.io/corrr/ |

Sobre "Intended Users": pon una cifra creíble para un año. Ellos avisan de
que "la capacidad aprobada puede ser menor que la solicitada", así que pedir
un millón no ayuda y resta credibilidad.

### Application Description — el campo que decide

Es el único que leen con atención. Pega esto:

```
CORRR is a running app that turns each run into map territory.

The world is divided into a grid of 10x10 metre cells. When a
runner's GPS track passes through a cell, that cell becomes
theirs on a shared map, and closing a loop captures the area
inside it. Running over cells owned by another runner takes
those cells from them. The goal is motivation: the reward for
going out is visible territory and friendly rivalry with people
running the same streets.

HOW WE USE STRAVA DATA

Only for athletes who explicitly connect their own account.
When an authenticated athlete records a run in Strava, we
receive the webhook, fetch that single activity and use its
summary polyline to compute which map cells the route crossed.
We store the resulting cells, plus distance and duration, so
the run counts towards that athlete's own territory and score.

We do not access data belonging to athletes who have not
authorised us. We do not aggregate, compare or resell athlete
data. We do not use any Strava data to train, fine-tune or
prompt AI models, and we have no AI features. Data is used
solely to render that athlete's own territory inside CORRR.

Athletes can disconnect Strava at any time from their profile,
and can delete their CORRR account and all associated data from
inside the app.

WHY IT COMPLEMENTS STRAVA

We do not replicate Strava's feed, social graph or analytics.
CORRR gives runners an extra reason to go out and run, and every
one of those runs is still recorded in Strava. Runners who use a
Garmin or another watch already sync to Strava, so this
integration is what lets them play without changing how they
record their training.

CURRENT STATUS

Published on Google Play and the App Store. The app is free,
with no purchases, subscriptions or advertising.
```

### Las tres casillas

Marca las tres, pero **léelas antes de marcarlas**:

- **API Agreement**
- **API Policy**
- **Brand Guidelines**

Lo relevante de las normas de marca para CORRR:

- Usar los botones oficiales de "Connect with Strava" — **ya los tenéis** en
  `assets/`
- No usar "Strava" en el nombre de la app — **cumplido**, se llama CORRR
- Al mostrar una actividad importada, enlazar con **"View on Strava"** —
  esto es lo que falta y lo añado en el paso 2

### App Images — no lo despaches

> *"Provide screenshots of ALL places Strava data is shown in your
> application. Submissions without complete photos can cause a delay."*

Necesitas capturas de:

1. El botón "Connect with Strava" en Perfil
2. La pantalla de autorización, para que se vea que usáis el flujo oficial
3. El mapa con territorio venido de una carrera importada
4. La ficha de una carrera importada, con el enlace "View on Strava"
5. La lista de carreras donde aparece una importada

Hazlas cuando la build del paso 2 esté funcionando y tengas una carrera
importada de verdad. Con capturas de algo que no funciona todavía, se nota.

## PASO 5 — Esperar

No hay plazo publicado. Cuentan de **días a semanas**.

Mientras tanto la app sigue funcionando con 10 atletas conectados, así que
no bloquea nada.

**Si te lo deniegan**, pregunta por qué respondiendo al correo: suele ser
algo concreto y arreglable, no un "no" definitivo.

---

## Lo que hay que decidir antes de encender

Importar carreras de fuera no es lo mismo que correr en la app, y hay tres
decisiones de producto que conviene tomar a propósito:

**1. Los robos con retraso.** Una carrera importada puede quitarle celdas a
alguien horas después de haber ocurrido. La víctima recibirá una
notificación de un robo "del pasado". Opciones: avisar igual, no avisar de
importadas, o avisar con otro texto ("te robaron territorio esta mañana").

**2. Carreras duplicadas.** Si alguien corre con CORRR **y** con Strava a la
vez, la misma carrera entra dos veces: una en vivo y otra importada. La
idempotencia actual solo mira el identificador de Strava, que no detecta
esto. Hace falta descartar por coincidencia de hora y lugar.

**3. El anti-trampas.** Está calibrado para carreras en vivo. Un recorrido
importado tiene menos puntos y más espaciados, así que puede saltar la marca
de "geometría inusual" sin que nadie haga trampa. Ahora eso solo marca, no
rechaza, pero conviene mirarlo cuando entren las primeras.

---

## Resumen de quién hace qué

| Paso | Quién | Cuándo |
|---|---|---|
| Suscripción + subir a Standard | Tú | Hoy |
| Verificar callback y apuntar Client ID | Tú | Hoy |
| Encender bandera + "View on Strava" + webhook | Yo | Cuando confirmes el paso 1 |
| Builds de Android e iOS | Yo | Después |
| Conseguir 10 conectados | Tú | Días |
| Capturas de pantalla | Tú | Con la build funcionando |
| Formulario | Tú | Con 10 conectados, ni uno menos |
