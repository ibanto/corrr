/**
 * Territorio en TIRAS para /cells/viewport?formato=tiras (app 1.11.10+).
 *
 * Una tira son celdas seguidas de un mismo dueño en una misma fila del mapa:
 * "de x0 a x1 en la fila y, todo de Ibanto". La zona de la Sagrada Família
 * son 25.294 celdas y 1.072 tiras, así que la respuesta no necesita tope.
 *
 * Hasta el 24-oct-2026 se agrupaba solo aquí, en JS, porque con funciones de
 * ventana la misma zona tardaba 460 ms en la base de datos. Pero eso obligaba
 * a traer de Supabase UNA FILA POR CELDA (~93 B cada una con el uuid, el
 * nombre y el grito del dueño): 20.000-57.000 filas por llamada, el 80-90 %
 * de los datos de salida del plan gratis (5 GB/mes), que se iba a pasar en
 * pleno Halloween. Ahora Postgres devuelve cada fila del dueño como un mapa
 * de bits (SQL_TIRAS: un entero por cada 32 columnas, y el dueño una sola
 * vez) y aquí se rehacen las tiras.
 * `agruparEnTiras` se queda: es la definición de referencia con la que se
 * comprueba que SQL_TIRAS da exactamente lo mismo.
 */
export type Dueno = {
  id: string; name: string | null; warCry: string | null;
  /** Su color en el mapa. Lo decide el servidor para que no haya dos
   *  corredores con tonos parecidos (ver `colorDeCorredor`). */
  color: string;
};

export type FilaCelda = {
  cell_x: number;
  cell_y: number;
  owner_id: string;
  owner_color?: string;
  owner_name: string | null;
  owner_war_cry: string | null;
};

export function agruparEnTiras(rows: FilaCelda[]): { tiras: Int32Array; n: number; duenos: Dueno[] } {
  const indice = new Map<string, number>();
  const duenos: Dueno[] = [];
  const filas = new Map<string, number[]>(); // "dueño:y" -> xs
  for (const r of rows) {
    let d = indice.get(r.owner_id);
    if (d === undefined) {
      d = duenos.length;
      indice.set(r.owner_id, d);
      duenos.push({
        id: r.owner_id, name: r.owner_name, warCry: r.owner_war_cry,
        color: r.owner_color ?? '#4A7BE8',
      });
    }
    const clave = `${d}:${r.cell_y}`;
    const xs = filas.get(clave);
    if (xs) xs.push(r.cell_x); else filas.set(clave, [r.cell_x]);
  }
  // 4 enteros por tira: índice del dueño, y, x0, x1 (x1 incluida).
  const salida: number[] = [];
  for (const [clave, xs] of filas) {
    const sep = clave.indexOf(':');
    const d = Number(clave.slice(0, sep));
    const y = Number(clave.slice(sep + 1));
    xs.sort((a, b) => a - b);
    let ini = xs[0];
    let ant = xs[0];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] <= ant + 1) { ant = Math.max(ant, xs[i]); continue; }
      salida.push(d, y, ini, ant);
      ini = ant = xs[i];
    }
    salida.push(d, y, ini, ant);
  }
  return { tiras: Int32Array.from(salida), n: salida.length / 4, duenos };
}

/**
 * Las celdas de una caja, COMPRIMIDAS EN POSTGRES como mapas de bits. Una
 * fila por dueño, con sus datos una sola vez y tres listas paralelas de
 * enteros: fila (y − y0), trozo ((x − x0) / 32) y los 32 bits del trozo (el
 * bit j encendido = la celda x0 + 32·trozo + j es suya). Con eso Node rehace
 * EXACTAMENTE las tiras de `agruparEnTiras`: es el mismo conjunto de celdas.
 *
 * Por qué así y no con funciones de ventana («huecos e islas»): la ventana
 * obliga a ORDENAR todas las celdas de la caja (115.000 en un encuadre de
 * Barcelona) y en local costaba 2-3,4 veces la CPU de la consulta de antes,
 * con la ordenación yendo a disco en cajas grandes; en el Supabase gratis eso
 * era arriesgar que el mapa tardara más en salir en pleno Halloween. Esto es
 * un único GROUP BY con hash (sin ordenar celdas): en local tarda MENOS que la
 * consulta de antes (75 frente a 98 ms en el encuadre). Viaja algo más que
 * con las tiras hechas (un trozo de territorio macizo es «-1», 2 cifras; una
 * tira de ~30 celdas ocupa 1-2 trozos), pero sigue siendo ~70-100 veces menos
 * que una fila por celda, y muy por debajo de lo que cabe en el plan gratis.
 *
 * Sin LIMIT a propósito: un tope de celdas fue lo que cortó el mapa con una
 * recta vertical (§9 del CLAUDE.md). El JOIN con users es el mismo de antes
 * (solo dueños que existen). `cell_x - $1` nunca es negativo (cell_x ≥ $1),
 * así que la división y el resto con >> y & valen también al oeste de
 * Greenwich, donde cell_x < 0. bit_or funde una celda repetida igual que JS.
 *
 * Los tres array_agg llevan el mismo ORDER BY y (fila, trozo) no se repite
 * dentro de un dueño: las listas van alineadas y ordenadas por fila y x, que
 * es lo que necesita `tirasDesdeDuenos` para unir una tira que cruza de un
 * trozo al siguiente. Solo se ordenan los trozos (miles), no las celdas.
 */
export const SQL_TIRAS = `
WITH g AS (
  SELECT owner_id, cell_y - $3 AS y, (cell_x - $1) >> 5 AS c,
         bit_or(1 << ((cell_x - $1) & 31)) AS b
    FROM cells
   WHERE cell_x BETWEEN $1 AND $2 AND cell_y BETWEEN $3 AND $4
   GROUP BY 1, 2, 3
), d AS (
  SELECT owner_id,
         array_agg(y ORDER BY y, c) AS ys,
         array_agg(c ORDER BY y, c) AS cs,
         array_agg(b ORDER BY y, c) AS bs
    FROM g
   GROUP BY owner_id
)
SELECT d.owner_id, u.display_name AS owner_name, u.war_cry AS owner_war_cry,
       u.color_idx AS owner_color_idx, d.ys, d.cs, d.bs
  FROM d
  JOIN users u ON u.id = d.owner_id`;

export type FilaDuenoTiras = {
  owner_id: string;
  owner_name: string | null;
  owner_war_cry: string | null;
  owner_color_idx: number | null;
  ys: (number | string)[];
  cs: (number | string)[];
  bs: (number | string)[];
};

/** Bit menos significativo encendido de un entero de 32 bits (v ≠ 0). */
function ctz(v: number): number {
  return 31 - Math.clz32(v & -v);
}

/** Monta la respuesta de SQL_TIRAS en el mismo formato que `agruparEnTiras`
 *  (4 enteros por tira: índice del dueño, y, x0, x1) y cuenta las celdas.
 *  `x0`/`y0` son la esquina de la caja que se pasó como $1 y $3. */
export function tirasDesdeDuenos(
  rows: FilaDuenoTiras[], x0: number, y0: number, colorDe: (idx: number) => string,
): { tiras: Int32Array; n: number; duenos: Dueno[]; celdas: number } {
  const salida: number[] = [];
  const duenos: Dueno[] = [];
  let celdas = 0;
  for (const r of rows) {
    const d = duenos.length;
    duenos.push({
      id: r.owner_id, name: r.owner_name, warCry: r.owner_war_cry,
      color: colorDe(r.owner_color_idx ?? 0),
    });
    // Tira abierta: fila `ty`, de `ini` a `fin` (x relativas a x0).
    let ty = NaN, ini = 0, fin = -2, abierta = false;
    // Number() por si algún día el driver devolviera texto: sumar "5" a un
    // número lo pegaría como cadena en vez de sumarlo.
    for (let i = 0; i < r.ys.length; i++) {
      const y = Number(r.ys[i]);
      const base = Number(r.cs[i]) * 32;
      let b = Number(r.bs[i]) >>> 0;
      if (y !== ty) {
        if (abierta) salida.push(d, y0 + ty, x0 + ini, x0 + fin);
        abierta = false;
        ty = y;
      }
      // Cada racha de bits encendidos es un trozo de tira; si empieza justo
      // detrás de la tira abierta (también desde el trozo anterior), la
      // alarga, como hace agruparEnTiras al no ver hueco.
      while (b !== 0) {
        const j = ctz(b);
        const resto = b >>> j;
        const largo = resto === 0xffffffff ? 32 : ctz(~resto);
        const a = base + j, z = a + largo - 1;
        celdas += largo;
        if (abierta && a === fin + 1) {
          fin = z;
        } else {
          if (abierta) salida.push(d, y0 + ty, x0 + ini, x0 + fin);
          ini = a; fin = z; abierta = true;
        }
        const mascara = largo === 32 ? 0xffffffff : (1 << largo) - 1;
        b = (b & ~(mascara << j)) >>> 0;
      }
    }
    if (abierta) salida.push(d, y0 + ty, x0 + ini, x0 + fin);
  }
  return { tiras: Int32Array.from(salida), n: salida.length / 4, duenos, celdas };
}

// ── Tiras PRECALCULADAS por casilla (6-nov-2026) ─────────────────────────────
//
// Hasta ahora cada vistazo al mapa sin caché leía en Postgres TODAS las celdas
// del encuadre (122.000-138.000 en Barcelona, 150-240 ms, con la ordenación
// yéndose a disco) para comprimirlas en tiras. Con `cells` creciendo ×10 cada
// mes y medio (95.000 celdas el 21-sep, 1.000.935 el 6-nov) eso iba a ser un
// segundo largo en pocas semanas.
//
// Ahora las tiras se guardan YA HECHAS en la tabla `tiras_casilla`: una fila
// por casilla de CASILLA_TIRAS celdas de lado (la misma casilla que usa la
// caché de /cells/viewport) y dueño, con tres listas paralelas (fila, x0, x1)
// en coordenadas RELATIVAS a la esquina de la casilla (0-127, que viajan en
// 1-3 cifras en vez de 6). Un encuadre de Barcelona son 12 casillas × 8 dueños:
// decenas de filas, y da igual cuántas celdas haya debajo.
//
// Quién las mantiene:
//   · POST /runs y los dos botones de cerco del panel recalculan, DENTRO de su
//     transacción, las casillas que han tocado (recalcularCasilla): así quien
//     acaba de correr ve su territorio nada más guardar.
//   · Y cada pocos minutos el servidor compara `cells` con la tabla casilla
//     por casilla (SQL_TIRAS_DESCUADRE) y rehace las que no cuadren. Es la red
//     para lo que no pasa por el servidor (los scripts de importar carreras y
//     del ejército escriben en `cells` directamente) y para un recálculo que
//     fallara a medias. Mientras una casilla esté en duda, /cells/viewport la
//     sirve calculándola al vuelo con SQL_TIRAS, como antes.
//
// Las tiras son una función pura de `cells` (sin mirar `users`): el JOIN con
// users para el nombre, el grito y el color se hace al leer, como siempre.

/** Celdas por lado de cada casilla de la tabla. Tiene que ser la misma que
 *  VIEWPORT_TILE en routes/index.ts: la caché y la tabla van por la misma
 *  cuadrícula. */
export const CASILLA_TIRAS = 128;

/** Casilla de una celda: división ENTERA hacia abajo, también al oeste de
 *  Greenwich (cell_x negativa). `Math.floor` y no `>> 7`, que es lo mismo
 *  pero se lee. */
export function casillaDe(v: number): number {
  return Math.floor(v / CASILLA_TIRAS);
}

/** Las casillas que tocan unas celdas, sin repetir y en orden (x, y). El
 *  orden importa: todas las transacciones bloquean las casillas en ESTE
 *  orden y así dos recálculos a la vez no pueden esperarse mutuamente. */
export function casillasDe(celdas: { x: number; y: number }[]): { cx: number; cy: number }[] {
  const vistas = new Set<string>();
  const salida: { cx: number; cy: number }[] = [];
  for (const c of celdas) {
    const cx = casillaDe(c.x), cy = casillaDe(c.y);
    const k = `${cx}:${cy}`;
    if (vistas.has(k)) continue;
    vistas.add(k);
    salida.push({ cx, cy });
  }
  salida.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  return salida;
}

/**
 * Las tiras de UNA casilla ($1 = casilla x, $2 = casilla y), calculadas desde
 * `cells` con la técnica de «huecos e islas»: dentro de cada dueño y fila,
 * `cell_x - fila_n` vale lo mismo para todas las celdas seguidas, así que
 * agrupar por ese valor da una tira. Aquí sí se puede ordenar por ventana:
 * una casilla son como mucho 128×128 = 16.384 celdas (la consulta de antes
 * ordenaba el encuadre entero, 130.000). Va por el índice de la clave
 * primaria (cell_x, cell_y), igual que SQL_TIRAS.
 *
 * Devuelve una fila por dueño con las tiras en coordenadas relativas a la
 * esquina de la casilla, ordenadas por fila y x0, y cuántas celdas suman.
 */
export const SQL_TIRAS_CASILLA = `
WITH c AS (
  SELECT owner_id, cell_y - $2::int * ${CASILLA_TIRAS} AS y, cell_x - $1::int * ${CASILLA_TIRAS} AS x,
         cell_x - ROW_NUMBER() OVER (PARTITION BY owner_id, cell_y ORDER BY cell_x) AS isla
    FROM cells
   WHERE cell_x BETWEEN $1::int * ${CASILLA_TIRAS} AND $1::int * ${CASILLA_TIRAS} + ${CASILLA_TIRAS - 1}
     AND cell_y BETWEEN $2::int * ${CASILLA_TIRAS} AND $2::int * ${CASILLA_TIRAS} + ${CASILLA_TIRAS - 1}
), t AS (
  SELECT owner_id, y, MIN(x) AS x0, MAX(x) AS x1
    FROM c
   GROUP BY owner_id, y, isla
)
SELECT owner_id,
       array_agg(y  ORDER BY y, x0) AS ys,
       array_agg(x0 ORDER BY y, x0) AS x0s,
       array_agg(x1 ORDER BY y, x0) AS x1s,
       SUM(x1 - x0 + 1)::int AS celdas
  FROM t
 GROUP BY owner_id`;

/**
 * Las casillas donde la tabla NO cuadra con `cells`: distinto número de celdas
 * o distinto reparto de dueños (la suma del hash del dueño, celda a celda, cambia
 * si una sola celda cambia de manos). Recorre `cells` entera, por eso se lanza
 * cada pocos minutos y no en cada petición: medido, es una pasada de la tabla
 * sin ordenar nada. Devuelve cero filas cuando todo está al día, así que casi
 * nunca viaja nada. Con la tabla vacía (primer arranque) devuelve todas las
 * casillas que tienen celdas: así el primer llenado es el mismo camino.
 */
export const SQL_TIRAS_DESCUADRE = `
WITH real AS (
  SELECT FLOOR(cell_x / ${CASILLA_TIRAS}.0)::int AS cx, FLOOR(cell_y / ${CASILLA_TIRAS}.0)::int AS cy,
         COUNT(*)::bigint AS n, SUM(hashtext(owner_id::text)::bigint) AS h
    FROM cells
   GROUP BY 1, 2
), pre AS (
  SELECT casilla_x AS cx, casilla_y AS cy,
         SUM(celdas)::bigint AS n, SUM(celdas::bigint * hashtext(owner_id::text)) AS h
    FROM tiras_casilla
   GROUP BY 1, 2
)
SELECT COALESCE(r.cx, p.cx) AS cx, COALESCE(r.cy, p.cy) AS cy
  FROM real r
  FULL JOIN pre p ON p.cx = r.cx AND p.cy = r.cy
 WHERE r.n IS DISTINCT FROM p.n OR r.h IS DISTINCT FROM p.h
 ORDER BY 1, 2`;

/** Lo que se lee de `tiras_casilla` para un encuadre (JOIN con users hecho
 *  en routes/index.ts: nombre, grito y color). */
export type FilaCasilla = {
  casilla_x: number;
  casilla_y: number;
  owner_id: string;
  owner_name: string | null;
  owner_war_cry: string | null;
  owner_color_idx: number | null;
  ys: (number | string)[];
  x0s: (number | string)[];
  x1s: (number | string)[];
};

/**
 * Monta la respuesta de /cells/viewport?formato=tiras a partir de las filas
 * de `tiras_casilla` de las casillas del encuadre. Da EXACTAMENTE las mismas
 * tiras que `tirasDesdeDuenos` sobre SQL_TIRAS para esa misma caja (se
 * comprueba en scripts/tiras-check.mjs): una tira que cruza de una casilla a
 * la siguiente está partida en la tabla y aquí se vuelve a pegar.
 */
export function tirasDesdeCasillas(
  rows: FilaCasilla[], colorDe: (idx: number) => string,
): { tiras: Int32Array; n: number; duenos: Dueno[]; celdas: number } {
  const indice = new Map<string, number>();
  const duenos: Dueno[] = [];
  const porDueno: { y: number; x0: number; x1: number }[][] = [];
  let celdas = 0;
  for (const r of rows) {
    let d = indice.get(r.owner_id);
    if (d === undefined) {
      d = duenos.length;
      indice.set(r.owner_id, d);
      duenos.push({
        id: r.owner_id, name: r.owner_name, warCry: r.owner_war_cry,
        color: colorDe(r.owner_color_idx ?? 0),
      });
      porDueno.push([]);
    }
    const bx = Number(r.casilla_x) * CASILLA_TIRAS, by = Number(r.casilla_y) * CASILLA_TIRAS;
    const lista = porDueno[d];
    // Number() por si el driver devolviera texto (ver tirasDesdeDuenos).
    for (let i = 0; i < r.ys.length; i++) {
      const x0 = bx + Number(r.x0s[i]), x1 = bx + Number(r.x1s[i]);
      lista.push({ y: by + Number(r.ys[i]), x0, x1 });
      celdas += x1 - x0 + 1;
    }
  }
  const salida: number[] = [];
  porDueno.forEach((lista, d) => {
    lista.sort((a, b) => a.y - b.y || a.x0 - b.x0);
    let abierta: { y: number; x0: number; x1: number } | null = null;
    for (const t of lista) {
      if (abierta && t.y === abierta.y && t.x0 === abierta.x1 + 1) {
        abierta.x1 = t.x1; // la misma tira, partida por el borde de la casilla
        continue;
      }
      if (abierta) salida.push(d, abierta.y, abierta.x0, abierta.x1);
      abierta = { ...t };
    }
    if (abierta) salida.push(d, abierta.y, abierta.x0, abierta.x1);
  });
  return { tiras: Int32Array.from(salida), n: salida.length / 4, duenos, celdas };
}
