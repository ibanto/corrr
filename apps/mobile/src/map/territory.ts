/**
 * Territorio del mapa en TIRAS, sin nada de React: así se puede probar fuera
 * del móvil (scripts/map-check.ts, dentro de `npm run test:gps`).
 *
 * Una tira son celdas seguidas de un mismo dueño en una misma fila del mapa.
 * El servidor manda el territorio así desde la 1.11.10: una zona llena son
 * decenas de miles de celdas pero solo un millar de tiras, y por eso no
 * necesita ponerle tope a nada. El tope anterior (5.000 celdas) era lo que
 * cortaba el mapa con una recta vertical (21-sep-2026).
 */
import polygonClipping from 'polygon-clipping';
import { CELL_LAT_DEG, CELL_LNG_DEG } from '../tracking/runTracker';

/** Caja en coordenadas de celda, bordes incluidos. */
export type CellBox = { x0: number; x1: number; y0: number; y1: number };

/** Dueño de territorio en el mapa. */
export interface MapOwner { id: string; name: string | null; warCry: string | null; mine: boolean; }

/** Lo que devuelve el servidor para un trozo de mapa. */
export interface MapTerritory {
  duenos: MapOwner[];
  /** Plano, de 4 en 4: índice en `duenos`, y, x0, x1 (x1 incluida). */
  tiras: number[];
  owners?: Record<string, { avatar: string | null }>;
}

/** Celda tal y como la manda el formato viejo del servidor. */
export interface RemoteCell {
  cell_x: number;
  cell_y: number;
  owner_id: string;
  owner_name?: string;
  owner_war_cry?: string | null;
  claimed_at?: string;
  is_mine: boolean;
}

/** Agrupa celdas sueltas (formato viejo del servidor) en tiras. */
export function cellsToTerritory(cells: RemoteCell[], owners?: Record<string, { avatar: string | null }>): MapTerritory {
  const indice = new Map<string, number>();
  const duenos: MapOwner[] = [];
  const porDueno: { x: number; y: number }[][] = [];
  for (const c of cells) {
    let d = indice.get(c.owner_id);
    if (d === undefined) {
      d = duenos.length;
      indice.set(c.owner_id, d);
      duenos.push({ id: c.owner_id, name: c.owner_name ?? null, warCry: c.owner_war_cry ?? null, mine: c.is_mine });
      porDueno.push([]);
    }
    porDueno[d].push({ x: c.cell_x, y: c.cell_y });
  }
  const tiras: number[] = [];
  porDueno.forEach((celdas, d) => {
    for (const t of cellsToStrips(celdas)) tiras.push(d, t.y, t.x0, t.x1);
  });
  return { duenos, tiras, owners };
}

/** Tira de celdas seguidas en una misma fila: de x0 a x1, las dos incluidas.
 *  Es como llega el territorio del servidor y como se une en polígonos. */
export type Tira = { y: number; x0: number; x1: number };

/** Celdas sueltas → tiras. Para el rastro de la carrera en curso, que se va
 *  pintando celda a celda. */
export function cellsToStrips(cells: { x: number; y: number }[]): Tira[] {
  const porFila = new Map<number, number[]>();
  for (const c of cells) {
    const fila = porFila.get(c.y);
    if (fila) fila.push(c.x);
    else porFila.set(c.y, [c.x]);
  }
  const tiras: Tira[] = [];
  porFila.forEach((xs, y) => {
    xs.sort((a, b) => a - b);
    let x0 = xs[0], x1 = xs[0];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] <= x1 + 1) { x1 = Math.max(x1, xs[i]); continue; }
      tiras.push({ y, x0, x1 });
      x0 = x1 = xs[i];
    }
    tiras.push({ y, x0, x1 });
  });
  return tiras;
}

/** Huella del territorio de un dueño, para saber si ha cambiado.
 *  No depende del orden y no crea cadenas enormes: comparar dos cadenas con
 *  todo el territorio costaría más que lo que queremos ahorrar. */
export function stripsFingerprint(tiras: Tira[]): string {
  let mezcla = 0;
  let suma = 0;
  for (const t of tiras) {
    const h = (t.y * 73856093) ^ (t.x0 * 19349663) ^ (t.x1 * 83492791);
    mezcla ^= h;
    suma = (suma + h) | 0;
  }
  return `${tiras.length}:${mezcla}:${suma}`;
}

/** Añade la tira recortada a lo que cae dentro de la caja (si cae algo). Sin
 *  caja —durante la carrera— va entera. */
export function pushClipped(out: Tira[], b: CellBox | null, y: number, x0: number, x1: number) {
  if (!b) { out.push({ y, x0, x1 }); return; }
  if (y < b.y0 || y > b.y1) return;
  const a = Math.max(x0, b.x0), z = Math.min(x1, b.x1);
  if (a <= z) out.push({ y, x0: a, x1: z });
}

/** Une las tiras de un dueño en uno o varios polígonos (uno por mancha).
 *  Used to render a territory as a single mass — no internal lines between
 *  adjacent cells, just one stroke around the perimeter of each connected
 *  component. Returns { outer, holes } for each polygon (RN-Maps's <Polygon>
 *  has a `holes` prop). */
export type UnionedPolygon = { outer: { latitude: number; longitude: number }[]; holes: { latitude: number; longitude: number }[][] };
export function unionStripsToPolygons(tiras: Tira[]): UnionedPolygon[] {
  if (tiras.length === 0) return [];
  // Cada tira es UN rectángulo, no veinte cuadraditos. La figura que sale es
  // exactamente la misma, pero unir cuesta mucho menos: con el territorio de
  // un corredor de 47.000 celdas, 575 ms → 22 ms (403 rectángulos en vez de
  // 47.000 cuadrados). Eso era lo que dejaba la app colgada al robarle a
  // alguien con mucho terreno. Antes de unir se juntan las tiras de una
  // misma fila que se tocan o se pisan (pasa con el rastro de la carrera
  // sobre el territorio que ya tenías).
  const porFila = new Map<number, Tira[]>();
  for (const t of tiras) {
    const fila = porFila.get(t.y);
    if (fila) fila.push(t);
    else porFila.set(t.y, [t]);
  }
  // polygon-clipping usa [lng, lat].
  const ringInput: number[][][][] = [];
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const oeste = x0 * CELL_LNG_DEG, este = x1 * CELL_LNG_DEG;
    const sur = y0 * CELL_LAT_DEG, norte = y1 * CELL_LAT_DEG;
    ringInput.push([[[oeste, sur], [este, sur], [este, norte], [oeste, norte], [oeste, sur]]]);
  };
  porFila.forEach((fila, y) => {
    fila.sort((a, b) => a.x0 - b.x0);
    let x0 = fila[0].x0, x1 = fila[0].x1;
    for (let i = 1; i < fila.length; i++) {
      if (fila[i].x0 <= x1 + 1) { x1 = Math.max(x1, fila[i].x1); continue; }
      rect(x0, y, x1 + 1, y + 1);
      x0 = fila[i].x0; x1 = fila[i].x1;
    }
    rect(x0, y, x1 + 1, y + 1);
  });
  let union;
  try {
    // polygon-clipping's overload signature is awkward — accepts variadic args
    // but TS can't infer through `...rest as any`. The Function.apply form sidesteps
    // the typing while doing the exact same thing at runtime.
    union = (polygonClipping.union as any).apply(null, ringInput);
  } catch {
    return [];
  }
  const result: UnionedPolygon[] = [];
  for (const poly of union as number[][][][]) {
    if (!poly || poly.length === 0) continue;
    const outer = poly[0].map((pt: number[]) => ({ latitude: pt[1], longitude: pt[0] }));
    const holes = poly.slice(1).map((h: number[][]) => h.map((pt: number[]) => ({ latitude: pt[1], longitude: pt[0] })));
    result.push({ outer, holes });
  }
  return result;
}
