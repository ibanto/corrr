/**
 * Un servidor de mentira para mirar la app por dentro sin tocar producción.
 *
 * PARA QUÉ: las pantallas de quien ya tiene cuenta —mapa, stats, ranking,
 * retos, perfil— no se ven nunca recién instalada la app, y son justo donde se
 * esconden los fallos. Con esto se arranca la app contra datos inventados y se
 * puede recorrer entera. Así salió que la pantalla de Retos anunciaba las
 * fechas viejas de Halloween (3-oct-2026), que iban escritas dentro de la app
 * y no había forma de corregirlas sin una versión nueva.
 *
 *   node scripts/mock-api.mjs            # datos de sobra
 *   MODO=vacio node scripts/mock-api.mjs # todo a cero: cuenta recién hecha
 *   MODO=campana node scripts/mock-api.mjs # campaña de marca: logos en vez de calabazas. En Retos: uno en marcha,
 *                                          # uno de otra ciudad, uno FINALIZADO con ganadores y otro sin ninguno
 *   SIN_ACTIVOS=1 MODO=campana node scripts/mock-api.mjs # solo los terminados: la pestaña Activos enseña el anuncio
 *   MODO=textos node scripts/mock-api.mjs # además de Tótems y Aura, dos pestañas de vaciles de TEXTO
 *   HALLOWEEN=1 node scripts/mock-api.mjs # la pestaña HALLOWEEN encendida desde el panel (con MODO=vacio sale siempre)
 *
 * Cómo se usa, paso a paso, en el §3 del CLAUDE.md ("Probar la app contra
 * datos de mentira"). Al terminar imprime las rutas que la app pidió y este
 * fichero no sabía contestar: si aparece alguna, es que hay pantalla sin
 * probar.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const MODO = process.env.MODO || 'lleno';
let avisoVisto = false;
let notasVistas = false;   // el cartel sale una vez, como en el servidor de verdad
const vacio = MODO === 'vacio';
// Campaña de marca (1.11.13): Halloween apagado y logos que la app NO lleva
// dentro. El dibujo viene de fuera, como vendrá el de verdad.
const campana = MODO === 'campana';
const textos = MODO === 'textos';
// La pestaña HALLOWEEN del selector (dibujada en la app) se enciende desde el
// panel: apagada, no sale. Con MODO=vacio se enseña, como la app de siempre.
const halloween = vacio || process.env.HALLOWEEN === '1';
const EVENTO = {
  tipo: 'tienda-prueba', nombre: 'el logo de Tienda Prueba',
  imagen: 'https://raw.githubusercontent.com/ibanto/corrr/main/docs/logo.png',
  cartel: '¡TIENDA PRUEBA! +{puntos}', fechas: 'DEL 10 AL 16 DE NOVIEMBRE',
  titulo: 'CAZA EL LOGO DE TIENDA PRUEBA',
  texto: 'Hay logos escondidos por tu barrio. Pisa uno corriendo y son 200 puntos.',
  premio: 'Unas zapatillas para quien más coja. Se recogen en la tienda.',
};
// Cuatro retos para ver la lista: uno en marcha de mi ciudad, uno de otra, y
// dos TERMINADOS (con ganadores y sin ninguno). Los apuntados se guardan
// mientras dure el mock; en los terminados ya no se apunta nadie.
const RETOS = [
  { ...EVENTO, ciudad: 'Madrid', deAqui: true, apuntados: 12 },
  { ...EVENTO, tipo: 'reto-panchito', nombre: 'el logo de Panchito', cartel: '¡PANCHITO! +{puntos}',
    titulo: 'RETO PANCHITO', fechas: 'DEL 17 AL 23 DE NOVIEMBRE', ciudad: 'Bilbao, Barakaldo', deAqui: false, apuntados: 3 },
  { ...EVENTO, tipo: 'reto-zapateria', nombre: 'el logo de La Zapatería', cartel: '¡LA ZAPATERÍA! +{puntos}',
    titulo: 'RETO DE LA ZAPATERÍA', fechas: 'DEL 20 AL 31 DE OCTUBRE', ciudad: 'Madrid', deAqui: true, apuntados: 5,
    finalizado: true, dentro: true, ganadores: [
      { userId: '22222222-2222-2222-2222-222222222222', name: 'Lucía M.', cuantos: 42, puntos: 8400, mine: false },
      { userId: '33333333-3333-3333-3333-333333333333', name: 'carlos', cuantos: 26, puntos: 5200, mine: false },
      { userId: '11111111-1111-1111-1111-111111111111', name: 'Auditor', cuantos: 19, puntos: 3800, mine: true }] },
  { ...EVENTO, tipo: 'reto-desierto', nombre: 'LA TIENDA', titulo: 'CAZA EL LOGO Y GANA EL PREMIO',
    fechas: 'DEL 5 AL 7 DE NOVIEMBRE', premio: 'Un desayuno de campeones', ciudad: 'Madrid', deAqui: true, apuntados: 1,
    finalizado: true, ganadores: [] },
];
if (process.env.SIN_ACTIVOS === '1') RETOS.splice(0, RETOS.length, ...RETOS.filter(r => r.finalizado));
const apuntado = new Set(RETOS.filter(r => r.dentro).map(r => r.tipo));
/** Lo mismo que hace el servidor (`retoParaAppDeAntes`) con las apps de hasta
 *  la 1.11.16, que no piden `?v=2`: el FINALIZADO y los ganadores van dentro
 *  de los textos, y la ciudad delante de las fechas si no es la mía. */
function retoParaAppDeAntes(r) {
  const donde = [r.deAqui ? '' : r.ciudad.toUpperCase(), r.fechas].filter(Boolean).join(' · ');
  if (!r.finalizado) return { ...r, fechas: donde };
  const lista = r.ganadores.map((g, i) => `${i + 1}.º ${g.name} · ${g.cuantos} ${g.cuantos === 1 ? 'logo' : 'logos'}`);
  return { ...r, fechas: ['FINALIZADO', donde].filter(Boolean).join(' · '),
    texto: lista.length
      ? `Este reto ha terminado. Ya no se puede apuntar nadie.\n\n${lista.length === 1 ? 'GANADOR' : 'GANADORES'}\n${lista.join('\n')}`
      : 'Este reto ha terminado sin ganadores: nadie cogió ningún logo.' };
}
const pideV2 = url => /[?&]v=2\b/.test(url);
const YO = '11111111-1111-1111-1111-111111111111';
const RIVAL = '22222222-2222-2222-2222-222222222222';
const ahora = () => new Date().toISOString();
const haceDias = d => new Date(Date.now() - d * 86400000).toISOString();

const CELL_LAT = 10 / 111000, CELL_LNG = 10 / (111000 * Math.cos(40 * Math.PI / 180));
const CY = Math.floor(43.263 / CELL_LAT), CX = Math.floor(-2.935 / CELL_LNG);

const tiras = [];
for (let dy = 0; dy < 60; dy++) tiras.push(0, CY + dy, CX, CX + 70);
for (let dy = 0; dy < 40; dy++) tiras.push(1, CY + 70 + dy, CX + 20, CX + 90);

const sx = (o, v) => (vacio ? o : v);

const RUTAS = {
  'POST /auth/login':  () => ({ accessToken: 'token-de-mentira', userId: YO,
                                user: { id: YO, email: 'audit@local.invalid', username: 'Auditor' } }),
  'GET /users/me': () => ({ id: YO, email: 'audit@local.invalid', display_name: 'Auditor',
    city: sx(null, 'Bilbao'), avatar_url: null, first_name: sx(null, 'Ana'), surname: sx(null, 'Ruiz'),
    war_cry: sx(null, 'A por todas'), shoe_brand: sx(null, 'Asics'), shoe_brand_other: null,
    // Tres campos a medio rellenar A PROPÓSITO (5 de 8 = 63%): con el perfil
    // entero la tarjeta enseña otra cosa y no se prueba lo que se quiere ver.
    // Con MODO=vacio salen los ocho sin rellenar, que es el 0%.
    birth_year: null, gender: null, usual_distance: null,
    weekly_frequency: sx(null, 3), profile_bonus_claimed: false, es_admin: true }),
  'GET /stats/me': () => ({
    stats: { total_zones: sx(0, 412), total_points: sx(0, 18540), total_km: sx(0, 182.4),
             total_runs: sx(0, 37), bonus_xp: sx(0, 120), total_xp: sx(0, 305), total_steals: sx(0, 46) },
    runs: vacio ? [] : [0,1,2,3,4,5].map(i => ({ id: 'run-' + i, distance_km: 6.2 + i, duration_secs: 2100 + i * 60,
      points: 420 + i * 10, zones_count: 12, created_at: haceDias(i * 2), source: i % 2 ? 'healthkit' : 'app' })) }),
  'GET /ranking/global': () => vacio ? [] : [
    { user_id: RIVAL, display_name: 'Lucía M.', city: 'Bilbao', total_points: 28480, total_zones: 87 },
    { user_id: YO, display_name: 'Auditor', city: 'Bilbao', total_points: 18540, total_zones: 41 },
    { user_id: '33333333-3333-3333-3333-333333333333', display_name: 'Dani', city: 'Madrid', total_points: 9120, total_zones: 22 }],
  // Forma de verdad (el servidor devuelve el LÍDER de cada ciudad). Van con
  // acentos y con Valencia repetida de las dos formas: es lo que hay en la base
  // de datos de verdad y es donde se rompe el buscador si está mal hecho.
  'GET /ranking/cities': () => vacio ? [] : [
    { user_id: RIVAL, display_name: 'Lucía M.', city: 'Bilbao', total_points: 51000, total_zones: 120 },
    { user_id: '33333333-3333-3333-3333-333333333333', display_name: 'Dani', city: 'Madrid', total_points: 30200, total_zones: 90 },
    { user_id: '44444444-4444-4444-4444-444444444444', display_name: 'Nerea', city: 'A Coruña', total_points: 12000, total_zones: 40 },
    { user_id: '55555555-5555-5555-5555-555555555555', display_name: 'Pau', city: 'València', total_points: 9000, total_zones: 31 },
    { user_id: '66666666-6666-6666-6666-666666666666', display_name: 'Marc', city: 'Valencia', total_points: 800, total_zones: 4 },
    { user_id: '77777777-7777-7777-7777-777777777777', display_name: 'Leire', city: 'Donostia', total_points: 7400, total_zones: 25 },
    { user_id: '88888888-8888-8888-8888-888888888888', display_name: 'Rocío', city: 'Sevilla', total_points: 6100, total_zones: 19 },
    { user_id: '99999999-9999-9999-9999-999999999999', display_name: 'Jon', city: 'Vigo', total_points: 2200, total_zones: 8 }],
  'GET /ranking/city': (_clave, url) => {
    const city = new URL(url, 'http://x').searchParams.get('city');
    return vacio ? [] : city === 'Bilbao' ? [
      { user_id: RIVAL, display_name: 'Lucía M.', city, total_points: 28480, total_zones: 87 },
      { user_id: YO, display_name: 'Auditor', city, total_points: 18540, total_zones: 41 }] : [
      { user_id: '33333333-3333-3333-3333-333333333333', display_name: 'Dani', city, total_points: 30200, total_zones: 90 }];
  },
  'GET /ranking/podium': () => vacio ? null : ({ weekStart: '2026-09-26', city: 'Bilbao',
    week:    { spain: [{ userId: RIVAL, name: 'Lucía M.', city: 'Bilbao', points: 3200, avatar: null }], city: [] },
    allTime: { spain: [{ userId: RIVAL, name: 'Lucía M.', city: 'Bilbao', points: 28480, avatar: null }], city: [] } }),
  'GET /challenges': () => vacio ? [] : [
    { id: 'c1', title: 'Cierra un círculo', description: 'Vuelve al punto de salida', type: 'shape',
      progress: 1, total: 3, reward: 150, icon: 'map' }],
  'GET /achievements': () => vacio ? [] : [
    { key: 'km10', title: '10 km', description: 'Diez kilómetros en total', icon: 'walk', category: 'distancia',
      target: 10, progress: 10, reward: 50, unlocked: true, unlockedAt: haceDias(9) },
    { key: 'km100', title: '100 km', description: 'Cien kilómetros', icon: 'walk', category: 'distancia',
      target: 100, progress: 82, reward: 200, unlocked: false, unlockedAt: null }],
  'GET /zones/my': () => vacio ? [] : [],
  'GET /zones/nearby': () => [],
  'GET /cells/viewport': () => vacio ? { formato: 'tiras', duenos: [], tiras: [] } : ({
    formato: 'tiras', duenos: [{ id: YO, name: 'Auditor', warCry: 'A por todas', mine: true, color: '#FF5500' },
             { id: RIVAL, name: 'Lucía M.', warCry: 'Nadie me pilla', mine: false, color: '#2E86DE' }],
    tiras, owners: { [YO]: { avatar: null }, [RIVAL]: { avatar: null } } }),
  // Muchas y repartidas por un barrio entero: pocas y separadas nunca llegan a
  // taparse, así que no sirven para probar que se agrupan al alejar el mapa.
  'GET /objetos/viewport': () => vacio ? { objetos: [] } : campana ? ({
    // Solo los logos de los retos a los que me he apuntado.
    objetos: RETOS.filter(r => apuntado.has(r.tipo)).flatMap((r, n) => Array.from({ length: 20 }, (_, i) => ({
      id: 300 + n * 100 + i, x: CX - 60 + ((i * 37) % 130) + n * 7, y: CY - 50 + ((i * 53) % 120) + n * 5,
      puntos: 200, tipo: r.tipo,
    }))),
    tipos: Object.fromEntries(RETOS.map(r => [r.tipo, { imagen: r.imagen, cartel: r.cartel, nombre: r.nombre }])),
  }) : ({ objetos: [
    ...Array.from({ length: 46 }, (_, i) => ({
      id: 100 + i,
      x: CX - 60 + ((i * 37) % 130),
      y: CY - 50 + ((i * 53) % 120),
      puntos: 200,
      tipo: 'calabaza',
    })),
    // Fantasmas pegados a las calabazas, uno de cada premio, para ver que los
    // tres se dibujan EXACTAMENTE igual: si se distinguieran, adiós al juego.
    { id: 200, x: CX + 13, y: CY + 14, puntos: 500, tipo: 'fantasma' },
    { id: 201, x: CX + 19, y: CY + 24, puntos: -1000, tipo: 'fantasma' },
    { id: 202, x: CX + 25, y: CY + 16, puntos: 0, tipo: 'fantasma' },
  ] }),
  'GET /objetos/ranking': (_clave, url) => {
    if (vacio) return { ranking: [], mias: 0 };
    // La de un reto terminado es su clasificación final: los ganadores y dos
    // más. A las apps de antes (sin `v=2`) no se les manda la tabla.
    const acabado = campana && RETOS.find(r => r.finalizado && url.includes('tipo=' + r.tipo));
    if (acabado) return { mias: acabado.ganadores.length ? 19 : 0, ranking: !pideV2(url) || !acabado.ganadores.length ? [] : [
      ...acabado.ganadores,
      { userId: '44444444-4444-4444-4444-444444444444', name: 'Oriol15', cuantos: 19, puntos: 3800, mine: false },
      { userId: '55555555-5555-5555-5555-555555555555', name: 'Marta', cuantos: 5, puntos: 1000, mine: false }] };
    return { mias: 7, ranking: [
      { userId: RIVAL, name: 'Lucía M.', cuantos: 14, puntos: 700, mine: false },
      { userId: YO, name: 'Auditor', cuantos: 7, puntos: 350, mine: true }] };
  },
  'GET /app/ajustes': () => ({ halloween: !vacio && !campana, halloween_para: null }),
  // Con MODO=vacio no hay anuncio: así se ve el «Próximamente» de siempre.
  'GET /app/retos': (_clave, url) => ({ retos: campana
    ? RETOS.map(({ dentro: _dentro, ...r }) => ({ ...r, apuntado: apuntado.has(r.tipo),
        apuntados: r.apuntados + (apuntado.has(r.tipo) && !r.finalizado ? 1 : 0) }))
      .map(r => pideV2(url) ? r : retoParaAppDeAntes(r))
    : [], proximamente: vacio ? null : {
    titulo: 'GRAN RETO\nDE NAVIDAD', destacado: '¡CON PREMIO!', texto: 'Muy pronto, aquí. Ve calentando.' } }),
  'GET /app/aviso': () => (vacio || avisoVisto) ? { aviso: null } : ({ aviso: { id: 9, titulo: 'Llega Halloween',
    texto: 'Del *23 de octubre* al *1 de noviembre* salen calabazas por toda la ciudad.',
    imagen: null, boton: 'Ver el mapa', enlace: null, etiqueta: 'Evento', sello: 'Nuevo', nota: '50 puntos\ncada una' } }),
  'GET /app/notificaciones': () => vacio ? { notificaciones: [], sinVer: 0 } : ({ sinVer: notasVistas ? 0 : 2, notificaciones: [
    { id: 1, titulo: 'Te han robado', quien: 'Lucía M.', nota: '\u22121240\nCELDAS', sello: 'Robo',
      texto: 'Lucía M. se ha quedado *1.240 celdas* tuyas. Lo que queda dentro de un cerco cambia de dueño: ve a recuperarlo.', creado_at: haceDias(0), vista: false },
    { id: 2, titulo: 'Te han cercado', quien: 'Lucía M.', nota: '\u2212800\nCELDAS', sello: 'Cercado',
      texto: 'Lucía M. ha rodeado tu zona y se ha quedado *800 celdas* tuyas. Lo que queda dentro de un cerco cambia de dueño: ve a recuperarlo.', creado_at: haceDias(1), vista: false },
    { id: 3, titulo: 'Cerco cobrado', nota: '+4100\nCELDAS', sello: 'Territorio',
      texto: 'Ya vale cerrar una zona *entre varios días*: lo que rodea tu territorio es tuyo. Acabas de cobrar *4.100 celdas* y *6.200 puntos*.', creado_at: haceDias(4), vista: true },
    // Una vieja, de antes de que se guardara el sello: tiene que verse igual
    // de bien, solo que sin el número grande.
    { id: 4, titulo: 'Territorio devuelto', texto: 'Se te ha devuelto el territorio que te quitó una carrera mal registrada.', creado_at: haceDias(9), vista: true }] }),
  'GET /robos': () => vacio ? [] : [
    { id: 'r1', run_id: 'run-1', created_at: haceDias(0), ladron_id: RIVAL, ladron: 'Lucía M.', contestado: false },
    { id: 'r2', run_id: null, created_at: haceDias(5), ladron_id: RIVAL, ladron: 'Lucía M.', contestado: true }],
  // La app espera { taunts: [...] }, como contesta el servidor de verdad.
  'GET /taunts/unread': () => ({ taunts: vacio ? [] : [
    { id: 't1', mode: 'taunt', taunt_id: 3, run_id: null, created_at: haceDias(0), from_user_id: RIVAL, from_user_name: 'Lucía M.' },
    // Un vacile de una pestaña del panel (§9-sexies): la app no lleva su
    // dibujo, le llega el texto ya con el nombre de quien lo recibe.
    { id: 't2', mode: 'response', taunt_id: 1004, run_id: null, created_at: haceDias(0), from_user_id: RIVAL, from_user_name: 'Lucía M.',
      texto: 'Jo, jo, jo, Auditor. Esa calle ahora es mía.', pestana: 'Navidad' },
    // Y uno de CARTELES: llega con la dirección del cartel entero.
    { id: 't3', mode: 'taunt', taunt_id: 2003, run_id: null, created_at: haceDias(0), from_user_id: RIVAL, from_user_name: 'Lucía M.',
      texto: 'ninja rosa', pestana: 'Tótems', imagen: CARTEL(2003) }] }),
  // Las pestañas de vaciles escritas desde el panel (§9-sexies). Con
  // MODO=vacio no hay ninguna: el selector enseña solo Clásicos y Halloween.
  'GET /app/vaciles': () => ({ pestanas: vacio ? [] : [
    ...(textos ? [
    { id: 1, nombre: 'Navidad', mensajes: [
      { id: 1001, texto: 'Feliz Navidad, {nombre}. Tu calle ya es mía.' },
      { id: 1002, texto: 'Eh {nombre}, esa calle era mía. Voy a por ti.' },
      { id: 1003, texto: 'Te la devuelvo en Reyes. O no.' },
      { id: 1005, texto: 'Un mensaje largo de los de ciento cuarenta letras, para ver que el texto se encoge hasta caber en la tarjeta sin comerse ni una palabra.' }],
      respuestas: [{ id: 1004, texto: 'Jo, jo, jo, {nombre}. Esa calle ahora es mía.' }] },
    { id: 2, nombre: 'Picantes', mensajes: [{ id: 1006, texto: 'Corres como mi abuela.' }, { id: 1007, texto: '¿Eso era correr o pasear al perro?' }], respuestas: [] },
    ] : []),
    // Las pestañas de CARTELES de Iban (Tótems y Aura): los PNG se sirven desde
    // las carpetas de la app por /vaciles/imagen/<id>.png, como hace el servidor.
    { id: 3, nombre: 'Tótems', tipo: 'imagen', mensajes: mensajesDe(COLECCIONES[0], false), respuestas: mensajesDe(COLECCIONES[0], true) },
    { id: 4, nombre: 'Aura', tipo: 'imagen', mensajes: mensajesDe(COLECCIONES[1], false), respuestas: mensajesDe(COLECCIONES[1], true) },
  ], dibujadas: { halloween } }),
  'GET /taunts': () => [],
  'GET /friends': () => vacio ? [] : [{ user_id: RIVAL, display_name: 'Lucía M.', city: 'Bilbao', total_points: 28480, total_zones: 87 }],
  'GET /friends/pending': () => vacio ? [] : [{ id: 'fr1', sender_id: RIVAL, sender_name: 'Lucía M.', created_at: haceDias(1) }],
  'GET /admin/resumen': () => ({ accesosDesde: haceDias(4),
    hoy: { carreras: 6, corredores: 5, han_abierto: 11, altas: 1 },
    // Siete días con uno a cero en medio: si el día vacío se cayera de la lista,
    // las barras mentirían y no se notaría.
    dias: [['-6',4],['-5',7],['-4',0],['-3',9],['-2',5],['-1',11],['0',6]].map(([d, n]) => ({
      dia: new Date(Date.now() + Number(d) * 86400000).toISOString().slice(0, 10),
      carreras: n, gente: Math.max(1, Math.round(n / 2)),
    })),
    quienes: {
      corrieron: [{ nombre: 'Lucía M.', carreras: 2, km: '12.4' }, { nombre: 'Dani', carreras: 1, km: '8.0' },
                  { nombre: 'Auditor', carreras: 1, km: '5.1' }, { nombre: 'Nerea', carreras: 1, km: '0.9' }],
      robos: [{ ladron: 'Lucía M.', victima: 'Auditor', veces: 3 }, { ladron: 'Dani', victima: 'Lucía M.', veces: 1 }],
      altas: [{ nombre: 'Jon', ciudad: 'Vigo' }],
      abrieron: ['Lucía M.', 'Dani', 'Auditor', 'Nerea', 'Pau', 'Leire', 'Rocío', 'Jon'],
    },
    semana: { altas: 3, carreras: 41, km: '312.4', celdas: 128400 },
    gente: { total: 46, sin_estrenar: 7, dormidos: 9, activos_semana: 18 },
    avisosActivos: 1, correos: [{ campana: 'reactivacion', enviados: 12, salieron: 11 }],
    carrerasMarcadas: 2, flojos: [{ nombre: 'Pepe', ultimaCarrera: haceDias(20), ultimoAcceso: haceDias(12) }],
    porPlataforma: [{ plataforma: 'ios', n: 25 }, { plataforma: 'android', n: 21 }] }),
  'GET /app/version': () => ({ platform: 'android', latestVersion: '1.11.11', latestVersionCode: 76,
                               minVersion: '1.0.0', updateUrl: 'https://play.google.com/store/apps/details?id=app.corrr' }),
};

const DINAMICAS = [
  [/^GET \/users\/[^/]+\/ficha$/, () => ({ id: RIVAL, name: 'Lucía M.', city: 'Bilbao', warCry: 'Nadie me pilla',
     avatar: null, zonas: 87, km: 410.2, carreras: 61, puntos: 28480, hectareas: 12.4, racha: 5, mine: false })],
  [/^GET \/territory\//, () => ({ duenos: [], tiras: [] })],
  // Una carrera guardada: 3,46 km que cierra un cerco y se topa. Sirve para
  // mirar que el resumen enseña el cerco, el tope y las calabazas por fuera.
  [/^POST \/runs$/, () => ({
    runId: 'run-prueba', stolenZones: [], stolenCells: [], newCellCount: 53,
    points: 6620,
    breakdown: {
      kmPoints: 42, cellPoints: 53, newCells: 53, stolenCells: 385,
      loopBonus: 50, streakMultiplier: 1.5, pbMultiplier: 1.2, streakDays: 3, beatPB: true,
      objetos: 4, puntosObjetos: -300,
      calabazas: 1, puntosCalabazas: 200,
      fantasmas: [500, 0, -1000], puntosFantasmas: -500,
      cercadas: 3480, puntosCerco: 3480,
      tope: 6920, topeAplicado: true, puntosBrutos: 7911,
    },
  })],
  [/^POST \/app\/retos\/[^/]+\/apuntarme$/, (clave) => { apuntado.add(clave.split('/')[3]); return { ok: true }; }],
  [/^DELETE \/app\/retos\/[^/]+\/apuntarme$/, (clave) => { apuntado.delete(clave.split('/')[3]); return { ok: true }; }],
  [/^POST \/app\/notificaciones\/vistas$/, () => { notasVistas = true; return { ok: true }; }],
  [/^POST \/app\/aviso\/\d+\/visto$/, () => { avisoVisto = true; return { ok: true }; }],
  [/^POST \//, () => ({ ok: true })],
  [/^PUT \//, () => ({ ok: true })],
  [/^DELETE \//, () => ({ ok: true })],
];

// Los carteles de las pestañas de carteles: id impar = provocación, par =
// respuesta. Tótems (2001-2010) salen de assets/taunts/vaciles y Aura
// (2011-2020) de assets/taunts/AURA, cada carpeta con su forma de nombrar.
const CARPETA_TAUNTS = new URL('../assets/taunts/', import.meta.url).pathname;
const COLECCIONES = [
  { carpeta: 'vaciles/', primerId: 2001,
    nombres: ['lobo_naranja', 'ninja_rosa', 'sombra_azul', 'corona_amarilla', 'soldado_verde'],
    archivo: (n, provocacion, nombre) => `${n}_${provocacion ? '01_PROVOCACION' : '02_RESPUESTA'}_${nombre}.png` },
  { carpeta: 'AURA/', primerId: 2011,
    nombres: ['naranja_modo_facil', 'rosa_estrategia', 'azul_hablas_mucho', 'amarillo_rankings', 'verde_silencio'],
    archivo: (n, provocacion, nombre) => `${n}_${provocacion ? 'PROVOCACION' : 'RESPUESTA'}_${nombre}.png` },
];
const CARTEL = (id, mini = false) => `http://localhost:8787/vaciles/imagen/${id}${mini ? '-v.jpg' : '.png'}?v=1`;
const mensajesDe = (c, respuestas) => c.nombres.map((nombre, i) => {
  const id = c.primerId + i * 2 + (respuestas ? 1 : 0);
  return { id, texto: nombre.replace(/_/g, ' '), imagen: CARTEL(id), miniatura: CARTEL(id, true) };
});
DINAMICAS.unshift([/^GET \/vaciles\/imagen\/\d+(-v)?\.(png|jpg)$/, (clave) => {
  const id = Number(clave.match(/\/(\d+)/)[1]);
  const c = COLECCIONES.find(x => id >= x.primerId && id < x.primerId + x.nombres.length * 2);
  if (!c) return {};
  const i = Math.floor((id - c.primerId) / 2);
  // La miniatura es el mismo PNG: para mirar la app vale.
  return { __archivo: `${CARPETA_TAUNTS}${c.carpeta}${c.archivo(String(i + 1).padStart(2, '0'), (id - c.primerId) % 2 === 0, c.nombres[i])}`, tipo: 'image/png' };
}]);

const vistas = new Set(); const perdidas = new Set();
createServer((req, res) => {
  const [ruta] = req.url.split('?');
  const clave = `${req.method} ${ruta}`;
  vistas.add(clave);
  let fn = RUTAS[clave];
  if (!fn) fn = (DINAMICAS.find(([re]) => re.test(clave)) || [])[1];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!fn) { perdidas.add(clave); console.log('  ✗ SIN MOCK', clave); res.writeHead(404); return res.end('{}'); }
  console.log('  ·', clave);
  let cuerpo; try { cuerpo = fn(clave, req.url); } catch (e) { console.log('   ERROR en el mock:', e.message); cuerpo = {}; }
  if (cuerpo && cuerpo.__archivo) {
    // Un archivo tal cual (los carteles de los vaciles), no JSON.
    res.setHeader('Content-Type', cuerpo.tipo);
    res.writeHead(200); return res.end(readFileSync(cuerpo.__archivo));
  }
  res.writeHead(200); res.end(JSON.stringify(cuerpo));
}).listen(8787, '0.0.0.0', () => console.log(`mock-api en :8787 (modo ${MODO})`));

process.on('SIGINT', () => { console.log('\nsin mock:', [...perdidas].join(', ') || 'ninguna'); process.exit(0); });
