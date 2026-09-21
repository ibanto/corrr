/**
 * Territorio en TIRAS para /cells/viewport?formato=tiras (app 1.11.10+).
 *
 * Una tira son celdas seguidas de un mismo dueño en una misma fila del mapa:
 * "de x0 a x1 en la fila y, todo de Ibanto". La zona de la Sagrada Família
 * son 25.294 celdas y 1.072 tiras, así que la respuesta no necesita tope.
 *
 * Se agrupa aquí y no en SQL: con funciones de ventana la misma zona tardaba
 * 460 ms en la base de datos; en JS son unos pocos ms.
 */
export type Dueno = { id: string; name: string | null; warCry: string | null };

export type FilaCelda = {
  cell_x: number;
  cell_y: number;
  owner_id: string;
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
      duenos.push({ id: r.owner_id, name: r.owner_name, warCry: r.owner_war_cry });
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
