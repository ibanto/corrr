// SOLO LECTURA: cronometra las peticiones que hace la app al abrir el mapa,
// contra producción, como si fuera Ibanto. No escribe nada.
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
if (!rows[0]) throw new Error('sin Ibanto');
const token = await new SignJWT({ sub: rows[0].id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m')
  .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));

async function mide(path, auth = true) {
  const t0 = performance.now();
  const r = await fetch(API + path, { headers: auth ? { Authorization: `Bearer ${token}` } : {} });
  const txt = await r.text();
  const ms = Math.round(performance.now() - t0);
  let extra = '';
  try {
    const j = JSON.parse(txt);
    if (j.tiras) extra = `${j.tiras.length / 4} tiras, ${j.duenos.length} dueños, ${Object.keys(j.owners || {}).length} fotos`;
    else if (j.objetos) extra = `${j.objetos.length} objetos, ${Object.keys(j.tipos || {}).length} tipos`;
    else if (Array.isArray(j)) extra = `${j.length} zonas`;
    else if (j.retos) extra = `${j.retos.length} retos`;
  } catch {}
  return { ms, status: r.status, kb: Math.round(txt.length / 1024), extra };
}

const cajas = {
  'Barcelona centro (3 km)': { lat: 41.3874, lng: 2.1686, h: 0.015 },
  'Sagrada Família (2 km)': { lat: 41.4036, lng: 2.1744, h: 0.01 },
  'Sant Cugat (3 km)': { lat: 41.4727, lng: 2.0863, h: 0.015 },
};
const fila = (nombre, r) => console.log(`${nombre.padEnd(34)} ${String(r.ms).padStart(5)} ms  ${String(r.status)}  ${String(r.kb).padStart(4)} KB  ${r.extra}`);

console.log('\n== Sin autenticación (ida y vuelta pura a Railway)');
for (let i = 0; i < 3; i++) fila(`/health #${i + 1}`, await mide('/health', false));

for (const [nombre, c] of Object.entries(cajas)) {
  const q = `north=${c.lat + c.h}&south=${c.lat - c.h}&east=${c.lng + c.h}&west=${c.lng - c.h}`;
  console.log(`\n== ${nombre}`);
  for (let i = 0; i < 3; i++) {
    const [t, o] = await Promise.all([mide(`/cells/viewport?${q}&formato=tiras`), mide(`/objetos/viewport?${q}`)]);
    fila(`territorio (tiras) #${i + 1}${i === 0 ? ' sin caché' : ''}`, t);
    fila(`objetos #${i + 1}`, o);
  }
  fila('zonas (/zones/nearby)', await mide(`/zones/nearby?lat=${c.lat}&lng=${c.lng}`));
}
console.log('\n== Lo demás que pide el mapa al abrir');
fila('/app/retos', await mide('/app/retos'));
fila('/app/ajustes', await mide('/app/ajustes'));
