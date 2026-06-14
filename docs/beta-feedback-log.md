# CORRR — Registro de feedback de la beta cerrada

Documento de trabajo para la solicitud de acceso a producción de Google Play.
Reúne las iteraciones hechas durante la prueba cerrada y el feedback de los
testers que las motivó. **Mantener actualizado durante los 14 días.**

> Para qué sirve: el formulario de acceso a producción pregunta cómo
> reclutamos testers, qué feedback recibimos y qué cambiamos. Tener esto
> documentado permite responder con ejemplos concretos (y aportar pruebas si
> Google las pide).

---

## 1. Reclutamiento de testers

- **Métodos usados**:
  - Comunidad de Telegram "Testers Play Console" (intercambio mutuo, bot).
  - Plataforma web de intercambio de testers (testerscommunity).
  - Amigos / contactos personales corredores (feedback de calidad).
- **Dificultad**: media. El cuello de botella fue que las comunidades con bot
  verifican el link de testing (`/apps/testing/app.corrr`), no el de store
  (404 en pruebas cerradas). Una vez ajustado, el reclutamiento fluyó.
- **Nº de testers**: 12+ opted-in, manteniéndolos activos los 14 días.

---

## 2. Iteraciones publicadas durante la beta

| Fecha | Versión | Cambio | Origen |
|---|---|---|---|
| 2026-06-01 | v1.10.7 / vc43 | Aviso destacado (prominent disclosure) de privacidad de ubicación antes de pedir el permiso de background. | Cumplimiento política Play |
| 2026-06-08 | v1.10.8 / vc44 | Fix: el mapa cargaba en blanco 2-5 s al abrir la app en frío. Ahora carga celdas al instante. | Pruebas internas |
| 2026-06-10 | v1.10.9 / vc45 | Fix: el mapa no se rellenaba de color por completo al terminar una carrera (había que reabrir la app). Fix: icono de la app recortado por los laterales en algunos launchers. | **Feedback de testers** |
| _(pendiente día 7)_ | v1.10.10 / vc46 | Soporte edge-to-edge para Android 15/16 + quitar restricción de orientación en pantallas grandes. | Pre-Launch Report + calidad |

---

## 3. Feedback recibido (ir rellenando)

> Apunta cada reporte real. Si es por WhatsApp/Telegram, guarda el screenshot.

| Fecha | Tester (nombre/alias) | Qué reportó | Canal | ¿Qué cambiamos? | Versión del fix |
|---|---|---|---|---|---|
| 2026-06-10 | (yo, en pruebas) | El mapa no se pone todo naranja tras la carrera hasta reabrir la app | Propio | Mantener celdas locales en la unión (no borrarlas tras loadCells) | v1.10.9 |
| 2026-06-10 | (yo, en pruebas) | El icono "CORRR" sale cortado por los lados en el escritorio | Propio | Escalar contenido del adaptive icon a la safe zone | v1.10.9 |
|  |  |  |  |  |  |
|  |  |  |  |  |  |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

---

## 4. Métodos de recogida de feedback

- Hashtag `#feedback` con captura en el grupo de Telegram de la comunidad.
- Email directo: `hola@corrr.es`.
- Mensajes/audios de WhatsApp de los testers conocidos.

---

## 5. Pruebas guardadas (para si Google las pide)

> Lista aquí las capturas/archivos que tengas guardados como evidencia.

- [ ] Screenshots de los #feedback del Telegram
- [ ] Audios/mensajes de amigos testers
- [ ] (añadir según se recojan)
