// SOLO LECTURA: cuánto ocupa la base de datos de producción, qué tabla pesa y
// a qué ritmo crece lo gordo (celdas y carreras).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/Users/iban/corrr/apps/backend/package.json');
const pg = require('pg');
const ca = readFileSync('/Users/iban/corrr/apps/backend/src/db/supabase-ca.ts', 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }, max: 1 });
const q = async (s, p = []) => (await db.query(s, p)).rows;
console.log('base de datos entera:', (await q(`SELECT pg_size_pretty(pg_database_size(current_database())) t`))[0].t);
console.log('\ntablas (datos + índices + toast), las 12 más grandes:');
for (const r of await q(`SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) total, pg_size_pretty(pg_relation_size(relid)) datos,
    pg_size_pretty(pg_indexes_size(relid)) indices, n_live_tup::bigint vivas, n_dead_tup::bigint muertas
  FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`)) {
  console.log(`  ${r.relname.padEnd(22)} ${String(r.total).padStart(8)}  datos ${String(r.datos).padStart(8)}  índices ${String(r.indices).padStart(8)}  filas ${String(r.vivas).padStart(9)}  muertas ${r.muertas}`);
}
console.log('\ncolumnas gordas:');
for (const r of await q(`SELECT 'users.avatar_url' c, pg_size_pretty(SUM(octet_length(avatar_url))::bigint) t, COUNT(avatar_url)::int n FROM users
  UNION ALL SELECT 'users.avatar_thumb', pg_size_pretty(SUM(octet_length(avatar_thumb))::bigint), COUNT(avatar_thumb)::int FROM users`)) console.log(`  ${r.c.padEnd(22)} ${r.t ?? '0'}  (${r.n})`);
const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'runs' ORDER BY ordinal_position`);
console.log('  columnas de runs:', cols.map(c => c.column_name).join(', '));
for (const c of cols.map(c => c.column_name)) {
  if (!/(path|route|points|gps|track|json|data|coords|polyline|readings)/i.test(c)) continue;
  const [r] = await q(`SELECT pg_size_pretty(SUM(octet_length(${c}::text))::bigint) t FROM runs`).catch(() => [{ t: '?' }]);
  console.log(`  runs.${c}: ${r.t}`);
}
console.log('\nritmo: celdas nuevas por semana (claimed_at) y carreras:');
for (const r of await q(`SELECT date_trunc('week', claimed_at)::date semana, COUNT(*)::int celdas FROM cells WHERE claimed_at > NOW() - INTERVAL '8 weeks' GROUP BY 1 ORDER BY 1`)) console.log(`  ${r.semana.toISOString().slice(0, 10)}  ${String(r.celdas).padStart(8)} celdas`);
for (const r of await q(`SELECT date_trunc('week', created_at)::date semana, COUNT(*)::int carreras, ROUND(SUM(distance_km))::int km FROM runs WHERE created_at > NOW() - INTERVAL '8 weeks' GROUP BY 1 ORDER BY 1`)) console.log(`  ${r.semana.toISOString().slice(0, 10)}  ${String(r.carreras).padStart(5)} carreras, ${r.km} km`);
console.log('\nbytes por celda (total de cells / filas):', Math.round((await q(`SELECT pg_total_relation_size('cells')::bigint b, (SELECT COUNT(*) FROM cells) n`))[0].b / (await q(`SELECT COUNT(*)::int n FROM cells`))[0].n));
await db.end();
