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
  NativeModules,
  Platform,
} from 'react-native';
import MapView, { Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import polygonClipping from 'polygon-clipping';
import { colors, spacing, radius } from '../theme';
import { api, RemoteZone, RemoteCell, TauntInbox } from '../services/api';
import ZonePopup, { PopupType } from '../components/ZonePopup';
import TauntSelector, { getTauntFullImage } from '../components/TauntSelector';
import LoadingScreen from '../components/LoadingScreen';

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
type BgPoint = { latitude: number; longitude: number; timestamp: number; accuracy: number; speed: number };
let bgLocationBuffer: BgPoint[] = [];

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;
  const newPts: BgPoint[] = locations.map(loc => ({
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    timestamp: loc.timestamp ?? Date.now(),
    accuracy: loc.coords.accuracy ?? 999,
    speed: loc.coords.speed ?? -1,
  }));
  bgLocationBuffer.push(...newPts);
  // Persist so points survive even if Android kills the JS process during a long background.
  // The task may run in a fresh headless JS context (module state reset), so AsyncStorage is the
  // only authoritative source across process lifetimes.
  try {
    const raw = await AsyncStorage.getItem(BG_BUFFER_KEY);
    const existing: BgPoint[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(BG_BUFFER_KEY, JSON.stringify([...existing, ...newPts]));
  } catch {}
});

async function loadAndClearPersistedBgBuffer(): Promise<BgPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(BG_BUFFER_KEY);
    await AsyncStorage.removeItem(BG_BUFFER_KEY);
    return raw ? (JSON.parse(raw) as BgPoint[]) : [];
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
const CELL_SIZE_M = 10;
const CELL_LAT_DEG = CELL_SIZE_M / 111000;
const CELL_LNG_DEG = CELL_SIZE_M / (111000 * Math.cos(40 * Math.PI / 180));

// Don't even attempt cell rendering when zoomed out beyond this — would draw
// thousands of tiny polygons and lag the map. 0.02 ≈ 2km viewport at Spain.
const MAX_DELTA_FOR_CELLS = 0.02;

function coordToCell(lat: number, lng: number): { x: number; y: number } {
  return {
    x: Math.floor(lng / CELL_LNG_DEG),
    y: Math.floor(lat / CELL_LAT_DEG),
  };
}

/** Returns the 4 corners of a cell as a polygon path (counter-clockwise). */
function cellToCorners(x: number, y: number): { latitude: number; longitude: number }[] {
  const lng = x * CELL_LNG_DEG;
  const lat = y * CELL_LAT_DEG;
  return [
    { latitude: lat, longitude: lng },
    { latitude: lat, longitude: lng + CELL_LNG_DEG },
    { latitude: lat + CELL_LAT_DEG, longitude: lng + CELL_LNG_DEG },
    { latitude: lat + CELL_LAT_DEG, longitude: lng },
  ];
}

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

const cellKey = (x: number, y: number) => `${x},${y}`;

/** 4-connected line of cells between two grid coordinates. Greedy: each step
 *  moves one orthogonal cell toward the target. Used to "bridge" consecutive
 *  GPS readings — even if the GPS skips 1-2 cells, the trail stays continuous
 *  with no holes, so the flood fill always seals enclosures. */
function cellLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
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
function fillEnclosedCells(cellKeys: Set<string>): Set<string> {
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

/** Union an array of cells into one (or several disjoint) outlined polygons.
 *  Used to render a territory as a single mass — no internal lines between
 *  adjacent cells, just one stroke around the perimeter of each connected
 *  component. Returns { outer, holes } for each polygon (RN-Maps's <Polygon>
 *  has a `holes` prop). */
type UnionedPolygon = { outer: { latitude: number; longitude: number }[]; holes: { latitude: number; longitude: number }[][] };
function unionCellsToPolygons(cells: { x: number; y: number }[]): UnionedPolygon[] {
  if (cells.length === 0) return [];
  // polygon-clipping uses [lng, lat] ordering.
  const ringInput: number[][][][] = cells.map(c => {
    const corners = cellToCorners(c.x, c.y);
    // Ensure ring is closed and follows polygon-clipping convention (first === last).
    const ring = corners.map(p => [p.longitude, p.latitude]);
    ring.push(ring[0]);
    return [ring];
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

// ── GPS Filtering (Strava-grade) ──────────────────────────────────────────
const MAX_SPEED_KMH = 30;        // Anti-cheat: max speed allowed
const MAX_ACCURACY_M = 18;       // Ignore GPS points with accuracy worse than 18m
const WARMUP_ACCURACY_M = 12;    // First 5 points need accuracy < 12m (GPS warming up)
const WARMUP_POINTS = 5;         // Number of initial points with strict accuracy
const MIN_POINT_DIST_M = 3;      // Ignore points closer than 3m (noise)
const MAX_POINT_DIST_M = 100;    // Teleport if jump > 100m in a single update
const TELEPORT_TIME_THRESHOLD = 8; // Only count as teleport if also >8s gap
const SINUOSITY_THRESHOLD = 1.3; // Buffer path/straight ratio below this = straight line = teleport

// ── Anti-drift (sentado en una silla) ─────────────────────────────────────
// Rolling window: si las últimas STATIONARY_WINDOW lecturas caben dentro de
// un círculo de STATIONARY_RADIUS_M, asumimos que el usuario está quieto y
// el GPS está bailando. No claimemos celdas ni acumulamos distancia.
// Caminante a 4 km/h en 18s recorre ~20m → fuera del círculo → OK.
// Sentado con drift de 5-10m → dentro del círculo → bloqueado.
// 6 puntos (≈18s) en lugar de 8 → detector arranca antes y el usuario no
// tiene tiempo de ver 15 km/h por un spike de drift.
const STATIONARY_WINDOW = 6;
const STATIONARY_RADIUS_M = 15;

/** ¿Las últimas N coordenadas caen todas dentro de un círculo de radius m?
 *  Si sí, el usuario está parado y el GPS está bailando — no movimiento real.
 *  Calcula bounding box (suficiente como aproximación al círculo envolvente
 *  para nuestros radios pequeños). Necesita al menos STATIONARY_WINDOW puntos
 *  para activarse — durante el "warmup" del run no bloquea. */
function isStationary(coords: Coord[]): boolean {
  if (coords.length < STATIONARY_WINDOW) return false;
  const recent = coords.slice(-STATIONARY_WINDOW);
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of recent) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }
  // Convertir delta lat/lng a metros (aproximación local plana).
  const latM = (maxLat - minLat) * 111000;
  const midLat = (minLat + maxLat) / 2;
  const lngM = (maxLng - minLng) * 111000 * Math.cos(midLat * Math.PI / 180);
  // Diagonal del bounding box ≈ diámetro del círculo envolvente.
  const diag = Math.sqrt(latM * latM + lngM * lngM);
  return diag < STATIONARY_RADIUS_M * 2;
}

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

/** Ray-casting point-in-polygon — mismo algoritmo que el backend */
function pointInPolygon(lat: number, lng: number, polygon: Coord[]): boolean {
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

function getDistance(a: Coord, b: Coord): number {
  const R = 6371000;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const x = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function getDistanceKm(a: Coord, b: Coord): number {
  return getDistance(a, b) / 1000;
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

/**
 * Central GPS point filter — returns action to take:
 * - 'accept': good point, add to path and accumulate distance
 * - 'skip': bad point (noise, low accuracy), ignore completely
 * - 'teleport': jump detected, start new path segment
 */
function filterGpsPoint(
  newCoord: Coord,
  prevCoord: Coord | null,
  newTimestamp: number,
  prevTimestamp: number,
  accuracy: number,
  speed: number,
  pointCount: number = 999, // how many good points we already have (for warmup)
): { action: 'accept' | 'skip' | 'teleport'; distKm: number; speedKmh: number } {
  // Filter 0: sanity — coords inválidas (NaN/Infinity) o fuera del planeta.
  // Sin esto, un punto GPS corrupto se propaga a coordToCell → cells con
  // keys "NaN,NaN" y polígonos rotos. Pasa muy de tarde en tarde con
  // ciertos chips GPS al perder fix.
  if (
    !Number.isFinite(newCoord.latitude) ||
    !Number.isFinite(newCoord.longitude) ||
    Math.abs(newCoord.latitude) > 90 ||
    Math.abs(newCoord.longitude) > 180
  ) {
    return { action: 'skip', distKm: 0, speedKmh: 0 };
  }
  // Filter 1: accuracy — stricter during warmup (first N points)
  const maxAcc = pointCount < WARMUP_POINTS ? WARMUP_ACCURACY_M : MAX_ACCURACY_M;
  if (accuracy > maxAcc) {
    return { action: 'skip', distKm: 0, speedKmh: 0 };
  }

  if (!prevCoord) {
    return { action: 'accept', distKm: 0, speedKmh: 0 };
  }

  const distKm = getDistanceKm(prevCoord, newCoord);
  const distM = distKm * 1000;
  const timeDiff = prevTimestamp > 0 ? (newTimestamp - prevTimestamp) / 1000 : 3;

  // Filter 2: too close (GPS noise / standing still)
  if (distM < MIN_POINT_DIST_M) {
    return { action: 'skip', distKm: 0, speedKmh: 0 };
  }

  // Filter 3: teleport (big jump after time gap — GPS glitch or phone slept)
  if (distM > MAX_POINT_DIST_M && timeDiff > TELEPORT_TIME_THRESHOLD) {
    return { action: 'teleport', distKm: 0, speedKmh: 0 };
  }

  // Filter 4: speed check (anti-cheat + catches shorter teleports)
  const speedKmh = timeDiff > 0 ? (distKm / timeDiff) * 3600 : 0;
  if (speedKmh > MAX_SPEED_KMH) {
    return { action: 'skip', distKm: 0, speedKmh };
  }

  return { action: 'accept', distKm, speedKmh };
}

/** Convex hull (Andrew's monotone chain) — used for zone polygon when path has gaps */
function convexHull(points: Coord[]): Coord[] {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a.longitude - b.longitude || a.latitude - b.latitude);
  const cross = (o: Coord, a: Coord, b: Coord) =>
    (a.longitude - o.longitude) * (b.latitude - o.latitude) -
    (a.latitude - o.latitude) * (b.longitude - o.longitude);

  // Lower hull
  const lower: Coord[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  // Upper hull
  const upper: Coord[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0)
      upper.pop();
    upper.push(pts[i]);
  }
  // Remove last point of each half because it repeats
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Check if a series of points is basically a straight line (sinuosity check) */
function isBufferStraightLine(lastGoodPoint: Coord, bufferPoints: Coord[]): boolean {
  if (bufferPoints.length < 2) return true;
  const first = lastGoodPoint;
  const last = bufferPoints[bufferPoints.length - 1];
  const straightDist = getDistance(first, last);
  if (straightDist < 30) return false; // too short to judge

  let pathDist = getDistance(first, bufferPoints[0]);
  for (let i = 1; i < bufferPoints.length; i++) {
    pathDist += getDistance(bufferPoints[i - 1], bufferPoints[i]);
  }

  const sinuosity = pathDist / straightDist;
  return sinuosity < SINUOSITY_THRESHOLD; // ratio close to 1 = straight line
}

export default function MapScreen({ user, onNavigateToShop }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [runTime, setRunTime] = useState(0);
  const [distance, setDistance] = useState(0);
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
    visible: boolean; distance: number; time: number; points: number; xp: number; zones: number;
  } | null>(null);
  const [loopDetected, setLoopDetected] = useState(false);
  const [remoteZones, setRemoteZones] = useState<RemoteZone[]>([]);
  // Grid (v2): cells claimed in the current run live in a Set keyed by "x,y".
  // The polygon system above still runs in parallel during the v1.5 → v1.6 transition
  // until we're confident enough to delete it.
  const claimedCellsRef = useRef<Set<string>>(new Set());
  const [claimedCellsTick, setClaimedCellsTick] = useState(0); // bump to force re-render
  // Last cell claimed — used to bridge a continuous line of cells to the next
  // one (Bresenham-style), so GPS skips don't leave holes in the trail.
  const lastClaimedCellRef = useRef<{ x: number; y: number } | null>(null);
  // Rolling window de las últimas N coordenadas aceptadas, para detector de
  // "estás en realidad quieto". Si todas caen dentro de un círculo pequeño
  // → GPS drift, no real movement → no claim cells. Ver STATIONARY_*.
  const recentCoordsRef = useRef<Coord[]>([]);
  const [remoteCells, setRemoteCells] = useState<RemoteCell[]>([]);
  const [selectedZone, setSelectedZone] = useState<RemoteZone | null>(null);
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
  const [tauntTarget, setTauntTarget] = useState<{ toUserId: string; toName: string; runId: string | null; mode: 'taunt' | 'response' } | null>(null);
  const [selectedRivalZone, setSelectedRivalZone] = useState<RemoteZone | null>(null);
  const [zoomedOutTooMuch, setZoomedOutTooMuch] = useState(false);
  const [speedWarning, setSpeedWarning] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  // Splits (parciales): pace per completed km. Recorded when distance crosses an integer km.
  const [splits, setSplits] = useState<{ km: number; paceSecs: number }[]>([]);
  const splitsTrackingRef = useRef({ lastKm: 0, lastTime: 0 });
  const speedWarningTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidSegments = useRef(0);
  const isRunningRef = useRef(false);
  const handleLocationUpdateRef = useRef<(loc: Location.LocationObject) => void>(() => {});

  // Timestamp del último punto GPS para cálculo de velocidad real
  const lastLocationTimestamp = useRef<number>(0);

  // Auto-pause: detect when runner is standing still for 30+ seconds
  const lastMovementTime = useRef<number>(0);
  const autoPauseTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Auto-pause silencioso: a los 20s sin movimiento la carrera se pausa sola
  // (sin modal). Cuando el GPS detecta que vuelves a moverte, se reanuda sola.
  // No es lo mismo que `isPaused` (pausa manual con el botón): el manual mantiene
  // la pausa hasta que pulses Reanudar; el auto se reanuda con movimiento.
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const isAutoPausedRef = useRef(false);

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

  // Background location: integrar puntos del buffer cuando la app vuelve a foreground
  useEffect(() => {
    const handleAppState = async (nextState: AppStateStatus) => {
      if (!isRunningRef.current) return;

      if (nextState === 'active') {
        // Check for new robo notifications and incoming taunts. Runs every time
        // the user comes back to the app (not just on cold launch).
        checkUnreadTaunts();
        // Force-recompute runTime from Date.now() math — catches up the timer
        // if the JS thread was suspended while the screen was off.
        if (runStartTimeRef.current) setRunTime(computeRunTime());

        // Drain persisted buffer first (survives process kill). It's authoritative — the task
        // writes to AsyncStorage AND in-memory on every batch, so persisted is always ≥ in-memory.
        const persisted = await loadAndClearPersistedBgBuffer();
        const bufferToProcess = persisted.length >= bgLocationBuffer.length ? persisted : bgLocationBuffer;
        bgLocationBuffer = [];

        if (bufferToProcess.length > 0) {
          const lastGood = pathRef.current.length > 0 ? pathRef.current[pathRef.current.length - 1] : null;

          // First: filter buffer points for basic quality
          const goodBufferPts = bufferToProcess.filter(p => p.accuracy <= MAX_ACCURACY_M);
          const bufferCoords = goodBufferPts.map(p => ({ latitude: p.latitude, longitude: p.longitude }));

          // Sinuosity check: if buffer is basically a straight line → teleport, don't draw it
          if (lastGood && bufferCoords.length >= 2 && isBufferStraightLine(lastGood, bufferCoords)) {
            // Straight line = phone was asleep, GPS gave bad intermediate points
            // Start new segment from current real position (last buffer point)
            const lastBuf = goodBufferPts[goodBufferPts.length - 1];
            if (pathRef.current.length > 1) {
              setPathSegments(segs => [...segs, [...pathRef.current]]);
            }
            const newStart = { latitude: lastBuf.latitude, longitude: lastBuf.longitude };
            pathRef.current = [newStart];
            lastLocationTimestamp.current = lastBuf.timestamp;
            // Count distance as straight line (approximate, better than nothing)
            const skipDist = getDistanceKm(lastGood, newStart);
            if (skipDist > 0.005) setDistance(d => d + skipDist);
            // Phone was asleep → don't bridge across the gap. Claim the cell
            // where the runner actually is now and reset the bridge anchor.
            const sc = coordToCell(newStart.latitude, newStart.longitude);
            claimedCellsRef.current.add(cellKey(sc.x, sc.y));
            lastClaimedCellRef.current = sc;
            setClaimedCellsTick(t => t + 1);
          } else {
            // Buffer has real movement — integrate points normally
            let addedDist = 0;
            let addedCellInBuffer = false;
            for (const point of bufferToProcess) {
              const newCoord = { latitude: point.latitude, longitude: point.longitude };
              const prev = pathRef.current.length > 0 ? pathRef.current[pathRef.current.length - 1] : null;
              const result = filterGpsPoint(newCoord, prev, point.timestamp, lastLocationTimestamp.current, point.accuracy, point.speed, pathRef.current.length);

              if (result.action === 'skip') continue;

              if (result.action === 'teleport') {
                if (pathRef.current.length > 1) {
                  setPathSegments(segs => [...segs, [...pathRef.current]]);
                }
                pathRef.current = [newCoord];
                lastLocationTimestamp.current = point.timestamp;
                lastClaimedCellRef.current = null; // don't bridge across teleport
                continue;
              }

              // accept
              lastLocationTimestamp.current = point.timestamp;
              pathRef.current = [...pathRef.current, newCoord];
              addedDist += result.distKm;
              // Claim cells for this background point, with line bridge — same
              // logic as the foreground watcher.
              const cell = coordToCell(newCoord.latitude, newCoord.longitude);
              const prevCell = lastClaimedCellRef.current;
              const bridge = prevCell ? cellLine(prevCell.x, prevCell.y, cell.x, cell.y) : [cell];
              for (const bc of bridge) {
                const k = cellKey(bc.x, bc.y);
                if (!claimedCellsRef.current.has(k)) { claimedCellsRef.current.add(k); addedCellInBuffer = true; }
              }
              lastClaimedCellRef.current = cell;
            }
            if (addedDist > 0) setDistance(d => d + addedDist);
            if (addedCellInBuffer) setClaimedCellsTick(t => t + 1);
          }

          setCurrentPath([...pathRef.current]);

          // Comprobar loop con los nuevos puntos
          if (!loopDetected && pathRef.current.length >= 10) {
            if (checkLoop(pathRef.current)) closeLoop([...pathRef.current]);
          }
        }

        // Reanudar foreground watcher si se perdió — reutiliza handleLocationUpdate del startRun
        if (isRunningRef.current && !locationRef.current) {
          locationRef.current = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 8, timeInterval: 3000 },
            handleLocationUpdateRef.current,
          );
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
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
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
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
    } catch {}
  };

  /** Load cells (v2 grid) for the current map viewport. Cheap call; runs alongside
   *  loadZones during the polygon→grid transition. */
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
      const halfLat = currentDelta.current.latDelta / 2;
      const halfLng = currentDelta.current.lngDelta / 2;
      const { cells } = await api.getCellsInViewport(
        useLat + halfLat,
        useLat - halfLat,
        useLng + halfLng,
        useLng - halfLng,
      );
      setRemoteCells(cells);
    } catch {}
  };

  /** Fetch unread taunts and queue them. Called on mount + on AppState 'active'.
   *  Each item gets shown one at a time via the tauntQueue useEffect below. */
  const checkUnreadTaunts = async () => {
    try {
      const { taunts } = await api.getUnreadTaunts();
      if (taunts && taunts.length > 0) setTauntQueue(prev => [...prev, ...taunts]);
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

  // Pre-computed unions of cells per owner. Rebuilt only when remoteCells or
  // this-run claims change — polygon-clipping is too expensive to do per render.
  const myCellsUnion = useMemo(() => {
    const myCells: { x: number; y: number }[] = [];
    const seen = new Set<string>();
    for (const c of remoteCells) {
      if (!c.is_mine) continue;
      const k = cellKey(c.cell_x, c.cell_y);
      if (seen.has(k)) continue;
      seen.add(k);
      myCells.push({ x: c.cell_x, y: c.cell_y });
    }
    claimedCellsRef.current.forEach(k => {
      if (seen.has(k)) return;
      seen.add(k);
      const [xs, ys] = k.split(',');
      myCells.push({ x: parseInt(xs, 10), y: parseInt(ys, 10) });
    });
    return unionCellsToPolygons(myCells);
  }, [remoteCells, claimedCellsTick]);

  /** Rival cells grouped by owner_id → one merged polygon per owner. Each carries
   *  the owner metadata so taps still resolve to the rival info modal. */
  const rivalCellsUnions = useMemo(() => {
    const byOwner = new Map<string, { ownerId: string; ownerName: string | undefined; ownerWarCry: string | null | undefined; cells: { x: number; y: number }[] }>();
    for (const c of remoteCells) {
      if (c.is_mine) continue;
      const entry = byOwner.get(c.owner_id);
      if (entry) entry.cells.push({ x: c.cell_x, y: c.cell_y });
      else byOwner.set(c.owner_id, {
        ownerId: c.owner_id,
        ownerName: c.owner_name,
        ownerWarCry: c.owner_war_cry,
        cells: [{ x: c.cell_x, y: c.cell_y }],
      });
    }
    return Array.from(byOwner.values()).map(o => ({
      ownerId: o.ownerId,
      ownerName: o.ownerName,
      ownerWarCry: o.ownerWarCry,
      polygons: unionCellsToPolygons(o.cells),
    }));
  }, [remoteCells]);

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

  const checkLoop = (path: Coord[]) => {
    // Unir todos los segmentos + path actual
    const allPoints = [...pathSegments.flat(), ...path];
    if (allPoints.length < 10) return false;
    const start = allPoints[0];
    const current = allPoints[allPoints.length - 1];
    const dist = getDistance(start, current);
    // Si volvemos a menos de 30m del inicio y hemos recorrido más de 200m
    const totalDist = allPoints.reduce((acc, p, i) => {
      if (i === 0) return 0;
      return acc + getDistance(allPoints[i-1], p);
    }, 0);
    return dist < 30 && totalDist > 200;
  };

  const closeLoop = async (path: Coord[]) => {
    setLoopDetected(true);

    // Unir todos los segmentos + path actual para tener la ruta completa
    const allPoints = [...pathSegments.flat(), ...path];

    // If we have multiple segments (gaps from sleep), use convex hull
    // to avoid diagonal lines between disconnected segments.
    // Single continuous path: use Douglas-Peucker to preserve actual route shape.
    const hasGaps = pathSegments.length > 0;
    let snapped: Coord[];

    if (hasGaps) {
      // Multiple segments: convex hull gives the outer perimeter of all points
      // without the ugly diagonal lines between gap endpoints
      snapped = convexHull(allPoints);
    } else {
      // Single continuous path: simplify preserving shape
      snapped = simplifyPath(allPoints, 0.00003); // ~3m tolerancia
    }

    // Asegurar que el polígono está cerrado
    if (snapped.length >= 3) {
      const first = snapped[0];
      const last = snapped[snapped.length - 1];
      if (getDistance(first, last) > 5) {
        snapped.push({ ...first });
      }
    }

    // Grid (v2): rasterize the closed polygon into 5m cells. Every cell whose
    // center falls inside the loop becomes ours, even the ones we didn't walk over.
    // Sync — cheap enough (<100ms even for huge loops) and we need the cells
    // before the popup/save fire.
    if (snapped.length >= 3) {
      const interiorCells = rasterizePolygonToCells(snapped);
      let added = 0;
      for (const c of interiorCells) {
        const k = cellKey(c.x, c.y);
        if (!claimedCellsRef.current.has(k)) {
          claimedCellsRef.current.add(k);
          added++;
        }
      }
      if (added > 0) setClaimedCellsTick(t => t + 1);
    }

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

    // Puntos por cerrar loop: 100 si recorrido > 3 km, sino 50
    // Loop closure bonuses (v1.7 economy): 25 for short loops, 50 for ≥3km loops,
    // +25 per rival polygon stolen at close. Cell-level points are computed
    // server-side at saveRun (1 new / 2 stolen) so we don't know the breakdown yet here.
    const loopBase = distance >= 3 ? 50 : 25;
    const loopPoints = loopBase + (stealCount * 25);

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

  const startRun = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso necesario', 'CORRR necesita tu ubicación para registrar la carrera.');
      return;
    }
    // Aviso "Pantalla activa" eliminado en v1.6.2 — el foreground service
    // sobrevive a la pantalla apagada perfectamente, ya no hay riesgo real.
    doStartRun();
  };

  const doStartRun = async () => {
    // Pedir permiso de background para que el GPS siga activo con pantalla apagada
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();

    // Mantener pantalla activa durante la carrera (evita que MIUI mate el GPS)
    await activateScreenAwake();

    setIsRunning(true);
    setRunTime(0);
    runStartTimeRef.current = Date.now();
    pauseStartedAtRef.current = null;
    pausedAccumulatedRef.current = 0;
    setDistance(0);
    setTotalPoints(0);
    setConqueredZones([]);
    claimedCellsRef.current = new Set();
    lastClaimedCellRef.current = null;
    // Reset del rolling window del detector anti-drift. Si no lo limpiamos,
    // los puntos de la carrera ANTERIOR quedaban en el buffer y podían
    // distorsionar la detección de "estás quieto" en los primeros segundos
    // de la nueva carrera.
    recentCoordsRef.current = [];
    setClaimedCellsTick(t => t + 1);
    setSplits([]);
    splitsTrackingRef.current = { lastKm: 0, lastTime: 0 };
    setCurrentPath([]);
    setLoopDetected(false);
    setSpeedWarning(false);
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    lastMovementTime.current = Date.now();

    // Auto-pause silencioso: cada 3s comprobamos si llevas 20s sin moverte.
    // Si sí, congelamos contadores (timer, distancia, celdas) sin tocar el GPS.
    // Cuando llegue un punto con movimiento real, handleLocationUpdate reanuda.
    if (autoPauseTimer.current) clearInterval(autoPauseTimer.current);
    autoPauseTimer.current = setInterval(() => {
      if (!isRunningRef.current) return;
      if (isAutoPausedRef.current) return;
      const stillFor = (Date.now() - lastMovementTime.current) / 1000;
      if (stillFor >= 20) {
        isAutoPausedRef.current = true;
        setIsAutoPaused(true);
        pauseStartedAtRef.current = Date.now();
      }
    }, 3000);
    setCurrentSpeed(0);
    setPathSegments([]);
    invalidSegments.current = 0;
    pathRef.current = [];
    lastLocationTimestamp.current = 0;

    // Recompute from Date.now() each tick — self-healing against missed ticks
    // while the JS thread is suspended (screen off, doze mode).
    timerRef.current = setInterval(() => setRunTime(computeRunTime()), 1000);

    // Centrar mapa en posición actual al iniciar
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    mapRef.current?.animateToRegion({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }, 800);

    // Arrancar background location task con foreground service (mantiene GPS activo con pantalla apagada)
    if (bgStatus === 'granted') {
      bgLocationBuffer = [];
      try { await AsyncStorage.removeItem(BG_BUFFER_KEY); } catch {}
      try {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
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
        });
      } catch (e) {
        console.warn('[BG Location] No se pudo iniciar:', e);
      }
    }

    /** Single location handler used everywhere — foreground watcher, resume, appState */
    const handleLocationUpdate = (loc: Location.LocationObject) => {
      const newCoord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      const now = loc.timestamp ?? Date.now();
      const accuracy = loc.coords.accuracy ?? 999;
      const speed = loc.coords.speed ?? -1;
      const prev = pathRef.current.length > 0 ? pathRef.current[pathRef.current.length - 1] : null;

      const result = filterGpsPoint(newCoord, prev, now, lastLocationTimestamp.current, accuracy, speed, pathRef.current.length);

      if (result.action === 'skip') {
        // Bad point — don't update timestamp so next point measures from last good one
        return;
      }

      if (result.action === 'teleport') {
        // Phone slept or lost GPS — start new visual segment
        if (pathRef.current.length > 1) {
          setPathSegments(segs => [...segs, [...pathRef.current]]);
        }
        pathRef.current = [newCoord];
        setCurrentPath([newCoord]);
        lastLocationTimestamp.current = now;
        // Don't bridge across a teleport jump — the runner didn't walk that
        // line. Drop the anchor so the next point starts a fresh segment.
        lastClaimedCellRef.current = null;
        return;
      }

      // 'accept' — good point
      lastLocationTimestamp.current = now;
      pathRef.current = [...pathRef.current, newCoord];
      setCurrentPath([...pathRef.current]);

      // Auto-pause silencioso: si estamos auto-pausados, este punto solo cuenta
      // si demuestra movimiento real (>5m de la última posición o >1.5 km/h).
      // Si hay movimiento → reanudamos solos y dejamos que el punto procese
      // normalmente. Si no → saltamos todo (no distancia, no celdas, no tiempo).
      if (isAutoPausedRef.current) {
        const movedEnough = result.distKm > 0.005 || result.speedKmh > 1.5;
        if (!movedEnough) return;
        // Reanudar: descongelar timer + actualizar lastMovementTime
        isAutoPausedRef.current = false;
        setIsAutoPaused(false);
        if (pauseStartedAtRef.current) {
          pausedAccumulatedRef.current += Date.now() - pauseStartedAtRef.current;
          pauseStartedAtRef.current = null;
        }
        lastMovementTime.current = Date.now();
      }

      // Anti-drift: actualizamos rolling window y chequeamos si el usuario
      // está realmente quieto (todas las últimas lecturas dentro de 15m).
      // Si lo está, NO claimemos celdas, NO sumamos distancia, NO refrescamos
      // lastMovementTime → el auto-pause acabará disparándose a los 20s.
      // El punto se descarta por completo, ni siquiera entra en pathRef.
      recentCoordsRef.current.push(newCoord);
      if (recentCoordsRef.current.length > STATIONARY_WINDOW * 2) {
        recentCoordsRef.current.shift();
      }
      if (isStationary(recentCoordsRef.current)) {
        return;
      }

      // Grid (v2): claim the cell this point falls in, plus every cell on the
      // line from the previous one (line bridge) — keeps the trail continuous
      // even when the GPS skips cells. The Set lives in a ref so updates don't
      // re-render; the tick state forces a render when the count changes.
      const cell = coordToCell(newCoord.latitude, newCoord.longitude);
      let addedCell = false;
      const prevCell = lastClaimedCellRef.current;
      const bridge = prevCell ? cellLine(prevCell.x, prevCell.y, cell.x, cell.y) : [cell];
      for (const bc of bridge) {
        const k = cellKey(bc.x, bc.y);
        if (!claimedCellsRef.current.has(k)) {
          claimedCellsRef.current.add(k);
          addedCell = true;
        }
      }
      lastClaimedCellRef.current = cell;
      if (addedCell) setClaimedCellsTick(t => t + 1);

      if (result.distKm > 0) {
        setDistance(d => d + result.distKm);
        lastMovementTime.current = Date.now(); // Runner is moving
      }
      // Velocidad con EMA (exponential moving average) en vez de mostrar el
      // valor instantáneo. Antes, un spike de drift (p.ej. 5m de drift en 1s
      // = 18 km/h) se veía tal cual durante 1s — confuso. Con alpha=0.3 el
      // display se va suavizando hacia el nuevo valor y un spike aislado
      // apenas mueve la aguja. En caminata sostenida converge en 5-6 puntos.
      if (result.speedKmh >= 0) {
        setCurrentSpeed(prev => prev * 0.7 + result.speedKmh * 0.3);
      }
      setSpeedWarning(false);

      // Center map on current position with heading (direction of movement)
      const heading = loc.coords.heading;
      if (heading != null && heading >= 0 && result.speedKmh > 2) {
        // Moving: rotate map to face direction of travel
        mapRef.current?.animateCamera({
          center: newCoord,
          heading: heading,
          pitch: 45,
          zoom: 17,
        }, { duration: 500 });
      } else {
        // Standing still or no heading: just center without rotation
        mapRef.current?.animateCamera({
          center: newCoord,
          pitch: 0,
          zoom: 17,
        }, { duration: 500 });
      }

      // Check for closed loop
      if (!loopDetected && pathRef.current.length >= 10) {
        if (checkLoop(pathRef.current)) {
          closeLoop([...pathRef.current]);
        }
      }
    };

    isRunningRef.current = true;
    handleLocationUpdateRef.current = handleLocationUpdate;
    locationRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 8, timeInterval: 3000 },
      handleLocationUpdate,
    );
  };

  const pauseRun = async () => {
    setIsPaused(true);
    // Manual pause overrides any auto-pause that may have been active.
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    pauseStartedAtRef.current = Date.now();
    if (autoPauseTimer.current) { clearInterval(autoPauseTimer.current); autoPauseTimer.current = null; }
    deactivateScreenAwake();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (locationRef.current) { locationRef.current.remove(); locationRef.current = null; }
    // Parar background task al pausar
    try {
      const isTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isTask) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch {}
    bgLocationBuffer = [];
    try { await AsyncStorage.removeItem(BG_BUFFER_KEY); } catch {}
  };

  const resumeRun = async () => {
    setIsPaused(false);
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    // Accumulate the paused duration so the timer math skips over it.
    if (pauseStartedAtRef.current) {
      pausedAccumulatedRef.current += Date.now() - pauseStartedAtRef.current;
      pauseStartedAtRef.current = null;
    }
    lastMovementTime.current = Date.now();
    await activateScreenAwake();
    // Reiniciar auto-pause silencioso (20s sin movimiento → auto-pause)
    if (autoPauseTimer.current) clearInterval(autoPauseTimer.current);
    autoPauseTimer.current = setInterval(() => {
      if (!isRunningRef.current) return;
      if (isAutoPausedRef.current) return;
      const stillFor = (Date.now() - lastMovementTime.current) / 1000;
      if (stillFor >= 20) {
        isAutoPausedRef.current = true;
        setIsAutoPaused(true);
        pauseStartedAtRef.current = Date.now();
      }
    }, 3000);
    // Recompute from Date.now() each tick — self-healing against missed ticks
    // while the JS thread is suspended (screen off, doze mode).
    timerRef.current = setInterval(() => setRunTime(computeRunTime()), 1000);

    // Reiniciar background task
    try {
      const bgRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (!bgRunning) {
        const { status } = await Location.requestBackgroundPermissionsAsync();
        if (status === 'granted') {
          bgLocationBuffer = [];
          try { await AsyncStorage.removeItem(BG_BUFFER_KEY); } catch {}
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
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
          });
        }
      }
    } catch {}

    locationRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 8, timeInterval: 3000 },
      handleLocationUpdateRef.current,
    );
  };

  const stopRun = async () => {
    // Guard de idempotencia: si stopRun ya se está ejecutando, ignoramos
    // taps adicionales. Sin esto, un doble tap rápido en STOP llamaba a
    // api.saveRun() dos veces y la carrera contaba doble en stats.
    if (!isRunningRef.current) return;
    isRunningRef.current = false;
    setIsRunning(false);
    setIsPaused(false);
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    // Freeze the final time before clearing the timer refs.
    setRunTime(computeRunTime());
    runStartTimeRef.current = null;
    pauseStartedAtRef.current = null;
    pausedAccumulatedRef.current = 0;
    if (autoPauseTimer.current) { clearInterval(autoPauseTimer.current); autoPauseTimer.current = null; }
    deactivateScreenAwake();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // Limpiar también la ref del watcher para que si se reentra (bug futuro),
    // no intentemos remover un subscription ya cerrado. Antes solo se llamaba
    // .remove() pero la ref quedaba colgando.
    if (locationRef.current) { locationRef.current.remove(); locationRef.current = null; }
    // Parar background task si estaba activo
    try {
      const isTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isTask) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch {}
    bgLocationBuffer = [];
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

    // Flood-fill any region fully enclosed by the cells walked this run. This is
    // what guarantees "if it closes, it closes" — interior cells get claimed even
    // if the mid-run loop detector missed the loop. Runs once, at the end.
    const filledCells = fillEnclosedCells(claimedCellsRef.current);
    if (filledCells.size !== claimedCellsRef.current.size) {
      claimedCellsRef.current = filledCells;
      setClaimedCellsTick(t => t + 1);
    }

    // 10 pts/km (v1.7 economy). The final total here is a client-side ESTIMATE
    // that assumes every claimed cell is new (1 pt each). The backend recomputes
    // authoritative points (knows which are robbed → 2 pts) and applies streak +
    // PB multipliers — we use res.points (returned by saveRun) in the summary modal.
    const kmPoints = pathRef.current.length >= 2 ? Math.round(distance * 10) : 0;
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
      distance >= MIN_DISTANCE_KM_FOR_VALID_RUN;

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
        distanceKm: distance,
        durationSecs: runTime,
        points: finalPoints, // client estimate — backend ignores and recomputes
        loopBonus: totalPoints, // sum of loop closure bonuses (trusted)
        xp: earnedXP,
        zonesCount,
        zones: closedZones.map(z => ({ coords: z.coords, area: z.area, points: z.points })),
        claimedCells,
      }).then(async (res) => {
        loadZones();
        // Wait for the cells reload to finish before clearing the local set —
        // otherwise we'd see a brief "no cells" flash between the clear and the
        // remoteCells state update. Clearing prevents the double-render (two
        // alpha tones overlapping on the same cells).
        await loadCells();
        claimedCellsRef.current = new Set();
        setClaimedCellsTick(t => t + 1);
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
          distance,
          time: runTime,
          points: authPoints,
          xp: authXP,
          zones: zonesCount,
        });
        setTotalXP(authXP);
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
          distance,
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
    if (!isValidRun && (cellCount > 0 || distance > 0)) {
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
        visible={popup.visible}
        type={popup.type}
        points={popup.points}
        rivalName={popup.rivalName}
        onClose={() => setPopup(p => ({ ...p, visible: false }))}
        onRespond={() => setShowTaunts(true)}
      />

      {/* Robo notif arriving via the inbox (someone stole from us): render the
          existing "te han robado" image with a "Devolver" button. Marks as read
          on dismissal. On Respond opens TauntSelector mode='taunt'. */}
      {currentTaunt?.mode === 'robo_notif' && (
        <ZonePopup
          visible
          type="stolen_from_you"
          rivalName={currentTaunt.from_user_name ?? 'Rival'}
          onClose={async () => {
            try { await api.markTauntsRead([currentTaunt.id]); } catch {}
            setCurrentTaunt(null);
          }}
          onRespond={() => {
            if (currentTaunt.from_user_id) {
              setTauntTarget({
                toUserId: currentTaunt.from_user_id,
                toName: currentTaunt.from_user_name ?? 'Rival',
                runId: currentTaunt.run_id,
                mode: 'taunt',
              });
              setShowTaunts(true);
            }
          }}
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
      {(currentTaunt?.mode === 'taunt' || currentTaunt?.mode === 'response') && currentTaunt.taunt_id && (
        <Modal transparent visible animationType="fade" statusBarTranslucent>
          <View style={styles.tauntReceivedContainer}>
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
            {currentTaunt.mode === 'taunt' ? (
              <TouchableOpacity
                style={styles.tauntReceivedRespond}
                onPress={() => {
                  if (currentTaunt.from_user_id) {
                    setTauntTarget({
                      toUserId: currentTaunt.from_user_id,
                      toName: currentTaunt.from_user_name ?? 'Rival',
                      runId: currentTaunt.run_id,
                      mode: 'response',
                    });
                    setShowTaunts(true);
                  }
                }}
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
              // Mark the original inbox item as read once the response goes through.
              if (currentTaunt) {
                try { await api.markTauntsRead([currentTaunt.id]); } catch {}
                setCurrentTaunt(null);
              }
            } catch (e: any) {
              // 409 = hilo ya cerrado (ya hay un taunt/response previo para
              // este run). Mensaje específico en vez del genérico para que el
              // usuario entienda por qué no se envía. También marcamos como
              // leído el inbox item para que no le aparezca otra vez.
              if (e?.status === 409) {
                Alert.alert('Hilo cerrado', e?.body?.error ?? 'En este hilo solo se permite un mensaje y una respuesta.');
                if (currentTaunt) {
                  try { await api.markTauntsRead([currentTaunt.id]); } catch {}
                  setCurrentTaunt(null);
                }
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

      {/* Resumen post-carrera */}
      {runSummary?.visible && (
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

              <View style={[styles.rivalAvatarBig, { borderColor: getRivalColor(selectedRivalZone.owner_id ?? selectedRivalZone.owner_name ?? '') }]}>
                <Text style={styles.rivalAvatarText}>
                  {(selectedRivalZone.owner_name ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.zoneCardTitle}>{selectedRivalZone.owner_name ?? 'Rival'}</Text>
              {/* Grito de guerra del rival (v1.9). Se muestra justo bajo el nombre
                  cuando el propietario lo ha configurado en su perfil. */}
              {!!selectedRivalZone.owner_war_cry && (
                <Text style={styles.zoneCardWarCry}>"{selectedRivalZone.owner_war_cry}"</Text>
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
        <View>
          <Text style={styles.cityLabel}>{cityName}</Text>
          <Text style={styles.citySubtitle}>{user?.username ?? 'Runner'}</Text>
        </View>
        <View style={styles.headerStats}>
          <View style={styles.headerStat}>
            <Ionicons name="flame" size={14} color={colors.orange} />
            <Text style={styles.headerStatValue}>{totalPoints}</Text>
          </View>
          <View style={styles.headerStat}>
            <Ionicons name="flag" size={14} color={colors.orange} />
            <Text style={styles.headerStatValue}>{conqueredZones.filter(z => z.area > 0).length}</Text>
          </View>
        </View>
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
            // Comprobar si está demasiado lejos para mostrar zonas
            setZoomedOutTooMuch(region.latitudeDelta > MAX_DELTA_FOR_ZONES);
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
              for surrounded enemy cells. Tappable rivals open the info modal. */}
          {rivalCellsUnions.map((rival, rivalIdx) =>
            rival.polygons.map((p, polyIdx) => {
              // UUID del owner → garantiza color único por usuario (no por nombre).
              const ownerColor = getRivalColor(rival.ownerId);
              return (
                <Polygon
                  // Mismo motivo que el polígono de "mine-": incluir nº de
                  // vértices fuerza a RN Maps a refrescar el polígono cuando
                  // cambia la forma (no se queda con el contorno cacheado).
                  key={`rival-${rival.ownerId}-${polyIdx}-${p.outer.length}`}
                  coordinates={p.outer}
                  holes={p.holes.length > 0 ? p.holes : undefined}
                  fillColor={`${ownerColor}80`}
                  strokeColor={ownerColor}
                  strokeWidth={2}
                  tappable
                  onPress={() => {
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
          {myCellsUnion.map((p, i) => (
            <Polygon
              // Key incluye nº de vértices del contorno externo: si el polígono
              // cambia de forma entre renders (p.ej. al pasar de "celdas
              // sueltas" a "blob unificado" después de un saveRun), la key
              // distinta fuerza a RN Maps a re-montar el polígono en lugar de
              // intentar reusar el anterior (que a veces no se refresca y
              // dejaba el efecto rejilla que pedía cerrar/abrir la app).
              key={`mine-${i}-${p.outer.length}`}
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
        visible={isRunning}
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
          <View style={styles.runningTop}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.runningLogo}
              resizeMode="contain"
            />
            {(isPaused || isAutoPaused) && (
              <View style={styles.pausedBadge}>
                <Ionicons name="pause" size={14} color={colors.orange} />
                <Text style={styles.pausedBadgeText}>
                  {isAutoPaused && !isPaused ? 'AUTO-PAUSA' : 'PAUSADO'}
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
              <Text style={styles.statBigLabel}>VELOCIDAD (KM/H)</Text>
              <Text style={styles.statBigValue}>{currentSpeed.toFixed(1)}</Text>
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

        {/* Solo botón INICIAR cuando NO se corre. Los controles de carrera
            (pause/stop/resume) ahora viven dentro del Modal de Strava-mode
            para que no se solapen con las parciales. */}
        {!isRunning && (
          <TouchableOpacity style={styles.startBtn} onPress={startRun}>
            <Ionicons name="play" size={18} color="#fff" />
            <Text style={styles.startBtnText}>INICIAR CARRERA</Text>
          </TouchableOpacity>
        )}
      </View>
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
  cityLabel: { fontSize: 20, fontWeight: '900', color: colors.textPrimary, letterSpacing: 1 },
  citySubtitle: { fontSize: 12, color: colors.textSecondary },
  headerStats: { flexDirection: 'row', gap: spacing.md },
  headerStat: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgCard,
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  headerStatValue: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
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
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
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
  // Contenedor de controles abajo. paddingHorizontal: 0 para que los pills
  // lleguen de borde a borde dentro del paddingHorizontal del runningScreen.
  runControlsInModal: {
    width: '100%',
    alignItems: 'stretch',
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
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  tauntReceivedClose: {
    position: 'absolute', top: 50, right: spacing.md, zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  tauntReceivedFrom: {
    color: colors.textPrimary, fontSize: 16, fontWeight: '700',
    marginBottom: spacing.md, textAlign: 'center',
  },
  tauntReceivedImage: {
    width: '100%', flex: 1, maxHeight: '70%',
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
  summaryBtn: {
    backgroundColor: colors.orange, paddingVertical: 14, paddingHorizontal: 48,
    borderRadius: radius.full,
  },
  summaryBtnText: { fontSize: 16, fontWeight: '800', color: '#000', letterSpacing: 1 },
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
    borderWidth: 3, marginBottom: spacing.sm,
  },
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
});
