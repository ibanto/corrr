import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import MapView, { Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, RemoteZone } from '../services/api';

const GOOGLE_API_KEY = 'AIzaSyC_1Y2Fo6S9X6GJU5Upx4EZxrw4JFf_xNU';

const DEFAULT_REGION = {
  latitude: 40.4168,
  longitude: -3.7038,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
};

const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#888888' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d1117' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1f2e' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#222836' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2d3748' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#111827' }] },
];

interface Coord { latitude: number; longitude: number; }
interface ConqueredZone { coords: Coord[]; area: number; points: number; }

interface Props {
  user: { username: string; id: string } | null;
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

export default function MapScreen({ user }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [runTime, setRunTime] = useState(0);
  const [distance, setDistance] = useState(0);
  const [currentPath, setCurrentPath] = useState<Coord[]>([]);
  const [conqueredZones, setConqueredZones] = useState<ConqueredZone[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [loopDetected, setLoopDetected] = useState(false);
  const [remoteZones, setRemoteZones] = useState<RemoteZone[]>([]);
  const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRef = useRef<any>(null);
  const pathRef = useRef<Coord[]>([]);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const region = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        };
        setMapRegion(region);
        loadZones(loc.coords.latitude, loc.coords.longitude);
      } else {
        loadZones(DEFAULT_REGION.latitude, DEFAULT_REGION.longitude);
      }
    })();
  }, []);

  const loadZones = async (lat?: number, lng?: number) => {
    try {
      const useLat = lat ?? mapRegion.latitude;
      const useLng = lng ?? mapRegion.longitude;
      const zones = await api.getNearbyZones(useLat, useLng);
      setRemoteZones(zones);
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
    const points = Math.round(area * 1000 * 500);
    const finalPoints = Math.max(100, Math.min(points, 5000));

    const snapped = path.length > 50
      ? await snapToRoads(path.filter((_, i) => i % 3 === 0))
      : await snapToRoads(path);

    setConqueredZones(prev => [...prev, { coords: snapped, area, points: finalPoints }]);
    setTotalPoints(p => p + finalPoints);

    // Detectar robos cliente-side con zonas ya cargadas (feedback inmediato)
    const rivalsCaptured = remoteZones.filter(rz => {
      if (rz.is_mine) return false;
      return pointInPolygon(rz.center_lat, rz.center_lng, snapped);
    });

    const isSteal = rivalsCaptured.length > 0;
    const stolenNames = [...new Set(rivalsCaptured.map(r => r.owner_name))];

    const title    = isSteal ? '🎭 ¡ROBO!' : '🏆 ¡Zona conquistada!';
    const subtitle = isSteal
      ? `¡Le has robado ${rivalsCaptured.length} zona${rivalsCaptured.length > 1 ? 's' : ''} a ${stolenNames.join(', ')}!\n+${finalPoints} puntos`
      : `Has encerrado ${area.toFixed(3)} km²\n+${finalPoints} puntos`;

    Alert.alert(title, subtitle, [{
      text: isSteal ? '😈 ¡Seguir robando!' : '¡Seguir corriendo!',
      onPress: () => {
        pathRef.current = [path[path.length - 1]];
        setCurrentPath([path[path.length - 1]]);
        setLoopDetected(false);
      },
    }]);
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

    const trailPoints = pathRef.current.length >= 2 ? Math.round(distance * 50) : 0;
    const finalPoints = totalPoints + trailPoints;
    const zonesCount = conqueredZones.filter(z => z.area > 0).length;

    if (distance > 0.05 || zonesCount > 0) {
      const closedZones = conqueredZones.filter(z => z.area > 0);
      api.saveRun({
        distanceKm: distance,
        durationSecs: runTime,
        points: finalPoints,
        zonesCount,
        zones: closedZones.map(z => ({ coords: z.coords, area: z.area, points: z.points })),
      }).then(res => {
        loadZones();
        if (res.stolenZones && res.stolenZones.length > 0) {
          const names = [...new Set(res.stolenZones.map((s: any) => s.ownerName))];
          Alert.alert(
            '🎭 Resumen de robos',
            `Has robado ${res.stolenZones.length} zona${res.stolenZones.length > 1 ? 's' : ''} a ${names.join(', ')}.\n¡Aparecen en el ranking como tuyas!`,
            [{ text: '💪 ¡Genial!' }]
          );
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
        points: trailPoints,
      }]);
    }

    setCurrentPath([]);
    pathRef.current = [];
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const pace = distance > 0.05 ? ((runTime / 60) / distance).toFixed(1) : '--';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.cityLabel}>MADRID</Text>
          <Text style={styles.citySubtitle}>{user?.username ?? 'Runner'}</Text>
        </View>
        <View style={styles.headerStats}>
          <View style={styles.headerStat}>
            <Ionicons name="flame" size={14} color={colors.orange} />
            <Text style={styles.headerStatValue}>{totalPoints}</Text>
          </View>
          <View style={styles.headerStat}>
            <Ionicons name="map" size={14} color={colors.orange} />
            <Text style={styles.headerStatValue}>{conqueredZones.length}</Text>
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
        >
          {/* Zonas del servidor: propias (naranja) y ajenas (azul) */}
          {remoteZones.map((zone) => (
            <Polygon
              key={zone.id}
              coordinates={zone.polygon}
              fillColor={zone.is_mine ? `${colors.orange}40` : 'rgba(30,79,216,0.25)'}
              strokeColor={zone.is_mine ? colors.orange : colors.blue}
              strokeWidth={zone.is_mine ? 2 : 1.5}
            />
          ))}

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
});
