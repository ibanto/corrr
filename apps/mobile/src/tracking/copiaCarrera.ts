/**
 * La copia de la carrera que se guarda en el móvil ANTES de mandarla
 * (`@corrr_carrera_pendiente`, ver MapScreen): si el envío falla, se manda
 * sola al volver a abrir la app.
 *
 * Por qué hay que apretarla (10-nov-2026): en Android, AsyncStorage guarda en
 * SQLite y una fila de más de unos 2 MiB se escribe pero NO SE PUEDE LEER
 * (no cabe en la ventana del cursor). Con las casillas sueltas, `{"x":…,"y":…}`
 * cada una, eso son unas 90.000: justo lo que manda una vuelta rellena de
 * 3×3 km. La copia quedaba en el disco, el reenvío fallaba al leerla y la
 * carrera se perdía igual. Y la base entera tiene un tope de 6 MB, que una
 * vuelta de 5×5 km (245.000 casillas, 5,6 MB) casi llena ella sola.
 *
 * Arreglo: por encima de UMBRAL_APRETAR caracteres las casillas se guardan en
 * TIRAS (fila, primera x, cuántas seguidas), como las del mapa. Una vuelta
 * rellena es casi todo filas enteras: 245.000 casillas caben en unos pocos KB.
 * Por debajo del umbral la copia es EXACTAMENTE la de antes, y las copias que
 * dejó una versión anterior se siguen leyendo igual.
 *
 * Al servidor se le manda siempre la carrera de siempre, con `claimedCells`:
 * las tiras solo existen en el disco del móvil.
 */

export interface Celda { x: number; y: number }

/** Por debajo de esto la copia se guarda como siempre (unas 22.000 casillas). */
export const UMBRAL_APRETAR = 500_000;

/** Casillas → tiras: [y, x0, n, y, x0, n, …], ordenadas por fila y luego por x.
 *  Las repetidas cuentan una vez. */
export function celdasATiras(celdas: Celda[]): number[] {
  const orden = celdas
    .filter((c) => Number.isInteger(c.x) && Number.isInteger(c.y))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const out: number[] = [];
  let y = 0, x0 = 0, n = 0;
  for (const c of orden) {
    if (n > 0 && c.y === y && c.x < x0 + n) continue; // repetida
    if (n > 0 && c.y === y && c.x === x0 + n) { n++; continue; }
    if (n > 0) out.push(y, x0, n);
    y = c.y; x0 = c.x; n = 1;
  }
  if (n > 0) out.push(y, x0, n);
  return out;
}

/** Tiras → casillas. Lo que no tenga forma de tira se ignora. */
export function tirasACeldas(tiras: unknown[]): Celda[] {
  const out: Celda[] = [];
  for (let i = 0; i + 2 < tiras.length; i += 3) {
    const y = tiras[i], x0 = tiras[i + 1], n = tiras[i + 2];
    if (!Number.isInteger(y) || !Number.isInteger(x0) || !Number.isInteger(n)) continue;
    for (let k = 0; k < (n as number); k++) out.push({ x: (x0 as number) + k, y: y as number });
  }
  return out;
}

/** El texto que se guarda en el disco. */
export function apretarCarrera<T extends { claimedCells?: Celda[] }>(carrera: T): string {
  const llana = JSON.stringify(carrera);
  if (llana.length <= UMBRAL_APRETAR || !carrera.claimedCells?.length) return llana;
  const { claimedCells, ...resto } = carrera;
  return JSON.stringify({ ...resto, celdasEnTiras: celdasATiras(claimedCells) });
}

/** La carrera que se manda, a partir de lo guardado (apretado o no). */
export function soltarCarrera<T>(guardada: string): T {
  const o = JSON.parse(guardada);
  if (o && Array.isArray(o.celdasEnTiras)) {
    o.claimedCells = tirasACeldas(o.celdasEnTiras);
    delete o.celdasEnTiras;
  }
  return o as T;
}
