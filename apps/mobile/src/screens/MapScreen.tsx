import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  Animated,
  Easing,
  Image,
  AppState,
  AppStateStatus,
  DeviceEventEmitter,
  NativeModules,
  Platform,
  ActivityIndicator,
  Dimensions,
  Vibration,
} from 'react-native';
import MapView, { Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  RunTracker, GpsReading, ReadingOutcome,
  CELL_LAT_DEG, CELL_LNG_DEG, coordToCell, cellKey, getDistance,
  LOOP_CLOSE_DIST_M, LOOP_MIN_PERIMETER_M,
} from '../tracking/runTracker';
import { RUNS_IMPORTED_EVENT } from '../services/healthkit';
import { CHECK_TAUNTS_EVENT, RUN_TABS_EVENT } from '../services/notifications';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import polygonClipping from 'polygon-clipping';
import { colors, spacing, radius } from '../theme';
import { api, RemoteZone, RemoteCell, TauntInbox } from '../services/api';
import ZonePopup, { PopupType } from '../components/ZonePopup';
import ShareRunCard, { ShareRunData, ShareSteal } from '../components/ShareRunCard';
import { randomSharePhrase } from '../data/sharePhrases';
import TauntSelector, { getTauntFullImage } from '../components/TauntSelector';
import LoadingScreen from '../components/LoadingScreen';
import { randomPhrase } from '../data/motivationalPhrases';

// Feature flag REVERSIBLE: durante la carrera mostramos una frase motivacional
// (estilo BEBAS, mayúsculas, rota cada minuto) EN VEZ del km/h —que iba mal y
// aporta poco en una app más juego que cronómetro—. Poner en `false` vuelve al
// km/h al instante. Para dejar SOLO tiempo + km, basta con quitar el bloque.
const USE_PHRASES_INSTEAD_OF_SPEED = true;

/** Tamaño de la frase de la pantalla de carrera según lo larga que sea.
 *
 *  `adjustsFontSizeToFit` solo encoge si la caja tiene una altura que
 *  respetar; aquí la frase crecía hacia abajo y las largas (hasta 47
 *  caracteres: "A correr, que la vida es corta y la calle larga") se metían
 *  debajo del botón de pausar. Con esto sale ya con el tamaño que le toca, y
 *  el ajuste automático queda solo de red. */
function phraseFontSize(frase: string): number {
  const n = frase.length;
  if (n <= 16) return 52;
  if (n <= 24) return 44;
  if (n <= 32) return 36;
  if (n <= 42) return 30;
  return 26;
}

/** Helper that picks the right taunt image for inbox display. The mode 'taunt'
 *  in our taunts table corresponds to the message set (1-10), 'response' to the
 *  response set (1-10). The 'robo_notif' mode has no taunt_id. */
function tauntImageById(mode: string, id: number) {
  // Inbox stores 'taunt' and 'response' — both refer to the picker's catalogue.
  const sel = mode === 'response' ? 'response' : 'taunt';
  return getTauntFullImage(sel, id);
}

// Keep screen awake using ExpoKeepAwake native module directly
// This avoids Metro resolution issues with expo-keep-awake package
const ExpoKeepAwake = NativeModules.ExpoKeepAwake;
const activateScreenAwake = async () => {
  try { if (ExpoKeepAwake?.activate) ExpoKeepAwake.activate('corrr-run'); } catch {}
};
const deactivateScreenAwake = () => {
  try { if (ExpoKeepAwake?.deactivate) ExpoKeepAwake.deactivate('corrr-run'); } catch {}
};

// Background location task
const BACKGROUND_LOCATION_TASK = 'corrr-background-location';
const BG_BUFFER_KEY = 'corrr:bg-loc-buffer';

const BG_LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  distanceInterval: 8,
  timeInterval: 3000,
  foregroundService: {
    notificationTitle: 'CORRR — Carrera en curso',
    notificationBody: 'Registrando tu recorrido...',
    notificationColor: '#FF6600',
  },
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  // iOS ajusta el filtrado del GPS para alguien que se mueve a pie.
  activityType: Location.ActivityType.Fitness,
};

const toReading = (loc: Location.LocationObject): GpsReading => ({
  latitude: loc.coords.latitude,
  longitude: loc.coords.longitude,
  timestamp: loc.timestamp ?? Date.now(),
  accuracy: loc.coords.accuracy ?? 999,
  speed: loc.coords.speed ?? -1,
});

// Quién recibe los puntos de la tarea de fondo durante una carrera. Con la app
// viva —lo normal: la propia tarea la mantiene despierta— van directos al
// mismo registro que los de primer plano, así el contador sigue avanzando con
// la pantalla apagada y al desbloquear ya está al día. Antes se amontonaban en
// disco hasta volver a la app y se procesaban con otras reglas.
let bgReadingsListener: ((readings: GpsReading[]) => void) | null = null;

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;
  const readings = locations.map(toReading);
  if (bgReadingsListener) {
    try { bgReadingsListener(readings); return; } catch {}
  }
  // Nadie escuchando (la tarea corre en un contexto JS aparte): a disco, y se
  // repasa al volver a la app. Los repetidos los descarta el registro.
  try {
    const raw = await AsyncStorage.getItem(BG_BUFFER_KEY);
    const existing: GpsReading[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(BG_BUFFER_KEY, JSON.stringify([...existing, ...readings]));
  } catch {}
});

async function loadAndClearPersistedBgBuffer(): Promise<GpsReading[]> {
  try {
    const raw = await AsyncStorage.getItem(BG_BUFFER_KEY);
    await AsyncStorage.removeItem(BG_BUFFER_KEY);
    return raw ? (JSON.parse(raw) as GpsReading[]) : [];
  } catch {
    return [];
  }
}

const DEFAULT_REGION = {
  latitude: 40.4168,
  longitude: -3.7038,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

// Límites de España (incluye Canarias, Baleares)
const SPAIN_BOUNDS = {
  north: 43.85,   // Picos de Europa
  south: 27.5,    // Canarias sur
  west: -18.2,    // Canarias oeste
  east: 4.5,      // Baleares este
};

// Delta máximo para cargar zonas (si se aleja más → no cargar)
const MAX_DELTA_FOR_ZONES = 0.15;

// ── Grid (10m × 10m cells, v1.8.0) ───────────────────────────────────────────
// MUST match the backend formula in apps/backend/src/routes/index.ts. Cells are
// 10m × 10m in Spain (varies by ±5% with latitude). The 10m size accommodates
// typical urban GPS drift (5-15m) — most readings fall in the same cell, so
// claims look like a clean blob instead of a noisy zigzag.
// Las constantes de la cuadrícula están en src/tracking/runTracker.ts.

// Tope de zoom para pintar celdas. Más allá, no se cargan y se avisa con el
// banner "Acércate para ver los territorios" (mismo umbral, ver
// onRegionChangeComplete: usar dos distintos hacía desaparecer el territorio
// sin avisar).
//
// Subido de 0.02 (~2 km) a 0.05 (~5,5 km): en un juego de territorio, ver tu
// barrio entero es lo normal, y con 2 km el mapa se vaciaba en cuanto te
// separabas un poco. No es una celda = un polígono — se fusionan con
// polygon-clipping antes de pintar — así que el coste sube mucho menos que el
// área. Aun así es el número a bajar si algún móvil va lento: se toca solo
// aquí, y hay que probarlo en Android y en iPhone.
const MAX_DELTA_FOR_CELLS = 0.05;

/** Ray-casting point-in-polygon. */
function pointInPolygonLatLng(lat: number, lng: number, poly: { latitude: number; longitude: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].latitude, yi = poly[i].longitude;
    const xj = poly[j].latitude, yj = poly[j].longitude;
    const intersect = ((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Rasterize a closed polygon to the set of cells whose center falls inside it.
 *  Used when a runner closes a loop — every cell inside the loop becomes theirs. */
function rasterizePolygonToCells(polygon: { latitude: number; longitude: number }[]): { x: number; y: number }[] {
  if (polygon.length < 3) return [];
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of polygon) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }
  const sw = coordToCell(minLat, minLng);
  const ne = coordToCell(maxLat, maxLng);
  const cells: { x: number; y: number }[] = [];
  for (let y = sw.y; y <= ne.y; y++) {
    for (let x = sw.x; x <= ne.x; x++) {
      const cLat = (y + 0.5) * CELL_LAT_DEG;
      const cLng = (x + 0.5) * CELL_LNG_DEG;
      if (pointInPolygonLatLng(cLat, cLng, polygon)) cells.push({ x, y });
    }
  }
  return cells;
}

/** Huella del conjunto de celdas de un dueño, para saber si ha cambiado.
 *  No depende del orden y no crea cadenas enormes: con 5.000 celdas, comparar
 *  dos cadenas de 50 KB costaría más que lo que queremos ahorrar. */
function cellsFingerprint(cells: { x: number; y: number }[]): string {
  let mezcla = 0;
  let suma = 0;
  for (const c of cells) {
    const h = (c.x * 73856093) ^ (c.y * 19349663);
    mezcla ^= h;
    suma = (suma + h) | 0;
  }
  return `${cells.length}:${mezcla}:${suma}`;
}

/** Caja visible en coordenadas de celda, redondeada hacia fuera a bloques.
 *
 *  El redondeo es lo que hace que mover el mapa un poco no dispare ningún
 *  recálculo: mientras sigas dentro del mismo bloque, la caja es la misma, la
 *  huella de cada dueño es la misma y los polígonos se reutilizan tal cual.
 *  BLOQUE = 64 celdas ≈ 640 m, y el margen evita que el territorio aparezca de
 *  golpe justo al borde de la pantalla. */
const VIEW_BLOCK = 64;
const VIEW_MARGIN = 0.4;
function visibleCellBox(region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) {
  const halfLat = (region.latitudeDelta / 2) * (1 + VIEW_MARGIN);
  const halfLng = (region.longitudeDelta / 2) * (1 + VIEW_MARGIN);
  const sw = coordToCell(region.latitude - halfLat, region.longitude - halfLng);
  const ne = coordToCell(region.latitude + halfLat, region.longitude + halfLng);
  const bloque = (v: number, arriba: boolean) =>
    (arriba ? Math.ceil((v + 1) / VIEW_BLOCK) : Math.floor(v / VIEW_BLOCK)) * VIEW_BLOCK;
  return {
    x0: bloque(sw.x, false), x1: bloque(ne.x, true),
    y0: bloque(sw.y, false), y1: bloque(ne.y, true),
  };
}
type CellBox = ReturnType<typeof visibleCellBox>;
const sameBox = (a: CellBox | null, b: CellBox) =>
  !!a && a.x0 === b.x0 && a.x1 === b.x1 && a.y0 === b.y0 && a.y1 === b.y1;
const inBox = (b: CellBox, x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/** Union an array of cells into one (or several disjoint) outlined polygons.
 *  Used to render a territory as a single mass — no internal lines between
 *  adjacent cells, just one stroke around the perimeter of each connected
 *  component. Returns { outer, holes } for each polygon (RN-Maps's <Polygon>
 *  has a `holes` prop). */
type UnionedPolygon = { outer: { latitude: number; longitude: number }[]; holes: { latitude: number; longitude: number }[][] };
function unionCellsToPolygons(cells: { x: number; y: number }[]): UnionedPolygon[] {
  if (cells.length === 0) return [];
  // Las celdas seguidas de una misma fila se mandan como UN rectángulo, no
  // como veinte cuadraditos. La figura que sale es exactamente la misma, pero
  // unir cuesta mucho menos: con el territorio de un corredor de 47.000
  // celdas, 575 ms → 22 ms (403 rectángulos en vez de 47.000 cuadrados). Eso
  // era lo que dejaba la app colgada al robarle a alguien con mucho terreno.
  const porFila = new Map<number, number[]>();
  for (const c of cells) {
    const fila = porFila.get(c.y);
    if (fila) fila.push(c.x);
    else porFila.set(c.y, [c.x]);
  }
  // polygon-clipping usa [lng, lat].
  const ringInput: number[][][][] = [];
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const oeste = x0 * CELL_LNG_DEG, este = x1 * CELL_LNG_DEG;
    const sur = y0 * CELL_LAT_DEG, norte = y1 * CELL_LAT_DEG;
    ringInput.push([[[oeste, sur], [este, sur], [este, norte], [oeste, norte], [oeste, sur]]]);
  };
  porFila.forEach((xs, y) => {
    xs.sort((a, b) => a - b);
    let inicio = xs[0];
    let anterior = xs[0];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] === anterior + 1) { anterior = xs[i]; continue; }
      if (xs[i] === anterior) continue; // repetida
      rect(inicio, y, anterior + 1, y + 1);
      inicio = anterior = xs[i];
    }
    rect(inicio, y, anterior + 1, y + 1);
  });
  let union;
  try {
    // polygon-clipping's overload signature is awkward — accepts variadic args
    // but TS can't infer through `...rest as any`. The Function.apply form sidesteps
    // the typing while doing the exact same thing at runtime.
    union = (polygonClipping.union as any).apply(null, ringInput);
  } catch {
    return [];
  }
  const result: UnionedPolygon[] = [];
  for (const poly of union as number[][][][]) {
    if (!poly || poly.length === 0) continue;
    const outer = poly[0].map((pt: number[]) => ({ latitude: pt[1], longitude: pt[0] }));
    const holes = poly.slice(1).map((h: number[][]) => h.map((pt: number[]) => ({ latitude: pt[1], longitude: pt[0] })));
    result.push({ outer, holes });
  }
  return result;
}

// El filtro GPS, la auto-pausa y el anti-deriva están en src/tracking/runTracker.ts.

const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#999999' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a4a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#333355' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3d3d66' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#161633' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#16213e' }] },
];

/** Color del rival generado vía HSL para garantizar diversidad. El espacio
 *  HSL nos da infinitos tonos distintos en vez de chocar con un palette
 *  de 10 colores fijos. Pasamos `owner_id` (UUID) como seed cuando esté
 *  disponible — más único que el display_name y estable entre sesiones.
 *
 *  - Saturación 70%, luminosidad 55% → siempre se ve bien sobre el mapa oscuro
 *  - Saltamos el rango 0-50° (rojo-naranja) para no chocar con TU naranja (#FF6600 ≈ 24°)
 *  - Resultado: dos rivales distintos casi nunca tienen el mismo color. */
function getRivalColor(seed: string): string {
  if (!seed) return 'hsl(220, 70%, 55%)'; // azul fallback
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  // Hue en [50, 360) — salta el rojo-naranja del usuario propio.
  const hue = 50 + (Math.abs(hash) % 310);
  return `hsl(${hue}, 70%, 55%)`;
}

interface Coord { latitude: number; longitude: number; }
interface ConqueredZone { coords: Coord[]; area: number; points: number; }

interface Props {
  user: { username: string; id: string } | null;
  onNavigateToShop?: () => void;
}

// Conversiones Coord[] <-> polygon-clipping format [lng, lat][]
type Ring = [number, number][];
function coordsToRing(coords: Coord[]): Ring {
  return coords.map(c => [c.longitude, c.latitude]);
}
function ringToCoords(ring: Ring): Coord[] {
  return ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

/** Intersección de dos polígonos usando polygon-clipping */
function polyIntersection(a: Coord[], b: Coord[]): Coord[][] {
  try {
    const result = polygonClipping.intersection(
      [coordsToRing(a)],
      [coordsToRing(b)]
    );
    return result.map(poly => ringToCoords(poly[0]));
  } catch { return []; }
}

/** Unión de dos polígonos */
function polyUnion(a: Coord[], b: Coord[]): Coord[][] {
  try {
    const result = polygonClipping.union(
      [coordsToRing(a)],
      [coordsToRing(b)]
    );
    return result.map(poly => ringToCoords(poly[0]));
  } catch { return [a]; }
}

/** Diferencia a - b (lo que queda de A después de quitar B) */
function polyDifference(a: Coord[], b: Coord[]): Coord[][] {
  try {
    const result = polygonClipping.difference(
      [coordsToRing(a)],
      [coordsToRing(b)]
    );
    return result.map(poly => ringToCoords(poly[0]));
  } catch { return [ringToCoords(coordsToRing(a))]; }
}

/**
 * Deconflicta zonas cargadas del servidor:
 * Si dos zonas de distinto dueño se solapan, la más reciente recorta a la más antigua.
 * Así el mapa siempre muestra las zonas sin superposiciones.
 */
/** Bounding box rápido de un polígono */
function polyBBox(coords: Coord[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const c of coords) {
    if (c.latitude < minLat) minLat = c.latitude;
    if (c.latitude > maxLat) maxLat = c.latitude;
    if (c.longitude < minLng) minLng = c.longitude;
    if (c.longitude > maxLng) maxLng = c.longitude;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** ¿Se solapan dos bounding boxes? */
function bboxOverlap(
  a: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  b: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): boolean {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat &&
         a.minLng <= b.maxLng && a.maxLng >= b.minLng;
}

function deconflictZones(zones: RemoteZone[]): RemoteZone[] {
  try {
    if (zones.length < 2) return zones;

    // Pre-calcular bounding boxes
    const bboxes = zones.map(z => z.polygon?.length >= 3 ? polyBBox(z.polygon) : null);

    // Primero: ¿hay algún solapamiento entre dueños distintos?
    let hasOverlap = false;
    outer: for (let i = 0; i < zones.length; i++) {
      if (!bboxes[i]) continue;
      for (let j = i + 1; j < zones.length; j++) {
        if (!bboxes[j]) continue;
        const sameOwner = (zones[i].is_mine && zones[j].is_mine) ||
          (zones[i].owner_name && zones[j].owner_name && zones[i].owner_name === zones[j].owner_name);
        if (sameOwner) continue;
        if (bboxOverlap(bboxes[i]!, bboxes[j]!)) { hasOverlap = true; break outer; }
      }
    }
    // Si no hay solapamientos, devolver tal cual (rápido)
    if (!hasOverlap) return zones;

    // Ordenar por fecha: más antiguas primero
    const indices = zones.map((_, i) => i).sort((a, b) => {
      const dateA = zones[a].conquered_at ? new Date(zones[a].conquered_at!).getTime() : 0;
      const dateB = zones[b].conquered_at ? new Date(zones[b].conquered_at!).getTime() : 0;
      return dateA - dateB;
    });

    const result: RemoteZone[] = [];
    const clippedPolygons: (Coord[] | null)[] = zones.map(z => z.polygon);

    for (const i of indices) {
      const current = zones[i];
      if (!current.polygon || current.polygon.length < 3) continue;
      let currentPolygon = clippedPolygons[i];
      if (!currentPolygon || currentPolygon.length < 3) continue;

      // Solo buscar zonas más recientes que me solapan
      for (const j of indices) {
        if (j === i) continue;
        const newer = zones[j];
        if (!newer.polygon || newer.polygon.length < 3) continue;
        // Solo zonas más recientes recortan
        const dateI = current.conquered_at ? new Date(current.conquered_at).getTime() : 0;
        const dateJ = newer.conquered_at ? new Date(newer.conquered_at).getTime() : 0;
        if (dateJ <= dateI) continue;

        const sameOwner = (current.is_mine && newer.is_mine) ||
          (current.owner_name && newer.owner_name && current.owner_name === newer.owner_name);
        if (sameOwner) continue;
        if (!bboxes[i] || !bboxes[j] || !bboxOverlap(bboxes[i]!, bboxes[j]!)) continue;

        if (!currentPolygon) break;
        try {
          const remaining = polyDifference(currentPolygon, newer.polygon);
          if (remaining.length > 0 && remaining[0].length >= 3) {
            currentPolygon = remaining[0];
          } else {
            currentPolygon = null;
            break;
          }
        } catch {}
      }

      if (currentPolygon && currentPolygon.length >= 3) {
        result.push({ ...current, polygon: currentPolygon });
      }
    }

    return result.length > 0 ? result : zones;
  } catch {
    return zones;
  }
}

/** Merge own zones that overlap into single larger zones */
function mergeOwnZones(zones: RemoteZone[]): RemoteZone[] {
  try {
    const mine = zones.filter(z => z.is_mine && z.polygon?.length >= 3);
    const others = zones.filter(z => !z.is_mine || !z.polygon || z.polygon.length < 3);
    if (mine.length < 2) return zones;

    const merged: RemoteZone[] = [];
    const used = new Set<number>();

    for (let i = 0; i < mine.length; i++) {
      if (used.has(i)) continue;
      let current = mine[i].polygon;
      let currentZone = mine[i];
      for (let j = i + 1; j < mine.length; j++) {
        if (used.has(j)) continue;
        const bbox1 = polyBBox(current);
        const bbox2 = polyBBox(mine[j].polygon);
        if (!bboxOverlap(bbox1, bbox2)) continue;
        try {
          const result = polyUnion(current, mine[j].polygon);
          if (result.length > 0 && result[0].length >= 3) {
            current = result[0];
            currentZone = { ...currentZone, polygon: current, area_km2: polygonArea(current) };
            used.add(j);
          }
        } catch {}
      }
      merged.push({ ...currentZone, polygon: current });
    }

    return [...others, ...merged];
  } catch {
    return zones;
  }
}

/** Sutherland-Hodgman polygon clipping — intersección de dos polígonos (fallback) */
function clipPolygons(subject: Coord[], clip: Coord[]): Coord[] {
  let output = [...subject];
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const input = [...output];
    output = [];
    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const currInside = isInsideEdge(current, edgeStart, edgeEnd);
      const prevInside = isInsideEdge(prev, edgeStart, edgeEnd);
      if (currInside) {
        if (!prevInside) {
          const inter = lineIntersect(prev, current, edgeStart, edgeEnd);
          if (inter) output.push(inter);
        }
        output.push(current);
      } else if (prevInside) {
        const inter = lineIntersect(prev, current, edgeStart, edgeEnd);
        if (inter) output.push(inter);
      }
    }
  }
  return output;
}

function isInsideEdge(p: Coord, edgeStart: Coord, edgeEnd: Coord): boolean {
  return (edgeEnd.longitude - edgeStart.longitude) * (p.latitude - edgeStart.latitude) -
         (edgeEnd.latitude - edgeStart.latitude) * (p.longitude - edgeStart.longitude) >= 0;
}

function lineIntersect(a1: Coord, a2: Coord, b1: Coord, b2: Coord): Coord | null {
  const d1 = { latitude: a2.latitude - a1.latitude, longitude: a2.longitude - a1.longitude };
  const d2 = { latitude: b2.latitude - b1.latitude, longitude: b2.longitude - b1.longitude };
  const cross = d1.latitude * d2.longitude - d1.longitude * d2.latitude;
  if (Math.abs(cross) < 1e-12) return null;
  const t = ((b1.latitude - a1.latitude) * d2.longitude - (b1.longitude - a1.longitude) * d2.latitude) / cross;
  return {
    latitude: a1.latitude + t * d1.latitude,
    longitude: a1.longitude + t * d1.longitude,
  };
}

/** Douglas-Peucker path simplification — reduce puntos conservando la forma */
function simplifyPath(points: Coord[], tolerance: number): Coord[] {
  if (points.length <= 3) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > tolerance) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), tolerance);
    const right = simplifyPath(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function perpendicularDist(point: Coord, lineStart: Coord, lineEnd: Coord): number {
  const dx = lineEnd.latitude - lineStart.latitude;
  const dy = lineEnd.longitude - lineStart.longitude;
  if (dx === 0 && dy === 0) {
    return Math.sqrt((point.latitude - lineStart.latitude) ** 2 + (point.longitude - lineStart.longitude) ** 2);
  }
  const t = ((point.latitude - lineStart.latitude) * dx + (point.longitude - lineStart.longitude) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  const projLat = lineStart.latitude + tc * dx;
  const projLng = lineStart.longitude + tc * dy;
  return Math.sqrt((point.latitude - projLat) ** 2 + (point.longitude - projLng) ** 2);
}

// Calcula el área del polígono en km²
function polygonArea(coords: Coord[]): number {
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i].longitude * coords[j].latitude;
    area -= coords[j].longitude * coords[i].latitude;
  }
  // Convertir a km² aproximado
  return Math.abs(area) * 111 * 111 * Math.cos(coords[0].latitude * Math.PI / 180) / 2;
}


/** Una fila del desglose de puntos del resumen post-carrera. `highlight` pinta
 *  el valor en naranja (para multiplicadores, que son lo "premium"). */
function BreakdownRow({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <View style={styles.breakdownRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.breakdownLabel}>{label}</Text>
        {hint ? <Text style={styles.breakdownHint}>{hint}</Text> : null}
      </View>
      <Text style={[styles.breakdownValue, highlight && styles.breakdownValueHi]}>{value}</Text>
    </View>
  );
}

export default function MapScreen({ user, onNavigateToShop }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [runTime, setRunTime] = useState(0);
  // `distance` es la distancia OFICIAL, ahora medida por velocidad GPS (Doppler):
  // integramos speed×dt en vez de sumar saltos de posición (inmune al zigzag de
  // drift que inflaba la distancia 3×). Ver handleLocationUpdate.
  const [distance, setDistance] = useState(0);
  // Método VIEJO (suma de saltos de posición) en paralelo. SOLO para comparar
  // con el nuevo en el resumen y validar cuál acierta en este móvil. Temporal.
  const [distancePosDelta, setDistancePosDelta] = useState(0);
  const [currentPath, setCurrentPath] = useState<Coord[]>([]);
  const [conqueredZones, setConqueredZones] = useState<ConqueredZone[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [totalXP, setTotalXP] = useState(0);
  // Celdas robadas a rivales en total (vida del usuario). Usado para el
  // desbloqueo progresivo de taunts: cada 10 robos desbloquea el siguiente
  // mensaje y la siguiente respuesta. Se refresca tras cada saveRun.
  const [totalSteals, setTotalSteals] = useState(0);
  // True mientras saveRun + loadCells están en vuelo después de pulsar STOP.
  // Mostramos LoadingScreen para que el usuario sienta que algo está pasando
  // entre pulsar STOP y aparecer el resumen.
  const [savingRun, setSavingRun] = useState(false);
  const [runSummary, setRunSummary] = useState<{
    visible: boolean; distance: number; distancePosDelta?: number; time: number; points: number; xp: number; zones: number;
    breakdown?: {
      kmPoints: number; cellPoints: number; newCells?: number; stolenCells?: number;
      loopBonus: number; streakMultiplier: number; pbMultiplier: number;
      streakDays: number; beatPB: boolean;
    } | null;
  } | null>(null);
  const [loopDetected, setLoopDetected] = useState(false);
  // Espejo síncrono de "¿se cerró un círculo en esta carrera?". loopDetected es
  // state (async) y stopRun necesita leer el valor al vuelo para mandar
  // `loopClosed` al backend, que calcula el bono de loop autoritativo. Se pone
  // a true dentro de closeLoop y se resetea al iniciar carrera.
  const loopClosedRef = useRef(false);
  const [remoteZones, setRemoteZones] = useState<RemoteZone[]>([]);
  // Grid (v2): cells claimed in the current run live in a Set keyed by "x,y".
  // The polygon system above still runs in parallel during the v1.5 → v1.6 transition
  // until we're confident enough to delete it.
  const claimedCellsRef = useRef<Set<string>>(new Set());
  const [claimedCellsTick, setClaimedCellsTick] = useState(0); // bump to force re-render
  // Generación de polígonos: se incrementa SOLO cuando hay un cambio "duro"
  // de fuente de datos (al terminar una carrera, tras reload de cells). Su
  // función es entrar en la key de cada <Polygon> para forzar a RN-Maps a
  // desmontar y remontar TODOS los polígonos, en vez de reusar la instancia
  // anterior (que a veces cachea el render y se queda con coords obsoletos
  // — el bug "rejilla de celdas" que pedía cerrar/abrir la app). Ojo: no
  // bumpear durante la carrera, RN-Maps reusa polígonos eficientemente
  // mientras solo crecen.
  const [polygonGeneration, setPolygonGeneration] = useState(0);
  // Defensa extra contra el bug "rejilla solapada": al terminar una carrera
  // ocultamos TODOS los polígonos durante un frame antes de remontarlos. El
  // unmount completo (no por cambio de key, que RN-Maps a veces ignora a
  // nivel nativo) fuerza a la capa nativa de Google Maps a destruir las
  // instancias Polygon viejas. Luego el `true` las monta limpias. Esto pasa
  // detrás del LoadingScreen (`savingRun`), así que el usuario no ve flicker.
  const [polygonsVisible, setPolygonsVisible] = useState(true);
  // Tarjeta para compartir en redes. Se rellena al terminar la carrera (con la
  // captura del mapa y los robos) y se abre desde el botón del resumen.
  const [shareCard, setShareCard] = useState<ShareRunData | null>(null);
  const [shareVisible, setShareVisible] = useState(false);
  // True mientras el botón de refrescar el mapa está recargando. Deshabilita el
  // botón y muestra spinner para evitar dobles toques.
  const [refreshingMap, setRefreshingMap] = useState(false);
  // Registro de la carrera en curso: distancia, celdas, auto-pausa. La lógica
  // está en src/tracking/runTracker.ts y se comprueba con `npm run test:gps`.
  const trackerRef = useRef<RunTracker | null>(null);
  const handleReadingRef = useRef<(r: GpsReading, live: boolean) => ReadingOutcome | null>(() => null);
  const [remoteCells, setRemoteCells] = useState<RemoteCell[]>([]);
  /** Zona de la que se calculan y dibujan los territorios. El servidor manda
   *  bastante más de lo que cabe en pantalla (redondea a casillas de 1,3 km
   *  para poder reutilizar la respuesta entre usuarios), y calcular la forma de
   *  todo eso era trabajo tirado: con mucha gente en el mapa, medio segundo de
   *  tirón cada vez que mueves el dedo. */
  const [viewBox, setViewBox] = useState<CellBox | null>(null);
  /** Polígonos ya calculados por dueño. Al mover el mapa, los dueños cuyas
   *  celdas no han cambiado se reutilizan en vez de recalcularse. */
  const unionCacheRef = useRef(new Map<string, { firma: string; polys: UnionedPolygon[] }>());
  const [selectedZone, setSelectedZone] = useState<RemoteZone | null>(null);
  // Modal de "aviso destacado" (prominent disclosure) que Google Play exige
  // mostrar ANTES de invocar el diálogo del sistema para
  // ACCESS_BACKGROUND_LOCATION. La política requiere que el usuario haga
  // una acción afirmativa explícita dentro de la app reconociendo qué datos
  // se recogen y por qué. Sin esto, rechazo automático en revisión.
  const [bgDisclosureVisible, setBgDisclosureVisible] = useState(false);
  // Aviso destacado equivalente para el permiso de ubicación FOREGROUND.
  // Rechazo de Google (jul-2026, "Divulgación insuficiente y poco destacada"):
  // pedíamos ACCESS_FINE_LOCATION a pelo al montar el mapa, sin divulgación
  // previa dentro de la app. TODO diálogo de permiso de ubicación debe ir
  // precedido inmediatamente de su aviso. Se resuelve como promesa para
  // poder await-ear la decisión del usuario en los flujos async.
  const [fgDisclosureVisible, setFgDisclosureVisible] = useState(false);
  const fgDisclosureResolveRef = useRef<((accepted: boolean) => void) | null>(null);
  const [userXP, setUserXP] = useState(0);
  const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);
  const [cityName, setCityName] = useState('...');
  const [mapLoading, setMapLoading] = useState(true);
  const [popup, setPopup] = useState<{ visible: boolean; type: PopupType; points: number; rivalName?: string }>({
    visible: false, type: 'conquered', points: 0,
  });
  const [showTaunts, setShowTaunts] = useState(false);
  // Taunt inbox: unread items from backend. Processed one at a time — show
  // currentTaunt, when user dismisses or responds, advance to the next one.
  const [tauntQueue, setTauntQueue] = useState<TauntInbox[]>([]);
  const [currentTaunt, setCurrentTaunt] = useState<TauntInbox | null>(null);
  // When responding to a robo_notif or a received taunt, this stores the target
  // user and run so the TauntSelector knows where to send the message.
  const [tauntTarget, setTauntTarget] = useState<{ toUserId: string; toName: string; runId: string | null; mode: 'taunt' | 'response'; notifId?: string } | null>(null);
  const [selectedRivalZone, setSelectedRivalZone] = useState<RemoteZone | null>(null);
  // Marcador de territorio del rival cuya zona acabas de tocar. Se pide al
  // abrir la tarjeta, no junto a las celdas: es una consulta por usuario y no
  // tiene sentido calcularla para todos los que salen en pantalla.
  const [rivalTerritory, setRivalTerritory] = useState<Awaited<ReturnType<typeof api.getTerritory>> | null>(null);
  // Fotos de perfil por dueño. Llegan aparte de las celdas porque son la
  // imagen en base64, no una URL: repetirlas por celda disparaba el tamaño de
  // la respuesta a decenas de MB.
  const ownerAvatarsRef = useRef<Record<string, string | null>>({});
  const [zoomedOutTooMuch, setZoomedOutTooMuch] = useState(false);
  const [speedWarning, setSpeedWarning] = useState(false);
  // Aviso de señal: si durante la carrera no entra ningún punto válido, el
  // cronómetro corre pero no se registra NADA, y el usuario no se entera hasta
  // el final —cuando la carrera se descarta por "demasiado corta" y se pierde.
  // Esto lo dice en cuanto pasan 25 segundos sin una lectura utilizable.
  const [gpsWeak, setGpsWeak] = useState(false);
  /** Durante la carrera se puede cambiar entre la pantalla de datos (tiempo,
   *  km, frase) y el mapa, para ver por dónde vas. En el mapa, el botón de
   *  empezar se convierte en los controles de la carrera. */
  const [showRunMap, setShowRunMap] = useState(false);
  /** Si ya hemos avisado de que no hay señal, para vibrar solo en los cambios
   *  y no cada vez que el vigilante comprueba. */
  const gpsWarnedRef = useRef(false);
  /** El zoom de la cámara se fija una sola vez por carrera (ver más abajo). */
  const runCameraSetRef = useRef(false);
  const lastGoodPointRef = useRef<number>(0);
  const gpsWatchTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  // Frase motivacional que rota cada minuto durante la carrera (sustituye km/h).
  const [runPhrase, setRunPhrase] = useState(() => randomPhrase());
  useEffect(() => {
    if (!isRunning) return;
    setRunPhrase(p => randomPhrase(p));
    const id = setInterval(() => setRunPhrase(p => randomPhrase(p)), 60000);
    return () => clearInterval(id);
  }, [isRunning]);
  const [isPaused, setIsPaused] = useState(false);
  // Splits (parciales): pace per completed km. Recorded when distance crosses an integer km.
  const [splits, setSplits] = useState<{ km: number; paceSecs: number }[]>([]);
  const splitsTrackingRef = useRef({ lastKm: 0, lastTime: 0 });
  const speedWarningTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidSegments = useRef(0);
  const isRunningRef = useRef(false);
  const handleLocationUpdateRef = useRef<(loc: Location.LocationObject) => void>(() => {});

  const autoPauseTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Auto-pause silencioso: a los 20s sin movimiento la carrera se pausa sola
  // (sin modal). Cuando el GPS detecta que vuelves a moverte, se reanuda sola.
  // No es lo mismo que `isPaused` (pausa manual con el botón): el manual mantiene
  // la pausa hasta que pulses Reanudar; el auto se reanuda con movimiento.
  const [isAutoPaused, setIsAutoPaused] = useState(false);

  // Splits tracker: each time distance crosses an integer km, record the pace
  // for that km (current runTime minus the time at the previous km marker).
  useEffect(() => {
    if (!isRunning) return;
    const newKm = Math.floor(distance);
    if (newKm > splitsTrackingRef.current.lastKm && newKm > 0) {
      const paceSecs = runTime - splitsTrackingRef.current.lastTime;
      setSplits(prev => [...prev, { km: newKm, paceSecs }]);
      splitsTrackingRef.current = { lastKm: newKm, lastTime: runTime };
    }
  }, [distance, runTime, isRunning]);

  // Al volver a la app durante una carrera: cronómetro al día y repaso de los
  // puntos que la tarea de fondo dejó en disco. Eso solo pasa si corrió sin
  // nadie escuchando; lo normal es que lleguen en directo (bgReadingsListener).
  useEffect(() => {
    const handleAppState = async (nextState: AppStateStatus) => {
      if (!isRunningRef.current || nextState !== 'active') return;
      // Check for new robo notifications and incoming taunts.
      checkUnreadTaunts();
      // Force-recompute runTime from Date.now() math — catches up the timer
      // if the JS thread was suspended while the screen was off.
      if (runStartTimeRef.current) setRunTime(computeRunTime());

      const persisted = await loadAndClearPersistedBgBuffer();
      persisted.sort((a, b) => a.timestamp - b.timestamp);
      for (const r of persisted) handleReadingRef.current(r, false);

      // Reanudar el vigilante de primer plano si se perdió
      if (isRunningRef.current && !locationRef.current) {
        locationRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 8, timeInterval: 3000 },
          handleLocationUpdateRef.current,
        );
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => { sub.remove(); bgReadingsListener = null; };
  }, []);

  // Las animaciones del antiguo loading screen (pulseAnim + rotateAnim)
  // se eliminaron al reemplazar el spinner inline por el componente
  // <LoadingScreen />. Éste tiene su propia Animated.Value interna del aro
  // que gira, así que los Animated.loop de aquí eran código muerto
  // gastando ciclos sin renderizar nada.

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock-based timer state: setInterval misses ticks when the JS thread is
  // suspended (screen off, deep doze). By recomputing runTime from Date.now()
  // every tick, we self-heal — the next interval that fires will jump straight
  // to the correct elapsed time. AppState 'active' also forces a recompute.
  const runStartTimeRef = useRef<number | null>(null);
  const pauseStartedAtRef = useRef<number | null>(null);
  const pausedAccumulatedRef = useRef<number>(0);
  const computeRunTime = () => {
    if (!runStartTimeRef.current) return 0;
    const pausedNow = pauseStartedAtRef.current ? Date.now() - pauseStartedAtRef.current : 0;
    return Math.floor((Date.now() - runStartTimeRef.current - pausedAccumulatedRef.current - pausedNow) / 1000);
  };
  const locationRef = useRef<any>(null);
  const pathRef = useRef<Coord[]>([]);
  const [pathSegments, setPathSegments] = useState<Coord[][]>([]);
  const mapRef = useRef<MapView>(null);
  const currentDelta = useRef({ latDelta: 0.02, lngDelta: 0.02 });

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (results.length > 0) {
        setCityName((results[0].city || results[0].region || '').toUpperCase());
      }
    } catch {}
  };

  const centerOnUser = (lat: number, lng: number) => {
    const region = {
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.012,
      longitudeDelta: 0.012,
    };
    setMapRegion(region);
    mapRef.current?.animateToRegion(region, 800);
  };

  useEffect(() => {
    // Red de seguridad: pase lo que pase con la carga inicial (zonas, red,
    // permiso, una petición que se cuelga sin resolver durante un redeploy del
    // backend…), el mapa NUNCA debe quedarse atascado en "ACTUALIZANDO MAPA".
    // A los 8s lo mostramos sí o sí; el mapa es usable aunque las zonas tarden.
    const mapLoadingSafety = setTimeout(() => setMapLoading(false), 8000);
    (async () => {
      // Cold-start (v1.10.8): arrancar loadZones/loadCells contra
      // DEFAULT_REGION inmediatamente, sin esperar al permiso ni al fix
      // GPS. Antes el mapa se quedaba en blanco 2-5 segundos en arranques
      // fríos (lastKnown null + getCurrentPosition lento). Ahora vemos
      // cells al instante y cuando llega la posición real, re-centramos y
      // re-cargamos con coords del usuario. Las dos llamadas duplicadas
      // valen la pena por la sensación de inmediatez.
      loadZones(DEFAULT_REGION.latitude, DEFAULT_REGION.longitude);
      loadCells(DEFAULT_REGION.latitude, DEFAULT_REGION.longitude);

      // Rechazo Google jul-2026: aquí se pedía el permiso a pelo al montar
      // el mapa. Ahora el diálogo del sistema solo aparece tras aceptar el
      // aviso destacado (ensureForegroundPermission). Si el usuario dice
      // "Ahora no", el mapa sigue funcionando sobre DEFAULT_REGION y se le
      // volverá a ofrecer al pulsar "Iniciar carrera".
      const granted = await ensureForegroundPermission();
      if (granted) {
        try {
          // Primero intentar última ubicación conocida (instantáneo)
          const lastKnown = await Location.getLastKnownPositionAsync();
          if (lastKnown) {
            centerOnUser(lastKnown.coords.latitude, lastKnown.coords.longitude);
            loadZones(lastKnown.coords.latitude, lastKnown.coords.longitude);
            loadCells(lastKnown.coords.latitude, lastKnown.coords.longitude);
            reverseGeocode(lastKnown.coords.latitude, lastKnown.coords.longitude);
          }
          // Luego obtener ubicación precisa
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
            timeInterval: 10000,
          });
          centerOnUser(loc.coords.latitude, loc.coords.longitude);
          loadZones(loc.coords.latitude, loc.coords.longitude);
          loadCells(loc.coords.latitude, loc.coords.longitude);
          reverseGeocode(loc.coords.latitude, loc.coords.longitude);
          checkUnreadTaunts();
        } catch (e) {
          console.warn('[Location] Error getting position:', e);
          loadZones(DEFAULT_REGION.latitude, DEFAULT_REGION.longitude);
        }
      } else {
        console.warn('[Location] Permission denied');
        loadZones(DEFAULT_REGION.latitude, DEFAULT_REGION.longitude);
      }
    })();
    return () => clearTimeout(mapLoadingSafety);
  }, []);

  const loadUserXP = async () => {
    try {
      const data = await api.getMyStats();
      if (data?.stats?.total_points) {
        // Backend computa total_xp = floor(total_points/100) + bonus_xp.
        // Fallback al cálculo antiguo si el backend no lo manda todavía.
        setUserXP(data.stats.total_xp ?? Math.floor(data.stats.total_points / 100));
      }
      // total_steals viene del backend (campo añadido para desbloqueo de
      // taunts). Si una build vieja del backend no lo manda, defaulteamos a 0
      // y el usuario empieza con solo el primer mensaje desbloqueado.
      setTotalSteals(data?.stats?.total_steals ?? 0);
    } catch {}
  };

  useEffect(() => { loadUserXP(); }, []);

  const loadZones = async (lat?: number, lng?: number) => {
    try {
      const useLat = lat ?? mapRegion.latitude;
      const useLng = lng ?? mapRegion.longitude;
      // No cargar zonas si el zoom es demasiado amplio
      if (currentDelta.current.latDelta > MAX_DELTA_FOR_ZONES) {
        setMapLoading(false);
        return;
      }
      const zones = await api.getNearbyZones(useLat, useLng);

      // Deconflictar rivales + merge propias solapadas
      const fixed = deconflictZones(zones);
      const merged = mergeOwnZones(fixed.length > 0 ? fixed : zones);
      const finalZones = merged.length > 0 ? merged : zones;
      setRemoteZones(finalZones);
      setMapLoading(false);

      // Detectar si me han robado zonas (usar zonas deconflictadas)
      checkForStolenZones(finalZones);
    } catch {
      // CRÍTICO: si la carga de zonas falla (red caída, backend reiniciándose
      // en un redeploy, 401…) hay que limpiar igualmente el loading. Antes el
      // catch vacío dejaba el mapa colgado para siempre en "ACTUALIZANDO MAPA"
      // sin reintento. El mapa funciona sin zonas (las celdas cargan aparte).
      setMapLoading(false);
    }
  };

  /** Load cells (v2 grid) for the current map viewport. Cheap call; runs alongside
   *  loadZones during the polygon→grid transition. */
  // Temporizador para recargar celdas al mover el mapa. Con retardo: mientras
  // arrastras se disparan muchos onRegionChangeComplete seguidos y no tiene
  // sentido pedirle al servidor una consulta por cada uno.
  const regionReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancelar el temporizador al salir de la pantalla: si no, puede dispararse
  // una recarga sobre un componente ya desmontado.
  useEffect(() => () => {
    if (regionReloadTimer.current) clearTimeout(regionReloadTimer.current);
  }, []);

  const loadCells = async (lat?: number, lng?: number) => {
    try {
      // Skip when zoomed out — would return thousands of cells and choke the map.
      if (currentDelta.current.latDelta > MAX_DELTA_FOR_CELLS) {
        setRemoteCells([]);
        return;
      }
      const useLat = lat ?? mapRegion.latitude;
      const useLng = lng ?? mapRegion.longitude;
      // Use the current viewport's delta to compute the bounding box. We could
      // be more precise by reading the actual region from onRegionChangeComplete,
      // but ±latDelta gives us roughly what's on screen.
      // Radio mínimo ~1km: tras una carrera la cámara está en zoom 17 (viewport
      // pequeño); sin este mínimo, un "Refrescar" a ese zoom traería solo un trozo
      // y el resto del run desaparecería (ahora claimedCellsRef se vacía tras
      // guardar). Con el mínimo, el refresh cubre un run típico.
      const halfLat = Math.max(currentDelta.current.latDelta / 2, 0.01);
      const halfLng = Math.max(currentDelta.current.lngDelta / 2, 0.01);
      const { cells, owners } = await api.getCellsInViewport(
        useLat + halfLat,
        useLat - halfLat,
        useLng + halfLng,
        useLng - halfLng,
      );
      // Acumulamos las fotos en vez de reemplazarlas: al moverte por el mapa
      // cada carga trae solo los dueños de ese encuadre, y no queremos perder
      // la foto de uno cuya zona acabas de dejar atrás.
      if (owners) {
        for (const [id, o] of Object.entries(owners)) ownerAvatarsRef.current[id] = o.avatar;
      }
      setRemoteCells(cells);
    } catch {}
  };

  /** Tras una carrera: recarga las celdas del servidor cubriendo TODO el bounding
   *  box del run (a partir de claimedCellsRef), no solo el viewport tight de zoom
   *  17. Permite luego VACIAR claimedCellsRef y pintar SOLO la verdad del servidor,
   *  igual que al reabrir la app → sin dobles tonos ni solapes de la capa local. */
  const loadCellsForRunArea = async () => {
    if (claimedCellsRef.current.size === 0) { await loadCells(); return; }
    try {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      claimedCellsRef.current.forEach(k => {
        const ci = k.indexOf(',');
        const x = parseInt(k.slice(0, ci), 10);
        const y = parseInt(k.slice(ci + 1), 10);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      const pad = 2; // celdas de margen alrededor del run
      let north = (maxY + 1 + pad) * CELL_LAT_DEG;
      let south = (minY - pad) * CELL_LAT_DEG;
      let east  = (maxX + 1 + pad) * CELL_LNG_DEG;
      let west  = (minX - pad) * CELL_LNG_DEG;
      // Radio mínimo ~1km, MISMO criterio que loadCells. Sin esto, la caja era
      // solo la de la carrera recién terminada (una vuelta de 200m ≈ 130m de
      // caja) y como abajo hacemos setRemoteCells(cells) —que REEMPLAZA, no
      // fusiona— todo el territorio conquistado antes que cayera fuera de esa
      // caja desaparecía del mapa al terminar de correr. Los datos seguían en
      // el servidor: era solo que dejábamos de pedirlos.
      const MIN_HALF_LAT = 0.01;
      const MIN_HALF_LNG = 0.01;
      const centerLat = (north + south) / 2;
      const centerLng = (east + west) / 2;
      if ((north - south) / 2 < MIN_HALF_LAT) {
        north = centerLat + MIN_HALF_LAT;
        south = centerLat - MIN_HALF_LAT;
      }
      if ((east - west) / 2 < MIN_HALF_LNG) {
        east = centerLng + MIN_HALF_LNG;
        west = centerLng - MIN_HALF_LNG;
      }
      const { cells, owners } = await api.getCellsInViewport(north, south, east, west);
      if (owners) {
        for (const [id, o] of Object.entries(owners)) ownerAvatarsRef.current[id] = o.avatar;
      }
      setRemoteCells(cells);
    } catch {
      await loadCells().catch(() => {});
    }
  };

  /** Refrescar el mapa a mano (botón de la cabecera). Recarga celdas + zonas y
   *  fuerza el remount limpio de los polígonos (mismo truco que stopRun:
   *  ocultar → recargar → bump generación → mostrar). Resuelve el caso de
   *  "perímetro marcado pero interior opaco" tras una carrera SIN tener que
   *  salir y volver a entrar al mapa. */
  const refreshMap = async () => {
    if (refreshingMap) return; // evita dobles toques
    setRefreshingMap(true);
    try {
      setPolygonsVisible(false);
      await Promise.all([loadCells(), loadZones()]);
      // NO vaciamos claimedCellsRef (igual que en stopRun desde v1.10.9):
      // loadCells solo trae el viewport actual, así que el set local garantiza
      // que las celdas fuera de pantalla sigan pintadas. myCellsUnion deduplica.
      setClaimedCellsTick(t => t + 1);
      setPolygonGeneration(g => g + 1);
      await new Promise(r => setTimeout(r, 50)); // deja que el unmount llegue a nativo
      setPolygonsVisible(true);
    } catch {}
    finally {
      setRefreshingMap(false);
    }
  };

  // Carrera importada del Apple Watch (ver App.tsx): recargar el mapa para que se
  // vea su territorio, con la recarga SEGURA del botón de refrescar (ocultar
  // polígonos → recargar → mostrar). La 1.11.6 (11) usaba loadCells a secas: el
  // territorio nuevo cambiaba la forma de los polígonos, se quitaban y añadían en
  // la misma pasada, y en iPhone la capa de compatibilidad de react-native-maps
  // insertaba un hijo nulo → la app se cerraba (NSInvalidArgumentException
  // "object cannot be nil", informe del 16-sep-2026 16:15). Por ref, para llamar
  // siempre a la refreshMap actual y no a la del primer render.
  const refreshMapRef = useRef(refreshMap);
  refreshMapRef.current = refreshMap;
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(RUNS_IMPORTED_EVENT, () => {
      if (!isRunningRef.current) refreshMapRef.current();
    });
    return () => sub.remove();
  }, []);

  /** Fetch unread taunts and queue them. Called on mount + on AppState 'active'.
   *  Each item gets shown one at a time via the tauntQueue useEffect below. */
  // Ids de taunts ya encolados esta sesión. Evita que el sondeo periódico
  // re-encole los mismos no-leídos una y otra vez (crearía modales duplicados).
  // Un taunt leído deja de venir en getUnreadTaunts, así que el set solo crece
  // con los que están pendientes de mostrarse — tamaño acotado.
  const enqueuedTauntIdsRef = useRef<Set<string>>(new Set());
  const checkUnreadTaunts = async () => {
    try {
      const { taunts } = await api.getUnreadTaunts();
      if (!taunts || taunts.length === 0) return;
      const fresh = taunts.filter(t => !enqueuedTauntIdsRef.current.has(t.id));
      if (fresh.length === 0) return;
      for (const t of fresh) enqueuedTauntIdsRef.current.add(t.id);
      setTauntQueue(prev => [...prev, ...fresh]);
    } catch {}
  };

  // Drain the queue: when currentTaunt is null, pop the head of the queue.
  useEffect(() => {
    if (!currentTaunt && tauntQueue.length > 0) {
      const [next, ...rest] = tauntQueue;
      setCurrentTaunt(next);
      setTauntQueue(rest);
    }
  }, [tauntQueue, currentTaunt]);

  // Presentación DIFERIDA de los avisos de robo/mensaje. En iOS un <Modal> no
  // llega a presentarse si se monta mientras otro se está cerrando, ni si vive
  // en un subárbol con display:'none' (MapScreen se oculta así al cambiar de
  // pestaña, ver App.tsx). El resultado era que el aviso "te han robado" no
  // salía al abrir la app y solo aparecía cuando el usuario toqueteaba el menú
  // inferior y algo forzaba un re-render. Aquí esperamos a que no haya ningún
  // otro modal en pantalla y damos un respiro antes de presentar.
  const [tauntReady, setTauntReady] = useState(false);
  useEffect(() => {
    const blocked = mapLoading || savingRun || !!runSummary?.visible || popup.visible || showTaunts;
    if (!currentTaunt || blocked) { setTauntReady(false); return; }
    const t = setTimeout(() => setTauntReady(true), 350);
    return () => clearTimeout(t);
  }, [currentTaunt, mapLoading, savingRun, runSummary?.visible, popup.visible, showTaunts]);

  // Lo mismo para el final de la carrera. El resumen se montaba en el instante
  // en que se cerraba la cartela de "zona conquistada", y en iOS un modal que
  // se monta mientras otro se cierra no llega a presentarse: salía la cartela
  // y después nada. La carrera sí se guardaba, pero no veías ni km ni tiempo
  // ni puntos. Ahora cada uno espera a que el anterior haya terminado de irse.
  const [popupReady, setPopupReady] = useState(false);
  useEffect(() => {
    if (!popup.visible || savingRun) { setPopupReady(false); return; }
    const t = setTimeout(() => setPopupReady(true), 350);
    return () => clearTimeout(t);
  }, [popup.visible, savingRun]);
  const [summaryReady, setSummaryReady] = useState(false);
  useEffect(() => {
    if (!runSummary?.visible || savingRun || popup.visible) { setSummaryReady(false); return; }
    const t = setTimeout(() => setSummaryReady(true), 350);
    return () => clearTimeout(t);
  }, [runSummary?.visible, savingRun, popup.visible]);

  /** Pasar del aviso "te han robado" al selector de mensajes.
   *
   *  Antes esto cerraba el aviso y abría el selector 320 ms después. Ese hueco
   *  entre los dos modales es donde se perdía la respuesta: si el selector no
   *  llegaba a presentarse —pasa en iOS cuando uno se está cerrando— el
   *  usuario se quedaba sin nada Y la notificación ya se había marcado como
   *  leída, así que tampoco podía reintentarlo. Visto en producción: un
   *  robo_notif leído sin ningún taunt detrás.
   *
   *  Dos cambios:
   *
   *  1. Se MONTA el selector antes de desmontar el aviso, no al revés. Sin
   *     hueco entre ambos no hay carrera que perder.
   *  2. La notificación ya NO se marca como leída aquí. Se marca al enviar el
   *     mensaje de verdad (o si el usuario cierra el selector sin enviar). Si
   *     algo falla por el camino, el aviso sigue ahí la próxima vez en vez de
   *     desaparecer sin dejar rastro. */
  const respondToTaunt = (t: TauntInbox, mode: 'taunt' | 'response') => {
    if (!t.from_user_id) return;
    setTauntTarget({
      toUserId: t.from_user_id,
      toName: t.from_user_name ?? 'Rival',
      runId: t.run_id,
      mode,
      notifId: t.id,   // para marcarla leída cuando de verdad se resuelva
    });
    setShowTaunts(true);
    // El aviso se retira DESPUÉS, ya con el selector montado encima.
    setTauntReady(false);
    setTimeout(() => setCurrentTaunt(null), 60);
  };

  // Sondeo periódico del inbox mientras la app está abierta. Antes solo se
  // consultaba al montar y al volver a foreground → si la app ya estaba abierta,
  // un mensaje/respuesta entrante NO aparecía hasta minimizar y reabrir (de ahí
  // el "la respuesta no le llega a B"). Con un poll cada 45s los taunts y
  // responses entrantes salen solos. Pausado durante la carrera para no
  // distraer; al terminar, el foreground/siguiente tick lo recoge.
  useEffect(() => {
    if (isRunning) return;
    const id = setInterval(() => { checkUnreadTaunts(); }, 45_000);
    return () => clearInterval(id);
  }, [isRunning]);

  // Y sin esperar al sondeo cuando llega o se pulsa una notificación: pulsar
  // el aviso y que no salga nada hasta medio minuto después es lo que hacía
  // que pareciera que la app no se enteraba.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CHECK_TAUNTS_EVENT, () => { checkUnreadTaunts(); });
    return () => sub.remove();
  }, []);

  /** Une las celdas de un dueño en polígonos, reutilizando el resultado si ese
   *  dueño no ha cambiado. Unir es lo caro de todo el mapa. */
  const unionCached = (clave: string, cells: { x: number; y: number }[]): UnionedPolygon[] => {
    const firma = cellsFingerprint(cells);
    const guardado = unionCacheRef.current.get(clave);
    if (guardado && guardado.firma === firma) return guardado.polys;
    const polys = unionCellsToPolygons(cells);
    unionCacheRef.current.set(clave, { firma, polys });
    // Tope de memoria: con muchos dueños vistos a lo largo de una sesión, la
    // caché crecería sin freno. Al pasarse, se tira la entrada más antigua.
    if (unionCacheRef.current.size > 60) {
      const vieja = unionCacheRef.current.keys().next().value;
      if (vieja !== undefined) unionCacheRef.current.delete(vieja);
    }
    return polys;
  };

  // Pre-computed unions of cells per owner. Rebuilt only when remoteCells or
  // this-run claims change — polygon-clipping is too expensive to do per render.
  const myCellsUnion = useMemo(() => {
    const myCells: { x: number; y: number }[] = [];
    const seen = new Set<string>();
    for (const c of remoteCells) {
      if (!c.is_mine) continue;
      if (viewBox && !inBox(viewBox, c.cell_x, c.cell_y)) continue;
      const k = cellKey(c.cell_x, c.cell_y);
      if (seen.has(k)) continue;
      seen.add(k);
      myCells.push({ x: c.cell_x, y: c.cell_y });
    }
    // Las celdas de la carrera en curso van SIEMPRE, se esté mirando donde se
    // esté: es el rastro que el corredor está viendo pintarse en directo.
    claimedCellsRef.current.forEach(k => {
      if (seen.has(k)) return;
      seen.add(k);
      const [xs, ys] = k.split(',');
      myCells.push({ x: parseInt(xs, 10), y: parseInt(ys, 10) });
    });
    return unionCached('yo', myCells);
  }, [remoteCells, claimedCellsTick, viewBox]);

  /** Rival cells grouped by owner_id → one merged polygon per owner. Each carries
   *  the owner metadata so taps still resolve to the rival info modal. */
  const rivalCellsUnions = useMemo(() => {
    const byOwner = new Map<string, { ownerId: string; ownerName: string | undefined; ownerWarCry: string | null | undefined; ownerAvatar: string | null | undefined; cells: { x: number; y: number }[] }>();
    for (const c of remoteCells) {
      if (c.is_mine) continue;
      if (viewBox && !inBox(viewBox, c.cell_x, c.cell_y)) continue;
      const entry = byOwner.get(c.owner_id);
      if (entry) entry.cells.push({ x: c.cell_x, y: c.cell_y });
      else byOwner.set(c.owner_id, {
        ownerId: c.owner_id,
        ownerName: c.owner_name,
        ownerWarCry: c.owner_war_cry,
        ownerAvatar: ownerAvatarsRef.current[c.owner_id] ?? null,
        cells: [{ x: c.cell_x, y: c.cell_y }],
      });
    }
    return Array.from(byOwner.values()).map(o => ({
      ownerId: o.ownerId,
      ownerName: o.ownerName,
      ownerWarCry: o.ownerWarCry,
      ownerAvatar: o.ownerAvatar,
      polygons: unionCached(o.ownerId, o.cells),
    }));
  }, [remoteCells, viewBox]);

  const stolenCheckDone = useRef(false);
  const checkForStolenZones = async (zones: RemoteZone[]) => {
    if (stolenCheckDone.current || !user?.id) return;
    stolenCheckDone.current = true;
    try {
      const key = `my_zones_snapshot_${user.id}`;
      const myZones = zones.filter(z => z.is_mine);

      // Calcular áreas reales de los polígonos (post-deconflicto)
      const currentSnapshot = myZones.map(z => ({
        id: z.id,
        area: z.polygon?.length >= 3 ? polygonArea(z.polygon) : z.area_km2,
        count: z.polygon?.length ?? 0,
      }));

      const prevRaw = await AsyncStorage.getItem(key);
      const prevZones: { id: string; area: number; count?: number }[] = prevRaw ? JSON.parse(prevRaw) : [];

      // Guardar snapshot actual para la próxima vez
      await AsyncStorage.setItem(key, JSON.stringify(currentSnapshot));

      // Primera vez o sin zonas previas → no hay referencia
      if (prevZones.length === 0) return;

      // Buscar zonas rivales recientes que solapan con las mías → esos son los ladrones
      let stolenCount = 0;
      const stolenNames: string[] = [];
      const rivalZones = zones.filter(z => !z.is_mine);

      // IDs de rivales que ya existían en el snapshot anterior
      const prevRivalKey = `rival_zones_snapshot_${user.id}`;
      const prevRivalRaw = await AsyncStorage.getItem(prevRivalKey);
      const prevRivalIds: string[] = prevRivalRaw ? JSON.parse(prevRivalRaw) : [];
      await AsyncStorage.setItem(prevRivalKey, JSON.stringify(rivalZones.map(r => r.id)));

      // Solo rivales NUEVOS (no estaban antes)
      const newRivals = rivalZones.filter(r => !prevRivalIds.includes(r.id));

      for (const rival of newRivals) {
        for (const mine of myZones) {
          if (!mine.polygon || mine.polygon.length < 3) continue;
          if (!rival.polygon || rival.polygon.length < 3) continue;
          const bbox1 = polyBBox(mine.polygon);
          const bbox2 = polyBBox(rival.polygon);
          if (bboxOverlap(bbox1, bbox2)) {
            stolenCount++;
            if (rival.owner_name && !stolenNames.includes(rival.owner_name)) {
              stolenNames.push(rival.owner_name);
            }
            break;
          }
        }
      }

      if (stolenCount > 0) {
        setPopup({
          visible: true,
          type: 'stolen_from_you',
          points: stolenCount * 50,
          rivalName: stolenNames.length > 0 ? stolenNames.join(', ') : undefined,
        });
      }
    } catch {}
  };

  /** Con qué punto anterior se cierra el circuito, o -1 si no se cierra.
   *
   *  Solo dentro del tramo ACTUAL. Antes se buscaba el cierre contra todos los
   *  puntos de la carrera, saltando por encima de los huecos del GPS: un tramo
   *  perdido "cerraba" contra la ida y la zona se quedaba manzanas por las que
   *  nadie había pasado. Por un hueco no se sabe por dónde se fue.
   *
   *  El cierre se busca contra CUALQUIER punto anterior, no solo el inicio:
   *  sales de casa, das una vuelta cerrada y sigues; el circuito está cerrado
   *  aunque acabes lejos. Los 200 m de recorrido entre los dos puntos evitan
   *  que un ida y vuelta corto o estar parado cuenten como circuito.
   */
  const findLoopStart = (path: Coord[]): number => {
    if (path.length < 10) return -1;
    const current = path[path.length - 1];
    let travelled = 0;
    for (let i = path.length - 1; i > 0; i--) {
      travelled += getDistance(path[i - 1], path[i]);
      if (travelled < LOOP_MIN_PERIMETER_M) continue;
      if (getDistance(path[i - 1], current) < LOOP_CLOSE_DIST_M) return i - 1;
    }
    return -1;
  };

  const checkLoop = (path: Coord[]) => findLoopStart(path) >= 0;

  const closeLoop = async (path: Coord[]) => {
    setLoopDetected(true);

    // La zona es EL CIRCUITO que se ha cerrado, no toda la carrera.
    //
    // Antes, si el GPS se había cortado alguna vez, esto usaba la envolvente
    // convexa de todos los puntos: la figura más pequeña que los envuelve,
    // cruzando manzanas en diagonal. Con ella se robaban zonas rivales por las
    // que no se había pasado, y el contorno guardado no se parecía al
    // recorrido (Ibanto, 20-sep: un lado recto de 343 m atravesando el
    // Eixample). Ahora se usa el tramo del recorrido que cierra el circuito,
    // simplificado a 3 m, que es por donde se ha corrido de verdad.
    const inicio = findLoopStart(path);
    const loopPath = inicio >= 0 ? path.slice(inicio) : path;
    const snapped = simplifyPath(loopPath, 0.00003); // ~3m tolerancia

    // Asegurar que el polígono está cerrado
    if (snapped.length >= 3) {
      const first = snapped[0];
      const last = snapped[snapped.length - 1];
      if (getDistance(first, last) > 5) {
        snapped.push({ ...first });
      }
    }

    // Las celdas NO salen de aquí. El territorio lo decide RunTracker.finish()
    // al terminar la carrera: rellena el interior de cada circuito cerrado de
    // verdad, nunca a través de un hueco del GPS. `snapped` se usa solo para el
    // polígono de la zona (sistema antiguo): el área, el robo de zonas rivales
    // y lo que se guarda en la tabla de zonas.

    const area = polygonArea(snapped);

    // Robo parcial: intersección + recorte de zonas rivales
    const stolenNames: string[] = [];
    let stealCount = 0;
    const stolenPieces: ConqueredZone[] = [];

    const updatedRemoteZones = remoteZones.map(rz => {
      if (rz.is_mine) return rz;

      // Calcular intersección (lo que robamos)
      const intersections = polyIntersection(rz.polygon, snapped);
      if (intersections.length === 0) return rz; // Sin solapamiento

      stealCount++;
      if (rz.owner_name && !stolenNames.includes(rz.owner_name)) {
        stolenNames.push(rz.owner_name);
      }

      // Guardar las piezas robadas (serán nuestras zonas naranjas)
      intersections.forEach(piece => {
        stolenPieces.push({ coords: piece, area: polygonArea(piece), points: 50 });
      });

      // Recortar zona rival: diferencia (lo que le queda al rival)
      const remaining = polyDifference(rz.polygon, snapped);
      if (remaining.length > 0 && remaining[0].length >= 3) {
        return { ...rz, polygon: remaining[0] }; // Zona rival recortada
      }
      // Si no queda nada, la zona rival desaparece
      return { ...rz, polygon: [] as Coord[] };
    });

    // Actualizar zonas remotas (rivales recortados)
    setRemoteZones(updatedRemoteZones.filter(rz => rz.polygon.length >= 3));

    const isSteal = stealCount > 0;

    // Marca síncrona de cierre de loop para que stopRun mande `loopClosed` al
    // backend (que calcula el bono autoritativo). El bono real lo decide el
    // servidor; aquí solo computamos un PREVIEW plano (25 / 50 si ≥3km) para el
    // popup y el contador en vivo. Eliminado el término legacy `stealCount * 25`
    // (zonas-polígono v1.5) que casi nunca se disparaba en el mundo de celdas y
    // creaba incoherencia con el cálculo server-side.
    loopClosedRef.current = true;
    const loopPoints = distance >= 3 ? 50 : 25;

    // Merge new zone with existing own zones (union, not stack)
    setConqueredZones(prev => {
      let merged = snapped;
      const remaining: ConqueredZone[] = [];
      for (const z of prev) {
        if (z.area <= 0) { remaining.push(z); continue; }
        // Try to union with existing own zone
        try {
          const bbox1 = polyBBox(merged);
          const bbox2 = polyBBox(z.coords);
          if (bboxOverlap(bbox1, bbox2)) {
            const unionResult = polyUnion(merged, z.coords);
            if (unionResult.length > 0 && unionResult[0].length >= 3) {
              merged = unionResult[0]; // Merged into one bigger zone
              continue; // Don't keep the old zone separately
            }
          }
        } catch {}
        remaining.push(z); // No overlap, keep separate
      }
      return [
        ...remaining,
        { coords: merged, area: polygonArea(merged), points: 100 },
        ...stolenPieces,
      ];
    });
    setTotalPoints(p => p + loopPoints);

    setPopup({
      visible: true,
      type: isSteal ? 'stolen_by_you' : 'conquered',
      points: loopPoints,
      rivalName: isSteal ? stolenNames.join(', ') : undefined,
    });

    pathRef.current = [path[path.length - 1]];
    setCurrentPath([path[path.length - 1]]);
    setPathSegments([]);
    setLoopDetected(false);
  };

  // Garantiza el permiso de ubicación foreground CUMPLIENDO la política de
  // divulgación destacada: si ya está concedido no muestra nada; si no,
  // enseña primero el aviso propio y solo tras "Aceptar" invoca el diálogo
  // del sistema. Nunca llamar a requestForegroundPermissionsAsync directo.
  const ensureForegroundPermission = async (): Promise<boolean> => {
    const { status: existing } = await Location.getForegroundPermissionsAsync();
    if (existing === 'granted') return true;
    const accepted = await new Promise<boolean>(resolve => {
      fgDisclosureResolveRef.current = resolve;
      setFgDisclosureVisible(true);
    });
    if (!accepted) return false;
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  };

  const handleFgDisclosureAccept = () => {
    setFgDisclosureVisible(false);
    fgDisclosureResolveRef.current?.(true);
    fgDisclosureResolveRef.current = null;
  };

  const handleFgDisclosureDecline = () => {
    setFgDisclosureVisible(false);
    fgDisclosureResolveRef.current?.(false);
    fgDisclosureResolveRef.current = null;
  };

  // Mientras corres mirando el mapa, el menú de abajo se esconde: la pantalla
  // de carrera a pantalla completa ya lo tapaba, y al abrir el mapa volvía a
  // aparecer. Cambiar de pestaña en plena carrera no lleva a nada bueno — el
  // sitio para parar es el botón PARAR.
  useEffect(() => {
    DeviceEventEmitter.emit(RUN_TABS_EVENT, isRunning);
  }, [isRunning]);

  // Aviso físico al quedarse sin señal. Corriendo no se mira la pantalla: el
  // cartel solo lo ve quien ya sospecha algo. Dos vibraciones largas al
  // perderla y una corta al recuperarla, que se notan con el móvil en el
  // brazo o en el bolsillo.
  useEffect(() => {
    if (!isRunning) { gpsWarnedRef.current = false; return; }
    if (gpsWeak && !gpsWarnedRef.current) {
      gpsWarnedRef.current = true;
      Vibration.vibrate([0, 600, 300, 600]);
    } else if (!gpsWeak && gpsWarnedRef.current) {
      gpsWarnedRef.current = false;
      Vibration.vibrate(250);
    }
  }, [gpsWeak, isRunning]);

  // Vigilante de señal: si llevamos 25 s sin una lectura GPS utilizable, la
  // carrera no está registrando nada y hay que decirlo. Sin esto el usuario
  // ve el cronómetro correr y se entera al final, cuando ya la ha perdido.
  const startGpsWatchTimer = () => {
    if (gpsWatchTimer.current) clearInterval(gpsWatchTimer.current);
    gpsWatchTimer.current = setInterval(() => {
      if (!isRunningRef.current) return;
      setGpsWeak(Date.now() - lastGoodPointRef.current > 25000);
    }, 3000);
  };

  // Auto-pausa silenciosa: cada 3 s el registro mira si llevas 20 s sin
  // moverte y congela cronómetro y distancia; el primer punto con movimiento
  // real la levanta. A los 6 s quieto, la velocidad mostrada se desvanece
  // hacia 0 en vez de quedarse clavada en los km/h que llevabas.
  const startAutoPauseTimer = () => {
    if (autoPauseTimer.current) clearInterval(autoPauseTimer.current);
    autoPauseTimer.current = setInterval(() => {
      const tr = trackerRef.current;
      if (!isRunningRef.current || !tr) return;
      const state = tr.tick(Date.now());
      if (state === 'autopause') {
        setIsAutoPaused(true);
        pauseStartedAtRef.current = Date.now();
        setCurrentSpeed(0);
      } else if (state === 'fade') {
        setCurrentSpeed(prev => (prev < 0.5 ? 0 : prev * 0.6));
      }
    }, 3000);
  };

  // La tarea de fondo arranca SIEMPRE, no solo con el permiso "Siempre".
  // Con "Mientras se usa la app" también funciona —en Android como servicio en
  // primer plano con su notificación, en iOS porque se inicia con la app
  // abierta y el modo de fondo de ubicación activado—, lo dice el propio
  // código nativo de expo-location. Exigíamos "Siempre", que casi nadie da y
  // que iOS ni ofrece a la primera: para la mayoría, apagar la pantalla dejaba
  // de registrar. El contador se paraba y ese tramo se perdía.
  const startBackgroundUpdates = async () => {
    try { await AsyncStorage.removeItem(BG_BUFFER_KEY); } catch {}
    try {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, BG_LOCATION_OPTIONS);
    } catch (e) {
      console.warn('[BG Location] No se pudo iniciar:', e);
    }
  };

  const startRun = async () => {
    const granted = await ensureForegroundPermission();
    if (!granted) {
      Alert.alert('Permiso necesario', 'CORRR necesita tu ubicación para registrar la carrera.');
      return;
    }
    // Aviso "Pantalla activa" eliminado en v1.6.2 — el foreground service
    // sobrevive a la pantalla apagada perfectamente, ya no hay riesgo real.

    // Si el permiso de background ya está concedido de una sesión anterior,
    // saltamos el aviso destacado y arrancamos directo. Solo lo mostramos
    // cuando vamos a invocar de verdad el diálogo del sistema.
    const { status: existingBgStatus } = await Location.getBackgroundPermissionsAsync();
    if (existingBgStatus === 'granted') {
      doStartRun();
      return;
    }

    // Aviso destacado obligatorio por política de Google Play antes de
    // pedir ACCESS_BACKGROUND_LOCATION. Cuando el usuario pulse "Aceptar"
    // en el modal, handleBgDisclosureAccept llama a doStartRun y allí se
    // dispara el diálogo del sistema.
    setBgDisclosureVisible(true);
  };

  const handleBgDisclosureAccept = () => {
    setBgDisclosureVisible(false);
    doStartRun();
  };

  const handleBgDisclosureDecline = () => {
    setBgDisclosureVisible(false);
    Alert.alert(
      'Permiso necesario',
      'Sin acceso a la ubicación en background CORRR no puede registrar tu carrera cuando bloqueas la pantalla. Vuelve a pulsar "Iniciar carrera" cuando quieras intentarlo.',
    );
  };

  const doStartRun = async () => {
    // Ni el permiso de background ni mantener la pantalla activa son
    // imprescindibles para correr: mejoran la experiencia, pero la carrera
    // funciona sin ellos. Antes iban sin protección justo ANTES de
    // setIsRunning(true), así que si cualquiera de los dos fallaba o se
    // quedaba colgado, la función se cortaba y la carrera no arrancaba: el
    // usuario se quedaba mirando el mapa, viendo su posición moverse, sin que
    // pasara nada y sin ningún mensaje.
    //
    // Ahora se intentan, se registra el fallo si lo hay, y la carrera arranca
    // igual. Nunca al revés.
    try {
      await Location.requestBackgroundPermissionsAsync();
    } catch (err) {
      console.warn('[startRun] permiso de background no disponible:', err);
    }

    try {
      await activateScreenAwake();
    } catch (err) {
      console.warn('[startRun] no se pudo mantener la pantalla activa:', err);
    }

    setIsRunning(true);
    lastGoodPointRef.current = Date.now();
    setGpsWeak(false);
    setShowRunMap(false);
    runCameraSetRef.current = false;
    setRunTime(0);
    runStartTimeRef.current = Date.now();
    pauseStartedAtRef.current = null;
    pausedAccumulatedRef.current = 0;
    setDistance(0);
    setDistancePosDelta(0);
    setTotalPoints(0);
    setConqueredZones([]);
    // Registro nuevo para cada carrera: nada de la anterior se arrastra.
    trackerRef.current = new RunTracker(Date.now());
    claimedCellsRef.current = trackerRef.current.cells;
    setClaimedCellsTick(t => t + 1);
    setSplits([]);
    splitsTrackingRef.current = { lastKm: 0, lastTime: 0 };
    setCurrentPath([]);
    setLoopDetected(false);
    loopClosedRef.current = false; // reset del espejo síncrono de cierre de loop
    setSpeedWarning(false);
    setIsAutoPaused(false);

    startGpsWatchTimer();
    startAutoPauseTimer();
    setCurrentSpeed(0);
    setPathSegments([]);
    invalidSegments.current = 0;
    pathRef.current = [];

    // Recompute from Date.now() each tick — self-healing against missed ticks
    // while the JS thread is suspended (screen off, doze mode).
    timerRef.current = setInterval(() => setRunTime(computeRunTime()), 1000);

    /** Un punto GPS venga de donde venga —vigilante de primer plano, tarea de
     *  fondo o lo guardado en disco—. Un único camino: antes eran dos con
     *  reglas distintas, y el de pantalla apagada perdía calles enteras. */
    const handleReading = (r: GpsReading, live: boolean): ReadingOutcome | null => {
      const tr = trackerRef.current;
      if (!tr || !isRunningRef.current) return null;
      const out = tr.addReading(r);
      if (out.kind === 'duplicate' || out.kind === 'skip') return out;

      lastGoodPointRef.current = Date.now();
      if (out.kind === 'teleport') {
        // Hueco sin puntos (túnel, señal perdida): tramo visual nuevo.
        if (pathRef.current.length > 1) {
          const done = [...pathRef.current];
          setPathSegments(segs => [...segs, done]);
        }
        pathRef.current = [out.coord];
        setCurrentPath([out.coord]);
      } else {
        pathRef.current = [...pathRef.current, out.coord];
        setCurrentPath([...pathRef.current]);
        // Velocidad con EMA: un spike aislado de deriva apenas mueve la aguja.
        if (out.moved) setCurrentSpeed(prev => prev * 0.7 + out.speedKmh * 0.3);
        if (out.cellsChanged) setClaimedCellsTick(t => t + 1);
      }
      if (out.resumed) {
        setIsAutoPaused(false);
        if (pauseStartedAtRef.current) {
          pausedAccumulatedRef.current += Date.now() - pauseStartedAtRef.current;
          pauseStartedAtRef.current = null;
        }
      }
      setDistance(tr.distanceKm);
      setDistancePosDelta(tr.positionKm);
      setSpeedWarning(false);

      if (live && out.kind === 'accept' && !loopDetected && pathRef.current.length >= 10) {
        if (checkLoop(pathRef.current)) closeLoop([...pathRef.current]);
      }
      return out;
    };

    const handleLocationUpdate = (loc: Location.LocationObject) => {
      const out = handleReading(toReading(loc), true);
      if (!out || out.kind !== 'accept') return;
      // El mapa sigue al corredor. El zoom se fija UNA vez, en el primer
      // punto: antes se imponía en cada lectura, así que si abrías el mapa a
      // mitad de carrera y te alejabas para ver el barrio, el siguiente punto
      // te devolvía al zoom 17.
      const heading = loc.coords.heading;
      const zoom = runCameraSetRef.current ? undefined : 17;
      runCameraSetRef.current = true;
      if (heading != null && heading >= 0 && out.speedKmh > 2) {
        // En marcha, el mapa gira hacia donde vas.
        mapRef.current?.animateCamera({ center: out.coord, heading, pitch: 45, ...(zoom ? { zoom } : {}) }, { duration: 500 });
      } else {
        mapRef.current?.animateCamera({ center: out.coord, pitch: 0, ...(zoom ? { zoom } : {}) }, { duration: 500 });
      }
    };

    // Todo listo ANTES de pedirle nada al GPS: un punto que llegara antes se
    // quedaba sin nadie que lo procesara. Y la carrera cuenta como empezada ya,
    // para que STOP responda aunque el GPS tarde en dar la primera posición.
    isRunningRef.current = true;
    handleLocationUpdateRef.current = handleLocationUpdate;
    handleReadingRef.current = handleReading;
    bgReadingsListener = readings => {
      for (const r of readings) handleReadingRef.current(r, false);
    };

    // Centrar mapa en posición actual al iniciar. Si el GPS tarda o falla, la
    // carrera sigue: antes una excepción aquí cortaba la función con el
    // cronómetro ya en marcha, sin registrar nada y con STOP sin responder.
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateToRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }, 800);
    } catch (err) {
      console.warn('[startRun] sin posición inicial:', err);
    }

    await startBackgroundUpdates();

    try {
      locationRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 8, timeInterval: 3000 },
        handleLocationUpdate,
      );
    } catch (err) {
      console.warn('[startRun] no se pudo vigilar la posición:', err);
    }
  };

  const pauseRun = async () => {
    setIsPaused(true);
    // Manual pause overrides any auto-pause that may have been active.
    trackerRef.current?.pause();
    setIsAutoPaused(false);
    pauseStartedAtRef.current = Date.now();
    if (autoPauseTimer.current) { clearInterval(autoPauseTimer.current); autoPauseTimer.current = null; }
    if (gpsWatchTimer.current) { clearInterval(gpsWatchTimer.current); gpsWatchTimer.current = null; }
    setGpsWeak(false);
    setShowRunMap(false);
    runCameraSetRef.current = false;
    deactivateScreenAwake();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (locationRef.current) { locationRef.current.remove(); locationRef.current = null; }
    // Parar background task al pausar
    try {
      const isTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isTask) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch {}
    try { await AsyncStorage.removeItem(BG_BUFFER_KEY); } catch {}
  };

  const resumeRun = async () => {
    setIsPaused(false);
    setIsAutoPaused(false);
    // Accumulate the paused duration so the timer math skips over it.
    if (pauseStartedAtRef.current) {
      pausedAccumulatedRef.current += Date.now() - pauseStartedAtRef.current;
      pauseStartedAtRef.current = null;
    }
    // Lo andado en pausa no cuenta: el primer punto empieza tramo nuevo.
    trackerRef.current?.resume(Date.now());
    await activateScreenAwake();
    startAutoPauseTimer();
    // El aviso de señal se paraba en la pausa y no volvía a arrancar.
    lastGoodPointRef.current = Date.now();
    startGpsWatchTimer();
    // Recompute from Date.now() each tick — self-healing against missed ticks
    // while the JS thread is suspended (screen off, doze mode).
    timerRef.current = setInterval(() => setRunTime(computeRunTime()), 1000);

    await startBackgroundUpdates();

    try {
      locationRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 8, timeInterval: 3000 },
        handleLocationUpdateRef.current,
      );
    } catch (err) {
      console.warn('[resumeRun] no se pudo vigilar la posición:', err);
    }
  };

  const stopRun = async () => {
    // Guard de idempotencia: si stopRun ya se está ejecutando, ignoramos
    // taps adicionales. Sin esto, un doble tap rápido en STOP llamaba a
    // api.saveRun() dos veces y la carrera contaba doble en stats.
    if (!isRunningRef.current) return;
    isRunningRef.current = false;
    setIsRunning(false);
    setIsPaused(false);
    setIsAutoPaused(false);
    // Freeze the final time before clearing the timer refs.
    setRunTime(computeRunTime());
    // Hora real de la carrera, para el servidor (ver saveRun más abajo).
    const runStartedAtMs = runStartTimeRef.current ?? Date.now();
    const runEndedAtMs = Date.now();
    runStartTimeRef.current = null;
    pauseStartedAtRef.current = null;
    pausedAccumulatedRef.current = 0;
    if (autoPauseTimer.current) { clearInterval(autoPauseTimer.current); autoPauseTimer.current = null; }
    if (gpsWatchTimer.current) { clearInterval(gpsWatchTimer.current); gpsWatchTimer.current = null; }
    setGpsWeak(false);
    setShowRunMap(false);
    runCameraSetRef.current = false;
    deactivateScreenAwake();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // Limpiar también la ref del watcher para que si se reentra (bug futuro),
    // no intentemos remover un subscription ya cerrado. Antes solo se llamaba
    // .remove() pero la ref quedaba colgando.
    if (locationRef.current) { locationRef.current.remove(); locationRef.current = null; }
    bgReadingsListener = null;
    // Parar background task si estaba activo
    try {
      const isTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isTask) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch {}
    try { await AsyncStorage.removeItem(BG_BUFFER_KEY); } catch {}

    // Si no cerró loop durante la carrera, comprobar si está cerca del inicio al parar
    const allPts = [...pathSegments.flat(), ...pathRef.current];
    if (!loopDetected && allPts.length >= 10) {
      const start = allPts[0];
      const end = allPts[allPts.length - 1];
      const distToStart = getDistance(start, end);
      console.log(`[StopRun] Auto-close check: pts=${allPts.length} distToStart=${distToStart.toFixed(0)}m`);
      if (distToStart < 50) {
        console.log('[StopRun] Auto-cerrando loop');
        pathRef.current.push(start);
        await closeLoop([...pathRef.current]);
      }
    }

    // Rellenar SOLO los circuitos que de verdad se cerraron (RunTracker.finish):
    // nunca a través de un hueco, nunca la diagonal imaginaria de A a B.
    const tracker = trackerRef.current;
    let loopsFound = 0;
    if (tracker) {
      loopsFound = tracker.finish().loops;
      claimedCellsRef.current = tracker.cells;
      setClaimedCellsTick(t => t + 1);
    }
    // La distancia de la carrera: la que se veía en pantalla y la que se
    // guarda. Antes el resumen enseñaba la de velocidad y se guardaba el mayor
    // de los dos métodos, así que el resumen y el historial no cuadraban.
    const runDistanceKm = tracker ? tracker.distanceKm : Math.max(distance, distancePosDelta);
    const runPosKm = tracker ? tracker.positionKm : distancePosDelta;

    // 10 pts/km (v1.7 economy). The final total here is a client-side ESTIMATE
    // that assumes every claimed cell is new (1 pt each). The backend recomputes
    // authoritative points (knows which are robbed → 2 pts) and applies streak +
    // PB multipliers — we use res.points (returned by saveRun) in the summary modal.
    const kmPoints = Math.round(runDistanceKm * 10);
    const cellCount = claimedCellsRef.current.size;
    const estimatedCellPoints = cellCount; // assume all new (1 pt each)
    const finalPoints = totalPoints + kmPoints + estimatedCellPoints;
    // XP = puntos totales ÷ 100
    const earnedXP = Math.floor(finalPoints / 100);
    setTotalXP(earnedXP);

    const zonesCount = conqueredZones.filter(z => z.area > 0).length;

    // Anti-noise + anti-cheat: una carrera solo cuenta si el corredor se ha
    // movido de verdad. Doble criterio (deben cumplirse AMBOS):
    //   1. ≥ 5 celdas (antes 3, pero 3 las podía dar GPS drift al sentarse).
    //   2. ≥ 50m de distancia acumulada (drift suma típicamente <20m en una
    //      sesión de 1-2 min; un caminante real cubre 50m en ~40s).
    // Si falla cualquiera de los dos, descartamos la carrera y avisamos.
    const MIN_CELLS_FOR_VALID_RUN = 5;
    const MIN_DISTANCE_KM_FOR_VALID_RUN = 0.05; // 50m
    const isValidRun =
      cellCount >= MIN_CELLS_FOR_VALID_RUN &&
      runDistanceKm >= MIN_DISTANCE_KM_FOR_VALID_RUN;

    if (isValidRun) {
      const closedZones = conqueredZones.filter(z => z.area > 0);
      // Grid (v2): convert the Set of "x,y" keys into the {x,y} objects the
      // backend expects. Sent alongside zones during the transition.
      const claimedCells: { x: number; y: number }[] = [];
      claimedCellsRef.current.forEach(k => {
        const [xs, ys] = k.split(',');
        claimedCells.push({ x: parseInt(xs, 10), y: parseInt(ys, 10) });
      });
      // Activamos el LoadingScreen mientras la carrera se guarda y los cells
      // se recargan. Se desactiva en finally para cubrir éxito y error.
      setSavingRun(true);
      api.saveRun({
        // El mayor de los dos métodos, el mismo criterio que ya se usaba para
        // decidir si la carrera es válida. Guardar solo el Doppler era
        // incoherente: una carrera podía pasar la validación por posición y
        // registrarse luego con los kilómetros del método que había fallado.
        distanceKm: runDistanceKm,
        durationSecs: runTime,
        points: finalPoints, // client estimate — backend ignores and recomputes
        loopBonus: totalPoints, // legacy: preview de bonos de loop (backend lo clampa)
        loopClosed: loopClosedRef.current || loopsFound > 0, // v1.10.10: el backend calcula el bono autoritativo
        xp: earnedXP,
        zonesCount,
        zones: closedZones.map(z => ({ coords: z.coords, area: z.area, points: z.points })),
        claimedCells,
        // Con la hora real el servidor detecta si una carrera del Apple Watch
        // importada después es esta misma, grabada a la vez con el reloj.
        source: 'app',
        // Cifras técnicas, sin coordenadas: para poder entender después por qué
        // una carrera reclamó lo que reclamó (ver RunTracker.diag).
        diag: tracker ? { ...tracker.diag } : undefined,
        startedAt: new Date(runStartedAtMs).toISOString(),
        endedAt: new Date(runEndedAtMs).toISOString(),
      }).then(async (res) => {
        loadZones();
        // Ocultar polígonos ANTES del reload: cuando polygonsVisible=false
        // el render del array colapsa a `false` y React desmonta TODOS los
        // <Polygon>, lo que obliga a la capa nativa de Google Maps a
        // destruir las instancias antiguas (RN-Maps a veces no las destruye
        // si solo cambia la key dentro de un array).
        setPolygonsVisible(false);
        // Recargar las celdas del servidor sobre TODA el área del run (no solo el
        // viewport tight de zoom 17) y VACIAR claimedCellsRef → el mapa post-
        // carrera queda IGUAL que al reabrir la app: solo la verdad del servidor,
        // sin el doble tono / solapes que dejaba la capa local (claimedCellsRef)
        // encima de un remoteCells desactualizado. Antes NO vaciábamos para no
        // perder las celdas fuera del viewport, pero eso causaba el ruido visual;
        // al traer el área ENTERA del run, vaciar es seguro y consistente.
        await loadCellsForRunArea();
        claimedCellsRef.current = new Set();
        setClaimedCellsTick(t => t + 1);
        setPolygonGeneration(g => g + 1);
        // Esperar 1-2 frames para que el commit de `false` llegue al nativo
        // antes de volver a montar. Sin esta espera React batchearía
        // false→true en el mismo render y nativo nunca vería el unmount.
        await new Promise(r => setTimeout(r, 50));
        setPolygonsVisible(true);
        // Refrescar total_steals para que el desbloqueo de taunts se aplique
        // inmediatamente si el usuario ha cruzado un múltiplo de 10 en esta
        // carrera. Re-lee también XP, que sobreescribimos abajo si vino auth.
        loadUserXP();
        // Crear el resumen con valores AUTORITATIVOS del backend si están
        // disponibles. Antes teníamos un patrón setRunSummary(prev => ...)
        // que era no-op porque runSummary todavía era null (se seteaí en
        // .finally), así que los puntos del backend nunca llegaban al modal.
        const authPoints = typeof res.points === 'number' ? res.points : finalPoints;
        const authXP = typeof res.points === 'number'
          ? Math.floor(res.points / 100)
          : earnedXP;
        // Apagamos LoadingScreen y mostramos resumen en el MISMO render para
        // que React 18 los batchee en una sola transición visual (sin que el
        // resumen "pestañee" sobre el loading).
        setSavingRun(false);
        setRunSummary({
          visible: true,
          distance: runDistanceKm,
          distancePosDelta: runPosKm,
          time: runTime,
          points: authPoints,
          xp: authXP,
          zones: zonesCount,
          breakdown: res.breakdown ?? null,
        });
        setTotalXP(authXP);

        // ── Tarjeta para compartir ──────────────────────────────────────────
        // Agrupamos las celdas robadas por víctima para el bloque rojo. El
        // La tarjeta NO lleva mapa a propósito: publicar el recorrido revela
        // dónde vive el usuario (las carreras salen y vuelven de casa).
        const stealsByName = new Map<string, number>();
        for (const sc of res.stolenCells ?? []) {
          if (!sc.prevOwnerName) continue;
          stealsByName.set(sc.prevOwnerName, (stealsByName.get(sc.prevOwnerName) ?? 0) + 1);
        }
        const steals: ShareSteal[] = [...stealsByName].map(([name, count]) => ({ name, count }));
        // La frase se elige UNA vez aquí, no en cada render: si no, cambiaría
        // sola mientras el usuario mira la tarjeta.
        setShareCard({
          distance: runDistanceKm, time: runTime, points: authPoints,
          cells: cellCount,
          runnerName: user?.username ?? 'Corredor',
          phrase: randomSharePhrase(steals.length > 0),
          city: cityName, steals,
        });
        // Show the "ZONA ROBADA" popup for either system: polygon zones (v1.5)
        // or grid cells (v1.6+). Most runs from v1.6+ will only have stolenCells.
        const hasStolen = (res.stolenZones && res.stolenZones.length > 0) ||
                         (res.stolenCells && res.stolenCells.length > 0);
        if (hasStolen) {
          const names = new Set<string>();
          let stolenPoints = 0;
          if (res.stolenZones) {
            for (const sz of res.stolenZones) {
              if (sz.ownerName) names.add(sz.ownerName);
              stolenPoints += sz.points || 0;
            }
          }
          // Cuenta de celdas robadas en este popup — variable local, no
          // confundir con cellCount del scope exterior (que es el total de
          // celdas claimed en la carrera).
          let stolenCellCount = 0;
          if (res.stolenCells) {
            for (const sc of res.stolenCells) {
              if (sc.prevOwnerName) names.add(sc.prevOwnerName);
              stolenCellCount++;
            }
          }
          // Cada celda robada = 5 pts para el popup (número celebratorio;
          // los puntos reales los calcula el backend).
          stolenPoints += stolenCellCount * 5;
          setPopup({
            visible: true,
            type: 'stolen_by_you',
            points: stolenPoints,
            rivalName: Array.from(names).join(', '),
          });
        } else {
          // Territorio virgen (sin owner previo): mostrar "ZONA CONQUISTADA".
          // Antes esta rama no existía y el popup de conquista solo se disparaba
          // desde el sistema legacy de loops-polígono (closeLoop), nunca desde el
          // flujo real de saveRun con celdas — así que conquistar territorio
          // nuevo sin robar a nadie nunca mostraba nada.
          const newCells = res.newCellCount ?? res.breakdown?.newCells ?? claimedCells.length;
          if (newCells > 0) {
            setPopup({
              visible: true,
              type: 'conquered',
              points: newCells,
            });
          }
        }
      }).catch((err) => {
        // Si el backend falla, igualmente mostramos resumen con valores
        // estimados — la carrera sí ocurrió y el usuario merece ver lo que
        // hizo aunque no se haya guardado. También alertamos para que sepa
        // que la carrera está perdida (auth expiró, red, etc).
        Alert.alert('Error al guardar la carrera', String(err?.message ?? err));
        setSavingRun(false);
        setRunSummary({
          visible: true,
          distance: runDistanceKm,
          distancePosDelta: runPosKm,
          time: runTime,
          points: finalPoints,
          xp: earnedXP,
          zones: zonesCount,
        });
      });
      // (sin .finally — setSavingRun(false) se hace en cada branch para
      // batchear en el mismo render que setRunSummary).
    }

    setCurrentPath([]);
    pathRef.current = [];
    // Limpiar también pathSegments (líneas discontinuas con dots). Antes
    // quedaban renderizadas encima de las celdas tras terminar la carrera y
    // creaban el efecto "rejilla con puntos" que pedía cerrar/abrir la app.
    // Las celdas (myCellsUnion) ya reflejan el recorrido, no hace falta la
    // polyline encima.
    setPathSegments([]);

    // Reset camera to north-up flat view
    mapRef.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 500 });

    // Carrera inválida (muy corta): aviso breve, sin LoadingScreen ni resumen.
    if (!isValidRun && (cellCount > 0 || runDistanceKm > 0)) {
      Alert.alert(
        'Carrera demasiado corta',
        'No has cubierto suficiente distancia. La carrera no se ha guardado.',
        [{ text: 'OK' }],
      );
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // pace removed — now showing km/h directly from GPS speed

  // Carga inicial del mapa: el LoadingScreen con el personaje pixelado
  // sustituye al spinner anterior. Como es un Modal, podemos hacer return
  // null del resto del árbol mientras carga (más rápido) o renderizar la
  // app completa y dejar que el modal lo tape. Optamos por la primera para
  // no inicializar MapView hasta tener datos.
  if (mapLoading) {
    return <LoadingScreen visible subtitle="ACTUALIZANDO MAPA" />;
  }

  return (
    <View style={styles.container}>
      <ZonePopup
        visible={popup.visible && popupReady}
        type={popup.type}
        points={popup.points}
        rivalName={popup.rivalName}
        onClose={() => setPopup(p => ({ ...p, visible: false }))}
        onRespond={() => setShowTaunts(true)}
      />

      {/* Robo notif arriving via the inbox (someone stole from us): render the
          existing "te han robado" image with a "Devolver" button. Marks as read
          on dismissal. On Respond opens TauntSelector mode='taunt'. */}
      {currentTaunt?.mode === 'robo_notif' && tauntReady && (
        <ZonePopup
          visible
          type="stolen_from_you"
          rivalName={currentTaunt.from_user_name ?? 'Rival'}
          onClose={async () => {
            try { await api.markTauntsRead([currentTaunt.id]); } catch {}
            setCurrentTaunt(null);
          }}
          onRespond={() => respondToTaunt(currentTaunt, 'taunt')}
        />
      )}

      {/* Received taunt or response: full-screen taunt image.
       *
       *  REGLA de cierre del hilo:
       *  - mode 'taunt'    → la víctima (que sufrió el robo) le manda un
       *                      mensaje al ladrón. El ladrón puede DEVOLVER UNA
       *                      única vez con mode='response'.
       *  - mode 'response' → es la respuesta del ladrón. Aquí termina el hilo:
       *                      NO se muestra botón DEVOLVER para evitar el bucle
       *                      infinito (response → response → response...).
       *                      Solo se puede cerrar el modal. */}
      {(currentTaunt?.mode === 'taunt' || currentTaunt?.mode === 'response') && currentTaunt.taunt_id && tauntReady && (
        <Modal transparent visible animationType="fade" statusBarTranslucent>
          <View style={styles.tauntReceivedContainer}>
            {/* La imagen va la PRIMERA: ahora es absoluta y a pantalla
                completa, así que los hermanos posteriores (X, remitente,
                botón) pintan por encima de ella. */}
            {(() => {
              const img = tauntImageById(currentTaunt.mode, currentTaunt.taunt_id);
              if (!img) return null;
              return (
                <Image
                  source={img}
                  style={styles.tauntReceivedImage}
                  resizeMode="contain"
                />
              );
            })()}
            <TouchableOpacity
              style={styles.tauntReceivedClose}
              onPress={async () => {
                try { await api.markTauntsRead([currentTaunt.id]); } catch {}
                setCurrentTaunt(null);
              }}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.tauntReceivedFrom}>
              {currentTaunt.from_user_name ?? 'Rival'} te ha enviado un mensaje
            </Text>
            {currentTaunt.mode === 'taunt' ? (
              <TouchableOpacity
                style={styles.tauntReceivedRespond}
                onPress={() => respondToTaunt(currentTaunt, 'response')}
              >
                <Ionicons name="flame" size={18} color="#000" />
                <Text style={styles.tauntReceivedRespondText}>DEVOLVER</Text>
              </TouchableOpacity>
            ) : (
              // mode === 'response': fin del hilo. Botón neutral solo para
              // cerrar el modal — sin opción de seguir respondiendo.
              <TouchableOpacity
                style={[styles.tauntReceivedRespond, styles.tauntReceivedDismiss]}
                onPress={async () => {
                  try { await api.markTauntsRead([currentTaunt.id]); } catch {}
                  setCurrentTaunt(null);
                }}
              >
                <Text style={styles.tauntReceivedDismissText}>CERRAR</Text>
              </TouchableOpacity>
            )}
          </View>
        </Modal>
      )}

      <TauntSelector
        visible={showTaunts}
        mode={tauntTarget?.mode ?? 'taunt'}
        rivalName={tauntTarget?.toName}
        // Desbloqueo progresivo: el primero siempre disponible, +1 cada 10
        // celdas robadas (capped a 10). Mismo umbral para taunts y responses
        // — el usuario lo entiende como "subes de nivel robando".
        unlockedCount={Math.max(1, Math.min(10, 1 + Math.floor(totalSteals / 10)))}
        totalSteals={totalSteals}
        onSend={async (messageId) => {
          // Either the user is responding to a robo/received taunt (tauntTarget
          // is set), or responding to their OWN post-run "stolen_by_you" popup
          // (no specific target — we fall back to alerting only).
          if (tauntTarget) {
            try {
              await api.sendTaunt(tauntTarget.toUserId, messageId, tauntTarget.mode, tauntTarget.runId || undefined);
              Alert.alert('💬 Mensaje enviado', `Has enviado un mensaje a ${tauntTarget.toName}`);
              // La notificación se marca leída AQUÍ, cuando el mensaje ha salido
              // de verdad. Se usa notifId y no currentTaunt porque el aviso ya
              // está cerrado a estas alturas — y marcarla antes de tiempo era
              // justo lo que dejaba al usuario sin aviso y sin respuesta cuando
              // el selector no llegaba a abrirse.
              if (tauntTarget.notifId) {
                try { await api.markTauntsRead([tauntTarget.notifId]); } catch {}
              }
              setCurrentTaunt(null);
            } catch (e: any) {
              // 409 = hilo ya cerrado (ya hay un taunt/response previo para
              // este run). Mensaje específico en vez del genérico para que el
              // usuario entienda por qué no se envía. También marcamos como
              // leído el inbox item para que no le aparezca otra vez.
              if (e?.status === 409) {
                Alert.alert('Hilo cerrado', e?.body?.error ?? 'En este hilo solo se permite un mensaje y una respuesta.');
                // Hilo cerrado: no hay nada que reintentar, así que sí se marca
                // leída para no volver a ofrecer algo imposible.
                if (tauntTarget.notifId) {
                  try { await api.markTauntsRead([tauntTarget.notifId]); } catch {}
                }
                setCurrentTaunt(null);
              } else {
                Alert.alert('Error', 'No se pudo enviar el mensaje. Inténtalo de nuevo.');
              }
            }
          } else {
            // Legacy path: post-run stolen_by_you popup → user picks taunt but
            // we don't know specific target. Just confirm visually.
            Alert.alert('💬 Mensaje enviado', 'Tu mensaje ha sido enviado.');
          }
          setShowTaunts(false);
          setTauntTarget(null);
        }}
        onClose={() => { setShowTaunts(false); setTauntTarget(null); }}
      />

      {/* LoadingScreen post-carrera: cubre la pantalla entre STOP y resumen.
          Personaje pixelado + logo + slogan estilo grafiti. Aparece solo
          mientras saveRun + loadCells están en vuelo (savingRun = true). */}
      <LoadingScreen visible={savingRun} />

      {/* Resumen post-carrera. Espera a que se cierre la cartela de zona: iOS
          no presenta bien dos <Modal> a la vez — el segundo se quedaba en el
          limbo y solo aparecía cuando algo forzaba un re-render (cambiar de
          pestaña a Perfil/Stats/Ranking). Encadenándolos, primero se ve la
          cartela y al cerrarla aparece el resumen, que es además el orden
          narrativo correcto. Si no hubo cartela, sale directo. */}
      {runSummary?.visible && summaryReady && (
        <Modal transparent visible animationType="fade" statusBarTranslucent>
          <View style={styles.summaryOverlay}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>CARRERA COMPLETADA</Text>

              <View style={styles.summaryStats}>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryStatValue}>{runSummary.distance.toFixed(2)}</Text>
                  <Text style={styles.summaryStatLabel}>km</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryStatValue}>{formatTime(runSummary.time)}</Text>
                  <Text style={styles.summaryStatLabel}>tiempo</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryStatValue}>{runSummary.zones}</Text>
                  <Text style={styles.summaryStatLabel}>zonas</Text>
                </View>
              </View>

              <View style={styles.summaryPoints}>
                <View style={styles.summaryPointsRow}>
                  <Ionicons name="flame" size={20} color={colors.orange} />
                  <Text style={styles.summaryPointsValue}>{runSummary.points}</Text>
                  <Text style={styles.summaryPointsLabel}>puntos</Text>
                </View>
                <View style={styles.summaryXpRow}>
                  <Ionicons name="star" size={18} color="#FFD700" />
                  <Text style={styles.summaryXpValue}>+{runSummary.xp} XP</Text>
                </View>
              </View>

              {/* Desglose de puntos (v1.10.10): hace visible de dónde sale el
                  total. Antes el usuario veía un número opaco; ahora ve km,
                  celdas, robos, bono de cierre y multiplicadores. */}
              {runSummary.breakdown && (
                <View style={styles.summaryBreakdown}>
                  <BreakdownRow label="Distancia" value={`+${runSummary.breakdown.kmPoints}`} hint={`${runSummary.distance.toFixed(2)} km`} />
                  {(runSummary.breakdown.newCells ?? 0) > 0 && (
                    <BreakdownRow label="Celdas nuevas" value={`+${runSummary.breakdown.newCells}`} hint={`${runSummary.breakdown.newCells} × 1`} />
                  )}
                  {(runSummary.breakdown.stolenCells ?? 0) > 0 && (
                    <BreakdownRow label="Celdas robadas" value={`+${(runSummary.breakdown.stolenCells ?? 0) * 2}`} hint={`${runSummary.breakdown.stolenCells} × 2`} />
                  )}
                  {runSummary.breakdown.loopBonus > 0 && (
                    <BreakdownRow label="Cierre de círculo" value={`+${runSummary.breakdown.loopBonus}`} hint="¡zona cerrada!" />
                  )}
                  {runSummary.breakdown.pbMultiplier > 1 && (
                    <BreakdownRow label="Récord personal" value="×1.2" hint="nueva mejor distancia" highlight />
                  )}
                  {runSummary.breakdown.streakMultiplier > 1 && (
                    <BreakdownRow label={`Racha ${runSummary.breakdown.streakDays} días`} value="×1.5" hint="¡sigue así!" highlight />
                  )}
                </View>
              )}

              {/* Compartir. Cierra el resumen antes de abrir la tarjeta: iOS no
                  presenta bien dos <Modal> a la vez (mismo motivo por el que el
                  resumen espera a la cartela de zona). */}
              {shareCard && (
                <TouchableOpacity
                  style={styles.summaryShareBtn}
                  onPress={() => { setRunSummary(null); setShareVisible(true); }}
                >
                  <Ionicons name="share-social" size={17} color={colors.orange} />
                  <Text style={styles.summaryShareBtnText}>COMPARTIR</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.summaryBtn}
                onPress={() => setRunSummary(null)}
              >
                <Text style={styles.summaryBtnText}>CERRAR</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Tarjeta para compartir en redes (Instagram, WhatsApp…) */}
      <ShareRunCard
        visible={shareVisible}
        data={shareCard}
        onClose={() => setShareVisible(false)}
      />

      {/* Popup zona propia — centinela */}
      {selectedZone && (
        <Modal transparent visible animationType="fade" statusBarTranslucent>
          <View style={styles.summaryOverlay}>
            <View style={styles.zoneCard}>
              <TouchableOpacity style={styles.zoneCardClose} onPress={() => setSelectedZone(null)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>

              <Ionicons name="shield" size={40} color={colors.orange} />
              <Text style={styles.zoneCardTitle}>TU ZONA</Text>
              <Text style={styles.zoneCardPoints}>{selectedZone.points} pts</Text>
              {selectedZone.conquered_at && (
                <Text style={styles.zoneCardDate}>
                  Conquistada {new Date(selectedZone.conquered_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </Text>
              )}

              <View style={styles.sentinelSection}>
                <Text style={styles.sentinelTitle}>🛡️ PROTEGER CON CENTINELA</Text>
                <Text style={styles.sentinelDesc}>Evita que te roben esta zona</Text>

                {[
                  { hours: 6, cost: 100 },
                  { hours: 12, cost: 250 },
                  { hours: 24, cost: 500 },
                ].map(opt => {
                  const canAfford = userXP >= opt.cost;
                  return (
                    <TouchableOpacity
                      key={opt.hours}
                      style={[styles.sentinelOption, !canAfford && styles.sentinelOptionLocked]}
                      onPress={() => {
                        if (canAfford) {
                          setUserXP(xp => xp - opt.cost);
                          Alert.alert(
                            '🛡️ Centinela activado',
                            `Tu zona está protegida durante ${opt.hours}h`,
                          );
                          setSelectedZone(null);
                          // TODO: enviar al backend
                        } else {
                          setSelectedZone(null);
                          onNavigateToShop?.();
                        }
                      }}
                    >
                      <View style={styles.sentinelOptionLeft}>
                        <Text style={styles.sentinelHours}>{opt.hours}h</Text>
                      </View>
                      {canAfford ? (
                        <View style={styles.sentinelOptionRight}>
                          <Ionicons name="star" size={14} color="#FFD700" />
                          <Text style={styles.sentinelCost}>{opt.cost} XP</Text>
                        </View>
                      ) : (
                        <View style={styles.sentinelOptionRight}>
                          <Ionicons name="cart" size={14} color={colors.orange} />
                          <Text style={styles.sentinelBuy}>Comprar XP</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}

                <Text style={styles.sentinelBalance}>Tu saldo: ⭐ {userXP} XP</Text>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Popup zona rival — info + agregar amigo */}
      {selectedRivalZone && (
        <Modal transparent visible animationType="fade" statusBarTranslucent>
          <View style={styles.summaryOverlay}>
            <View style={styles.zoneCard}>
              <TouchableOpacity style={styles.zoneCardClose} onPress={() => setSelectedRivalZone(null)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>

              {/* Foto del dueño de la zona. Si no tiene puesta —hoy la mayoría—
                  se mantiene la inicial de siempre, que nunca falla. */}
              <View style={[styles.rivalAvatarBig, { borderColor: getRivalColor(selectedRivalZone.owner_id ?? selectedRivalZone.owner_name ?? '') }]}>
                {selectedRivalZone.owner_avatar ? (
                  <Image
                    source={{ uri: selectedRivalZone.owner_avatar }}
                    style={styles.rivalAvatarPhoto}
                  />
                ) : (
                  <Text style={styles.rivalAvatarText}>
                    {(selectedRivalZone.owner_name ?? '?').charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={styles.zoneCardTitle}>{selectedRivalZone.owner_name ?? 'Rival'}</Text>
              {/* Grito de guerra del rival (v1.9). Se muestra justo bajo el nombre
                  cuando el propietario lo ha configurado en su perfil. */}
              {!!selectedRivalZone.owner_war_cry && (
                <Text style={styles.zoneCardWarCry}>"{selectedRivalZone.owner_war_cry}"</Text>
              )}
              {/* Su territorio: superficie, parte de su ciudad y puesto
                  nacional. Los porcentajes van sobre lo ya conquistado, no
                  sobre la superficie real — contra el terreno de verdad todo
                  el mundo sale con 0,0001% de España. */}
              {rivalTerritory && rivalTerritory.cells > 0 && (
                <View style={styles.rivalTerritory}>
                  <Text style={styles.rivalTerritoryArea}>
                    {rivalTerritory.areaM2 >= 10000
                      ? `${(rivalTerritory.areaM2 / 10000).toFixed(1)} ha`
                      : `${rivalTerritory.areaM2.toLocaleString('es-ES')} m²`}
                  </Text>
                  <Text style={styles.rivalTerritoryLine}>
                    {rivalTerritory.citySharePct !== null && !!rivalTerritory.city
                      ? `${rivalTerritory.citySharePct}% de ${rivalTerritory.city}`
                      : ''}
                    {rivalTerritory.nationalRank !== null
                      ? `${rivalTerritory.citySharePct !== null && rivalTerritory.city ? '  ·  ' : ''}nº ${rivalTerritory.nationalRank} de España`
                      : ''}
                  </Text>
                </View>
              )}
              {/* Cells (grid v2) don't have a per-cell points value — hide the
                  line so we don't show a useless "0 pts" on a cell tap. */}
              {selectedRivalZone.points > 0 && (
                <Text style={styles.zoneCardPoints}>{selectedRivalZone.points} pts</Text>
              )}
              {selectedRivalZone.conquered_at && (
                <Text style={styles.zoneCardDate}>
                  Conquistada {new Date(selectedRivalZone.conquered_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </Text>
              )}

              <TouchableOpacity
                style={styles.addFriendBtn}
                onPress={async () => {
                  const ownerId = selectedRivalZone.owner_id;
                  const ownerName = selectedRivalZone.owner_name ?? 'rival';
                  setSelectedRivalZone(null);
                  if (!ownerId) {
                    Alert.alert('👥 Solicitud enviada', `Has enviado solicitud de amistad a ${ownerName}`);
                    return;
                  }
                  try {
                    await api.sendFriendRequest(ownerId);
                    Alert.alert('👥 Solicitud enviada', `Has enviado solicitud de amistad a ${ownerName}`);
                  } catch {
                    Alert.alert('👥 Solicitud enviada', `Has enviado solicitud de amistad a ${ownerName}`);
                  }
                }}
              >
                <Ionicons name="person-add" size={18} color="#fff" />
                <Text style={styles.addFriendBtnText}>AGREGAR AMIGO</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      <View style={styles.header}>
        {/* numberOfLines + el flex del contenedor son lo que impide que un
            nombre largo ("Sant Cugat del Vallès") empuje el botón de refrescar
            fuera de la pantalla. Antes este bloque crecía sin límite y el
            botón se salía por la derecha. */}
        <View style={styles.headerTitles}>
          <Text style={styles.cityLabel} numberOfLines={1}>{cityName}</Text>
          <Text style={styles.citySubtitle} numberOfLines={1}>{user?.username ?? 'Runner'}</Text>
        </View>
        {/* Botón de refrescar el mapa. Sustituye a los antiguos contadores de
            sesión (llama=puntos, bandera=zonas) que eran poco útiles. Recarga
            celdas/zonas y fuerza un remount limpio de los polígonos → arregla el
            caso "perímetro marcado pero interior opaco" tras una carrera sin
            tener que salir del mapa. */}
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={refreshMap}
          disabled={refreshingMap}
          activeOpacity={0.7}
        >
          {refreshingMap ? (
            <ActivityIndicator size="small" color={colors.orange} />
          ) : (
            <Ionicons name="refresh" size={20} color={colors.orange} />
          )}
          <Text style={styles.refreshBtnText}>{refreshingMap ? 'Actualizando' : 'Refrescar'}</Text>
        </TouchableOpacity>
      </View>

      {/* MapView siempre montado en el árbol — durante la carrera lo tapa el
          runningScreen (overlay absoluto). Antes lo ocultábamos con display:
          'none', pero RN Maps no refresca bien los polígonos al volver visible
          y las celdas aparecían sueltas/sin unificar. Con overlay encima, el
          mapa nativo sigue vivo y al terminar la carrera se ve la unión
          correcta sin tener que cerrar/abrir la app. */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={mapRegion}
          customMapStyle={MAP_STYLE}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          onRegionChangeComplete={(region) => {
            currentDelta.current = { latDelta: region.latitudeDelta, lngDelta: region.longitudeDelta };
            // Solo se recalcula si el encuadre sale del bloque actual: mover el
            // mapa un poco no rehace ningún polígono.
            const caja = visibleCellBox(region);
            setViewBox(prev => (sameBox(prev, caja) ? prev : caja));
            // Comprobar si está demasiado lejos para mostrar zonas
            // El aviso tiene que usar EL MISMO umbral que decide borrar las
            // celdas. Usaba el de las zonas (0.15) mientras el borrado usa el
            // de las celdas (0.02): entre esos dos valores el territorio
            // desaparecía del mapa sin que se mostrase ningún mensaje, y el
            // usuario solo veía esfumarse lo que había conquistado.
            setZoomedOutTooMuch(region.latitudeDelta > MAX_DELTA_FOR_CELLS);

            // Recargar el territorio de la zona a la que te has movido. Antes
            // esto no se hacía: las celdas eran las de tu posición inicial y
            // nada más, así que al desplazar el mapa a otra ciudad no aparecía
            // nada — parecía que tus carreras se habían perdido cuando lo que
            // pasaba es que nunca se pedían.
            //
            // Durante una carrera no se recarga: el mapa está tapado por la
            // pantalla de carrera y las celdas que importan son las que se
            // están pintando en vivo.
            if (!isRunning) {
              if (regionReloadTimer.current) clearTimeout(regionReloadTimer.current);
              regionReloadTimer.current = setTimeout(() => {
                loadCells(region.latitude, region.longitude);
              }, 600);
            }
            // Limitar al territorio español
            const clampedLat = Math.max(SPAIN_BOUNDS.south, Math.min(SPAIN_BOUNDS.north, region.latitude));
            const clampedLng = Math.max(SPAIN_BOUNDS.west, Math.min(SPAIN_BOUNDS.east, region.longitude));
            if (clampedLat !== region.latitude || clampedLng !== region.longitude) {
              mapRef.current?.animateToRegion({
                ...region,
                latitude: clampedLat,
                longitude: clampedLng,
              }, 300);
            }
          }}
        >
          {/* Grid v2 — unified territory polygons. Each owner's cells are merged
              into one (or several disjoint) polygons with a single perimeter
              stroke and no internal cell lines. polygon-clipping handles holes
              for surrounded enemy cells. Tappable rivals open the info modal.
              `polygonsVisible` se pone a false 1 frame al terminar una carrera
              para forzar el unmount de las instancias nativas (ver state). */}
          {polygonsVisible && rivalCellsUnions.map((rival, rivalIdx) =>
            rival.polygons.map((p, polyIdx) => {
              // UUID del owner → garantiza color único por usuario (no por nombre).
              const ownerColor = getRivalColor(rival.ownerId);
              return (
                <Polygon
                  // La clave YA NO lleva el número de puntos del contorno.
                  // Con él, cualquier cambio en el territorio de un rival
                  // destruía su dibujo y creaba otro; con cientos en pantalla,
                  // eso es lo que hacía que refrescar diera tirones. Ahora el
                  // dibujo se queda y solo se le cambian las coordenadas.
                  // polygonGeneration sigue: al terminar una carrera bumpea y
                  // se remonta todo limpio de una vez.
                  key={`rival-${polygonGeneration}-${rival.ownerId}-${polyIdx}`}
                  coordinates={p.outer}
                  holes={p.holes.length > 0 ? p.holes : undefined}
                  fillColor={`${ownerColor}80`}
                  strokeColor={ownerColor}
                  strokeWidth={2}
                  tappable
                  onPress={() => {
                    setRivalTerritory(null);
                    if (rival.ownerId) {
                      api.getTerritory(rival.ownerId).then(setRivalTerritory).catch(() => {});
                    }
                    setSelectedRivalZone({
                      id: `rival-${rival.ownerId}-${polyIdx}`,
                      polygon: p.outer,
                      area_km2: 0,
                      points: 0,
                      center_lat: 0,
                      center_lng: 0,
                      conquered_at: undefined,
                      owner_id: rival.ownerId,
                      owner_name: rival.ownerName,
                      owner_war_cry: rival.ownerWarCry,
                      is_mine: false,
                    });
                  }}
                />
              );
            })
          )}
          {polygonsVisible && myCellsUnion.map((p, i) => (
            <Polygon
              // Sin el número de puntos en la clave: durante una carrera el
              // territorio crece en cada celda nueva, y rehacer el dibujo
              // entero cada vez era el tirón más gordo del mapa en marcha.
              key={`mine-${polygonGeneration}-${i}`}
              coordinates={p.outer}
              holes={p.holes.length > 0 ? p.holes : undefined}
              fillColor={`${colors.orange}80`}
              strokeColor={colors.orange}
              strokeWidth={2.5}
              tappable
              onPress={() => Alert.alert('🟧 Tu territorio', 'Esta celda es tuya.')}
            />
          ))}

          {/* Ruta actual — segmentos anteriores (sin teleport lines) */}
          {pathSegments.map((seg, i) => seg.length > 1 && (
            <Polyline
              key={`seg-${i}`}
              coordinates={seg}
              strokeColor={colors.orangeLight}
              strokeWidth={4}
              lineDashPattern={[8, 4]}
              lineCap="round"
            />
          ))}
          {/* Segmento actual */}
          {currentPath.length > 1 && (
            <Polyline
              coordinates={currentPath}
              strokeColor={loopDetected ? colors.success : colors.orangeLight}
              strokeWidth={4}
              lineDashPattern={loopDetected ? undefined : [8, 4]}
              lineCap="round"
            />
          )}

          {/* Punto de inicio */}
          {currentPath.length > 0 && isRunning && (
            <Polygon
              coordinates={[
                { latitude: currentPath[0].latitude + 0.0001, longitude: currentPath[0].longitude },
                { latitude: currentPath[0].latitude - 0.0001, longitude: currentPath[0].longitude + 0.0001 },
                { latitude: currentPath[0].latitude - 0.0001, longitude: currentPath[0].longitude - 0.0001 },
              ]}
              fillColor={colors.success}
              strokeColor={colors.success}
              strokeWidth={1}
            />
          )}
        </MapView>

        {/* Banner: acércate para ver zonas */}
        {zoomedOutTooMuch && !isRunning && (
          <View style={styles.zoomBanner}>
            <Ionicons name="search-outline" size={16} color={colors.orange} />
            <Text style={styles.zoomBannerText}>Acércate para ver los territorios</Text>
          </View>
        )}

        {/* Botón centrar en mi ubicación (oculto mientras corres, el mapa ya te sigue) */}
        {!isRunning && (
          <TouchableOpacity
            style={styles.centerBtn}
            onPress={async () => {
              try {
                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                centerOnUser(loc.coords.latitude, loc.coords.longitude);
              } catch {}
            }}
          >
            <Ionicons name="locate" size={22} color={colors.orange} />
          </TouchableOpacity>
        )}

        {/* Loop detectado banner */}
        {loopDetected && (
          <View style={styles.loopBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.loopBannerText}>¡Zona cerrada! Calculando...</Text>
          </View>
        )}

        {/* Anti-trampa: aviso velocidad excesiva */}
        {gpsWeak && (
          // Corriendo, las cifras ocupan la franja de abajo: el aviso sube
          // para no quedar debajo de ellas.
          <View style={[styles.gpsBanner, isRunning && styles.gpsBannerSobreCifras]}>
            <Ionicons name="warning" size={18} color="#FFB300" />
            <Text style={styles.gpsBannerText}>
              Sin señal GPS suficiente — no se está registrando
            </Text>
          </View>
        )}
        {speedWarning && (
          <View style={styles.speedBanner}>
            <Ionicons name="speedometer" size={18} color="#FF3B30" />
            <Text style={styles.speedBannerText}>Velocidad no válida — ¡corre, no conduzcas!</Text>
          </View>
        )}

        {/* Stats carrera */}
        {isRunning && (
          <View style={styles.runningOverlay}>
            <View style={styles.runStatItem}>
              <Text style={styles.runStatValue}>{distance.toFixed(2)}</Text>
              <Text style={styles.runStatLabel}>km</Text>
            </View>
            <View style={styles.runStatDivider} />
            <View style={styles.runStatItem}>
              <Text style={styles.runStatValue}>{currentSpeed.toFixed(1)}</Text>
              <Text style={styles.runStatLabel}>km/h</Text>
            </View>
            <View style={styles.runStatDivider} />
            <View style={styles.runStatItem}>
              <Text style={styles.runStatValue}>{formatTime(runTime)}</Text>
              <Text style={styles.runStatLabel}>tiempo</Text>
            </View>
          </View>
        )}

      </View>

      {/* Strava-mode fullscreen: durante la carrera lo renderizamos como Modal
          a nivel app para tapar TAMBIÉN la tab bar (Mapa/Stats/Ranking/...).
          Antes era un overlay solo dentro del mapContainer y dejaba el menú
          inferior visible — ahí no se podía pulsar (la app sigue en MapScreen)
          y le quitaba espacio a las parciales, que chocaban con los botones
          de pausa/stop. Ahora todo cabe holgado y los controles van dentro
          del propio modal. */}
      <Modal
        visible={isRunning && !showRunMap}
        transparent={false}
        animationType="fade"
        statusBarTranslucent
        // Bloqueamos el botón back físico de Android durante la carrera —
        // si no, el usuario podría salirse sin parar el GPS.
        onRequestClose={() => {}}
      >
        {/* Layout estilo Strava (en negro):
             - Logo pequeño + badge PAUSADO arriba.
             - 3 stats apilados con cifras MUY grandes (76px) y label encima.
             - Botón pill ancho abajo (PAUSAR en marcha; STOP + REANUDAR en pausa).
             - paddingBottom amplio para que el botón no quede por debajo de
               la nav bar de Android (Xiaomi, gestos, etc.). */}
        <View style={styles.runningScreen}>
          {/* Una sola fila arriba: logo, el estado (pausa) en el centro y
              MAPA a la derecha. Alto fijo para que aparecer o desaparecer el
              badge no mueva nada de lo de abajo. */}
          <View style={styles.runningTop}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.runningLogo}
              resizeMode="contain"
            />
            <View style={styles.runningTopCentro}>
              {(isPaused || isAutoPaused) && (
                <View style={styles.pausedBadge}>
                  <Ionicons name="pause" size={14} color={colors.orange} />
                  <Text style={styles.pausedBadgeText}>
                    {isAutoPaused && !isPaused ? 'AUTO-PAUSA' : 'PAUSADO'}
                  </Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.verMapaBtn}
              onPress={() => setShowRunMap(true)}
              activeOpacity={0.8}
              accessibilityLabel="Ver el mapa"
            >
              <Ionicons name="map" size={18} color={colors.orange} />
              <Text style={styles.verMapaText}>MAPA</Text>
            </TouchableOpacity>
          </View>

          {/* El cartel de sin señal vivía solo en el mapa, y el mapa está
              tapado por esta pantalla durante toda la carrera: nadie lo veía.
              Va FLOTANDO sobre el contenido: si empujara, al aparecer y
              desaparecer descolocaría el tiempo, la distancia y la frase. */}
          <View style={styles.avisoSlot} pointerEvents="none">
            {gpsWeak && (
              <View style={styles.gpsBannerRun}>
                <Ionicons name="warning" size={18} color="#FFB300" />
                <Text style={styles.gpsBannerText}>
                  Sin señal GPS — no se está registrando
                </Text>
              </View>
            )}
          </View>

          {/* Stats apilados verticales. flex:1 reparte espacio uniformemente
              entre los 3 bloques sin que se solapen con el botón de abajo. */}
          <View style={styles.statsStack}>
            <View style={styles.statBlockBig}>
              <Text style={styles.statBigLabel}>TIEMPO</Text>
              <Text style={styles.statBigValue}>{formatTime(runTime)}</Text>
            </View>
            <View style={styles.statBlockBig}>
              <Text style={styles.statBigLabel}>DISTANCIA (KM)</Text>
              <Text style={styles.statBigValue}>{distance.toFixed(2)}</Text>
            </View>
            <View style={styles.statBlockBig}>
              {USE_PHRASES_INSTEAD_OF_SPEED ? (
                <View style={styles.phraseBox}>
                  <Text
                    style={[styles.motivationalPhrase, { fontSize: phraseFontSize(runPhrase) }]}
                    adjustsFontSizeToFit
                    numberOfLines={4}
                    minimumFontScale={0.4}
                  >
                    {runPhrase}
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={styles.statBigLabel}>VELOCIDAD (KM/H)</Text>
                  <Text style={styles.statBigValue}>{currentSpeed.toFixed(1)}</Text>
                </>
              )}
            </View>
          </View>

          {/* Controles abajo. En marcha = un único pill PAUSAR ancho.
              En pausa = STOP (rojo) + REANUDAR (verde) en fila. */}
          <View style={styles.runControlsInModal}>
            {!isPaused ? (
              <TouchableOpacity style={styles.pausePillBtn} onPress={pauseRun} activeOpacity={0.85}>
                <Ionicons name="pause" size={22} color="#fff" />
                <Text style={styles.pausePillText}>PAUSAR</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.pausedControlsRow}>
                <TouchableOpacity style={styles.stopPillBtn} onPress={stopRun} activeOpacity={0.85}>
                  <Ionicons name="stop" size={20} color="#fff" />
                  <Text style={styles.stopPillText}>PARAR</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.resumePillBtn} onPress={resumeRun} activeOpacity={0.85}>
                  <Ionicons name="play" size={20} color="#fff" />
                  <Text style={styles.resumePillText}>REANUDAR</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <View style={styles.bottom}>
        {!isRunning && (
          <View style={styles.territoryRow}>
            {[
              { value: `${conqueredZones.filter(z => z.area > 0).length}`, label: 'Zonas' },
              { value: `${distance.toFixed(1)} km`, label: 'Distancia' },
              { value: `${totalPoints}`, label: 'Puntos' },
            ].map((s, i) => (
              <View key={i} style={styles.territoryStat}>
                <Text style={styles.territoryValue}>{s.value}</Text>
                <Text style={styles.territoryLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {!isRunning && (
          <TouchableOpacity style={styles.startBtn} onPress={startRun}>
            <Ionicons name="play" size={18} color="#fff" />
            <Text style={styles.startBtnText}>INICIAR CARRERA</Text>
          </TouchableOpacity>
        )}

        {/* Corriendo y mirando el mapa: donde estaba INICIAR van los mandos de
            la carrera. Parar es el botón grande; al lado, pausar y volver a
            los datos. */}
        {isRunning && showRunMap && (
          <View style={styles.runMapControls}>
            <TouchableOpacity
              style={styles.runMapSideBtn}
              onPress={isPaused ? resumeRun : pauseRun}
              activeOpacity={0.85}
              accessibilityLabel={isPaused ? 'Reanudar' : 'Pausar'}
            >
              <Ionicons name={isPaused ? 'play' : 'pause'} size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.runMapStopBtn} onPress={stopRun} activeOpacity={0.85}>
              <Ionicons name="stop" size={20} color="#fff" />
              <Text style={styles.startBtnText}>PARAR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.runMapSideBtn}
              onPress={() => setShowRunMap(false)}
              activeOpacity={0.85}
              accessibilityLabel="Ver los datos de la carrera"
            >
              <Ionicons name="stats-chart" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Aviso destacado de ubicación FOREGROUND. Igual de obligatorio que el
          de background: el rechazo de jul-2026 fue por pedir este permiso al
          montar el mapa sin divulgación previa. Reutiliza los estilos del
          modal de background. */}
      <Modal
        visible={fgDisclosureVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleFgDisclosureDecline}
      >
        <View style={styles.bgDisclosureBackdrop}>
          <View style={styles.bgDisclosureCard}>
            <View style={styles.bgDisclosureHeader}>
              <Image source={require('../../assets/icon.png')} style={styles.bgDisclosureLogo} />
              <Text style={styles.bgDisclosureTitle}>Tu ubicación en CORRR</Text>
            </View>

            <Text style={styles.bgDisclosureLead}>
              CORRR recoge datos de ubicación para mostrar tu posición en el
              mapa, el territorio a tu alrededor y registrar tus carreras.
            </Text>

            <View style={styles.bgDisclosureSection}>
              <Text style={styles.bgDisclosureSectionTitle}>¿Qué datos recogemos?</Text>
              <Text style={styles.bgDisclosureSectionBody}>
                Tu posición GPS mientras usas la app: para centrar el mapa,
                enseñarte las celdas conquistadas cerca de ti y, durante una
                carrera, calcular distancia, ritmo y territorio.
              </Text>
            </View>

            <View style={styles.bgDisclosureSection}>
              <Text style={styles.bgDisclosureSectionTitle}>¿A dónde van tus datos?</Text>
              <Text style={styles.bgDisclosureSectionBody}>
                A tu cuenta de CORRR en nuestro servidor (EU, GDPR). No se
                ceden a terceros y puedes borrarlos cuando quieras desde
                Perfil → Eliminar cuenta.
              </Text>
            </View>

            <Text style={styles.bgDisclosureFootnote}>
              Tras pulsar "Aceptar y continuar", Android te pedirá
              confirmación del permiso de ubicación.
            </Text>

            <TouchableOpacity
              style={styles.bgDisclosureAcceptBtn}
              onPress={handleFgDisclosureAccept}
              activeOpacity={0.85}
            >
              <Text style={styles.bgDisclosureAcceptText}>Aceptar y continuar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bgDisclosureDeclineBtn}
              onPress={handleFgDisclosureDecline}
              activeOpacity={0.85}
            >
              <Text style={styles.bgDisclosureDeclineText}>Ahora no</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Aviso destacado de ubicación en background. OBLIGATORIO antes de
          invocar el diálogo de permiso del sistema (política de Google Play
          para ACCESS_BACKGROUND_LOCATION). Sin esto la app no pasa revisión.
          El usuario tiene que pulsar "Aceptar y continuar" para que tras eso
          se llame a requestBackgroundPermissionsAsync y aparezca el diálogo
          nativo de Android. Si pulsa "Ahora no", se cancela el inicio de la
          carrera. */}
      <Modal
        visible={bgDisclosureVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleBgDisclosureDecline}
      >
        <View style={styles.bgDisclosureBackdrop}>
          <View style={styles.bgDisclosureCard}>
            <View style={styles.bgDisclosureHeader}>
              <Image source={require('../../assets/icon.png')} style={styles.bgDisclosureLogo} />
              <Text style={styles.bgDisclosureTitle}>Permiso de ubicación</Text>
            </View>

            <Text style={styles.bgDisclosureLead}>
              CORRR recoge datos de ubicación para registrar tu carrera y el
              territorio que conquistas, incluso cuando la app está cerrada o
              no está en uso (pantalla bloqueada u otra app en primer plano).
            </Text>

            <View style={styles.bgDisclosureSection}>
              <Text style={styles.bgDisclosureSectionTitle}>¿Qué datos recogemos?</Text>
              <Text style={styles.bgDisclosureSectionBody}>
                Únicamente la ruta GPS de tu carrera mientras esté activa
                (desde "Iniciar carrera" hasta "Parar"). Se calcula
                distancia, ritmo y las celdas de territorio que pisas.
              </Text>
            </View>

            <View style={styles.bgDisclosureSection}>
              <Text style={styles.bgDisclosureSectionTitle}>¿Por qué en segundo plano?</Text>
              <Text style={styles.bgDisclosureSectionBody}>
                Android suspende las apps cuando la pantalla se bloquea. Sin
                el permiso en segundo plano se perderían tramos de tu carrera
                cada vez que apagues la pantalla, falseando la distancia y el
                territorio que conquistas.
              </Text>
            </View>

            <View style={styles.bgDisclosureSection}>
              <Text style={styles.bgDisclosureSectionTitle}>¿A dónde van tus datos?</Text>
              <Text style={styles.bgDisclosureSectionBody}>
                A tu cuenta de CORRR en nuestro servidor (EU, GDPR). No se
                ceden a terceros y puedes borrarlos cuando quieras desde
                Perfil → Eliminar cuenta.
              </Text>
            </View>

            <Text style={styles.bgDisclosureFootnote}>
              Tras pulsar "Aceptar y continuar", Android te pedirá confirmación.
              Elige "Permitir todo el tiempo" para mejor experiencia.
            </Text>

            <TouchableOpacity
              style={styles.bgDisclosureAcceptBtn}
              onPress={handleBgDisclosureAccept}
              activeOpacity={0.85}
            >
              <Text style={styles.bgDisclosureAcceptText}>Aceptar y continuar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bgDisclosureDeclineBtn}
              onPress={handleBgDisclosureDecline}
              activeOpacity={0.85}
            >
              <Text style={styles.bgDisclosureDeclineText}>Ahora no</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // Loading screen
  loadingContainer: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: 20,
  },
  loadingLogo: { width: 100, height: 100, borderRadius: 24 },
  loadingTitle: {
    fontSize: 18, fontWeight: '900', color: colors.textPrimary,
    letterSpacing: 2, marginTop: 8,
  },
  loadingSubtitle: {
    fontSize: 14, color: colors.textSecondary, marginTop: 4,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm,
  },
  // flexShrink deja que el bloque del título ceda ancho; minWidth 0 es
  // imprescindible en flexbox para que un texto pueda encogerse por debajo de
  // su tamaño natural (sin él, numberOfLines ni llega a aplicarse).
  headerTitles: { flexShrink: 1, minWidth: 0, marginRight: spacing.sm },
  cityLabel: { fontSize: 20, fontWeight: '900', color: colors.textPrimary, letterSpacing: 1 },
  citySubtitle: { fontSize: 12, color: colors.textSecondary },
  headerStats: { flexDirection: 'row', gap: spacing.md },
  headerStat: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgCard,
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  headerStatValue: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.bgCard,
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, minWidth: 124, justifyContent: 'center',
    flexShrink: 0,   // nunca cede ancho: el que cede es el nombre de la ciudad
  },
  refreshBtnText: { fontSize: 13, fontWeight: '700', color: colors.orange },
  mapContainer: { flex: 1, position: 'relative' },
  map: { flex: 1 },
  centerBtn: {
    position: 'absolute', bottom: spacing.md, right: spacing.md,
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4,
    elevation: 4,
  },
  loopBanner: {
    position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md,
    backgroundColor: 'rgba(34,197,94,0.15)', borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.success,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.sm, gap: spacing.xs,
  },
  loopBannerText: { fontSize: 14, fontWeight: '700', color: colors.success },
  zoomBanner: {
    position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md,
    backgroundColor: 'rgba(255,149,0,0.12)', borderRadius: radius.full,
    borderWidth: 1, borderColor: `${colors.orange}50`,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.sm, gap: spacing.xs,
  },
  zoomBannerText: { fontSize: 14, fontWeight: '700', color: colors.orange },
  gpsBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,179,0,0.15)', borderColor: '#FFB300', borderWidth: 1,
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.full,
    alignSelf: 'center', marginTop: spacing.sm,
  },
  gpsBannerText: { fontSize: 13, fontWeight: '700', color: '#FFB300', flexShrink: 1 },
  gpsBannerSobreCifras: { marginBottom: 72 },
  speedBanner: {
    position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md,
    backgroundColor: 'rgba(255,59,48,0.15)', borderRadius: radius.full,
    borderWidth: 1, borderColor: '#FF3B30',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.sm, gap: spacing.xs,
  },
  speedBannerText: { fontSize: 13, fontWeight: '700', color: '#FF3B30' },
  runningOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.85)',
    paddingVertical: spacing.sm, alignItems: 'center',
  },
  runStatItem: { flex: 1, alignItems: 'center' },
  runStatValue: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  runStatLabel: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase' },
  runStatDivider: { width: 1, height: 32, backgroundColor: colors.border },
  runningScreen: {
    // Modal fullscreen (tapa tab bar y nav bar). Layout vertical:
    //   - top: logo + badge.
    //   - statsStack: ocupa todo el espacio sobrante con flex:1.
    //   - controles: pegados abajo con padding inferior amplio para no
    //     solaparse con la nav del teléfono (Android Xiaomi, gestos, etc.).
    // paddingBottom subido 40 → 72 porque MIUI suele tener nav bar más alta
    // (gestos / barra de captura) y antes el botón PAUSAR quedaba pegado.
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 72,
    paddingHorizontal: spacing.lg,
  },
  runningTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // Alto fijo: el badge de pausa aparece y desaparece solo, y sin esto
    // arrastraba consigo el tiempo, la distancia y la frase.
    height: 44,
    marginBottom: spacing.md,
  },
  runningTopCentro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Stack vertical de stats. flex:1 → ocupa todo el alto restante entre
  // top y controles. justifyContent:'space-around' distribuye los 3
  // bloques con aire entre ellos.
  statsStack: {
    flex: 1,
    width: '100%',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  statBlockBig: { alignItems: 'center', gap: 4 },
  // La frase vive en una caja de alto acotado: nunca puede crecer por debajo
  // de los controles, pase lo que pase con el texto.
  phraseBox: {
    alignSelf: 'stretch',
    maxHeight: 190,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Label arriba pequeño tipo Strava ("DISTANCIA (KM)").
  statBigLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  // Cifras MUY grandes — el dato es lo único que importa durante la carrera.
  statBigValue: {
    fontSize: 88,
    fontWeight: '900',
    color: colors.textPrimary,
    letterSpacing: -3,
    lineHeight: 92,
  },
  // Frase motivacional (sustituye al km/h). Estilo "tipo BEBAS": condensada
  // nativa de Android + negra + mayúsculas. adjustsFontSizeToFit encoge las
  // frases largas y deja grandes las cortas, ocupando el mismo hueco.
  motivationalPhrase: {
    // Fuente condensada por plataforma (estilo BEBAS). Android tiene la
    // condensada nativa; iOS NO ('sans-serif-condensed' no existe) → usamos
    // Avenir Next Condensed Heavy, condensada del sistema iOS. (Futuro: cargar
    // Bebas Neue real con expo-font para que sea idéntica en ambas.)
    fontFamily: Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' }),
    fontSize: 46,
    fontWeight: '900',
    color: colors.orange,
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    // SIN lineHeight fijo: no escala con adjustsFontSizeToFit y provocaba que
    // las frases largas se cortaran. Con el alto automático, la frase entera
    // siempre cabe encogiendo (hasta 5 líneas / scale 0.25). Frases cortas
    // siguen saliendo grandes.
    alignSelf: 'stretch',
    paddingHorizontal: 16,
  },
  // Contenedor de controles abajo. paddingHorizontal: 0 para que los pills
  // lleguen de borde a borde dentro del paddingHorizontal del runningScreen.
  runControlsInModal: {
    width: '100%',
    alignItems: 'stretch',
  },
  // Botón "MAPA" de la pantalla de carrera: discreto, arriba a la derecha.
  verMapaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.orange,
  },
  verMapaText: { color: colors.orange, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  // Mismo aviso de "sin señal" que en el mapa, dentro de la pantalla de
  // carrera, que es la que se ve mientras corres.
  // Hueco propio para el aviso, SIEMPRE presente aunque esté vacío: si
  // apareciera y desapareciera empujando, movería el tiempo, la distancia y
  // la frase cada vez que el GPS va y viene.
  avisoSlot: { height: 38, alignItems: 'center', justifyContent: 'center' },
  gpsBannerRun: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: radius.full, backgroundColor: 'rgba(255,179,0,0.18)',
    borderWidth: 1, borderColor: '#FFB300',
  },
  // Mandos de la carrera cuando estás mirando el mapa: parar en grande, y a
  // los lados pausar y volver a los datos.
  runMapControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  runMapSideBtn: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgCardAlt, borderWidth: 1, borderColor: colors.border,
  },
  runMapStopBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 56, borderRadius: radius.full, backgroundColor: colors.danger,
  },
  // Botón pill PAUSAR ancho — estilo Strava.
  pausePillBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orange,
    paddingVertical: 18, paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
  },
  pausePillText: {
    fontSize: 17, fontWeight: '900', color: '#fff',
    letterSpacing: 2,
  },
  // Cuando está pausado, dos pills en fila: PARAR (rojo) + REANUDAR (verde).
  pausedControlsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stopPillBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.danger,
    paddingVertical: 18,
    borderRadius: radius.full,
  },
  stopPillText: {
    fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 1.5,
  },
  resumePillBtn: {
    flex: 1.5,  // botón verde un poco más ancho que el rojo
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.success,
    paddingVertical: 18,
    borderRadius: radius.full,
  },
  resumePillText: {
    fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 1.5,
  },
  pausedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: `${colors.orange}20`, borderColor: colors.orange, borderWidth: 1,
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full,
  },
  pausedBadgeText: {
    fontSize: 12, fontWeight: '800', color: colors.orange,
    letterSpacing: 1.5,
  },
  runningLogo: { width: 40, height: 40, borderRadius: 10 },
  splitsContainer: {
    width: '100%', paddingHorizontal: spacing.lg, alignItems: 'center', gap: spacing.sm,
  },
  splitsHeader: {
    fontSize: 11, fontWeight: '700', color: colors.textSecondary,
    letterSpacing: 2, textTransform: 'uppercase',
  },
  splitsPlaceholder: {
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
    fontStyle: 'italic', marginTop: spacing.xs,
  },
  // Inbox display for received taunts/responses (sister to ZonePopup).
  tauntReceivedContainer: {
    // Negro puro (no colors.bg): el arte de los taunts tiene fondo negro y
    // cualquier diferencia de tono delataba el recuadro de la imagen.
    flex: 1, backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
  },
  tauntReceivedClose: {
    position: 'absolute', top: 50, right: spacing.md, zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  tauntReceivedFrom: {
    // Flota SOBRE la imagen a pantalla completa (antes empujaba la imagen
    // hacia abajo dentro del flujo). Sombra para que se lea sobre el arte.
    position: 'absolute', top: 58, left: 70, right: 70, zIndex: 10,
    color: colors.textPrimary, fontSize: 16, fontWeight: '700',
    textAlign: 'center',
    textShadowColor: '#000', textShadowRadius: 6,
  },
  tauntReceivedImage: {
    // Pantalla completa con medidas EXPLÍCITAS (sin position:absolute: sin
    // marco el <Image> cae a su tamaño intrínseco y sale ampliadísimo) y con
    // 'contain', porque los taunts tienen proporciones distintas entre sí y el
    // texto llega al borde. Sobre negro puro las bandas no se ven.
    position: 'absolute',
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  tauntReceivedRespond: {
    position: 'absolute', bottom: 50, left: spacing.md, right: spacing.md,
    backgroundColor: colors.orange, paddingVertical: 16, borderRadius: radius.full,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  tauntReceivedRespondText: {
    fontSize: 16, fontWeight: '800', color: '#000', letterSpacing: 1,
  },
  // Variante neutra para cerrar el hilo en la respuesta final (sin opción a
  // seguir respondiendo). Mismo botón, otro look — distingue "cerrar" de
  // "devolver" para que el usuario sepa que el hilo ya acabó.
  tauntReceivedDismiss: {
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
  },
  tauntReceivedDismissText: {
    fontSize: 16, fontWeight: '800', color: colors.textPrimary, letterSpacing: 1,
  },
  splitsRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center',
    gap: spacing.md, minHeight: 120,
  },
  splitItem: { alignItems: 'center', gap: 4 },
  splitPace: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  splitBar: { width: 28, borderRadius: 4 },
  splitKm: { fontSize: 10, color: colors.textSecondary, fontWeight: '600' },
  bottom: {
    paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.md,
    gap: spacing.md, backgroundColor: colors.bg,
  },
  territoryRow: { flexDirection: 'row', justifyContent: 'space-around' },
  territoryStat: { alignItems: 'center' },
  territoryValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  territoryLabel: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase' },
  startBtn: {
    backgroundColor: colors.orange, paddingVertical: 18, borderRadius: radius.full,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
    shadowColor: colors.orange, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 16,
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  runControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  runControlBtn: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  pauseBtn: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.orange,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.orange, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 20,
    elevation: 8,
  },
  resumeBtn: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.success, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 18,
    elevation: 8,
  },
  stopBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#FF3B30',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#FF3B30', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 14,
    elevation: 6,
  },
  // Resumen post-carrera
  summaryOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center', alignItems: 'center', padding: spacing.lg,
  },
  summaryCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, width: '100%', alignItems: 'center',
  },
  summaryTitle: {
    fontSize: 18, fontWeight: '900', color: colors.orange,
    letterSpacing: 2, marginBottom: spacing.lg,
  },
  summaryStats: {
    flexDirection: 'row', alignItems: 'center', width: '100%',
    marginBottom: spacing.lg,
  },
  summaryStat: { flex: 1, alignItems: 'center' },
  summaryStatValue: { fontSize: 28, fontWeight: '900', color: colors.textPrimary },
  summaryStatLabel: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', marginTop: 2 },
  summaryDivider: { width: 1, height: 40, backgroundColor: colors.border },
  summaryPoints: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    padding: spacing.md, width: '100%', alignItems: 'center',
    marginBottom: spacing.lg, gap: spacing.sm,
  },
  summaryPointsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryPointsValue: { fontSize: 32, fontWeight: '900', color: colors.orange },
  summaryPointsLabel: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  summaryXpRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryXpValue: { fontSize: 18, fontWeight: '800', color: '#FFD700' },
  // Desglose de puntos (v1.10.10)
  summaryBreakdown: {
    width: '100%', marginBottom: spacing.lg, gap: 2,
  },
  breakdownRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  breakdownLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  breakdownHint: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  breakdownValue: { fontSize: 15, fontWeight: '800', color: colors.textSecondary },
  breakdownValueHi: { color: colors.orange },
  summaryBtn: {
    backgroundColor: colors.orange, paddingVertical: 14, paddingHorizontal: 48,
    borderRadius: radius.full,
  },
  summaryBtnText: { fontSize: 16, fontWeight: '800', color: '#000', letterSpacing: 1 },
  // Compartir: secundario (contorno) para que CERRAR siga siendo la acción
  // principal y no compitan dos botones naranjas macizos.
  summaryShareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderWidth: 1.5, borderColor: colors.orange, borderRadius: radius.full,
    paddingVertical: 13, paddingHorizontal: 36, marginBottom: spacing.sm,
  },
  summaryShareBtnText: { fontSize: 15, fontWeight: '800', color: colors.orange, letterSpacing: 1 },
  // Zona popup — centinela
  zoneCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, width: '100%', alignItems: 'center',
  },
  zoneCardClose: {
    position: 'absolute', top: spacing.sm, right: spacing.sm,
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  zoneCardTitle: {
    fontSize: 16, fontWeight: '900', color: colors.textPrimary,
    letterSpacing: 2, marginTop: spacing.sm,
  },
  rivalTerritory: { alignItems: 'center', marginTop: 6, marginBottom: 2 },
  rivalTerritoryArea: { fontSize: 20, fontWeight: '900', color: colors.textPrimary },
  rivalTerritoryLine: { fontSize: 12, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
  zoneCardWarCry: {
    fontSize: 13, fontStyle: 'italic', color: colors.textSecondary,
    marginTop: 4, textAlign: 'center', paddingHorizontal: spacing.lg,
  },
  zoneCardPoints: {
    fontSize: 28, fontWeight: '900', color: colors.orange, marginTop: 4,
  },
  zoneCardDate: {
    fontSize: 12, color: colors.textSecondary, marginTop: 2,
  },
  rivalAvatarBig: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.bgCardAlt, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, marginBottom: spacing.sm, overflow: 'hidden',
  },
  // La foto rellena el círculo entero. overflow hidden en el contenedor no
  // basta en Android, así que el propio Image lleva el borderRadius.
  rivalAvatarPhoto: { width: '100%', height: '100%', borderRadius: 30 },
  rivalAvatarText: { fontSize: 26, fontWeight: '900', color: colors.textPrimary },
  addFriendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.orange, paddingVertical: 14, borderRadius: radius.full,
    marginTop: spacing.lg, width: '100%',
  },
  addFriendBtnText: { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  sentinelSection: {
    width: '100%', marginTop: spacing.lg,
    backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md,
  },
  sentinelTitle: {
    fontSize: 14, fontWeight: '800', color: colors.textPrimary,
    textAlign: 'center', letterSpacing: 1,
  },
  sentinelDesc: {
    fontSize: 12, color: colors.textSecondary, textAlign: 'center',
    marginTop: 2, marginBottom: spacing.md,
  },
  sentinelOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgCard, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  sentinelOptionLocked: { borderColor: `${colors.orange}40` },
  sentinelOptionLeft: {},
  sentinelOptionRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sentinelHours: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  sentinelCost: { fontSize: 15, fontWeight: '700', color: '#FFD700' },
  sentinelBuy: { fontSize: 13, fontWeight: '700', color: colors.orange },
  sentinelBalance: {
    fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm,
  },

  // ── Aviso destacado de ubicación en background (Google Play policy) ──
  bgDisclosureBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  bgDisclosureCard: {
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bgDisclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: spacing.md,
  },
  bgDisclosureLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  bgDisclosureTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  bgDisclosureLead: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  bgDisclosureSection: {
    marginBottom: spacing.md,
  },
  bgDisclosureSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.orange,
    marginBottom: 4,
  },
  bgDisclosureSectionBody: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  bgDisclosureFootnote: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 16,
  },
  bgDisclosureAcceptBtn: {
    backgroundColor: colors.orange,
    paddingVertical: 14,
    borderRadius: radius.full,
    alignItems: 'center',
    marginBottom: 8,
  },
  bgDisclosureAcceptText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
  },
  bgDisclosureDeclineBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  bgDisclosureDeclineText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
