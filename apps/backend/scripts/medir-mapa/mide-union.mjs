// SOLO LECTURA: cuánto tarda el MÓVIL en unir las tiras en polígonos
// (unionStripsToPolygons de apps/mobile/src/map/territory.ts), repetido aquí
// tal cual con la misma librería (polygon-clipping) y las tiras reales de
// producción para Barcelona centro. En un móvil es 3-6 veces más lento que
// en este Mac.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const rb = createRequire('/Users/iban/corrr/apps/backend/package.json');
const rm = createRequire('/Users/iban/corrr/apps/mobile/package.json');
const pg = rb('pg');
const { SignJWT } = rb('jose');
const polygonClipping = rm('polygon-clipping');
const src = readFileSync('/Users/iban/corrr/apps/mobile/src/tracking/runTracker.ts', 'utf8');
const CELL_SIZE_M = Number(eval(src.match(/const CELL_SIZE_M\s*=\s*([^;]+);/)[1]));
const CELL_LAT_DEG = CELL_SIZE_M / 111000;
const CELL_LNG_DEG = CELL_SIZE_M / (111000 * Math.cos(40 * Math.PI / 180));

const API = 'https://corrr-api-production.up.railway.app';
const ca = readFileSync('/Users/iban/corrr/apps/backend/src/db/supabase-ca.ts', 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }, max: 1 });
const { rows } = await db.query(`SELECT id FROM users WHERE display_name = 'Ibanto' LIMIT 1`);
await db.end();
const token = await new SignJWT({ sub: rows[0].id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m')
  .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));

function unionStripsToPolygons(tiras) {
  if (tiras.length === 0) return [];
  const porFila = new Map();
  for (const t of tiras) { const f = porFila.get(t.y); if (f) f.push(t); else porFila.set(t.y, [t]); }
  const ringInput = [];
  const rect = (x0, y0, x1, y1) => {
    const oeste = x0 * CELL_LNG_DEG, este = x1 * CELL_LNG_DEG, sur = y0 * CELL_LAT_DEG, norte = y1 * CELL_LAT_DEG;
    ringInput.push([[[oeste, sur], [este, sur], [este, norte], [oeste, norte], [oeste, sur]]]);
  };
  porFila.forEach((fila, y) => {
    fila.sort((a, b) => a.x0 - b.x0);
    let x0 = fila[0].x0, x1 = fila[0].x1;
    for (let i = 1; i < fila.length; i++) {
      if (fila[i].x0 <= x1 + 1) { x1 = Math.max(x1, fila[i].x1); continue; }
      rect(x0, y, x1 + 1, y + 1); x0 = fila[i].x0; x1 = fila[i].x1;
    }
    rect(x0, y, x1 + 1, y + 1);
  });
  const union = polygonClipping.union.apply(null, ringInput);
  return { rects: ringInput.length, polys: union.length, puntos: union.reduce((s, p) => s + p.reduce((a, r) => a + r.length, 0), 0) };
}

for (const [nombre, lat, lng, h] of [['Barcelona centro (3 km)', 41.3874, 2.1686, 0.015], ['Sagrada Família (2 km)', 41.4036, 2.1744, 0.01], ['Poblenou (3 km)', 41.4036, 2.197, 0.015]]) {
  const q = `north=${lat + h}&south=${lat - h}&east=${lng + h}&west=${lng - h}&formato=tiras`;
  const j = await (await fetch(`${API}/cells/viewport?${q}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const porDueno = new Map();
  for (let i = 0; i < j.tiras.length; i += 4) {
    const d = j.tiras[i];
    if (!porDueno.has(d)) porDueno.set(d, []);
    porDueno.get(d).push({ y: j.tiras[i + 1], x0: j.tiras[i + 2], x1: j.tiras[i + 3] });
  }
  console.log(`\n== ${nombre}: ${j.tiras.length / 4} tiras, ${porDueno.size} dueños`);
  let total = 0;
  for (const [d, tiras] of porDueno) {
    const t0 = performance.now();
    const r = unionStripsToPolygons(tiras);
    const ms = performance.now() - t0;
    total += ms;
    console.log(`  ${(j.duenos[d].name ?? '?').padEnd(16)} ${String(tiras.length).padStart(5)} tiras → ${String(r.rects).padStart(5)} rectángulos → ${String(r.polys).padStart(3)} polígonos, ${String(r.puntos).padStart(6)} puntos · ${ms.toFixed(0)} ms`);
  }
  console.log(`  TOTAL unir en este Mac: ${total.toFixed(0)} ms (en un móvil, ×3-6)`);
}
