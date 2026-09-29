/**
 * Cercos: lo que rodeas con tu territorio pasa a ser tuyo.
 *
 * Hasta ahora solo contaba el círculo que cerrabas DENTRO de una misma
 * carrera. Pero el juego se piensa por semanas: hoy una recta, mañana otra
 * desde donde la dejaste, y el jueves la cierras. En cuanto el perímetro es
 * tuyo, lo de dentro es tuyo, lo hayas cerrado en un día o en cinco.
 *
 * Cómo se calcula: se inunda el mapa DESDE FUERA de la caja pasando solo por
 * celdas que no son tuyas. Lo que la inundación no alcanza está rodeado por
 * las tuyas.
 *
 * Dos consecuencias de hacerlo así, las dos buscadas:
 *
 *   · La inundación se mueve en cruz (arriba, abajo, izquierda, derecha), así
 *     que una fila de celdas EN DIAGONAL también cierra. Eso perdona el
 *     zigzag del GPS, que es lo que de verdad rompería un cerco por un pelo.
 *
 *   · Las celdas de otros que queden dentro NO se tocan: quedan como islas
 *     suyas dentro de tu territorio. Robar sigue siendo pisar.
 */

export type Celda = { x: number; y: number };

/** Tope por carrera: 10 km².
 *
 *  No es una regla del juego, es una red de seguridad. Si un fallo o un salto
 *  del GPS deja el territorio de alguien con forma de anillo alrededor de
 *  media ciudad, sin tope se la quedaría entera de una sentada y habría que
 *  deshacerlo a mano. Con tope, el estropicio máximo está acotado.
 *
 *  Estuvo en 2 km² y era demasiado poco: KarolK cerró 46.985 celdas (4,7 km²)
 *  en una vuelta real, y el móvil se las dio porque cerrar dentro de UNA
 *  carrera lo calcula él, con otro límite. O sea que la misma hazaña contaba
 *  o no según se hiciera en un día o en tres. A 10 km² los dos caminos van a
 *  la par. */
export const MAX_CELDAS_CERCO = 100_000;

/** Caja de trabajo máxima. Inundar es recorrer celda a celda: con 700×700
 *  (7×7 km) se cubre cualquier cerco real sin que el servidor sude. */
export const MAX_CAJA_CERCO = 500_000;

export type Caja = { x0: number; x1: number; y0: number; y1: number };

/** La caja donde buscar el cerco: lo que abarcan las celdas indicadas, con un
 *  margen de una celda para que la inundación pueda rodearlas. */
export function cajaDe(celdas: Celda[], margen = 1): Caja {
  const xs = celdas.map(c => c.x);
  const ys = celdas.map(c => c.y);
  return {
    x0: Math.min(...xs) - margen, x1: Math.max(...xs) + margen,
    y0: Math.min(...ys) - margen, y1: Math.max(...ys) + margen,
  };
}

/**
 * Las celdas que `propias` deja encerradas dentro de `caja`.
 *
 * Devuelve TODAS las encerradas, sean libres o de otro: quien llama decide
 * qué hacer con ellas (al rellenar solo se ocupan las libres).
 */
export function celdasEncerradas(propias: Celda[], caja?: Caja): Celda[] {
  if (propias.length === 0) return [];
  const { x0, x1, y0, y1 } = caja ?? cajaDe(propias);
  const ancho = x1 - x0 + 1;
  const alto = y1 - y0 + 1;
  if (ancho <= 0 || alto <= 0 || ancho * alto > MAX_CAJA_CERCO) return [];

  // Rejilla plana: con decenas de miles de celdas, un Set de cadenas es mucho
  // más lento y más pesado que un byte por casilla.
  const dentro = new Uint8Array(ancho * alto);
  const idx = (x: number, y: number) => (y - y0) * ancho + (x - x0);
  for (const c of propias) {
    if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
    dentro[idx(c.x, c.y)] = 1;
  }

  // Inundación desde el borde de la caja, solo por lo que no es tuyo.
  const fuera = new Uint8Array(ancho * alto);
  const cola: number[] = [];
  const empujar = (i: number) => {
    if (dentro[i] || fuera[i]) return;
    fuera[i] = 1;
    cola.push(i);
  };
  for (let x = x0; x <= x1; x++) { empujar(idx(x, y0)); empujar(idx(x, y1)); }
  for (let y = y0; y <= y1; y++) { empujar(idx(x0, y)); empujar(idx(x1, y)); }
  while (cola.length) {
    const i = cola.pop()!;
    const cx = i % ancho, cy = (i - cx) / ancho;
    if (cx > 0) empujar(i - 1);
    if (cx < ancho - 1) empujar(i + 1);
    if (cy > 0) empujar(i - ancho);
    if (cy < alto - 1) empujar(i + ancho);
  }

  const encerradas: Celda[] = [];
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * ancho + x;
      if (!dentro[i] && !fuera[i]) encerradas.push({ x: x + x0, y: y + y0 });
    }
  }
  return encerradas;
}
