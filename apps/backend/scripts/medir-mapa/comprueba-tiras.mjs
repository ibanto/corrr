// SOLO LECTURA: ¿las tiras de la tabla precalculada (tiras_casilla) son LAS
// MISMAS que las calculadas al vuelo desde `cells` (SQL_TIRAS)? Se comparan
// en producción para varios encuadres, con el mismo código que usa el
// servidor (dist/services/tiras.js: hace falta `npm run build`). No escribe nada.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/Users/iban/corrr/apps/backend/package.json');
const pg = require('pg');
const { SQL_TIRAS, tirasDesdeDuenos, SQL_TIRAS_DESCUADRE, tirasDesdeCasillas, CASILLA_TIRAS } =
  await import('/Users/iban/corrr/apps/backend/dist/services/tiras.js');
const ca = readFileSync('/Users/iban/corrr/apps/backend/src/db/supabase-ca.ts', 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }, max: 1 });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

const LAT = 10 / 111000, LNG = 10 / (111000 * Math.cos(40 * Math.PI / 180));
const caja = (lat, lng, h) => {
  const sw = { x: Math.floor((lng - h) / LNG), y: Math.floor((lat - h) / LAT) };
  const ne = { x: Math.floor((lng + h) / LNG), y: Math.floor((lat + h) / LAT) };
  return {
    x0: Math.floor(sw.x / CASILLA_TIRAS) * CASILLA_TIRAS, x1: Math.ceil((ne.x + 1) / CASILLA_TIRAS) * CASILLA_TIRAS,
    y0: Math.floor(sw.y / CASILLA_TIRAS) * CASILLA_TIRAS, y1: Math.ceil((ne.y + 1) / CASILLA_TIRAS) * CASILLA_TIRAS,
  };
};
const color = (i) => `#${i}`;
const normaliza = (r) => {
  const out = [];
  for (let i = 0; i < r.tiras.length; i += 4) out.push(`${r.duenos[r.tiras[i]].id} ${r.tiras[i + 1]} ${r.tiras[i + 2]} ${r.tiras[i + 3]}`);
  return out.sort();
};
let fallos = 0;
for (const [nombre, c] of Object.entries({
  'Barcelona centro (3 km)': [41.3874, 2.1686, 0.015], 'Sagrada Família (2 km)': [41.4036, 2.1744, 0.01],
  'Sant Cugat (3 km)': [41.4727, 2.0863, 0.015], 'Madrid centro (2 km)': [40.4168, -3.7038, 0.01],
  'Sevilla (3 km)': [37.3891, -5.9845, 0.015], 'Bilbao (3 km)': [43.263, -2.935, 0.015],
})) {
  const b = caja(...c);
  // Al vuelo, sobre las casillas enteras (hasta x1 - 1 / y1 - 1, como lee la tabla).
  const t0 = performance.now();
  const vuelo = tirasDesdeDuenos(await q(SQL_TIRAS, [b.x0, b.x1 - 1, b.y0, b.y1 - 1]), b.x0, b.y0, color);
  const t1 = performance.now();
  const filas = await q(
    `SELECT t.casilla_x, t.casilla_y, t.owner_id, u.display_name AS owner_name, u.war_cry AS owner_war_cry,
            u.color_idx AS owner_color_idx, t.ys, t.x0s, t.x1s
       FROM tiras_casilla t JOIN users u ON u.id = t.owner_id
      WHERE t.casilla_x BETWEEN $1 AND $2 AND t.casilla_y BETWEEN $3 AND $4`,
    [Math.floor(b.x0 / CASILLA_TIRAS), Math.floor((b.x1 - 1) / CASILLA_TIRAS), Math.floor(b.y0 / CASILLA_TIRAS), Math.floor((b.y1 - 1) / CASILLA_TIRAS)]);
  const t2 = performance.now();
  const tabla = tirasDesdeCasillas(filas, color);
  const a = normaliza(vuelo), z = normaliza(tabla);
  const iguales = a.length === z.length && a.every((v, i) => v === z[i]);
  if (!iguales) fallos++;
  console.log(`${iguales ? '✔' : '✘'} ${nombre.padEnd(26)} al vuelo ${String(vuelo.n).padStart(5)} tiras / ${String(vuelo.celdas).padStart(6)} celdas en ${Math.round(t1 - t0)} ms · tabla ${String(tabla.n).padStart(5)} tiras / ${String(tabla.celdas).padStart(6)} celdas en ${Math.round(t2 - t1)} ms (${filas.length} filas)`);
  if (!iguales) {
    const sa = new Set(a), sz = new Set(z);
    console.log('   solo al vuelo:', a.filter(x => !sz.has(x)).slice(0, 5), '· solo en la tabla:', z.filter(x => !sa.has(x)).slice(0, 5));
  }
}
const t0 = performance.now();
const malas = await q(SQL_TIRAS_DESCUADRE);
console.log(`\ndescuadre: ${malas.length} casillas en ${Math.round(performance.now() - t0)} ms`);
await db.end();
console.log(fallos ? `\n${fallos} encuadre(s) DISTINTOS.` : '\nLa tabla da las mismas tiras que al vuelo.');
process.exit(fallos ? 1 : 0);
