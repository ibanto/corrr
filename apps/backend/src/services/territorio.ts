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

/** Caja de trabajo máxima: 10×10 km.
 *
 *  Estuvo en 500.000 (7×7 km) por miedo a que inundar fuera caro, y no lo es:
 *  medido, el peor caso de una caja de 10×10 km son 16 ms y 15 MB. Lo que sí
 *  costaba caro era el tope: al sumarle el margen de 3 km que se pide desde
 *  las carreras, CUALQUIER carrera de más de 1,1 km de ancho se pasaba de
 *  caja y se quedaba sin mirar si había cercado algo — en silencio. */
export const MAX_CAJA_CERCO = 1_000_000;

export type Caja = { x0: number; x1: number; y0: number; y1: number };

/** La caja donde buscar el cerco: lo que abarcan las celdas indicadas, con un
 *  margen de una celda para que la inundación pueda rodearlas. */
export function cajaDe(celdas: Celda[], margen = 1): Caja {
  // A mano, no con Math.min(...xs): el spread pasa cada celda como un
  // argumento y por encima de unas 65.000 revienta la pila. KarolK ya tiene
  // más de 46.000 celdas, así que era cuestión de tiempo.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of celdas) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return {
    x0: minX - margen, x1: maxX + margen,
    y0: minY - margen, y1: maxY + margen,
  };
}

/** La caja para buscar el cerco de una carrera: la de sus celdas con el mayor
 *  margen que quepa, hasta `margen`.
 *
 *  El margen existe porque el cerco casi nunca se cierra entero dentro de la
 *  carrera de hoy: el resto del perímetro se corrió otro día y hay que
 *  alcanzarlo. Antes el margen era fijo y, si no cabía, NO SE MIRABA EL CERCO
 *  y nadie se enteraba. Es mejor mirar con menos margen que no mirar.
 *
 *  Devuelve null solo si ni con el margen mínimo cabe (una carrera que abarca
 *  más de 10 km de lado). */
export function cajaDeTrabajo(celdas: Celda[], margen: number): Caja | null {
  if (celdas.length === 0) return null;
  const base = cajaDe(celdas, 0);
  const ancho = base.x1 - base.x0 + 1, alto = base.y1 - base.y0 + 1;
  let m = Math.max(1, Math.floor(margen));
  while (m > 1 && (ancho + 2 * m) * (alto + 2 * m) > MAX_CAJA_CERCO) m--;
  if ((ancho + 2 * m) * (alto + 2 * m) > MAX_CAJA_CERCO) return null;
  return cajaDe(celdas, m);
}

/**
 * Parte las celdas de alguien en las ZONAS donde corre de verdad.
 *
 * Quien ha corrido en Barcelona y un fin de semana en Asturias tiene un
 * territorio cuya caja abarca 600 km de vacío. Mirar esa caja entera es
 * imposible, y hasta ahora eso significaba no mirarle el cerco NUNCA: ni la
 * regla automática ni el botón del panel podían con él.
 *
 * Así que primero se separan las zonas y luego se mira cada una por su cuenta.
 * Dos celdas van juntas si sus casillas gordas (de `separacion` celdas de
 * lado, 1,28 km por defecto) se tocan, en cruz o en diagonal. Un cerco de
 * verdad cabe de sobra dentro de una zona: lo que separa las zonas son
 * kilómetros de nada.
 */
export function gruposDeCeldas(celdas: Celda[], separacion = 128): Celda[][] {
  if (celdas.length === 0) return [];

  // Casillas gordas ocupadas, cada una con sus celdas.
  const casillas = new Map<string, Celda[]>();
  const clave = (gx: number, gy: number) => `${gx},${gy}`;
  for (const c of celdas) {
    const k = clave(Math.floor(c.x / separacion), Math.floor(c.y / separacion));
    const lista = casillas.get(k);
    if (lista) lista.push(c); else casillas.set(k, [c]);
  }

  // Unir las que se tocan (conjuntos disjuntos, con compresión de camino).
  const padre = new Map<string, string>();
  for (const k of casillas.keys()) padre.set(k, k);
  const raiz = (k: string): string => {
    let r = k;
    while (padre.get(r) !== r) r = padre.get(r)!;
    while (padre.get(k) !== r) { const sig = padre.get(k)!; padre.set(k, r); k = sig; }
    return r;
  };
  const unir = (a: string, b: string) => {
    const ra = raiz(a), rb = raiz(b);
    if (ra !== rb) padre.set(ra, rb);
  };
  for (const k of casillas.keys()) {
    const [gx, gy] = k.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const vecino = clave(gx + dx, gy + dy);
        if (casillas.has(vecino)) unir(k, vecino);
      }
    }
  }

  const grupos = new Map<string, Celda[]>();
  for (const [k, lista] of casillas) {
    const r = raiz(k);
    const g = grupos.get(r);
    if (g) g.push(...lista); else grupos.set(r, [...lista]);
  }
  // De mayor a menor: la zona donde alguien corre a diario va primero.
  return [...grupos.values()].sort((a, b) => b.length - a.length);
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
  // La cola, en enteros de 32 bits en vez de un array normal: cada casilla
  // entra en ella como mucho una vez, así que cabe de sobra, y en una caja
  // grande esto es la diferencia entre 4 MB y 30.
  const cola = new Int32Array(ancho * alto);
  let cima = 0;
  const empujar = (i: number) => {
    if (dentro[i] || fuera[i]) return;
    fuera[i] = 1;
    cola[cima++] = i;
  };
  for (let x = x0; x <= x1; x++) { empujar(idx(x, y0)); empujar(idx(x, y1)); }
  for (let y = y0; y <= y1; y++) { empujar(idx(x0, y)); empujar(idx(x1, y)); }
  while (cima > 0) {
    const i = cola[--cima];
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
