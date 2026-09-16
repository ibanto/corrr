/**
 * Comprobación del registro de carreras con recorridos simulados.
 *
 *   npm run test:gps
 *
 * Pasarlo SIEMPRE antes de sacar una build que toque el mapa o el GPS. Cada
 * escenario es algo que ya se ha roto alguna vez en producción. Si uno falla,
 * no se sube.
 *
 * Lo que esto NO puede comprobar: que el sistema operativo entregue puntos con
 * la pantalla apagada. Eso depende del móvil, y va en la lista de prueba en
 * dispositivo del final.
 */
import {
  RunTracker, GpsReading, Coord, getDistance, CELL_SIZE_M,
} from '../src/tracking/runTracker';
import { processImportedRoute } from '../src/tracking/importWorkout';

// ── Generador de recorridos ──────────────────────────────────────────────────
let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const M_PER_DEG_LAT = 111000;
const mPerDegLng = (lat: number) => 111000 * Math.cos(lat * Math.PI / 180);
const offset = (p: Coord, eastM: number, northM: number): Coord => ({
  latitude: p.latitude + northM / M_PER_DEG_LAT,
  longitude: p.longitude + eastM / mPerDegLng(p.latitude),
});

/** Eixample, Barcelona. */
const BCN: Coord = { latitude: 41.3900, longitude: 2.1600 };

interface Leg { eastM: number; northM: number }

/** Recorre tramos rectos a velocidad constante, una lectura cada `everyS`.
 *  Ruido GPS correlacionado (no independiente punto a punto, como el real). */
function route(start: Coord, legs: Leg[], o: { t0: number; kmh: number; everyS?: number; acc?: number; noiseM?: number }): GpsReading[] {
  const everyS = o.everyS ?? 3, acc = o.acc ?? 5, noiseM = o.noiseM ?? 2;
  const mps = o.kmh / 3.6;
  const out: GpsReading[] = [];
  let t = o.t0, pos = start, nE = 0, nN = 0;
  for (const leg of legs) {
    const len = Math.hypot(leg.eastM, leg.northM);
    const steps = Math.max(1, Math.round(len / (mps * everyS)));
    for (let s = 1; s <= steps; s++) {
      const p = offset(pos, (leg.eastM * s) / steps, (leg.northM * s) / steps);
      nE = nE * 0.8 + (rand() - 0.5) * noiseM; nN = nN * 0.8 + (rand() - 0.5) * noiseM;
      t += everyS * 1000;
      const q = offset(p, nE, nN);
      out.push({ ...q, timestamp: t, accuracy: acc, speed: mps * (0.95 + rand() * 0.1) });
    }
    pos = offset(pos, leg.eastM, leg.northM);
  }
  return out;
}

/** Parado en un sitio con el GPS bailando. */
function still(at: Coord, seconds: number, o: { t0: number; driftM: number; acc: number; everyS?: number }): GpsReading[] {
  const everyS = o.everyS ?? 3;
  const out: GpsReading[] = [];
  for (let t = everyS; t <= seconds; t += everyS) {
    const q = offset(at, (rand() - 0.5) * 2 * o.driftM, (rand() - 0.5) * 2 * o.driftM);
    out.push({ ...q, timestamp: o.t0 + t * 1000, accuracy: o.acc, speed: rand() * 0.3 });
  }
  return out;
}

const endOf = (rs: GpsReading[]): Coord => rs[rs.length - 1];
const lastTs = (rs: GpsReading[]) => rs[rs.length - 1].timestamp;

/** Alimenta lecturas como lo hace la app: cada una al tracker y un tick. */
function feed(tr: RunTracker, rs: GpsReading[]) {
  for (const r of rs) { tr.addReading(r); tr.tick(r.timestamp); }
}

/** Grupos de celdas conectadas (un rastro continuo es 1). */
function components(cells: Set<string>): number {
  const seen = new Set<string>();
  let n = 0;
  cells.forEach(start => {
    if (seen.has(start)) return;
    n++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const [x, y] = stack.pop()!.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (cells.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
  });
  return n;
}

// ── Escenarios ───────────────────────────────────────────────────────────────
type Check = { what: string; ok: boolean; got: string };
const results: { name: string; checks: Check[] }[] = [];
const km = (v: number) => `${(v * 1000).toFixed(0)} m`;
function scenario(name: string, fn: (check: (what: string, ok: boolean, got: string) => void) => void) {
  const checks: Check[] = [];
  seed = 7; // cada escenario, reproducible por sí mismo
  fn((what, ok, got) => checks.push({ what, ok, got }));
  results.push({ name, checks });
}
const T0 = Date.UTC(2026, 8, 14, 7, 0, 0);

scenario('Pantalla encendida: 1 km recto a 10 km/h', check => {
  const tr = new RunTracker(T0);
  feed(tr, route(BCN, [{ eastM: 1000, northM: 0 }], { t0: T0, kmh: 10 }));
  check('distancia ≈ 1 km (no el doble)', tr.distanceKm > 0.9 && tr.distanceKm < 1.15, km(tr.distanceKm));
  check('rastro continuo', components(tr.cells) === 1, `${components(tr.cells)} grupos`);
  check('celdas a lo largo de la calle', tr.cells.size >= 95 && tr.cells.size <= 250, `${tr.cells.size}`);
});

scenario('Pantalla apagada a mitad: 400 m llegan en un lote de fondo', check => {
  const tr = new RunTracker(T0);
  const a = route(BCN, [{ eastM: 300, northM: 0 }], { t0: T0, kmh: 10 });
  const b = route(endOf(a), [{ eastM: 400, northM: 0 }], { t0: lastTs(a), kmh: 10 });
  const c = route(endOf(b), [{ eastM: 300, northM: 0 }], { t0: lastTs(b), kmh: 10 });
  feed(tr, a);
  // Con la pantalla apagada la app no hace tick; al volver, el lote de golpe.
  for (const r of b) tr.addReading(r);
  tr.tick(lastTs(b) + 1000);
  feed(tr, c);
  check('distancia ≈ 1 km', tr.distanceKm > 0.9 && tr.distanceKm < 1.15, km(tr.distanceKm));
  check('la calle recta NO se pierde (rastro continuo)', components(tr.cells) === 1, `${components(tr.cells)} grupos`);
  check('sin auto-pausa falsa al volver', !tr.autoPaused, tr.autoPaused ? 'pausada' : 'en marcha');
});

scenario('Android: los mismos puntos llegan dos veces (vigilante + tarea + disco)', check => {
  const tr1 = new RunTracker(T0);
  const rs = route(BCN, [{ eastM: 600, northM: 0 }], { t0: T0, kmh: 10 });
  feed(tr1, rs);
  const tr2 = new RunTracker(T0);
  const half = Math.floor(rs.length / 2);
  feed(tr2, rs.slice(0, half));
  feed(tr2, rs.slice(0, half)); // repetidos
  feed(tr2, rs.slice(half - 5)); // solapados
  check('misma distancia', Math.abs(tr1.distanceKm - tr2.distanceKm) < 1e-9, `${km(tr1.distanceKm)} / ${km(tr2.distanceKm)}`);
  check('mismas celdas', tr1.cells.size === tr2.cells.size, `${tr1.cells.size} / ${tr2.cells.size}`);
});

scenario('Sin señal 3 minutos en plena carrera (túnel, sin permiso de fondo)', check => {
  const tr = new RunTracker(T0);
  const a = route(BCN, [{ eastM: 250, northM: 0 }], { t0: T0, kmh: 10 });
  // 500 m sin ninguna lectura a 10 km/h = 180 s
  const gapEnd = offset(endOf(a), 500, 0);
  const c = route(gapEnd, [{ eastM: 250, northM: 0 }], { t0: lastTs(a) + 180_000, kmh: 10 });
  feed(tr, a);
  tr.tick(lastTs(a) + 30_000); // la app sigue viva y el reloj corre
  feed(tr, c);
  check('el tramo sin señal se cuenta (línea recta)', tr.distanceKm > 0.85 && tr.distanceKm < 1.15, km(tr.distanceKm));
  check('no se inventan celdas en el hueco', components(tr.cells) === 2, `${components(tr.cells)} grupos`);
});

scenario('Semáforo: 60 s parado a mitad', check => {
  const tr = new RunTracker(T0);
  const a = route(BCN, [{ eastM: 300, northM: 0 }], { t0: T0, kmh: 10 });
  feed(tr, a);
  const before = tr.distanceKm;
  const s = still(endOf(a), 60, { t0: lastTs(a), driftM: 6, acc: 10 });
  feed(tr, s);
  const during = tr.distanceKm - before;
  const pausedAt = tr.autoPaused;
  const c = route(endOf(a), [{ eastM: 300, northM: 0 }], { t0: lastTs(s), kmh: 10 });
  feed(tr, c);
  check('parado no suma metros', during < 0.015, km(during));
  check('se auto-pausa', pausedAt, pausedAt ? 'sí' : 'no');
  check('se reanuda al moverse', !tr.autoPaused, tr.autoPaused ? 'sigue pausada' : 'sí');
  check('distancia ≈ 600 m', tr.distanceKm > 0.54 && tr.distanceKm < 0.72, km(tr.distanceKm));
});

scenario('Sentado 5 minutos con GPS malo', check => {
  const tr = new RunTracker(T0);
  feed(tr, still(BCN, 300, { t0: T0, driftM: 12, acc: 25 }));
  check('no suma distancia', tr.distanceKm < 0.03, km(tr.distanceKm));
  check('no pinta territorio', tr.cells.size <= 3, `${tr.cells.size} celdas`);
});

scenario('Ciudad con precisión de 25 m (la 1.11.3 no contaba nada)', check => {
  const tr = new RunTracker(T0);
  feed(tr, route(BCN, [{ eastM: 1000, northM: 0 }], { t0: T0, kmh: 10, acc: 25, noiseM: 5 }));
  check('cuenta la distancia', tr.distanceKm > 0.85 && tr.distanceKm < 1.2, km(tr.distanceKm));
  check('pinta el rastro', tr.cells.size >= 80, `${tr.cells.size} celdas`);
});

scenario('Ida A→B sin cerrar (la diagonal de la Barceloneta)', check => {
  const tr = new RunTracker(T0);
  feed(tr, route(BCN, [{ eastM: 600, northM: 0 }, { eastM: 0, northM: 600 }], { t0: T0, kmh: 10 }));
  const { loops } = tr.finish();
  // El triángulo entre la ruta y la diagonal serían ~1.800 celdas.
  check('no hay circuito', loops === 0, `${loops}`);
  check('solo el rastro, sin cuña', tr.cells.size <= 200, `${tr.cells.size} celdas`);
});

scenario('Circuito cerrado de 200 × 150 m', check => {
  const tr = new RunTracker(T0);
  feed(tr, route(BCN, [
    { eastM: 200, northM: 0 }, { eastM: 0, northM: 150 },
    { eastM: -200, northM: 0 }, { eastM: 0, northM: -150 },
  ], { t0: T0, kmh: 10 }));
  const { loops } = tr.finish();
  const area = (200 * 150) / (CELL_SIZE_M * CELL_SIZE_M);
  check('detecta el circuito', loops >= 1, `${loops}`);
  check('rellena el interior', tr.cells.size >= area * 0.8, `${tr.cells.size} celdas (área ${area})`);
});

scenario('Pausa manual: lo andado en pausa no cuenta', check => {
  const tr = new RunTracker(T0);
  const a = route(BCN, [{ eastM: 300, northM: 0 }], { t0: T0, kmh: 10 });
  feed(tr, a);
  tr.pause();
  const resumeAt = lastTs(a) + 300_000;
  tr.resume(resumeAt);
  const c = route(offset(endOf(a), 400, 0), [{ eastM: 300, northM: 0 }], { t0: resumeAt, kmh: 10 });
  feed(tr, c);
  check('distancia ≈ 600 m, no 1 km', tr.distanceKm > 0.54 && tr.distanceKm < 0.72, km(tr.distanceKm));
});

scenario('En coche a 50 km/h con la app abierta', check => {
  const tr = new RunTracker(T0);
  feed(tr, route(BCN, [{ eastM: 2000, northM: 0 }], { t0: T0, kmh: 50 }));
  check('no suma kilómetros', tr.distanceKm < 0.1, km(tr.distanceKm));
  check('no pinta territorio', tr.cells.size <= 5, `${tr.cells.size} celdas`);
});

scenario('Paseo corto de 200 m: la carrera es válida para guardar', check => {
  const tr = new RunTracker(T0);
  feed(tr, route(BCN, [{ eastM: 200, northM: 0 }], { t0: T0, kmh: 5 }));
  tr.finish();
  check('≥ 50 m', tr.distanceKm >= 0.05, km(tr.distanceKm));
  check('≥ 5 celdas', tr.cells.size >= 5, `${tr.cells.size}`);
});

scenario('Apple Watch: 2 km a 11 km/h, un punto por segundo', check => {
  // El reloj guarda la ruta a 1 Hz y ya suavizada: muchos más puntos y más
  // juntos que en directo. No debe inflar la distancia.
  const rs = route(BCN, [{ eastM: 1000, northM: 0 }, { eastM: 0, northM: 1000 }], { t0: T0, kmh: 11, everyS: 1, acc: 4, noiseM: 1 });
  const run = processImportedRoute(rs);
  check('distancia ≈ 2 km', run.distanceKm > 1.8 && run.distanceKm < 2.3, km(run.distanceKm));
  check('rastro continuo', components(new Set(run.cells.map(c => `${c.x},${c.y}`))) === 1, `${run.cells.length} celdas`);
  check('sin circuito', !run.loopClosed, run.loopClosed ? 'sí' : 'no');
});

scenario('Apple Watch: pausa de 3 minutos en el reloj a mitad', check => {
  const a = route(BCN, [{ eastM: 600, northM: 0 }], { t0: T0, kmh: 11, everyS: 1, acc: 4, noiseM: 1 });
  // En pausa el reloj no graba; al reanudar estás 40 m más allá.
  const b = route(offset(endOf(a), 40, 0), [{ eastM: 600, northM: 0 }], { t0: lastTs(a) + 180_000, kmh: 11, everyS: 1, acc: 4, noiseM: 1 });
  const run = processImportedRoute([...b, ...a]); // desordenadas a propósito
  check('lo andado en pausa no cuenta', run.distanceKm > 1.08 && run.distanceKm < 1.35, km(run.distanceKm));
});

// ── Informe ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  const bad = r.checks.filter(c => !c.ok);
  failed += bad.length;
  console.log(`${bad.length ? '✘' : '✔'} ${r.name}`);
  for (const c of r.checks) console.log(`    ${c.ok ? '·' : '✘'} ${c.what}: ${c.got}`);
}
console.log(failed ? `\n${failed} comprobaciones FALLAN. No subir build.` : '\nTodo en orden.');
(globalThis as any).process.exit(failed ? 1 : 0);
