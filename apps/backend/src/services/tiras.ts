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
