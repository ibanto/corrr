import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import MapView, { Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import polygonClipping from 'polygon-clipping';
import { colors, spacing, radius } from '../theme';
import { api, RemoteZone } from '../services/api';
import ZonePopup, { PopupType } from '../components/ZonePopup';

const GOOGLE_API_KEY = 'AIzaSyC_1Y2Fo6S9X6GJU5Upx4EZxrw4JFf_xNU';

const DEFAULT_REGION = {
  latitude: 40.4168,
  longitude: -3.7038,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

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

// 10 colores para rivales — distintos entre sí y del naranja (tuyo)
const RIVAL_COLORS = [
  '#3B82F6', // azul
  '#8B5CF6', // violeta
  '#EC4899', // rosa
  '#14B8A6', // turquesa
  '#EF4444', // rojo
  '#22C55E', // verde
  '#F59E0B', // ámbar
  '#06B6D4', // cyan
  '#A855F7', // púrpura
  '#64748B', // gris azulado
];

function getRivalColor(ownerName: string): string {
  // Hash simple del nombre para asignar color consistente
  let hash = 0;
  for (let i = 0; i < (ownerName || '').length; i++) {
    hash = ((hash << 5) - hash) + ownerName.charCodeAt(i);
    hash |= 0;
  }
  return RIVAL_COLORS[Math.abs(hash) % RIVAL_COLORS.length];
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
function deconflictZones(zones: RemoteZone[]): RemoteZone[] {
  if (zones.length < 2) return zones;

  // Ordenar por fecha: más antiguas primero → las recientes recortan a las viejas
  const sorted = [...zones].sort((a, b) => {
    const dateA = a.conquered_at ? new Date(a.conquered_at).getTime() : 0;
    const dateB = b.conquered_at ? new Date(b.conquered_at).getTime() : 0;
    return dateA - dateB;
  });

  const result: RemoteZone[] = [];

  for (let i = 0; i < sorted.length; i++) {
    let current = sorted[i];
    let currentPolygon = current.polygon;

    // Cada zona posterior (más reciente) recorta a esta si se solapan
    for (let j = i + 1; j < sorted.length; j++) {
      const newer = sorted[j];
      // Solo recortar si son de distinto dueño
      if (newer.owner_name === current.owner_name && newer.is_mine === current.is_mine) continue;
      if (newer.polygon.length < 3 || currentPolygon.length < 3) continue;

      try {
        const remaining = polyDifference(currentPolygon, newer.polygon);
        if (remaining.length > 0 && remaining[0].length >= 3) {
          currentPolygon = remaining[0];
        } else {
          currentPolygon = []; // Zona completamente absorbida
          break;
        }
      } catch {
        // Si falla el clipping, mantener la zona original
      }
    }

    if (currentPolygon.length >= 3) {
      result.push({ ...current, polygon: currentPolygon });
    }
  }

  return result;
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

async function snapToRoads(coords: Coord[]): Promise<Coord[]> {
  if (coords.length < 2) return coords;
  const path = coords.map(c => `${c.latitude},${c.longitude}`).join('|');
  try {
    const res = await fetch(
      `https://roads.googleapis.com/v1/snapToRoads?path=${path}&interpolate=true&key=${GOOGLE_API_KEY}`
    );
    const data = await res.json();
    if (data.snappedPoints) {
      return data.snappedPoints.map((p: any) => ({
        latitude: p.location.latitude,
        longitude: p.location.longitude,
      }));
    }
  } catch {}
  return coords;
}

export default function MapScreen({ user, onNavigateToShop }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [runTime, setRunTime] = useState(0);
  const [distance, setDistance] = useState(0);
  const [currentPath, setCurrentPath] = useState<Coord[]>([]);
  const [conqueredZones, setConqueredZones] = useState<ConqueredZone[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [totalXP, setTotalXP] = useState(0);
  const [runSummary, setRunSummary] = useState<{
    visible: boolean; distance: number; time: number; points: number; xp: number; zones: number;
  } | null>(null);
  const [loopDetected, setLoopDetected] = useState(false);
  const [remoteZones, setRemoteZones] = useState<RemoteZone[]>([]);
  const [selectedZone, setSelectedZone] = useState<RemoteZone | null>(null);
  const [userXP, setUserXP] = useState(0); // XP acumulado del usuario
  const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);
  const [cityName, setCityName] = useState('...');
  const [popup, setPopup] = useState<{ visible: boolean; type: PopupType; points: number; rivalName?: string }>({
    visible: false, type: 'conquered', points: 0,
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRef = useRef<any>(null);
  const pathRef = useRef<Coord[]>([]);
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
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
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
            reverseGeocode(lastKnown.coords.latitude, lastKnown.coords.longitude);
          }
          // Luego obtener ubicación precisa
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
            timeInterval: 10000,
          });
          centerOnUser(loc.coords.latitude, loc.coords.longitude);
          loadZones(loc.coords.latitude, loc.coords.longitude);
          reverseGeocode(loc.coords.latitude, loc.coords.longitude);
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
        setUserXP(Math.floor(data.stats.total_points / 100));
      }
    } catch {}
  };

  useEffect(() => { loadUserXP(); }, []);

  const loadZones = async (lat?: number, lng?: number) => {
    try {
      const useLat = lat ?? mapRegion.latitude;
      const useLng = lng ?? mapRegion.longitude;
      const zones = await api.getNearbyZones(useLat, useLng);
      // Deconflictar: zonas recientes recortan a las antiguas donde se solapan
      setRemoteZones(deconflictZones(zones));
    } catch {}
  };

  const checkLoop = (path: Coord[]) => {
    if (path.length < 10) return false;
    const start = path[0];
    const current = path[path.length - 1];
    const dist = getDistance(start, current);
    // Si volvemos a menos de 80m del inicio y hemos recorrido más de 200m
    const totalDist = path.reduce((acc, p, i) => {
      if (i === 0) return 0;
      return acc + getDistance(path[i-1], p);
    }, 0);
    return dist < 80 && totalDist > 200;
  };

  const closeLoop = async (path: Coord[]) => {
    setLoopDetected(true);
    const area = polygonArea(path);

    const snapped = path.length > 50
      ? await snapToRoads(path.filter((_, i) => i % 3 === 0))
      : await snapToRoads(path);

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

    // 100 pts por cerrar loop + 50 bonus por cada robo
    const loopPoints = 100 + (stealCount * 50);

    // Añadir zona propia + piezas robadas
    setConqueredZones(prev => [
      ...prev,
      { coords: snapped, area, points: 100 },
      ...stolenPieces,
    ]);
    setTotalPoints(p => p + loopPoints);

    setPopup({
      visible: true,
      type: isSteal ? 'stolen_by_you' : 'conquered',
      points: loopPoints,
      rivalName: isSteal ? stolenNames.join(', ') : undefined,
    });

    pathRef.current = [path[path.length - 1]];
    setCurrentPath([path[path.length - 1]]);
    setLoopDetected(false);
  };

  const startRun = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso necesario', 'CORRR necesita tu ubicación para registrar la carrera.');
      return;
    }

    setIsRunning(true);
    setRunTime(0);
    setDistance(0);
    setCurrentPath([]);
    setLoopDetected(false);
    pathRef.current = [];

    timerRef.current = setInterval(() => setRunTime(t => t + 1), 1000);

    // Centrar mapa en posición actual al iniciar
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    mapRef.current?.animateToRegion({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }, 800);

    locationRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 10,
        timeInterval: 3000,
      },
      (loc) => {
        const newCoord = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };

        pathRef.current = [...pathRef.current, newCoord];
        setCurrentPath([...pathRef.current]);

        // Centrar mapa en la posición actual respetando el zoom del usuario
        mapRef.current?.animateToRegion({
          latitude: newCoord.latitude,
          longitude: newCoord.longitude,
          latitudeDelta: currentDelta.current.latDelta,
          longitudeDelta: currentDelta.current.lngDelta,
        }, 500);

        if (pathRef.current.length > 1) {
          const prev = pathRef.current[pathRef.current.length - 2];
          setDistance(d => d + getDistanceKm(prev, newCoord));
        }

        // Detectar loop cerrado
        if (!loopDetected && checkLoop(pathRef.current)) {
          closeLoop([...pathRef.current]);
        }
      }
    );
  };

  const stopRun = async () => {
    setIsRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (locationRef.current) locationRef.current.remove();

    // 50 pts por km recorrido (siempre, loop o recta)
    const kmPoints = pathRef.current.length >= 2 ? Math.round(distance * 50) : 0;
    const finalPoints = totalPoints + kmPoints;
    // XP = puntos totales ÷ 100
    const earnedXP = Math.floor(finalPoints / 100);
    setTotalXP(earnedXP);

    const zonesCount = conqueredZones.filter(z => z.area > 0).length;

    if (distance > 0.05 || zonesCount > 0) {
      const closedZones = conqueredZones.filter(z => z.area > 0);
      api.saveRun({
        distanceKm: distance,
        durationSecs: runTime,
        points: finalPoints,
        xp: earnedXP,
        zonesCount,
        zones: closedZones.map(z => ({ coords: z.coords, area: z.area, points: z.points })),
      }).then(res => {
        loadZones();
        if (res.stolenZones && res.stolenZones.length > 0) {
          const names = [...new Set(res.stolenZones.map((s: any) => s.ownerName))];
          const totalStolenPts = res.stolenZones.reduce((a: number, s: any) => a + (s.points || 0), 0);
          setPopup({
            visible: true,
            type: 'stolen_by_you',
            points: totalStolenPts,
            rivalName: names.join(', '),
          });
        }
      }).catch(() => {});
    }

    if (pathRef.current.length >= 2) {
      const snapped = await snapToRoads(
        pathRef.current.filter((_, i) => i % 3 === 0 || i === pathRef.current.length - 1)
      );
      setConqueredZones(prev => [...prev, {
        coords: snapped,
        area: 0,
        points: kmPoints,
      }]);
    }

    setCurrentPath([]);
    pathRef.current = [];

    // Mostrar resumen de carrera
    if (distance > 0.05 || zonesCount > 0) {
      setRunSummary({
        visible: true,
        distance,
        time: runTime,
        points: finalPoints,
        xp: earnedXP,
        zones: zonesCount,
      });
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const pace = distance > 0.05 ? ((runTime / 60) / distance).toFixed(1) : '--';

  return (
    <View style={styles.container}>
      <ZonePopup
        visible={popup.visible}
        type={popup.type}
        points={popup.points}
        rivalName={popup.rivalName}
        onClose={() => setPopup(p => ({ ...p, visible: false }))}
      />

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
            <Ionicons name="map" size={14} color={colors.orange} />
            <Text style={styles.headerStatValue}>{conqueredZones.filter(z => z.area > 0).length}</Text>
          </View>
        </View>
      </View>

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
          }}
        >
          {/* Zonas del servidor: propias (naranja, tocables) y ajenas (color por rival) */}
          {remoteZones.map((zone) => {
            const rivalColor = zone.is_mine ? colors.orange : getRivalColor(zone.owner_name ?? '');
            return (
              <Polygon
                key={zone.id}
                coordinates={zone.polygon}
                fillColor={zone.is_mine ? `${colors.orange}40` : `${rivalColor}35`}
                strokeColor={zone.is_mine ? colors.orange : rivalColor}
                strokeWidth={zone.is_mine ? 2 : 1.5}
                tappable
                onPress={() => {
                  if (zone.is_mine) setSelectedZone(zone);
                }}
              />
            );
          })}

          {/* Zonas conquistadas esta sesión */}
          {conqueredZones.map((zone, i) => (
            zone.area > 0 ? (
              <Polygon
                key={i}
                coordinates={zone.coords}
                fillColor={`${colors.orange}50`}
                strokeColor={colors.orange}
                strokeWidth={2}
              />
            ) : (
              <Polyline
                key={i}
                coordinates={zone.coords}
                strokeColor={colors.orange}
                strokeWidth={5}
                lineCap="round"
              />
            )
          ))}

          {/* Ruta actual */}
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

        {/* Stats carrera */}
        {isRunning && (
          <View style={styles.runningOverlay}>
            <View style={styles.runStatItem}>
              <Text style={styles.runStatValue}>{distance.toFixed(2)}</Text>
              <Text style={styles.runStatLabel}>km</Text>
            </View>
            <View style={styles.runStatDivider} />
            <View style={styles.runStatItem}>
              <Text style={styles.runStatValue}>{pace}</Text>
              <Text style={styles.runStatLabel}>min/km</Text>
            </View>
            <View style={styles.runStatDivider} />
            <View style={styles.runStatItem}>
              <Text style={styles.runStatValue}>{formatTime(runTime)}</Text>
              <Text style={styles.runStatLabel}>tiempo</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.bottom}>
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

        {!isRunning ? (
          <TouchableOpacity style={styles.startBtn} onPress={startRun}>
            <Ionicons name="play" size={18} color="#fff" />
            <Text style={styles.startBtnText}>INICIAR CARRERA</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.runControls}>
            <TouchableOpacity style={styles.runControlBtn}>
              <Ionicons name="lock-closed" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.pauseBtn} onPress={stopRun}>
              <Ionicons name="stop" size={28} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.runControlBtn}>
              <Ionicons name="location" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  runningOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.85)',
    paddingVertical: spacing.sm, alignItems: 'center',
  },
  runStatItem: { flex: 1, alignItems: 'center' },
  runStatValue: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  runStatLabel: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase' },
  runStatDivider: { width: 1, height: 32, backgroundColor: colors.border },
  bottom: {
    paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.sm,
    gap: spacing.sm, backgroundColor: colors.bg,
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
  runControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  runControlBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  pauseBtn: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: colors.orange,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.orange, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 16,
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
  zoneCardPoints: {
    fontSize: 28, fontWeight: '900', color: colors.orange, marginTop: 4,
  },
  zoneCardDate: {
    fontSize: 12, color: colors.textSecondary, marginTop: 2,
  },
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
