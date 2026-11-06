// SOLO LECTURA: territorio SIN caché en varios encuadres (espera a que caduque
// la caché de 30 s del servidor) y luego con caché. No escribe nada.
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
await db.end();
const token = await new SignJWT({ sub: rows[0].id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m')
  .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));
async function mide(path) {
  const t0 = performance.now();
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  return { ms: Math.round(performance.now() - t0), tiras: j.tiras ? j.tiras.length / 4 : '?', duenos: j.duenos?.length ?? '?' };
}
const cajas = {
  'Madrid centro (DEFAULT_REGION, 2 km)': { lat: 40.4168, lng: -3.7038, h: 0.01 },
  'Barcelona centro (3 km)': { lat: 41.3874, lng: 2.1686, h: 0.015 },
  'Gràcia (3 km)': { lat: 41.4036, lng: 2.1527, h: 0.015 },
  'Poblenou (3 km)': { lat: 41.4036, lng: 2.197, h: 0.015 },
  "L'Hospitalet (3 km)": { lat: 41.3597, lng: 2.0996, h: 0.015 },
  'Terrassa (3 km)': { lat: 41.563, lng: 2.0089, h: 0.015 },
};
await new Promise(r => setTimeout(r, 32000)); // que caduque la caché del servidor
for (const [nombre, c] of Object.entries(cajas)) {
  const q = `north=${c.lat + c.h}&south=${c.lat - c.h}&east=${c.lng + c.h}&west=${c.lng - c.h}&formato=tiras`;
  const a = await mide(`/cells/viewport?${q}`);
  const b = await mide(`/cells/viewport?${q}`);
  console.log(`${nombre.padEnd(38)} sin caché ${String(a.ms).padStart(5)} ms · con caché ${String(b.ms).padStart(4)} ms · ${a.tiras} tiras, ${a.duenos} dueños`);
}
