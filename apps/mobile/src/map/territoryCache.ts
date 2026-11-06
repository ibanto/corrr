/**
 * Territorio guardado EN EL MÓVIL (6-nov-2026), para que el mapa salga pintado
 * al instante al abrir la app y no haya que esperar al servidor.
 *
 * Cada respuesta de /cells/viewport se guarda por CASILLA del servidor: el
 * servidor redondea la caja pedida hacia fuera a múltiplos de CASILLA_SERVIDOR
 * celdas (así reutiliza la respuesta entre usuarios), y aquí se guarda bajo esa
 * misma caja, calculada con la misma regla. Al abrir la app se lee la última
 * vista (centro y zoom) y el territorio de su caja, se pinta, y mientras tanto
 * se pide al servidor lo de verdad, que lo sustituye en cuanto llega.
 *
 * Va por usuario: `duenos[].mine` lo decide el servidor para quien pregunta.
 * Se guardan las últimas MAX_CAJAS cajas (unos 100 KB cada una en una ciudad
 * llena); al pasarse, se tira la más vieja. Todo con red: si el disco falla o
 * lo guardado no se entiende, el mapa funciona igual que si no hubiera nada.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coordToCell } from '../tracking/runTracker';
import { CellBox, MapTerritory } from './territory';

/** Celdas por lado de la casilla del servidor (VIEWPORT_TILE en
 *  apps/backend/src/routes/index.ts). Si cambiara allí, aquí las claves
 *  dejarían de coincidir y simplemente no se acertaría en la caché. */
export const CASILLA_SERVIDOR = 128;
const MAX_CAJAS = 8;
/** Un elemento de AsyncStorage no se relee en Android por encima de ~2 MB
 *  (§9 del CLAUDE.md): por encima de esto no se guarda. */
const MAX_BYTES = 1_500_000;
const PREFIJO = 'corrr:territorio:';

/** La misma caja que devolverá el servidor para estos límites. */
export function cajaDelServidor(north: number, south: number, east: number, west: number): CellBox {
  const sw = coordToCell(south, west);
  const ne = coordToCell(north, east);
  return {
    x0: Math.floor(sw.x / CASILLA_SERVIDOR) * CASILLA_SERVIDOR,
    x1: Math.ceil((ne.x + 1) / CASILLA_SERVIDOR) * CASILLA_SERVIDOR,
    y0: Math.floor(sw.y / CASILLA_SERVIDOR) * CASILLA_SERVIDOR,
    y1: Math.ceil((ne.y + 1) / CASILLA_SERVIDOR) * CASILLA_SERVIDOR,
  };
}

export const claveDeCaja = (c: CellBox) => `${c.x0}:${c.x1}:${c.y0}:${c.y1}`;

/** Centro y zoom de la última vista del mapa. */
export type Vista = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

const kVista = (userId: string) => `${PREFIJO}${userId}:vista`;
const kIndice = (userId: string) => `${PREFIJO}${userId}:cajas`;
const kCaja = (userId: string, clave: string) => `${PREFIJO}${userId}:caja:${clave}`;

export async function leerUltimaVista(userId: string): Promise<Vista | null> {
  try {
    const raw = await AsyncStorage.getItem(kVista(userId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    const ok = [v.latitude, v.longitude, v.latitudeDelta, v.longitudeDelta].every(
      (n) => typeof n === 'number' && Number.isFinite(n));
    return ok && v.latitudeDelta > 0 && v.longitudeDelta > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function guardarUltimaVista(userId: string, vista: Vista): Promise<void> {
  try {
    await AsyncStorage.setItem(kVista(userId), JSON.stringify(vista));
  } catch {}
}

export async function leerTerritorio(userId: string, clave: string): Promise<MapTerritory | null> {
  try {
    const raw = await AsyncStorage.getItem(kCaja(userId, clave));
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t || !Array.isArray(t.duenos) || !Array.isArray(t.tiras) || t.tiras.length % 4 !== 0) return null;
    return { duenos: t.duenos, tiras: t.tiras, owners: t.owners ?? undefined };
  } catch {
    return null;
  }
}

/** Guarda la respuesta del servidor para una caja y recuerda cuáles hay, de
 *  la más vieja a la más nueva, para tirar la más vieja al pasarse. */
export async function guardarTerritorio(userId: string, clave: string, t: MapTerritory): Promise<void> {
  try {
    let raw = JSON.stringify({ duenos: t.duenos, tiras: t.tiras, owners: t.owners });
    // Las fotos son lo único que puede pesar: sin ellas se pinta igual y
    // llegan con la primera respuesta del servidor.
    if (raw.length > MAX_BYTES) raw = JSON.stringify({ duenos: t.duenos, tiras: t.tiras });
    if (raw.length > MAX_BYTES) return;
    await AsyncStorage.setItem(kCaja(userId, clave), raw);
    const rawIndice = await AsyncStorage.getItem(kIndice(userId));
    let indice: string[] = [];
    try { indice = rawIndice ? JSON.parse(rawIndice) : []; } catch { indice = []; }
    if (!Array.isArray(indice)) indice = [];
    indice = indice.filter((k) => k !== clave);
    indice.push(clave);
    const sobran = indice.splice(0, Math.max(0, indice.length - MAX_CAJAS));
    if (sobran.length > 0) await AsyncStorage.multiRemove(sobran.map((k) => kCaja(userId, k)));
    await AsyncStorage.setItem(kIndice(userId), JSON.stringify(indice));
  } catch {}
}
