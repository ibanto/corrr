// SOLO LECTURA: qué pestañas de vaciles hay en producción, cuáles ve Ibanto en la app
// y si los carteles se sirven. Desde apps/backend:
//   node --env-file=.env scripts/vaciles-en-produccion.mjs
// Firma un token de Ibanto con JWT_ACCESS_SECRET (no lo imprime) y no escribe nada.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/Users/iban/corrr/apps/backend/package.json');
const pg = require('pg');
const { SignJWT } = require('jose');
const API = 'https://corrr-api-production.up.railway.app';
const ca = readFileSync('/Users/iban/corrr/apps/backend/src/db/supabase-ca.ts', 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }, max: 1 });
const { rows } = await db.query(`SELECT id FROM users WHERE display_name = 'Ibanto' LIMIT 1`);
const pest = (await db.query(`SELECT id, nombre, orden, tipo, modo, borrada, (SELECT COUNT(*) FROM vacile_mensajes m WHERE m.pestana_id = p.id AND m.activo) activos FROM vacile_pestanas p ORDER BY id`)).rows;
console.log('pestañas en la tabla:', pest.map(p => `#${p.id} ${p.nombre} (${p.tipo}, modo ${p.modo}${p.borrada ? ', BORRADA' : ''}, ${p.activos} mensajes activos)`).join(' | '));
await db.end();
const token = await new SignJWT({ sub: rows[0].id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m')
  .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));
const r = await fetch(API + '/app/vaciles', { headers: { Authorization: `Bearer ${token}` } });
const j = await r.json();
const tabs = Array.isArray(j) ? j : (j.pestanas ?? j);
for (const t of tabs) {
  const msgs = t.mensajes ?? t.items ?? [];
  const conImg = msgs.filter(m => m.imagen).length;
  const ids = msgs.map(m => m.id);
  console.log(`la app ve: ${t.nombre} (${t.tipo ?? '?'}) ${msgs.length} mensajes, ${conImg} con cartel, ids ${Math.min(...ids)}-${Math.max(...ids)}`);
  const first = msgs.find(m => m.imagen);
  if (first) {
    for (const u of [first.imagen, first.miniatura].filter(Boolean)) {
      const full = u.startsWith('http') ? u : API + u;
      const h = await fetch(full);
      const b = await h.arrayBuffer();
      console.log(`   ${h.status} ${h.headers.get('content-type')} ${Math.round(b.byteLength / 1024)} KB  ${full.replace(API, '')}`);
    }
  }
}
