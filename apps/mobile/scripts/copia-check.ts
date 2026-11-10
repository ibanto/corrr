/**
 * Comprobación de la copia de la carrera en el móvil (src/tracking/copiaCarrera.ts).
 *
 * Va dentro de `npm run test:gps`. La copia es lo que salva una carrera cuyo
 * envío falla; en Android una de más de ~2 MiB no se podía volver a leer y la
 * carrera se perdía (vueltas rellenas de 3×3 km o más, 10-nov-2026). Las
 * vueltas se hacen con el RunTracker de verdad, como en la calle.
 */
import { RunTracker, GpsReading, Coord } from '../src/tracking/runTracker';
import {
  apretarCarrera, soltarCarrera, celdasATiras, tirasACeldas, UMBRAL_APRETAR, Celda,
} from '../src/tracking/copiaCarrera';

let seed = 3;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const M_PER_DEG_LAT = 111000;
const mPerDegLng = (lat: number) => 111000 * Math.cos(lat * Math.PI / 180);
const offset = (p: Coord, eastM: number, northM: number): Coord => ({
  latitude: p.latitude + northM / M_PER_DEG_LAT,
  longitude: p.longitude + eastM / mPerDegLng(p.latitude),
});
const VALENCIA: Coord = { latitude: 39.4699, longitude: -0.3763 };
const T0 = Date.UTC(2026, 10, 10, 8, 0, 0);

/** Vuelta rectangular de `anchoM` × `altoM` que vuelve a la salida, a 11 km/h,
 *  una lectura cada 3 s y algo de ruido de GPS. Devuelve las casillas tras STOP. */
function vuelta(anchoM: number, altoM: number): Set<string> {
  const tr = new RunTracker(T0);
  const legs = [
    { e: anchoM, n: 0 }, { e: 0, n: altoM }, { e: -anchoM, n: 0 }, { e: 0, n: -altoM },
  ];
  const mps = 11 / 3.6, everyS = 3;
  let pos = VALENCIA, t = T0, nE = 0, nN = 0;
  for (const leg of legs) {
    const len = Math.hypot(leg.e, leg.n);
    const steps = Math.max(1, Math.round(len / (mps * everyS)));
    for (let s = 1; s <= steps; s++) {
      const p = offset(pos, (leg.e * s) / steps, (leg.n * s) / steps);
      nE = nE * 0.8 + (rand() - 0.5) * 2; nN = nN * 0.8 + (rand() - 0.5) * 2;
      t += everyS * 1000;
      const r: GpsReading = { ...offset(p, nE, nN), timestamp: t, accuracy: 5, speed: mps };
      tr.addReading(r); tr.tick(t);
    }
    pos = offset(pos, leg.e, leg.n);
  }
  tr.finish();
  return tr.cells;
}

const aCeldas = (s: Set<string>): Celda[] => [...s].map(k => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
});
const mismoConjunto = (a: Celda[], b: Celda[]) => {
  const sa = new Set(a.map(c => `${c.x},${c.y}`));
  const sb = new Set(b.map(c => `${c.x},${c.y}`));
  if (sa.size !== sb.size) return false;
  for (const k of sa) if (!sb.has(k)) return false;
  return true;
};
/** La carrera tal cual la monta MapScreen al pulsar STOP. */
const carreraCon = (claimedCells: Celda[]) => ({
  distanceKm: 14.07, durationSecs: 4600, points: 3000, loopBonus: 50, loopClosed: true,
  xp: 30, zonesCount: 1,
  zones: [{ coords: [{ latitude: 39.47, longitude: -0.37 }], area: 12, points: 0 }],
  claimedCells, source: 'app' as const,
  diag: { readings: 1500, loopsFilled: 1 },
  startedAt: new Date(T0).toISOString(), endedAt: new Date(T0 + 4600_000).toISOString(),
});
const MiB = (n: number) => `${(n / 1048576).toFixed(2)} MiB`;
const KB = (n: number) => `${(n / 1000).toFixed(1)} KB`;
/** Lo que Android no relee (ventana del cursor de SQLite, 2 MiB). Con margen. */
const TOPE_ANDROID = 1.5 * 1048576;

type Check = { what: string; ok: boolean; got: string };
const results: { name: string; checks: Check[] }[] = [];
function scenario(name: string, fn: (check: (what: string, ok: boolean, got: string) => void) => void) {
  const checks: Check[] = [];
  seed = 3;
  fn((what, ok, got) => checks.push({ what, ok, got }));
  results.push({ name, checks });
}

scenario('Carrera normal: la copia es la de siempre', check => {
  const celdas = aCeldas(vuelta(800, 600));
  const carrera = carreraCon(celdas);
  const copia = apretarCarrera(carrera);
  check('por debajo del umbral', copia.length <= UMBRAL_APRETAR, `${celdas.length} casillas, ${KB(copia.length)}`);
  check('idéntica a JSON.stringify', copia === JSON.stringify(carrera), copia === JSON.stringify(carrera) ? 'sí' : 'NO');
  check('se lee igual', JSON.stringify(soltarCarrera(copia)) === JSON.stringify(carrera), 'ida y vuelta');
});

for (const [ancho, alto, nombre] of [
  [3000, 3000, 'Vuelta de 3×3 km (la que rozaba los 2 MiB)'],
  [4000, 3000, 'Vuelta de 4×3 km (más de 100.000 casillas)'],
  [5000, 4900, 'Vuelta de 5×4,9 km (la más grande que rellena la app)'],
] as const) {
  scenario(nombre, check => {
    const celdas = aCeldas(vuelta(ancho, alto));
    const carrera = carreraCon(celdas);
    const llana = JSON.stringify(carrera).length;
    const copia = apretarCarrera(carrera);
    check('sin apretar no cabría en Android', llana > TOPE_ANDROID || celdas.length < 90_000,
      `${celdas.length} casillas → ${MiB(llana)}`);
    check('apretada cabe de sobra', copia.length < 200_000, KB(copia.length));
    const vuelta2 = soltarCarrera<ReturnType<typeof carreraCon>>(copia);
    check('vuelven TODAS las casillas', mismoConjunto(vuelta2.claimedCells, celdas),
      `${vuelta2.claimedCells.length} de ${celdas.length}`);
    check('no queda el campo de las tiras', !('celdasEnTiras' in (vuelta2 as object)), Object.keys(vuelta2).join(','));
    const { claimedCells: _a, ...resto1 } = carrera;
    const { claimedCells: _b, ...resto2 } = vuelta2;
    check('el resto de la carrera, igual', JSON.stringify(resto1) === JSON.stringify(resto2), 'km, tiempo, fechas, diag');
  });
}

scenario('Copia de una versión anterior (sin apretar)', check => {
  const carrera = carreraCon([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  const vieja = JSON.stringify(carrera);
  check('se lee igual que antes', JSON.stringify(soltarCarrera(vieja)) === vieja, 'ida y vuelta');
});

scenario('Tiras: repetidas, desordenadas y negativas', check => {
  const celdas: Celda[] = [
    { x: 5, y: -3 }, { x: 3, y: -3 }, { x: 4, y: -3 }, { x: 4, y: -3 },
    { x: -2, y: 7 }, { x: -1, y: 7 }, { x: 1, y: 7 }, { x: 0, y: -400000 },
  ];
  const tiras = celdasATiras(celdas);
  check('tres seguidas son una tira', tiras.join(',') === '-400000,0,1,-3,3,3,7,-2,2,7,1,1', tiras.join(','));
  check('vuelven sin repetidas', mismoConjunto(tirasACeldas(tiras), celdas) && tirasACeldas(tiras).length === 7,
    `${tirasACeldas(tiras).length}`);
  check('lo que no es tira se ignora', tirasACeldas([1, 2, 'x', 4, 5, 2, 9]).length === 2,
    JSON.stringify(tirasACeldas([1, 2, 'x', 4, 5, 2, 9])));
});

let failed = 0;
console.log('\n── Copia de la carrera en el móvil ──');
for (const r of results) {
  const bad = r.checks.filter(c => !c.ok);
  failed += bad.length;
  console.log(`${bad.length ? '✘' : '✔'} ${r.name}`);
  for (const c of r.checks) console.log(`    ${c.ok ? '·' : '✘'} ${c.what}: ${c.got}`);
}
console.log(failed ? `\n${failed} comprobaciones de la copia FALLAN. No subir build.` : '\nCopia en orden.');
(globalThis as any).process.exit(failed ? 1 : 0);
