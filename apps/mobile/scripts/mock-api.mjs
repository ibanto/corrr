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
 *
 * Cómo se usa, paso a paso, en el §3 del CLAUDE.md ("Probar la app contra
 * datos de mentira"). Al terminar imprime las rutas que la app pidió y este
 * fichero no sabía contestar: si aparece alguna, es que hay pantalla sin
 * probar.
 */
import { createServer } from 'node:http';

const MODO = process.env.MODO || 'lleno';
let avisoVisto = false;
let notasVistas = false;   // el cartel sale una vez, como en el servidor de verdad
const vacio = MODO === 'vacio';
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
    birth_year: sx(null, 1987), gender: sx(null, 'mujer'), usual_distance: sx(null, 10),
    weekly_frequency: sx(null, 3), profile_bonus_claimed: !vacio, es_admin: true }),
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
  'GET /ranking/city': () => vacio ? [] : [
    { user_id: RIVAL, display_name: 'Lucía M.', city: 'Bilbao', total_points: 28480, total_zones: 87 },
    { user_id: YO, display_name: 'Auditor', city: 'Bilbao', total_points: 18540, total_zones: 41 }],
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
  'GET /objetos/viewport': () => vacio ? { objetos: [] } : ({ objetos: [
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
  'GET /objetos/ranking': () => vacio ? { ranking: [], mias: 0 } : ({ mias: 7, ranking: [
    { userId: RIVAL, name: 'Lucía M.', cuantos: 14, puntos: 700, mine: false },
    { userId: YO, name: 'Auditor', cuantos: 7, puntos: 350, mine: true }] }),
  'GET /app/ajustes': () => ({ halloween: !vacio, halloween_para: null }),
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
  'GET /taunts/unread': () => vacio ? [] : [
    { id: 't1', mode: 'taunt', taunt_id: 3, run_id: null, created_at: haceDias(0), from_user_id: RIVAL, from_user_name: 'Lucía M.' }],
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
  [/^POST \/app\/notificaciones\/vistas$/, () => { notasVistas = true; return { ok: true }; }],
  [/^POST \/app\/aviso\/\d+\/visto$/, () => { avisoVisto = true; return { ok: true }; }],
  [/^POST \//, () => ({ ok: true })],
  [/^PUT \//, () => ({ ok: true })],
  [/^DELETE \//, () => ({ ok: true })],
];

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
  let cuerpo; try { cuerpo = fn(); } catch (e) { console.log('   ERROR en el mock:', e.message); cuerpo = {}; }
  res.writeHead(200); res.end(JSON.stringify(cuerpo));
}).listen(8787, '0.0.0.0', () => console.log(`mock-api en :8787 (modo ${MODO})`));

process.on('SIGINT', () => { console.log('\nsin mock:', [...perdidas].join(', ') || 'ninguna'); process.exit(0); });
