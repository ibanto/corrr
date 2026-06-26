/** Flags de funcionalidades que se pueden activar/desactivar SIN borrar código.
 *
 *  STRAVA_ENABLED: Strava ha pasado a cobrar por el uso de su API, así que de
 *  momento ocultamos la integración de los puntos de entrada visibles (botón
 *  "Connect with Strava" en login/registro y la sección de Strava en Perfil).
 *  TODO el flujo OAuth (handlers, modos strava-signup/strava-link, endpoints,
 *  deep links) queda INTACTO — solo se ocultan los botones que lo inician, así
 *  que nadie puede llegar a él. Para reactivar Strava: poner esto en `true`.
 */
export const STRAVA_ENABLED = false;
