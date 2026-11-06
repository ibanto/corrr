// SOLO LECTURA: ¿se cogieron los logos a 20 m en las carreras de hoy de Ibanto?
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/Users/iban/corrr/apps/backend/package.json');
const pg = require('pg');
const ca = readFileSync('/Users/iban/corrr/apps/backend/src/db/supabase-ca.ts', 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }, max: 1 });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const [yo] = await q(`SELECT id FROM users WHERE display_name = 'Ibanto'`);
const runs = await q(`SELECT id, created_at, distance_km, source FROM runs WHERE user_id = $1 AND created_at > NOW() - INTERVAL '36 hours' ORDER BY created_at`, [yo.id]);
console.log('carreras de Ibanto (36 h):', runs.map(r => `${r.id.slice(0, 8)} ${new Date(r.created_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} ${Number(r.distance_km).toFixed(2)} km ${r.source ?? ''}`).join(' | ') || 'ninguna');
for (const r of runs) {
  const celdas = await q(`SELECT cell_x x, cell_y y FROM cells WHERE run_id = $1`, [r.id]);
  const cogidos = await q(`SELECT id, cell_x x, cell_y y, tipo, tomado_at FROM objetos WHERE tomado_por = $1 AND tomado_at BETWEEN $2::timestamptz - INTERVAL '5 minutes' AND $2::timestamptz + INTERVAL '5 minutes'`, [yo.id, r.created_at]);
  const libres = await q(`SELECT id, cell_x x, cell_y y, tipo FROM objetos WHERE tomado_por IS NULL AND tipo NOT IN ('calabaza','fantasma','zombi') AND (hasta IS NULL OR hasta > NOW())`);
  const dist = o => celdas.length ? Math.min(...celdas.map(c => Math.max(Math.abs(c.x - o.x), Math.abs(c.y - o.y)))) : null;
  console.log(`\ncarrera ${r.id.slice(0, 8)}: ${celdas.length} celdas con run_id de esta carrera`);
  console.log(`  cogidos en ±5 min: ${cogidos.length}` + (cogidos.length ? ' → distancia a la celda pisada más cercana (0 = encima): ' + cogidos.map(o => `${o.tipo}#${o.id} d=${dist(o)}`).join(', ') : ''));
  const cerca = libres.map(o => ({ ...o, d: dist(o) })).filter(o => o.d !== null && o.d <= 2);
  console.log(`  logos LIBRES que quedaron a ≤2 cuadrados de la carrera (deberían ser 0): ${cerca.length}` + (cerca.length ? ' → ' + cerca.map(o => `${o.tipo}#${o.id} d=${o.d}`).join(', ') : ''));
  const cerca5 = libres.map(o => ({ ...o, d: dist(o) })).filter(o => o.d !== null && o.d > 2 && o.d <= 5);
  console.log(`  logos libres a 3-5 cuadrados (30-50 m, no se cogen): ${cerca5.length}`);
}
await db.end();
