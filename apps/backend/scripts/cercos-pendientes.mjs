/**
 * ¿Quién tiene un cerco cerrado que nadie le ha cobrado?
 *
 * SOLO LEE. Ni un UPDATE, ni un INSERT, ni un DELETE: saca la lista y la
 * imprime. Cobrarlo se hace desde el panel, a mano, persona a persona.
 *
 *   npm run cercos
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { celdasEncerradas, cajaDe, gruposDeCeldas, MAX_CAJA_CERCO } from '../dist/services/territorio.js';

const ca = readFileSync(new URL('../src/db/supabase-ca.ts', import.meta.url), 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  max: 2,
});

const num = (n) => Number(n).toLocaleString('es-ES');

const { rows: gente } = await db.query(`
  SELECT u.id, u.display_name, COUNT(c.*)::int AS celdas
    FROM users u JOIN cells c ON c.owner_id = u.id
   GROUP BY u.id, u.display_name
   HAVING COUNT(c.*) >= 20
   ORDER BY COUNT(c.*) DESC
`);

console.log(`Corredores con territorio: ${gente.length}\n`);

const pendientes = [];
const sinMirar = [];

for (const p of gente) {
  const { rows } = await db.query(
    'SELECT cell_x AS x, cell_y AS y FROM cells WHERE owner_id = $1', [p.id],
  );
  // Zona por zona: quien corre en dos ciudades tiene una caja con el vacío
  // de en medio, y así ninguna de sus zonas se queda sin mirar.
  const zonas = gruposDeCeldas(rows);
  const dentro = [];
  let zonasGordas = 0;
  for (const zona of zonas) {
    const caja = cajaDe(zona);
    const ancho = caja.x1 - caja.x0 + 1, alto = caja.y1 - caja.y0 + 1;
    if (ancho * alto > MAX_CAJA_CERCO) { zonasGordas++; continue; }
    for (const c of celdasEncerradas(zona, caja)) dentro.push(c);
  }
  if (zonasGordas > 0) sinMirar.push({ ...p, km: `${zonasGordas} zona(s) de más de 10 × 10 km`, zonas: zonas.length });
  if (dentro.length === 0) continue;

  // De lo encerrado, qué es de otro (eso se cobra como robo) y qué está libre.
  const xs = dentro.map(c => c.x), ys = dentro.map(c => c.y);
  const { rows: ajenas } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM cells c JOIN unnest($1::int[], $2::int[]) AS t(x, y)
         ON c.cell_x = t.x AND c.cell_y = t.y
      WHERE c.owner_id <> $3`,
    [xs, ys, p.id],
  );
  const robadas = ajenas[0]?.n ?? 0;
  const libres = dentro.length - robadas;
  pendientes.push({
    nombre: p.display_name,
    suyas: p.celdas,
    dentro: dentro.length,
    libres,
    robadas,
    puntos: libres + robadas * 2,
  });
}

if (pendientes.length === 0) {
  console.log('Nadie tiene cercos pendientes. Todo repartido.');
} else {
  console.log(`CERCOS SIN COBRAR: ${pendientes.length}\n`);
  console.log('corredor           celdas suyas   dentro   libres   de otros   puntos');
  console.log('─'.repeat(74));
  for (const p of pendientes.sort((a, b) => b.dentro - a.dentro)) {
    console.log(
      p.nombre.padEnd(18) +
      num(p.suyas).padStart(12) +
      num(p.dentro).padStart(9) +
      num(p.libres).padStart(9) +
      num(p.robadas).padStart(11) +
      num(p.puntos).padStart(9),
    );
  }
}

if (sinMirar.length > 0) {
  console.log(`\nZonas que siguen sin poder mirarse:`);
  for (const p of sinMirar) console.log(`  ${p.display_name} — ${num(p.celdas)} celdas, ${p.km}`);
}

await db.end();
