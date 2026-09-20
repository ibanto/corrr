/**
 * Registro de una carrera: de lecturas GPS a kilómetros y celdas.
 *
 * Todo lo que decide qué cuenta vive aquí, en TypeScript puro —sin React ni
 * módulos nativos— para poder comprobarlo con recorridos simulados antes de
 * cada build: `npm run test:gps` (scripts/gps-check.ts).
 *
 * Antes esta lógica estaba dentro de MapScreen en DOS caminos que hacían lo
 * mismo con reglas distintas: uno para la pantalla encendida y otro para los
 * puntos que llegaban con la pantalla apagada. Se separaron con el tiempo:
 * el de pantalla apagada daba por "salto" cualquier tramo recto y tiraba las
 * celdas de la calle entera, no pasaba por la auto-pausa ni por el
 * anti-deriva, y no guardaba los puntos para rellenar circuitos. Y en la
 * 1.11.4 el de pantalla encendida sumaba cada metro dos veces. Ahora hay un
 * solo camino y una sola distancia, la misma que se ve y la que se guarda.
 */

export interface Coord { latitude: number; longitude: number; }

/** Una lectura del GPS, venga del vigilante en primer plano o de la tarea de
 *  fondo. Los mismos campos que expo-location, aplanados. */
export interface GpsReading {
  latitude: number;
  longitude: number;
  /** ms desde epoch, del propio fix */
  timestamp: number;
  /** metros; 999 si el chip no lo da */
  accuracy: number;
  /** m/s; -1 si el chip no lo da */
  speed: number;
}

// ── Cuadrícula (10 m × 10 m) ─────────────────────────────────────────────────
// TIENE que coincidir con la fórmula del backend (apps/backend/src/routes/index.ts).
export const CELL_SIZE_M = 10;
export const CELL_LAT_DEG = CELL_SIZE_M / 111000;
export const CELL_LNG_DEG = CELL_SIZE_M / (111000 * Math.cos(40 * Math.PI / 180));

export function coordToCell(lat: number, lng: number): { x: number; y: number } {
  return {
    x: Math.floor(lng / CELL_LNG_DEG),
    y: Math.floor(lat / CELL_LAT_DEG),
  };
}

export const cellKey = (x: number, y: number) => `${x},${y}`;

/** 4-connected line of cells between two grid coordinates. Greedy: each step
 *  moves one orthogonal cell toward the target. Used to "bridge" consecutive
 *  GPS readings — even if the GPS skips 1-2 cells, the trail stays continuous
 *  with no holes, so the flood fill always seals enclosures. */
export function cellLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [{ x: x0, y: y0 }];
  let x = x0, y = y0;
  let guard = 0;
  while ((x !== x1 || y !== y1) && guard++ < 5000) {
    const remX = x1 - x;
    const remY = y1 - y;
    if (Math.abs(remX) >= Math.abs(remY) && remX !== 0) x += Math.sign(remX);
    else if (remY !== 0) y += Math.sign(remY);
    else if (remX !== 0) x += Math.sign(remX);
    cells.push({ x, y });
  }
  return cells;
}

/** Fill every cell fully enclosed by a set of claimed cells. Works for ANY
 *  shape — figure-8s, multiple loops, jagged perimeters — because it's a flood
 *  fill, not polygon rasterization. Algorithm: BFS-flood the empty space from
 *  outside the bounding box; any empty cell the flood can't reach is enclosed,
 *  so we claim it. This is what makes "if it closes, it closes" hold true. */
export function fillEnclosedCells(cellKeys: Set<string>): Set<string> {
  if (cellKeys.size < 8) return cellKeys; // too few to enclose anything
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  cellKeys.forEach(k => {
    const ci = k.indexOf(',');
    const x = parseInt(k.slice(0, ci), 10);
    const y = parseInt(k.slice(ci + 1), 10);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  // Pad by 1 so the flood can always wrap around the outside.
  minX--; maxX++; minY--; maxY++;
  // Safety cap — a runaway bounding box (bad GPS) would make this O(huge).
  if ((maxX - minX) * (maxY - minY) > 2_000_000) return cellKeys;

  const outside = new Set<string>();
  const stack: [number, number][] = [[minX, minY]];
  outside.add(cellKey(minX, minY));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const nk = cellKey(nx, ny);
      if (outside.has(nk) || cellKeys.has(nk)) continue;
      outside.add(nk);
      stack.push([nx, ny]);
    }
  }
  // Any empty cell the flood never reached is enclosed → claim it.
  const result = new Set(cellKeys);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const k = cellKey(x, y);
      if (!outside.has(k) && !cellKeys.has(k)) result.add(k);
    }
  }
  return result;
}

/** Ray-casting point-in-polygon — mismo algoritmo que el backend */
export function pointInPolygon(lat: number, lng: number, polygon: Coord[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].latitude,  yi = polygon[i].longitude;
    const xj = polygon[j].latitude,  yj = polygon[j].longitude;
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function getDistance(a: Coord, b: Coord): number {
  const R = 6371000;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const x = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

export function getDistanceKm(a: Coord, b: Coord): number {
  return getDistance(a, b) / 1000;
}

// ── Filtro GPS ────────────────────────────────────────────────────────────────
export const MAX_SPEED_KMH = 30;        // Anti-cheat: max speed allowed
export const MAX_SPEED_MPS = MAX_SPEED_KMH / 3.6;
// Velocidad mínima (m/s) para contar como movimiento real al medir la distancia
// por velocidad GPS (Doppler). Por debajo (~1.8 km/h) la "velocidad" del chip
// suele ser ruido estando parado → no sumamos metros (la distancia no sube
// parado en un semáforo).
export const MIN_MOVING_MPS = 0.5;
// Máximo dt (segundos) entre dos lecturas para integrar velocidad×tiempo. A
// ritmo de paseo, con distanceInterval=8m, una lectura llega cada ~6-10s; con
// pantalla bloqueada Android espacia aún más. Con el cap en 6s se caían casi
// todos los intervalos de paseo → infraconteo (~64% real, medido vs iPhone:
// CORRR 1.31 vs reloj 2.06 km). 15s captura paseo + background moderado y sigue
// descartando huecos largos de verdad (pausa/lock profundo).
export const MAX_DOPPLER_DT_S = 15;
// Factor de calibración de la distancia por velocidad. El GPS de muchos Android
// (medido en Xiaomi) reporta la velocidad de ANDAR ~40% más alta de lo real, así
// que la integración velocidad×tiempo se pasa de forma consistente. Medido vs
// Apple Watch en 2 caminatas: CORRR 1.38× y 1.44× la distancia real (mientras la
// distancia por POSICIÓN se iba a ~2.8×, aún peor). Factor 0.72 deja el método
// de velocidad dentro de ±4%. Ajustable si algún dispositivo/ritmo se desvía.
export const DOPPLER_CALIBRATION = 0.72;
// Precisión máxima aceptable de una lectura GPS. Por encima de esto el punto
// se descarta ENTERO: ni pinta celda ni suma distancia.
//
// Estaba en 18 m y era demasiado estricto. En ciudad, entre edificios, una
// precisión de 20-35 m es lo normal, así que había carreras en las que NINGÚN
// punto pasaba el filtro: el cronómetro corría, no se pintaba nada, no se
// sumaba ni un metro, y al terminar la carrera se descartaba por "demasiado
// corta". 30 m sigue descartando las lecturas de verdad malas (50-100 m).
export const MAX_ACCURACY_M = 30;
// Los primeros puntos siguen siendo más exigentes: es cuando el GPS está
// calentando y da las lecturas más disparatadas.
export const WARMUP_ACCURACY_M = 20;
export const WARMUP_POINTS = 5;
// Techo de lecturas para el warmup estricto. Sin esto el warmup se podía
// DEADLOCKEAR con la precisión estancada justo por encima del umbral: ningún
// punto pasaba, el contador de aceptados nunca subía y la carrera entera no
// aceptaba nada. 5 lecturas ≈ 15s.
export const WARMUP_MAX_READINGS = 5;

// Suelo de ruido FIJO: si te has "movido" menos que esto entre dos lecturas, es
// jitter del GPS, no movimiento real. El punto saltado MANTIENE el ancla, así
// que el desplazamiento real se acaba contando cuando supera el suelo.
//
// 6m (antes 3m) absorbe el zigzag de drift que inflaba la distancia ~2.36× al
// andar lento (verificado vs Apple Watch: CORRR 1.42km vs reloj 0.60km).
// OJO — NO volver al suelo DINÁMICO max(6, accuracy*0.8): rechazaba movimiento
// real y causó 3 regresiones en vc47. Es el knob de tuning km: si SOBREcuenta →
// subir a 7-8; si INFRAcuenta → bajar a 5.
export const MIN_POINT_DIST_M = 6;
export const MAX_POINT_DIST_M = 100;      // Teleport if jump > 100m in a single update
export const TELEPORT_TIME_THRESHOLD = 8; // Only count as teleport if also >8s gap
// Si entre dos lecturas consecutivas el puente de celdas tendría que cruzar más
// de MAX_BRIDGE_CELLS celdas (≈150m), una de las dos es un outlier de drift —
// NO se reclaman las celdas del puente. Ver context.md §4 "Network of Fake Cells".
export const MAX_BRIDGE_CELLS = 15;

// Anti-drift (sentado en una silla): si las últimas STATIONARY_WINDOW lecturas
// caben en un círculo de STATIONARY_RADIUS_M, el GPS está bailando.
export const STATIONARY_WINDOW = 6;
export const STATIONARY_RADIUS_M = 15;
// Segunda opinión vía Doppler: si el chip dice movimiento sostenido, NO estamos
// quietos aunque el bounding box sea pequeño (caminante lento, curva, acera
// estrecha). Varias lecturas, para que un spike aislado no desactive el filtro.
export const DOPPLER_MOVING_WINDOW = 4;
export const DOPPLER_MOVING_MIN_HITS = 2;
// Lecturas seguidas sin velocidad para dar por hecho que está quieto.
export const DOPPLER_STILL_MIN_READINGS = 3;

// Auto-pausa: a los 20 s sin movimiento la carrera se congela sola, y se
// reanuda sola con el primer punto que demuestre movimiento. A los 6 s la
// velocidad mostrada empieza a desvanecerse hacia 0.
export const AUTO_PAUSE_AFTER_S = 20;
export const SPEED_FADE_AFTER_S = 6;

// Circuitos: se cierra uno cuando vuelves a menos de LOOP_CLOSE_DIST_M de un
// punto por el que ya pasaste, con al menos LOOP_MIN_PERIMETER_M recorridos
// desde entonces. Al pulsar STOP se acepta hasta STOP_CLOSE_DIST_M del inicio.
export const LOOP_CLOSE_DIST_M = 30;
export const LOOP_MIN_PERIMETER_M = 200;
export const STOP_CLOSE_DIST_M = 50;
// Distancia máxima entre dos puntos SEGUIDOS dentro de un circuito para
// fiarnos de él. Corriendo, con una lectura cada pocos segundos, dos puntos
// seguidos caen a menos de 60 m; si hay más, ahí el GPS se cortó y la "recta"
// entre ellos no es una calle: es una línea inventada. Rellenar el interior de
// un circuito así es lo que pintaba cuñas enormes en diagonal atravesando
// manzanas (KarolK 20-sep: 4,7 km² con 13 km; Ibanto ese mismo día: una banda
// maciza de 530×430 m con 1,34 km).
export const MAX_LOOP_EDGE_M = 60;

// Hueco sin lecturas (túnel, pérdida de señal): al volver la señal lejos, se
// suma la línea recta SOLO si encaja con alguien andando o corriendo y venías
// moviéndote. Queda corto en una ruta con curvas, pero es mejor que perder el
// tramo entero, que es lo que pasaba. No pinta celdas por el hueco: no sabemos
// por qué calle fuiste.
export const GAP_MIN_KMH = 3;

/** ¿Las últimas N coordenadas caen todas dentro de un círculo de radius m? */
export function isStationary(coords: Coord[]): boolean {
  if (coords.length < STATIONARY_WINDOW) return false;
  const recent = coords.slice(-STATIONARY_WINDOW);
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of recent) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }
  const latM = (maxLat - minLat) * 111000;
  const midLat = (minLat + maxLat) / 2;
  const lngM = (maxLng - minLng) * 111000 * Math.cos(midLat * Math.PI / 180);
  const diag = Math.sqrt(latM * latM + lngM * lngM);
  return diag < STATIONARY_RADIUS_M * 2;
}

/**
 * Filtro central de un punto GPS:
 * - 'accept': punto bueno
 * - 'skip': ruido o mala precisión, se ignora entero
 * - 'teleport': salto tras un hueco de tiempo, empieza tramo nuevo
 */
export function filterGpsPoint(
  newCoord: Coord,
  prevCoord: Coord | null,
  newTimestamp: number,
  prevTimestamp: number,
  accuracy: number,
  speed: number,
  inWarmup: boolean = false,
): { action: 'accept' | 'skip' | 'teleport'; distKm: number; speedKmh: number } {
  // Coordenadas inválidas (NaN/Infinity) o fuera del planeta: pasa muy de tarde
  // en tarde con ciertos chips al perder el fix.
  if (
    !Number.isFinite(newCoord.latitude) ||
    !Number.isFinite(newCoord.longitude) ||
    Math.abs(newCoord.latitude) > 90 ||
    Math.abs(newCoord.longitude) > 180
  ) {
    return { action: 'skip', distKm: 0, speedKmh: 0 };
  }
  const maxAcc = inWarmup ? WARMUP_ACCURACY_M : MAX_ACCURACY_M;
  if (accuracy > maxAcc) {
    return { action: 'skip', distKm: 0, speedKmh: 0 };
  }

  if (!prevCoord) {
    return { action: 'accept', distKm: 0, speedKmh: 0 };
  }

  const distKm = getDistanceKm(prevCoord, newCoord);
  const distM = distKm * 1000;
  const timeDiff = prevTimestamp > 0 ? (newTimestamp - prevTimestamp) / 1000 : 3;

  if (distM < MIN_POINT_DIST_M) {
    return { action: 'skip', distKm: 0, speedKmh: 0 };
  }

  if (distM > MAX_POINT_DIST_M && timeDiff > TELEPORT_TIME_THRESHOLD) {
    return { action: 'teleport', distKm: 0, speedKmh: 0 };
  }

  const speedKmh = timeDiff > 0 ? (distKm / timeDiff) * 3600 : 0;
  if (speedKmh > MAX_SPEED_KMH) {
    return { action: 'skip', distKm: 0, speedKmh };
  }

  return { action: 'accept', distKm, speedKmh };
}

/** Tramos del recorrido que se cierran de verdad sobre sí mismos.
 *
 *  Un polígono se cierra solo, uniendo el último punto con el primero: si se
 *  rellenaba el recorrido ENTERO y salías de A para acabar en B, esa línea
 *  imaginaria reclamaba toda el área entre tu ruta y la diagonal (Yurena, la
 *  Barceloneta; ocho carreras infladas entre 2 y 5,4 veces). Aquí se buscan
 *  pares de puntos a menos de LOOP_CLOSE_DIST_M con al menos
 *  LOOP_MIN_PERIMETER_M de recorrido entre ellos. Cada uno es un circuito
 *  real; la ida hasta él y la vuelta a casa no encierran nada. */
export function findClosedLoops(path: Coord[]): Coord[][] {
  if (path.length < 8) return [];
  const cum: number[] = [0];
  for (let k = 1; k < path.length; k++) {
    cum[k] = cum[k - 1] + getDistance(path[k - 1], path[k]);
  }
  const loops: Coord[][] = [];
  let from = 0;
  for (let j = 1; j < path.length; j++) {
    for (let i = from; i < j; i++) {
      const perimeter = cum[j] - cum[i];
      // Al crecer i el perímetro solo encoge: si ya es corto, ninguno sirve.
      if (perimeter < LOOP_MIN_PERIMETER_M) break;
      // Un "circuito" de más de 10 km casi siempre es el recorrido entero
      // cerrándose contra sí mismo, que es justo lo que evitamos.
      if (perimeter > 10000) continue;
      if (getDistance(path[i], path[j]) < LOOP_CLOSE_DIST_M) {
        loops.push(path.slice(i, j + 1));
        from = j; // tramo consumido
        break;
      }
    }
  }
  return loops;
}

/** ¿Es un circuito de verdad o hay un corte del GPS dentro?
 *
 *  Un circuito cerrado de verdad son puntos seguidos, uno cada pocos segundos.
 *  Si entre dos puntos seguidos hay un salto largo, ese tramo no se ha corrido:
 *  es una línea recta que el GPS se ha saltado, y todo lo que "encierra" contra
 *  el resto del recorrido es territorio que nadie ha pisado. */
export function isTrustworthyLoop(loop: Coord[]): boolean {
  for (let i = 1; i < loop.length; i++) {
    if (getDistance(loop[i - 1], loop[i]) > MAX_LOOP_EDGE_M) return false;
  }
  return true;
}

/** Añade a `cells` las celdas cuyo centro cae dentro del circuito. */
export function claimLoopInterior(loop: Coord[], cells: Set<string>): void {
  let minCX = Infinity, maxCX = -Infinity, minCY = Infinity, maxCY = -Infinity;
  for (const pt of loop) {
    const c = coordToCell(pt.latitude, pt.longitude);
    if (c.x < minCX) minCX = c.x; if (c.x > maxCX) maxCX = c.x;
    if (c.y < minCY) minCY = c.y; if (c.y > maxCY) maxCY = c.y;
  }
  // 200×200 celdas son 2×2 km: un circuito mayor es un fallo del GPS.
  if ((maxCX - minCX + 1) * (maxCY - minCY + 1) > 40000) return;
  for (let cy = minCY; cy <= maxCY; cy++) {
    for (let cx = minCX; cx <= maxCX; cx++) {
      const k = cellKey(cx, cy);
      if (cells.has(k)) continue;
      const lat = (cy + 0.5) * CELL_LAT_DEG;
      const lng = (cx + 0.5) * CELL_LNG_DEG;
      if (pointInPolygon(lat, lng, loop)) cells.add(k);
    }
  }
}

export type ReadingOutcome =
  /** Ya se había procesado (llegó por dos vías, o se repasó desde disco). */
  | { kind: 'duplicate' }
  | { kind: 'skip' }
  /** Salto tras un hueco: la ruta visual debe empezar tramo nuevo aquí. */
  | { kind: 'teleport'; coord: Coord; resumed: boolean }
  | {
      kind: 'accept';
      coord: Coord;
      /** Se añadieron celdas nuevas. */
      cellsChanged: boolean;
      /** Contó como movimiento real (sumó distancia). */
      moved: boolean;
      speedKmh: number;
      /** Salía de la auto-pausa con este punto. */
      resumed: boolean;
    };

export class RunTracker {
  /** Distancia por velocidad del chip (Doppler × calibración). */
  dopplerKm = 0;
  /** Distancia por posición: suma de desplazamientos aceptados. */
  positionKm = 0;
  /** Celdas reclamadas. Siempre el MISMO Set: la pantalla lo lee por referencia. */
  readonly cells = new Set<string>();
  /** Tramos continuos de puntos aceptados. Un salto abre uno nuevo, y los
   *  circuitos se buscan dentro de cada tramo: nunca a través de un hueco. */
  readonly segments: Coord[][] = [[]];
  autoPaused = false;
  /** Timestamp del último movimiento real, para la auto-pausa. */
  lastMovementAt: number;
  /** Cifras técnicas de la carrera, SIN coordenadas: sirven para entender por
   *  qué una carrera reclamó lo que reclamó sin guardar por dónde fue nadie.
   *  Se mandan al servidor junto con la carrera. */
  readonly diag = {
    /** Lecturas que llegaron del GPS. */
    readings: 0,
    /** Lecturas aceptadas (las que pintan rastro). */
    accepted: 0,
    /** Trozos del recorrido: más de uno = el GPS se cortó. */
    segments: 1,
    /** Metros del mayor salto entre dos puntos seguidos. */
    maxStepM: 0,
    /** Saltos de más de MAX_LOOP_EDGE_M metros. */
    longSteps: 0,
    /** Celdas del rastro, antes de rellenar circuitos. */
    trailCells: 0,
    /** Circuitos cerrados que se rellenaron. */
    loopsFilled: 0,
    /** Circuitos descartados por tener un corte dentro. */
    loopsSkipped: 0,
  };

  private lastCell: { x: number; y: number } | null = null;
  private lastRawTs = 0;
  private lastAcceptedTs = 0;
  private recentCoords: Coord[] = [];
  private recentDoppler: number[] = [];
  private rawReadings = 0;
  private accepted = 0;
  /** Tras una pausa manual el siguiente punto empieza tramo sin sumar el hueco. */
  private gapPending = false;

  constructor(startedAt: number) {
    this.lastMovementAt = startedAt;
  }

  /** La distancia de la carrera: la que se enseña y la que se guarda.
   *  El mayor de los dos métodos, para no descartar una carrera real si uno
   *  de ellos infracuenta en un móvil concreto. */
  get distanceKm(): number {
    return Math.max(this.dopplerKm, this.positionKm);
  }

  get acceptedCount(): number {
    return this.accepted;
  }

  private get lastPoint(): Coord | null {
    const seg = this.segments[this.segments.length - 1];
    return seg.length > 0 ? seg[seg.length - 1] : null;
  }

  addReading(r: GpsReading): ReadingOutcome {
    // Mismo fix dos veces. En Android, con la pantalla apagada, llega por el
    // vigilante de primer plano Y por la tarea de fondo; y al volver a la app
    // se repasa lo guardado en disco. Contarlo otra vez duplicaría metros.
    if (r.timestamp <= this.lastRawTs) return { kind: 'duplicate' };

    const coord: Coord = { latitude: r.latitude, longitude: r.longitude };

    // ── Distancia por velocidad (Doppler) ─────────────────────────────────
    // En CADA lectura, aceptada o no. dt > MAX_DOPPLER_DT_S = hubo un corte y
    // no se integra la velocidad instantánea sobre el hueco.
    const rawDt = this.lastRawTs > 0 ? (r.timestamp - this.lastRawTs) / 1000 : 0;
    this.lastRawTs = r.timestamp;
    // Por encima del tope de velocidad no se cuenta NADA (antes se recortaba
    // a 30 km/h y un trayecto en coche sumaba kilómetros a 30).
    const speedUsable = r.speed >= 0 && r.speed <= MAX_SPEED_MPS && r.accuracy <= MAX_ACCURACY_M;
    if (speedUsable && rawDt > 0 && rawDt <= MAX_DOPPLER_DT_S
        && r.speed >= MIN_MOVING_MPS && !this.autoPaused) {
      this.dopplerKm += (r.speed * rawDt) / 1000 * DOPPLER_CALIBRATION;
    }
    // La ventana de "¿se mueve?" se alimenta con CADA lectura válida, haya
    // hueco o no. Antes solo entraba si el hueco era corto, y parado el móvil
    // apenas manda lecturas (filtro de 8 m): la ventana se quedaba con las
    // velocidades de cuando corrías y decía "en movimiento" indefinidamente,
    // así que la deriva del GPS sumaba metros estando sentado.
    if (speedUsable) {
      this.recentDoppler.push(r.speed);
      if (this.recentDoppler.length > DOPPLER_MOVING_WINDOW) this.recentDoppler.shift();
    }

    this.rawReadings += 1;
    this.diag.readings = this.rawReadings;
    const inWarmup = this.accepted < WARMUP_POINTS && this.rawReadings <= WARMUP_MAX_READINGS;

    if (this.gapPending && this.lastPoint) {
      // Primer punto tras una pausa manual: lo andado en pausa no cuenta.
      const res = filterGpsPoint(coord, null, r.timestamp, 0, r.accuracy, r.speed, inWarmup);
      if (res.action === 'skip') return { kind: 'skip' };
      this.gapPending = false;
      return this.startSegment(coord, r.timestamp);
    }

    const prev = this.lastPoint;
    const result = filterGpsPoint(coord, prev, r.timestamp, this.lastAcceptedTs, r.accuracy, r.speed, inWarmup);
    if (result.action === 'skip') return { kind: 'skip' };

    if (result.action === 'teleport') {
      // Sin lecturas la app se auto-pausa a los 20 s (parado, el móvil no
      // manda posiciones), así que la pausa no distingue "me paré" de "perdí
      // la señal corriendo". Lo distingue la velocidad del hueco: parado y con
      // deriva al recuperar señal sale por debajo de GAP_MIN_KMH.
      let resumed = false;
      if (prev) {
        const gapKm = getDistanceKm(prev, coord);
        const gapS = (r.timestamp - this.lastAcceptedTs) / 1000;
        const gapKmh = gapS > 0 ? (gapKm / gapS) * 3600 : Infinity;
        if (gapKmh >= GAP_MIN_KMH && gapKmh <= MAX_SPEED_KMH) {
          this.positionKm += gapKm;
          this.lastMovementAt = r.timestamp;
          if (this.autoPaused) { this.autoPaused = false; resumed = true; }
        }
      }
      return this.startSegment(coord, r.timestamp, resumed);
    }

    // ── accept ────────────────────────────────────────────────────────────
    const stepM = result.distKm * 1000;
    if (stepM > this.diag.maxStepM) this.diag.maxStepM = Math.round(stepM);
    if (stepM > MAX_LOOP_EDGE_M) this.diag.longSteps += 1;
    this.lastAcceptedTs = r.timestamp;
    this.accepted += 1;
    this.diag.accepted = this.accepted;
    this.segments[this.segments.length - 1].push(coord);
    const outcome = {
      kind: 'accept' as const, coord, cellsChanged: false, moved: false,
      speedKmh: result.speedKmh, resumed: false,
    };

    // Anti-deriva: ¿quieto de verdad? Dos señales. La posición (todas las
    // últimas lecturas dentro de un círculo pequeño) falla con GPS malo, que
    // baila más que ese círculo. La velocidad del chip no: sentado da ~0 m/s
    // aunque la posición salte 15 m. Si varias lecturas seguidas dicen que no
    // hay velocidad, está quieto, diga lo que diga la posición.
    this.recentCoords.push(coord);
    if (this.recentCoords.length > STATIONARY_WINDOW * 2) this.recentCoords.shift();
    const movingHits = this.recentDoppler.filter(s => s >= MIN_MOVING_MPS).length;
    const dopplerMoving = movingHits >= DOPPLER_MOVING_MIN_HITS;
    const dopplerStill = this.recentDoppler.length >= DOPPLER_STILL_MIN_READINGS && movingHits === 0;
    const stationary = (isStationary(this.recentCoords) && !dopplerMoving) || dopplerStill;

    // Auto-pausada: solo la despierta movimiento real. Antes bastaba un salto
    // de deriva de 6 m, y en un semáforo la pausa se encendía y apagaba sola.
    if (this.autoPaused) {
      const movedEnough = result.distKm > 0.005 || result.speedKmh > 1.5;
      if (!movedEnough || stationary) return outcome;
      this.autoPaused = false;
      outcome.resumed = true;
      this.lastMovementAt = r.timestamp;
    }

    if (stationary) return outcome;

    // Celda de este punto y el puente desde la anterior, para que el rastro
    // no tenga agujeros aunque el GPS se salte alguna.
    const cell = coordToCell(coord.latitude, coord.longitude);
    const bridge = this.lastCell ? cellLine(this.lastCell.x, this.lastCell.y, cell.x, cell.y) : [cell];
    if (bridge.length > MAX_BRIDGE_CELLS) {
      this.lastCell = null;
    } else {
      for (const bc of bridge) {
        const k = cellKey(bc.x, bc.y);
        if (!this.cells.has(k)) {
          this.cells.add(k);
          outcome.cellsChanged = true;
        }
      }
      this.lastCell = cell;
    }

    // UNA sola vez. La 1.11.4 sumaba este mismo desplazamiento también antes
    // de la auto-pausa y del anti-deriva, así que cada metro contaba doble
    // (y además subía estando parado).
    if (result.distKm > 0) {
      this.positionKm += result.distKm;
      this.lastMovementAt = r.timestamp;
      outcome.moved = true;
    }
    return outcome;
  }

  private startSegment(coord: Coord, ts: number, resumed = false): ReadingOutcome {
    this.segments.push([coord]);
    this.diag.segments = this.segments.length;
    this.lastAcceptedTs = ts;
    this.lastCell = null; // no se tiende puente sobre un hueco
    this.recentCoords = [];
    return { kind: 'teleport', coord, resumed };
  }

  /** Llamar cada pocos segundos con la hora actual. */
  tick(now: number): 'autopause' | 'fade' | 'none' {
    // Mientras no haya ningún punto aceptado, el GPS aún está fijando: no
    // estás quieto, es que no hay señal todavía.
    if (this.autoPaused || this.accepted === 0) return 'none';
    const stillFor = (now - this.lastMovementAt) / 1000;
    if (stillFor >= AUTO_PAUSE_AFTER_S) {
      this.autoPaused = true;
      return 'autopause';
    }
    if (stillFor >= SPEED_FADE_AFTER_S) return 'fade';
    return 'none';
  }

  /** Pausa manual: manda sobre cualquier auto-pausa. */
  pause(): void {
    this.autoPaused = false;
  }

  /** Reanudar tras pausa manual. */
  resume(now: number): void {
    this.lastMovementAt = now;
    this.gapPending = true;
  }

  /** Al pulsar STOP. Rellena los circuitos cerrados de verdad y devuelve
   *  cuántos había. */
  finish(): { loops: number } {
    let loops = 0;
    this.diag.trailCells = this.cells.size;
    const first = this.segments[0][0];
    this.segments.forEach((seg, idx) => {
      let pts = seg;
      // Parar cerca de donde empezaste cierra el circuito, pero solo si todo
      // fue un tramo continuo: a través de un hueco no se sabe por dónde fuiste.
      if (idx === 0 && this.segments.length === 1 && first && pts.length >= 10) {
        const last = pts[pts.length - 1];
        if (getDistance(first, last) < STOP_CLOSE_DIST_M) pts = [...pts, first];
      }
      for (const loop of findClosedLoops(pts)) {
        // Un circuito con un corte del GPS dentro no se rellena: esa recta no
        // es una calle. Los kilómetros del tramo sí cuentan; el territorio no.
        if (!isTrustworthyLoop(loop)) { this.diag.loopsSkipped += 1; continue; }
        claimLoopInterior(loop, this.cells);
        loops++;
        this.diag.loopsFilled += 1;
      }
    });
    // Aquí había un flood fill sobre TODAS las celdas de la carrera, que
    // rellenaba cualquier hueco rodeado por el rastro. Parecía seguro y no lo
    // era: al perder el GPS un rato la carrera queda partida en trozos, y la
    // ida, la vuelta y el hueco juntos rodean manzanas enteras que nadie ha
    // pisado. Se rellenaban igual, porque el flood fill no distingue un trozo
    // de otro (KarolK 20-sep: 4,7 km² en una carrera de 13 km; Ibanto ese
    // mismo día: una banda maciza de 530×430 m corriendo 1,34 km en zigzag).
    // Ahora solo se rellena el interior de los circuitos que se han cerrado de
    // verdad, uno a uno.
    return { loops };
  }
}
