// SOLO LECTURA: ¿cuánto tarda el territorio cuando el servidor lleva un rato
// sin que nadie le pida nada (pool de conexiones frío)? Espera 50 s en
// silencio, pide un encuadre nuevo sin caché, y compara con el siguiente.
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
  await r.text();
  return Math.round(performance.now() - t0);
}
const box = (lat, lng, h = 0.015) => `north=${lat + h}&south=${lat - h}&east=${lng + h}&west=${lng - h}`;
for (const [nombre, lat, lng] of [['Sants', 41.3755, 2.135], ['Horta', 41.4305, 2.1605], ['Sarrià', 41.3995, 2.1215]]) {
  await new Promise(r => setTimeout(r, 50000));
  const frio = await mide(`/cells/viewport?${box(lat, lng)}&formato=tiras`);
  const seguido = await mide(`/cells/viewport?${box(lat, lng + 0.03)}&formato=tiras`); // otro encuadre, también sin caché
  const cache = await mide(`/cells/viewport?${box(lat, lng)}&formato=tiras`);
  console.log(`${nombre.padEnd(8)} tras 50 s en silencio: ${String(frio).padStart(5)} ms · otro encuadre justo después: ${String(seguido).padStart(4)} ms · el mismo, con caché: ${cache} ms`);
}
