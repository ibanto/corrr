import { RunTracker, GpsReading } from './runTracker';

export interface ImportedRun {
  /** La distancia de la carrera, calculada igual que en directo. */
  distanceKm: number;
  cells: { x: number; y: number }[];
  loopClosed: boolean;
}

/** Una ruta grabada fuera de CORRR (el Apple Watch) pasa por EXACTAMENTE las
 *  mismas reglas que una carrera en directo: filtro GPS, anti-deriva,
 *  auto-pausa y circuitos. Así un kilómetro del reloj vale lo mismo que uno
 *  de la app, y nadie gana territorio extra por usar un dispositivo u otro.
 *
 *  No se usa la distancia que calcula el propio reloj a propósito: saldría
 *  distinta de la que pinta las celdas, y el anti-trampas del servidor compara
 *  precisamente las dos. */
export function processImportedRoute(readings: GpsReading[]): ImportedRun {
  const sorted = [...readings].sort((a, b) => a.timestamp - b.timestamp);
  const tracker = new RunTracker(sorted.length > 0 ? sorted[0].timestamp : Date.now());
  for (const r of sorted) {
    tracker.addReading(r);
    tracker.tick(r.timestamp);
  }
  const { loops } = tracker.finish();
  const cells = [...tracker.cells].map(k => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });
  return { distanceKm: tracker.distanceKm, cells, loopClosed: loops > 0 };
}
