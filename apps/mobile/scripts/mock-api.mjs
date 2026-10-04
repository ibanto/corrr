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
  'GET /ranking/cities': () => vacio ? [] : [
    { position: 1, city: 'Bilbao', points: 51000, runners: 12 }, { position: 2, city: 'Madrid', points: 30200, runners: 9 }],
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
  'GET /objetos/viewport': () => vacio ? { objetos: [] } : ({ objetos: [
    ...[0,1,2,3,4,5,6,7].map(i => ({ id: 100 + i, x: CX + 10 + i * 6, y: CY + 12 + (i % 4) * 7, puntos: 200, tipo: 'calabaza' })),
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
    { id: 1, titulo: 'Te han robado', texto: 'Lucía M. se ha quedado *1.240 celdas* tuyas.', creado_at: haceDias(0), vista: false },
    { id: 2, titulo: 'Te han cercado', texto: 'Han rodeado tu zona y perdiste *800 celdas*.', creado_at: haceDias(1), vista: false },
    { id: 3, titulo: 'Cerco cobrado', texto: 'Cobraste *4.100 celdas*.', creado_at: haceDias(4), vista: true }] }),
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
