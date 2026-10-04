/**
 * Pinta el decorado del EJÉRCITO CORRR en las ciudades donde no corre nadie.
 *
 *   node scripts/sembrar-ejercito.mjs            # ENSAYO: solo dice qué haría
 *   node scripts/sembrar-ejercito.mjs --de-verdad
 *
 * PARA QUÉ: de 47 corredores, 26 no han corrido nunca, y hay 27 ciudades con
 * una sola persona. Quien se da de alta en Burgos abre el mapa, lo ve gris y no
 * vuelve. Esto no es el juego de los bots (§13 del CLAUDE.md) — eso llega en
 * noviembre, con rutas por calles de verdad y reaccionando a la gente. Esto es
 * SOLO decorado: territorio pintado para que el mapa de una ciudad vacía no
 * parezca un pueblo fantasma antes de Halloween.
 *
 * No hace falta versión nueva de la app: la ciudad de estos cinco es
 * "EJÉRCITO CORRR", y la app ya pinta la ciudad debajo del nombre. Así se lee
 * quiénes son sin tocar una línea de código del móvil.
 *
 * NO roba nada: solo ocupa celdas que no tengan dueño (ON CONFLICT DO NOTHING).
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const deVerdad = process.argv.includes('--de-verdad');

/** Los cinco. Nombres de bicho rápido: suenan a mote y no a robot. */
const EJERCITO = ['El Galgo', 'La Liebre', 'El Zorro', 'El Lobo', 'La Gaviota'];
const CIUDAD = 'EJÉRCITO CORRR';

/** Una mancha de 25x25 celdas = 250x250 m. Es lo que deja una vuelta cerrada a
 *  un par de manzanas: se ve en el mapa y no se come el barrio. */
const LADO = 25;
/** Manchas por ciudad. Pocas y separadas: demasiado territorio espanta más que
 *  el mapa vacío — el que llega piensa "esto ya está cogido". */
const MANCHAS = 3;
/** Entre manchas, al menos 1,5 km, para que se vean como sitios distintos. */
const SEPARACION = 150;

const ca = readFileSync(new URL('../src/db/supabase-ca.ts', import.meta.url), 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }, max: 2,
});

const CELL_LAT = 10 / 111000, CELL_LNG = 10 / (111000 * Math.cos(40 * Math.PI / 180));
const aCelda = (lat, lon) => ({ x: Math.floor(lon / CELL_LNG), y: Math.floor(lat / CELL_LAT) });

// ── Dónde hace falta ────────────────────────────────────────────────────────
// Las zonas son las mismas que se bajaron de OpenStreetMap. Para cada una se
// mira cuánta gente DE VERDAD tiene territorio dentro: las vacías y las de una
// sola persona son las que necesitan decorado.
const zonas = JSON.parse(readFileSync(new URL('../datos/zonas.json', import.meta.url), 'utf8'));
const objetivo = [];
for (const z of zonas) {
  const a = aCelda(z.sur, z.oeste), b = aCelda(z.norte, z.este);
  const { rows: [g] } = await db.query(
    `SELECT COUNT(DISTINCT c.owner_id)::int AS gente
       FROM cells c JOIN users u ON u.id = c.owner_id
      WHERE NOT u.es_bot AND c.cell_x BETWEEN $1 AND $2 AND c.cell_y BETWEEN $3 AND $4`,
    [a.x, b.x, a.y, b.y]);
  const { rows: [c] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM calles
      WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4`,
    [a.x, b.x, a.y, b.y]);
  if (c.n < 500) continue;                 // sin calles suficientes, no es ciudad
  if (g.gente > 1) continue;               // ahí ya hay partida
  objetivo.push({ caja: { x0: a.x, x1: b.x, y0: a.y, y1: b.y }, gente: g.gente, calles: c.n,
                  centro: `${((z.sur + z.norte) / 2).toFixed(3)}, ${((z.oeste + z.este) / 2).toFixed(3)}` });
}
objetivo.sort((p, q) => q.calles - p.calles);
console.log(`Zonas con calles bajadas: ${zonas.length}`);
console.log(`De esas, vacías o con una sola persona: ${objetivo.length}\n`);

// ── Qué se pintaría ─────────────────────────────────────────────────────────
let totalCeldas = 0;
const plan = [];
for (const [i, z] of objetivo.entries()) {
  const { rows: calles } = await db.query(
    `SELECT cell_x x, cell_y y FROM calles
      WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4
      ORDER BY random() LIMIT 400`,
    [z.caja.x0, z.caja.x1, z.caja.y0, z.caja.y1]);
  const centros = [];
  for (const c of calles) {
    if (centros.length >= MANCHAS) break;
    if (centros.every(p => Math.abs(p.x - c.x) > SEPARACION || Math.abs(p.y - c.y) > SEPARACION)) centros.push(c);
  }
  for (const [j, c] of centros.entries()) {
    plan.push({ zona: i, dueno: (i + j) % EJERCITO.length, centro: c });
    totalCeldas += LADO * LADO;
  }
  console.log(`  ${z.centro.padEnd(18)} ${String(z.gente)} corredor(es) · ${String(z.calles).padStart(6)} puntos de calle → ${centros.length} manchas`);
}
console.log(`\nSe pintarían ${plan.length} manchas de ${LADO * 10}x${LADO * 10} m = ${totalCeldas.toLocaleString('es-ES')} celdas como mucho`);
console.log('(menos las que ya tengan dueño: a nadie se le quita nada)');

if (!deVerdad) { console.log('\nEnsayo. Para hacerlo de verdad: --de-verdad'); await db.end(); process.exit(0); }

// ── Hacerlo ─────────────────────────────────────────────────────────────────
const cliente = await db.connect();
try {
  await cliente.query('BEGIN');
  const ids = [];
  for (const nombre of EJERCITO) {
    const { rows: ya } = await cliente.query(
      'SELECT id FROM users WHERE LOWER(display_name) = LOWER($1)', [nombre]);
    if (ya.length) { ids.push(ya[0].id); continue; }
    // Sin contraseña utilizable y sin verificar: no se puede entrar con ellas.
    const { rows: [u] } = await cliente.query(
      `INSERT INTO users (email, password_hash, display_name, city, es_bot)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
      [`ejercito-${randomUUID()}@corrr.invalid`, 'x', nombre, CIUDAD]);
    await cliente.query('INSERT INTO user_stats (user_id) VALUES ($1)', [u.id]);
    ids.push(u.id);
    console.log(`  creado: ${nombre}`);
  }

  let puestas = 0;
  for (const m of plan) {
    const xs = [], ys = [];
    for (let dx = 0; dx < LADO; dx++) for (let dy = 0; dy < LADO; dy++) {
      xs.push(m.centro.x - (LADO >> 1) + dx);
      ys.push(m.centro.y - (LADO >> 1) + dy);
    }
    const { rowCount } = await cliente.query(
      `INSERT INTO cells (cell_x, cell_y, owner_id, claimed_at)
       SELECT x, y, $3::uuid, NOW() FROM unnest($1::int[], $2::int[]) AS t(x, y)
       ON CONFLICT (cell_x, cell_y) DO NOTHING`,
      [xs, ys, ids[m.dueno]]);
    puestas += rowCount ?? 0;
  }
  for (const id of ids) {
    await cliente.query(
      `UPDATE user_stats SET total_cells = (SELECT COUNT(*) FROM cells WHERE owner_id = $1) WHERE user_id = $1`, [id]);
  }
  await cliente.query('COMMIT');
  console.log(`\nHecho. ${puestas.toLocaleString('es-ES')} celdas pintadas.`);
} catch (e) {
  await cliente.query('ROLLBACK');
  console.error('\nNo se ha tocado nada:', e.message);
  throw e;
} finally { cliente.release(); }
await db.end();
