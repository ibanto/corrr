/**
 * Comprobación del dibujo del territorio (src/map/territory.ts).
 *
 * Va dentro de `npm run test:gps`. Cada escenario compara lo que pinta el
 * mapa a partir de TIRAS con lo que pintaría celda a celda, que es la verdad:
 * misma superficie, mismas manchas, mismos huecos. Si no coinciden, el mapa
 * está enseñando territorio que no es de nadie o escondiendo el que sí.
 */
import polygonClipping from 'polygon-clipping';
import { CELL_LAT_DEG, CELL_LNG_DEG } from '../src/tracking/runTracker';
import {
  Tira, UnionedPolygon, cellsToStrips, cellsToTerritory, pushClipped,
  stripsFingerprint, unionStripsToPolygons, RemoteCell,
} from '../src/map/territory';

let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const key = (x: number, y: number) => `${x},${y}`;

/** Mancha irregular con huecos: un paseo aleatorio que va pintando círculos. */
function blob(cx: number, cy: number, pasos: number, radio: number): Set<string> {
  const out = new Set<string>();
  let x = cx, y = cy;
  for (let i = 0; i < pasos; i++) {
    x += Math.round((rand() - 0.5) * 6);
    y += Math.round((rand() - 0.5) * 6);
    const r = 1 + Math.floor(rand() * radio);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) out.add(key(x + dx, y + dy));
    }
  }
  // Agujeros sueltos para que haya "holes" que comprobar.
  for (const k of [...out]) if (rand() < 0.03) out.delete(k);
  return out;
}

const toCells = (s: Set<string>) => [...s].map(k => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
});

/** Lo de siempre: cada celda un cuadrado, y se unen todos. La referencia. */
function unionPorCeldas(cells: { x: number; y: number }[]): UnionedPolygon[] {
  if (cells.length === 0) return [];
  const cuadrados = cells.map(c => [[
    [c.x * CELL_LNG_DEG, c.y * CELL_LAT_DEG], [(c.x + 1) * CELL_LNG_DEG, c.y * CELL_LAT_DEG],
    [(c.x + 1) * CELL_LNG_DEG, (c.y + 1) * CELL_LAT_DEG], [c.x * CELL_LNG_DEG, (c.y + 1) * CELL_LAT_DEG],
    [c.x * CELL_LNG_DEG, c.y * CELL_LAT_DEG],
  ]]);
  const u = (polygonClipping.union as any).apply(null, cuadrados) as number[][][][];
  return u.map(p => ({
    outer: p[0].map(pt => ({ latitude: pt[1], longitude: pt[0] })),
    holes: p.slice(1).map(h => h.map(pt => ({ latitude: pt[1], longitude: pt[0] }))),
  }));
}

/** Superficie en celdas (fuera menos huecos). */
function area(polys: UnionedPolygon[]): number {
  const anillo = (r: { latitude: number; longitude: number }[]) => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      a += (r[j].longitude + r[i].longitude) * (r[j].latitude - r[i].latitude);
    }
    return Math.abs(a / 2) / (CELL_LAT_DEG * CELL_LNG_DEG);
  };
  let total = 0;
  for (const p of polys) {
    total += anillo(p.outer);
    for (const h of p.holes) total -= anillo(h);
  }
  return Math.round(total * 1000) / 1000;
}
const huecos = (polys: UnionedPolygon[]) => polys.reduce((n, p) => n + p.holes.length, 0);

type Check = (what: string, ok: boolean, got: string) => void;
const results: { name: string; checks: { what: string; ok: boolean; got: string }[] }[] = [];
function scenario(name: string, fn: (check: Check) => void) {
  const checks: { what: string; ok: boolean; got: string }[] = [];
  try {
    fn((what, ok, got) => checks.push({ what, ok, got }));
  } catch (e) {
    checks.push({ what: 'sin errores', ok: false, got: String(e) });
  }
  results.push({ name, checks });
}

/** Mismo dibujo por tiras que por celdas. */
function igual(check: Check, que: string, tiras: Tira[], celdas: { x: number; y: number }[]) {
  const a = unionStripsToPolygons(tiras);
  const b = unionPorCeldas(celdas);
  check(`${que}: misma superficie`, area(a) === area(b) && area(b) === celdas.length,
    `${area(a)} celdas por tiras, ${area(b)} por celdas, ${celdas.length} reales`);
  check(`${que}: mismas manchas y huecos`, a.length === b.length && huecos(a) === huecos(b),
    `${a.length} manchas / ${huecos(a)} huecos (por celdas: ${b.length} / ${huecos(b)})`);
}

scenario('Tres corredores con territorio irregular, formato viejo del servidor', check => {
  const duenos = [blob(0, 0, 120, 4), blob(30, 10, 90, 3), blob(-20, 25, 60, 5)];
  // Se reparten las celdas como en la base de datos: cada una tiene UN dueño.
  const visto = new Set<string>();
  const cells: RemoteCell[] = [];
  duenos.forEach((s, i) => {
    for (const k of s) {
      if (visto.has(k)) continue;
      visto.add(k);
      const [x, y] = k.split(',').map(Number);
      cells.push({ cell_x: x, cell_y: y, owner_id: `u${i}`, owner_name: `Corredor ${i}`, is_mine: i === 0 });
    }
  });
  // Desordenadas, como pueden llegar.
  cells.sort(() => rand() - 0.5);
  const t = cellsToTerritory(cells);
  check('un dueño por corredor', t.duenos.length === 3, `${t.duenos.length}`);
  check('solo el primero es "mío"', t.duenos.filter(d => d.mine).map(d => d.id).join() === 'u0',
    t.duenos.filter(d => d.mine).map(d => d.id).join());
  check('muchas menos tiras que celdas', t.tiras.length / 4 < cells.length / 3,
    `${t.tiras.length / 4} tiras para ${cells.length} celdas`);
  t.duenos.forEach((d, i) => {
    const tiras: Tira[] = [];
    for (let j = 0; j < t.tiras.length; j += 4) {
      if (t.tiras[j] === i) tiras.push({ y: t.tiras[j + 1], x0: t.tiras[j + 2], x1: t.tiras[j + 3] });
    }
    const suyas = cells.filter(c => c.owner_id === d.id).map(c => ({ x: c.cell_x, y: c.cell_y }));
    igual(check, d.name ?? d.id, tiras, suyas);
  });
});

scenario('Barrio lleno: 60.000 celdas en una casilla (la recta vertical del 21-sep)', check => {
  // Un bloque de 300×200 celdas con una calle vacía en medio, de un solo dueño.
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < 200; y++) for (let x = 0; x < 301; x++) if (x !== 150) cells.push({ x: 18300 + x, y: 45900 + y });
  const tiras = cellsToStrips(cells);
  check('dos tiras por fila (la calle las parte)', tiras.length === 400, `${tiras.length} tiras`);
  const polys = unionStripsToPolygons(tiras);
  check('se dibuja entero, sin cortes', area(polys) === cells.length && polys.length === 2,
    `${area(polys)} de ${cells.length} celdas, ${polys.length} manchas`);
});

scenario('Solo se dibuja lo que cae cerca de la pantalla', check => {
  const s = toCells(blob(0, 0, 200, 5));
  const caja = { x0: -10, x1: 12, y0: -8, y1: 15 };
  const tiras: Tira[] = [];
  for (const t of cellsToStrips(s)) pushClipped(tiras, caja, t.y, t.x0, t.x1);
  const dentro = s.filter(c => c.x >= caja.x0 && c.x <= caja.x1 && c.y >= caja.y0 && c.y <= caja.y1);
  igual(check, 'recortado a la caja', tiras, dentro);
  const sinCaja: Tira[] = [];
  for (const t of cellsToStrips(s)) pushClipped(sinCaja, null, t.y, t.x0, t.x1);
  check('sin caja (en carrera) va todo', area(unionStripsToPolygons(sinCaja)) === s.length,
    `${area(unionStripsToPolygons(sinCaja))} de ${s.length}`);
});

scenario('Rastro de la carrera encima del territorio que ya tenías', check => {
  const antes = blob(0, 0, 80, 4);
  const rastro = new Set<string>();
  for (let x = -40; x <= 40; x++) { rastro.add(key(x, 3)); rastro.add(key(x, 4)); }
  for (let y = -30; y <= 30; y++) rastro.add(key(7, y));
  // Como lo hace el mapa: tiras del servidor + tiras del rastro, pisándose.
  const tiras = [...cellsToStrips(toCells(antes)), ...cellsToStrips(toCells(rastro))];
  const todas = toCells(new Set([...antes, ...rastro]));
  igual(check, 'territorio + rastro', tiras, todas);
});

scenario('La huella no depende del orden', check => {
  const tiras = cellsToStrips(toCells(blob(5, 5, 60, 3)));
  const barajadas = [...tiras].sort(() => rand() - 0.5);
  check('misma huella', stripsFingerprint(tiras) === stripsFingerprint(barajadas), stripsFingerprint(tiras));
  const otra = tiras.slice(1);
  check('cambia si cambia el territorio', stripsFingerprint(tiras) !== stripsFingerprint(otra), stripsFingerprint(otra));
});

let failed = 0;
console.log('\n── Mapa ──');
for (const r of results) {
  const bad = r.checks.filter(c => !c.ok);
  failed += bad.length;
  console.log(`${bad.length ? '✘' : '✔'} ${r.name}`);
  for (const c of r.checks) console.log(`    ${c.ok ? '·' : '✘'} ${c.what}: ${c.got}`);
}
console.log(failed ? `\n${failed} comprobaciones del mapa FALLAN. No subir build.` : '\nMapa en orden.');
(globalThis as any).process.exit(failed ? 1 : 0);
