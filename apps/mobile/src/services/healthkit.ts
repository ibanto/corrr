/**
 * Apple Watch → CORRR, a través de Salud (HealthKit).
 *
 * Las carreras y caminatas que grabas con el reloj se importan solas al abrir
 * la app y cuentan como si las hubieras corrido con CORRR: kilómetros, celdas
 * y robos. Decisiones de producto (sept-2026):
 *   - Automático, sin elegir entreno a entreno.
 *   - Solo entrenos POSTERIORES a conectar: nadie se trae su historial de golpe.
 *   - Correr y caminar. Bici y demás, nunca.
 *   - Cada ruta pasa por el mismo registro que una carrera en directo
 *     (src/tracking/importWorkout.ts), así que cuenta igual.
 * El servidor hace el resto: descarta duplicados (el mismo entreno, o una
 * carrera que ya grabaste con CORRR a la vez), da cada celda a quien pasó por
 * ella más tarde y avisa al rival con la hora real.
 *
 * Solo iOS. La librería se carga bajo demanda: en Android no tiene parte
 * nativa, y cargarla al arrancar la app la rompería.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GpsReading } from '../tracking/runTracker';
import { processImportedRoute } from '../tracking/importWorkout';
import { api } from './api';

/** Se emite (DeviceEventEmitter) cuando entra alguna carrera del reloj, para
 *  que el mapa recargue y enseñe el territorio nuevo. */
export const RUNS_IMPORTED_EVENT = 'corrr:runs-imported';

type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');
const healthKit = (): HealthKitModule => require('@kingstinct/react-native-healthkit');

// Tipos de entreno de HealthKit (HKWorkoutActivityType).
const RUNNING = 37;
const WALKING = 52;
const IMPORTABLE = new Set<number>([RUNNING, WALKING]);

// La ruta llega al iPhone cuando el reloj sincroniza, a veces minutos después
// del entreno. Mientras sea reciente, un entreno sin ruta se vuelve a mirar.
const ROUTE_SYNC_GRACE_MS = 2 * 60 * 60 * 1000;
// Mismo tope que el servidor, con margen.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Mismos mínimos que una carrera en directo para guardarse.
const MIN_CELLS = 5;
const MIN_DISTANCE_KM = 0.05;

interface WatchState {
  /** Cuándo conectó: solo cuentan entrenos que empezaron después. */
  connectedAt: string;
  /** UUIDs ya procesados (importados, duplicados o descartados). */
  seen: string[];
}

const storageKey = (userId: string) => `corrr:apple-watch:${userId}`;

async function loadState(userId: string): Promise<WatchState | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as WatchState) : null;
  } catch {
    return null;
  }
}

async function saveState(userId: string, state: WatchState): Promise<void> {
  // Los últimos 300 bastan: lo anterior ya queda fuera de la ventana de 7 días.
  const trimmed = { ...state, seen: state.seen.slice(-300) };
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(trimmed));
}

export function appleWatchSupported(): boolean {
  return Platform.OS === 'ios';
}

export async function isAppleWatchConnected(userId: string): Promise<boolean> {
  return appleWatchSupported() && (await loadState(userId)) !== null;
}

/** Pide permiso para leer entrenos y sus rutas. Nada más: ni pulso, ni
 *  calorías, ni nada de salud. iOS no dice si el usuario lo concedió (por
 *  privacidad, un permiso de lectura denegado parece simplemente "sin datos"). */
export async function connectAppleWatch(userId: string): Promise<boolean> {
  if (!appleWatchSupported()) return false;
  const hk = healthKit();
  if (!(await hk.isHealthDataAvailable())) return false;
  await hk.requestAuthorization({ toRead: ['HKWorkoutTypeIdentifier', 'HKWorkoutRouteTypeIdentifier'] });
  await saveState(userId, { connectedAt: new Date().toISOString(), seen: [] });
  return true;
}

/** Deja de importar. El permiso en sí se retira desde Ajustes → Salud. */
export async function disconnectAppleWatch(userId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(userId));
}

export interface ImportedWorkout {
  distanceKm: number;
  cells: number;
  stolenCells: number;
  startedAt: Date;
}

let importing = false;

/** Importa los entrenos nuevos. Devuelve los que se guardaron. Nunca lanza:
 *  si algo falla, se reintenta la próxima vez que se abra la app. */
export async function importNewWorkouts(userId: string): Promise<ImportedWorkout[]> {
  if (!appleWatchSupported() || importing) return [];
  const state = await loadState(userId);
  if (!state) return [];
  importing = true;
  const imported: ImportedWorkout[] = [];
  try {
    const hk = healthKit();
    const now = Date.now();
    const since = Math.max(Date.parse(state.connectedAt), now - MAX_AGE_MS);
    const seen = new Set(state.seen);
    const workouts = await hk.queryWorkoutSamples({ limit: 50, ascending: true });

    for (const w of workouts) {
      try {
        const startMs = new Date(w.startDate).getTime();
        const endMs = new Date(w.endDate).getTime();
        if (seen.has(w.uuid) || startMs < since || !IMPORTABLE.has(Number(w.workoutActivityType))) continue;

        const routes = await w.getWorkoutRoutes();
        const readings: GpsReading[] = routes.flatMap(route => route.locations.map(loc => ({
          latitude: loc.latitude,
          longitude: loc.longitude,
          timestamp: new Date(loc.date).getTime(),
          accuracy: loc.horizontalAccuracy,
          speed: loc.speed,
        })));

        if (readings.length === 0) {
          // Sin ruta: o aún no ha sincronizado (se reintenta) o no la tendrá
          // nunca (cinta, reloj de otra marca). Sin ruta no hay territorio.
          if (now - endMs > ROUTE_SYNC_GRACE_MS) seen.add(w.uuid);
          continue;
        }

        const run = processImportedRoute(readings);
        if (run.cells.length < MIN_CELLS || run.distanceKm < MIN_DISTANCE_KM) {
          seen.add(w.uuid);
          continue;
        }

        const res = await api.saveRun({
          distanceKm: run.distanceKm,
          durationSecs: Math.max(1, Math.round((endMs - startMs) / 1000)),
          points: 0, // el servidor calcula los puntos
          loopClosed: run.loopClosed,
          zonesCount: 0,
          zones: [],
          claimedCells: run.cells,
          source: 'healthkit',
          externalId: w.uuid,
          startedAt: new Date(startMs).toISOString(),
          endedAt: new Date(endMs).toISOString(),
        });
        seen.add(w.uuid);
        if (!res.duplicate) {
          imported.push({
            distanceKm: run.distanceKm,
            cells: res.newCellCount ?? run.cells.length,
            stolenCells: res.stolenCells?.length ?? 0,
            startedAt: new Date(startMs),
          });
        }
      } catch (err) {
        // Este entreno no se marca: se reintenta la próxima vez.
        console.warn('[AppleWatch] no se pudo importar un entreno:', err);
      } finally {
        w.dispose?.();
      }
    }
    await saveState(userId, { ...state, seen: [...seen] });
  } catch (err) {
    console.warn('[AppleWatch] importación fallida:', err);
  } finally {
    importing = false;
  }
  return imported;
}
