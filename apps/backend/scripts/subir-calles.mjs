/**
 * Mete en la base de datos las calles bajadas por bajar-calles.mjs.
 *
 *   npm run calles:subir
 *
 * ADELGAZA ANTES DE SUBIR: del mapa bajado se queda UNA celda por cada
 * cuadrado de 100×100 m. Las que quedan son celdas reales de calle —asfalto,
 * no un punto inventado—, simplemente no se guardan diez de la misma acera.
 * Como las calabazas se siembran a 300 m unas de otras, tener más resolución
 * no cambia nada, y el ahorro es de 101 MB a 6: la base de datos es el plan
 * gratuito de Supabase (500 MB) y `cells` crece sola según corre la gente.
 *
 * Es idempotente: se puede lanzar las veces que haga falta.
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';

/** Una celda de calle por cada 10 celdas de lado = 100 m. */
const REJILLA = 10;
const LOTE = 5000;

const ca = readFileSync(new URL('../src/db/supabase-ca.ts', import.meta.url), 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  max: 2,
});

const origen = existsSync('/tmp/calles.json') ? '/tmp/calles.json' : '/tmp/calles-progreso.json';
const crudo = JSON.parse(readFileSync(origen, 'utf8'));
const todas = Array.isArray(crudo) ? crudo.map(c => `${c[0]},${c[1]}`) : crudo.celdas;
console.log(`Leídas ${todas.length.toLocaleString('es-ES')} celdas de ${origen}`);

const vistos = new Set();
const finales = [];
for (const k of todas) {
  const [x, y] = k.split(',').map(Number);
  const cuadro = `${Math.floor(x / REJILLA)},${Math.floor(y / REJILLA)}`;
  if (vistos.has(cuadro)) continue;
  vistos.add(cuadro);
  finales.push([x, y]);
}
console.log(`Adelgazadas a ${finales.length.toLocaleString('es-ES')} (una cada ${REJILLA * 10} m)\n`);

await db.query(`CREATE TABLE IF NOT EXISTS calles (
  cell_x INT NOT NULL, cell_y INT NOT NULL, PRIMARY KEY (cell_x, cell_y))`);

let metidas = 0;
for (let i = 0; i < finales.length; i += LOTE) {
  const lote = finales.slice(i, i + LOTE);
  const { rowCount } = await db.query(
    `INSERT INTO calles (cell_x, cell_y)
     SELECT x, y FROM unnest($1::int[], $2::int[]) AS t(x, y)
     ON CONFLICT DO NOTHING`,
    [lote.map(c => c[0]), lote.map(c => c[1])],
  );
  metidas += rowCount ?? 0;
  process.stdout.write(`\r  ${Math.min(i + LOTE, finales.length).toLocaleString('es-ES')} / ${finales.length.toLocaleString('es-ES')}`);
}

const { rows: [t] } = await db.query(
  `SELECT COUNT(*)::int AS n, pg_size_pretty(pg_total_relation_size('calles')) AS tam FROM calles`);
console.log(`\n\nEn la base de datos: ${t.n.toLocaleString('es-ES')} celdas de calle · ${t.tam}`);
console.log(`Nuevas en esta pasada: ${metidas.toLocaleString('es-ES')}`);
await db.end();
