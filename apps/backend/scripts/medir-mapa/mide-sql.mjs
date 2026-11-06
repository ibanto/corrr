// SOLO LECTURA: cuánto tarda en la base de datos la consulta del territorio
// (SQL_TIRAS) y la de objetos, con EXPLAIN ANALYZE, para el encuadre de
// Barcelona centro. Más tamaños de tabla e índices. No escribe nada.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/Users/iban/corrr/apps/backend/package.json');
const pg = require('pg');
const ca = readFileSync('/Users/iban/corrr/apps/backend/src/db/supabase-ca.ts', 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }, max: 1 });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

const LAT = 10 / 111000, LNG = 10 / (111000 * Math.cos(40 * Math.PI / 180));
const TILE = 128;
const caja = (lat, lng, h) => {
  const sw = { x: Math.floor((lng - h) / LNG), y: Math.floor((lat - h) / LAT) };
  const ne = { x: Math.floor((lng + h) / LNG), y: Math.floor((lat + h) / LAT) };
  return {
    x0: Math.floor(sw.x / TILE) * TILE, x1: Math.ceil((ne.x + 1) / TILE) * TILE,
    y0: Math.floor(sw.y / TILE) * TILE, y1: Math.ceil((ne.y + 1) / TILE) * TILE,
  };
};
const SQL_TIRAS = readFileSync('/Users/iban/corrr/apps/backend/src/services/tiras.ts', 'utf8')
  .match(/export const SQL_TIRAS = `([\s\S]*?)`;/)[1];

const t0 = performance.now();
await q('SELECT 1');
console.log(`ida y vuelta a Supabase desde este Mac: ${Math.round(performance.now() - t0)} ms`);

console.log('\n== Tamaños');
console.log(await q(`SELECT (SELECT COUNT(*) FROM cells)::int celdas, (SELECT COUNT(DISTINCT owner_id) FROM cells)::int duenos,
  (SELECT COUNT(*) FROM objetos WHERE tomado_por IS NULL)::int objetos_libres, (SELECT COUNT(*) FROM objetos)::int objetos_total,
  (SELECT COUNT(*) FROM campanas)::int campanas, (SELECT COUNT(*) FROM campana_apuntados)::int apuntados, (SELECT COUNT(*) FROM zones)::int zonas,
  pg_size_pretty(pg_total_relation_size('cells')) cells_tamano, pg_size_pretty(pg_total_relation_size('objetos')) objetos_tamano`));
console.log('índices:', (await q(`SELECT tablename, indexname FROM pg_indexes WHERE tablename IN ('cells','objetos','campana_apuntados','campanas','zones') ORDER BY 1,2`)).map(r => `${r.tablename}.${r.indexname}`).join(', '));
console.log('estadísticas cells:', await q(`SELECT n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze, last_analyze FROM pg_stat_user_tables WHERE relname = 'cells'`));

for (const [nombre, c] of Object.entries({ 'Barcelona centro (3 km)': [41.3874, 2.1686, 0.015], 'Sagrada Família (2 km)': [41.4036, 2.1744, 0.01] })) {
  const b = caja(...c);
  console.log(`\n== ${nombre}: caja ${b.x1 - b.x0}×${b.y1 - b.y0} celdas`);
  console.log('celdas en la caja:', (await q(`SELECT COUNT(*)::int n FROM cells WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4`, [b.x0, b.x1, b.y0, b.y1]))[0].n);
  for (let i = 0; i < 2; i++) {
    const plan = await q(`EXPLAIN (ANALYZE, BUFFERS) ${SQL_TIRAS}`, [b.x0, b.x1, b.y0, b.y1]);
    const lineas = plan.map(r => r['QUERY PLAN']);
    const tiempo = lineas.find(l => l.startsWith('Execution Time'));
    const planeo = lineas.find(l => l.startsWith('Planning Time'));
    console.log(`  tiras #${i + 1}: ${tiempo} · ${planeo}`);
    if (i === 0) console.log('   ' + lineas.filter(l => /Scan|Aggregate|Sort|Buffers: shared/.test(l)).map(l => l.trim()).slice(0, 10).join('\n   '));
  }
}
// Desde el 6-nov-2026 (tarde): lo mismo leyendo la tabla de tiras precalculadas
// (tiras_casilla, una fila por casilla y dueño) y lo que cuesta la comprobación
// de descuadre que el servidor lanza cada 5 minutos.
const SQL_PRECALC = `SELECT t.casilla_x, t.casilla_y, t.owner_id, u.display_name AS owner_name, u.war_cry AS owner_war_cry,
            u.color_idx AS owner_color_idx, t.ys, t.x0s, t.x1s
       FROM tiras_casilla t JOIN users u ON u.id = t.owner_id
      WHERE t.casilla_x BETWEEN $1 AND $2 AND t.casilla_y BETWEEN $3 AND $4`;
const hayTabla = (await q(`SELECT to_regclass('tiras_casilla') IS NOT NULL AS si`))[0].si;
if (hayTabla) {
  console.log('\n== Tiras PRECALCULADAS (tiras_casilla)');
  console.log(await q(`SELECT COUNT(*)::int filas, SUM(celdas)::int celdas, COUNT(DISTINCT (casilla_x, casilla_y))::int casillas,
    pg_size_pretty(pg_total_relation_size('tiras_casilla')) tamano, MAX(actualizado_at) ultima FROM tiras_casilla`));
  for (const [nombre, c] of Object.entries({ 'Barcelona centro (3 km)': [41.3874, 2.1686, 0.015], 'Sagrada Família (2 km)': [41.4036, 2.1744, 0.01] })) {
    const b = caja(...c);
    const p = [Math.floor(b.x0 / TILE), Math.floor((b.x1 - 1) / TILE), Math.floor(b.y0 / TILE), Math.floor((b.y1 - 1) / TILE)];
    for (let i = 0; i < 2; i++) {
      const plan = await q(`EXPLAIN (ANALYZE, BUFFERS) ${SQL_PRECALC}`, p);
      const l = plan.map(r => r['QUERY PLAN']);
      console.log(`  ${nombre} #${i + 1}: ${l.find(x => x.startsWith('Execution Time'))} · ${l.find(x => x.startsWith('Planning Time'))}`);
      if (i === 0) console.log('   ' + l.filter(x => /Scan|Buffers: shared/.test(x)).map(x => x.trim()).slice(0, 4).join('\n   '));
    }
    const t0 = performance.now();
    const filas = await q(SQL_PRECALC, p);
    const bytes = JSON.stringify(filas).length;
    console.log(`  ${nombre}: ${filas.length} filas, ~${Math.round(bytes / 1024)} KB de datos de salida (ida y vuelta ${Math.round(performance.now() - t0)} ms)`);
  }
  // Del JS compilado (npm run build), que en el fuente lleva constantes sin sustituir.
  const { SQL_TIRAS_DESCUADRE: SQL_DESCUADRE } = await import('/Users/iban/corrr/apps/backend/dist/services/tiras.js');
  for (let i = 0; i < 2; i++) {
    const plan = await q(`EXPLAIN (ANALYZE, BUFFERS) ${SQL_DESCUADRE}`);
    const l = plan.map(r => r['QUERY PLAN']);
    console.log(`  descuadre (cells entera) #${i + 1}: ${l.find(x => x.startsWith('Execution Time'))}${l.some(x => /Disk/.test(x)) ? ' · ORDENA EN DISCO' : ''}`);
  }
}

const ib = (await q(`SELECT id FROM users WHERE display_name = 'Ibanto'`))[0].id;
const b = caja(41.3874, 2.1686, 0.015);
const sw = { x: Math.floor((2.1686 - 0.015) / LNG), y: Math.floor((41.3874 - 0.015) / LAT) };
const ne = { x: Math.floor((2.1686 + 0.015) / LNG), y: Math.floor((41.3874 + 0.015) / LAT) };
const plan = await q(`EXPLAIN (ANALYZE, BUFFERS) SELECT id, cell_x, cell_y, puntos, tipo FROM objetos
      WHERE tomado_por IS NULL AND desde <= NOW() AND (hasta IS NULL OR hasta > NOW())
        AND cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4
        AND (tipo IN ('calabaza', 'fantasma', 'zombi') OR EXISTS (SELECT 1 FROM campana_apuntados a JOIN campanas c ON c.tipo = a.tipo
            WHERE a.tipo = objetos.tipo AND a.user_id = $5 AND c.modo <> 'no'))
      LIMIT 500`, [sw.x, ne.x, sw.y, ne.y, ib]);
const l = plan.map(r => r['QUERY PLAN']);
console.log(`\n== objetos (Barcelona centro): ${l.find(x => x.startsWith('Execution Time'))}`);
console.log('   ' + l.filter(x => /Scan|Buffers: shared|Filter/.test(x)).map(x => x.trim()).slice(0, 8).join('\n   '));
await db.end();
