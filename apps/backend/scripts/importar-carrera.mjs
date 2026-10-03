/**
 * Mete a mano una carrera que no llegó a CORRR.
 *
 *   node scripts/importar-carrera.mjs <ruta.gpx> <corredor> [--de-verdad]
 *
 * Sin `--de-verdad` solo ENSEÑA lo que haría: cuántas celdas, a quién se las
 * quita y cuántos puntos. Nada se escribe hasta que se pide expresamente.
 *
 * PARA QUÉ: en Android, quien sale a correr con Strava pierde la carrera —
 * Strava no comparte la ruta con nadie, y CORRR no puede enterarse. En iPhone
 * llega sola por Salud. Mientras eso siga así, esto es la red de seguridad:
 * el corredor exporta el GPX de su app y aquí se le cuenta como si la hubiera
 * hecho con CORRR.
 *
 * Hace lo mismo que una carrera normal: rellena el camino entre puntos (si no,
 * el GPS deja huecos), reclama las celdas, se las quita a quien las tuviera
 * —con su aviso— y suma los puntos con el tope por carrera.
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { ocuparCeldas } from './_importar-lib.mjs';

const [, , ficheroGpx, nombre, ...flags] = process.argv;
if (!ficheroGpx || !nombre) {
  console.error('Uso: node scripts/importar-carrera.mjs <ruta.gpx> <corredor> [--de-verdad]');
  process.exit(1);
}
const deVerdad = flags.includes('--de-verdad');

const CELL_LAT_DEG = 10 / 111000;
const CELL_LNG_DEG = 10 / (111000 * Math.cos((40 * Math.PI) / 180));
const MAX_PUNTOS_CARRERA = 8000;

/** Puntos del GPX, en orden. Vale tanto <trkpt> como <rtept>. */
function leeGpx(texto) {
  const puntos = [];
  const re = /<(?:trkpt|rtept)[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"/g;
  let m;
  while ((m = re.exec(texto))) puntos.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]) });
  // La hora, para fechar la carrera donde toca y no "ahora".
  const t = texto.match(/<time>([^<]+)<\/time>/);
  return { puntos, cuando: t ? new Date(t[1]) : new Date() };
}

const metros = (a, b) => {
  const dy = (b.lat - a.lat) / CELL_LAT_DEG * 10;
  const dx = (b.lon - a.lon) / CELL_LNG_DEG * 10;
  return Math.hypot(dx, dy);
};

/** Celdas del recorrido, rellenando el tramo entre lecturas: sin esto, un GPS
 *  que da un punto cada 10 segundos deja la calle a trozos. */
function celdasDelRecorrido(puntos) {
  const celdas = new Set();
  const aCelda = (p) => ({
    x: Math.floor(p.lon / CELL_LNG_DEG),
    y: Math.floor(p.lat / CELL_LAT_DEG),
  });
  for (let i = 0; i < puntos.length; i++) {
    const c = aCelda(puntos[i]);
    celdas.add(`${c.x},${c.y}`);
    if (i === 0) continue;
    // Bresenham entre la anterior y esta.
    const a = aCelda(puntos[i - 1]);
    let x = a.x, y = a.y;
    const dx = Math.abs(c.x - x), dy = Math.abs(c.y - y);
    const sx = x < c.x ? 1 : -1, sy = y < c.y ? 1 : -1;
    let err = dx - dy;
    let guarda = 0;
    while ((x !== c.x || y !== c.y) && guarda++ < 5000) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      celdas.add(`${x},${y}`);
    }
  }
  return [...celdas].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
}

const ca = readFileSync(new URL('../src/db/supabase-ca.ts', import.meta.url), 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  max: 2,
});

const { puntos, cuando } = leeGpx(readFileSync(ficheroGpx, 'utf8'));
if (puntos.length < 2) { console.error('El GPX no trae recorrido.'); process.exit(1); }

let km = 0;
for (let i = 1; i < puntos.length; i++) km += metros(puntos[i - 1], puntos[i]) / 1000;
const celdas = celdasDelRecorrido(puntos);

const { rows: us } = await db.query(
  `SELECT id, display_name FROM users WHERE LOWER(display_name) = LOWER($1)`, [nombre]);
if (us.length !== 1) { console.error(`No encuentro a "${nombre}".`); process.exit(1); }
const corredor = us[0];

console.log(`Carrera de ${corredor.display_name}`);
console.log(`  ${puntos.length} puntos del GPX · ${km.toFixed(2)} km · ${cuando.toLocaleString('es-ES')}`);
console.log(`  ${celdas.length.toLocaleString('es-ES')} celdas de recorrido\n`);

await ocuparCeldas(db, { corredor, celdas, km, cuando, deVerdad, MAX_PUNTOS_CARRERA });
await db.end();
