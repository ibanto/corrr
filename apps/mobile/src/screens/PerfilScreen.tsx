import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, MyStats, RunRecord } from '../services/api';

interface Props {
  user: { username: string; id: string; city?: string } | null;
  onLogout: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return 'Hoy';
  if (diff < 172800000) return 'Ayer';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function formatPace(distKm: number, secs: number): string {
  if (!distKm || !secs) return '--:--';
  const secsPerKm = secs / distKm;
  const m = Math.floor(secsPerKm / 60);
  const s = Math.floor(secsPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatKm(km: number): string {
  return km >= 1000 ? `${(km / 1000).toFixed(1)}k` : km.toFixed(1);
}

export default function PerfilScreen({ user, onLogout }: Props) {
  const displayName = user?.username ?? 'RunnerMadrid';
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const data = await api.getMyStats();
      setStats(data);
    } catch {
      // silencioso — mantiene datos anteriores
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  const handleConnectStrava = async () => {
    setStravaLoading(true);
    try {
      const url = await api.getStravaAuthUrl();
      await Linking.openURL(url);
    } catch {
      Alert.alert('Error', 'No se pudo conectar con Strava. Inténtalo de nuevo.');
    } finally {
      setStravaLoading(false);
    }
  };

  const s = stats?.stats;
  const runs: RunRecord[] = stats?.runs ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />}
    >
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>{Math.floor((s?.total_zones ?? 0) / 5) + 1}</Text>
          </View>
        </View>
        <View style={styles.userInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.username}>{displayName}</Text>
            <Ionicons name="checkmark-circle" size={16} color={colors.orange} />
          </View>
          {user?.city && (
            <View style={styles.locationRow}>
              <Ionicons name="location" size={12} color={colors.textSecondary} />
              <Text style={styles.location}>{user.city}</Text>
            </View>
          )}
          <View style={styles.xpRow}>
            <View style={styles.xpBar}>
              <View style={[styles.xpFill, { width: `${Math.min(100, ((s?.total_points ?? 0) % 5000) / 50)}%` }]} />
            </View>
            <Text style={styles.xpText}>{(s?.total_points ?? 0).toLocaleString('es-ES')} pts totales</Text>
          </View>
        </View>
        <TouchableOpacity>
          <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        {[
          { value: String(s?.total_zones ?? 0), label: 'Zonas' },
          { value: formatKm(s?.total_km ?? 0), label: 'km totales' },
          { value: String(s?.total_runs ?? 0), label: 'Carreras' },
          { value: String(s?.total_points ?? 0), label: 'Puntos', flame: true },
        ].map((item, i) => (
          <View key={i} style={styles.statItem}>
            {item.flame && <Ionicons name="flame" size={14} color={colors.orange} />}
            <Text style={styles.statValue}>{item.value}</Text>
            <Text style={styles.statLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Logros</Text>
          <TouchableOpacity><Text style={styles.sectionLink}>Ver todos</Text></TouchableOpacity>
        </View>
        <View style={styles.achievementsRow}>
          {[
            { icon: 'business' as const, label: 'Conquistador', sub: '10 zonas' },
            { icon: 'flash' as const, label: 'Imparable', sub: '10 rachas' },
            { icon: 'walk' as const, label: 'Explorador', sub: '100 km' },
            { icon: 'star' as const, label: 'Leyenda', sub: 'Top 5%' },
          ].map((a, i) => (
            <View key={i} style={styles.achievement}>
              <View style={styles.achievementIcon}>
                <Ionicons name={a.icon} size={26} color={colors.orange} />
              </View>
              <Text style={styles.achievementLabel}>{a.label}</Text>
              <Text style={styles.achievementSub}>{a.sub}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Actividad reciente</Text>
        </View>
        {runs.length === 0 ? (
          <Text style={styles.emptyText}>Aún no tienes carreras. ¡A correr!</Text>
        ) : runs.map((run, i) => (
          <View key={run.id ?? i} style={styles.runRow}>
            <View style={styles.runIcon}>
              <Ionicons name="walk" size={18} color={colors.orange} />
            </View>
            <View style={styles.runInfo}>
              <Text style={styles.runPlace}>{run.distance_km.toFixed(2)} km · {run.zones_count} zona{run.zones_count !== 1 ? 's' : ''}</Text>
              <Text style={styles.runDate}>{formatDate(run.created_at)}</Text>
            </View>
            <View style={styles.runStats}>
              <Text style={styles.runKm}>{run.points} pts</Text>
              <Text style={styles.runPace}>{formatPace(run.distance_km, run.duration_secs)} /km</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Strava Connect */}
      <TouchableOpacity style={styles.stravaCard} onPress={handleConnectStrava} disabled={stravaLoading}>
        <View style={styles.stravaLeft}>
          <View style={styles.stravaIcon}>
            <Text style={styles.stravaIconText}>S</Text>
          </View>
          <View>
            <Text style={styles.stravaTitle}>Importar desde Strava</Text>
            <Text style={styles.stravaSub}>Conquista zonas con tus últimas 5 carreras</Text>
          </View>
        </View>
        {stravaLoading
          ? <ActivityIndicator size="small" color="#FC4C02" />
          : <Ionicons name="chevron-forward" size={20} color="#FC4C02" />}
      </TouchableOpacity>

      <View style={styles.premiumCard}>
        <View style={styles.premiumTop}>
          <View>
            <View style={styles.premiumTitleRow}>
              <Ionicons name="ribbon" size={18} color={colors.orange} />
              <Text style={styles.premiumTitle}>CORRR PREMIUM</Text>
            </View>
            <Text style={styles.premiumSub}>Desbloquea todo tu potencial</Text>
          </View>
          <View style={styles.priceBadge}>
            <Text style={styles.priceText}>€4,99</Text>
            <Text style={styles.pricePeriod}>/mes</Text>
          </View>
        </View>
        <View style={styles.premiumFeatures}>
          {['Retos exclusivos', 'Ranking avanzado', 'Estadísticas avanzadas', 'Sin anuncios', 'Más recompensas'].map((f, i) => (
            <View key={i} style={styles.premiumFeatureRow}>
              <Ionicons name="checkmark-circle" size={16} color={colors.orange} />
              <Text style={styles.premiumFeature}>{f}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={styles.premiumBtn}>
          <Ionicons name="ribbon" size={16} color="#fff" />
          <Text style={styles.premiumBtnText}>Probar 7 días gratis</Text>
        </TouchableOpacity>
        <Text style={styles.premiumFooter}>Cancela cuando quieras</Text>
      </View>

      <View style={styles.section}>
        {[
          { icon: 'person-outline' as const, label: 'Cuenta', onPress: undefined },
          { icon: 'notifications-outline' as const, label: 'Notificaciones', onPress: undefined },
          { icon: 'lock-closed-outline' as const, label: 'Privacidad', onPress: () => Linking.openURL('https://ibanto.github.io/corrr/privacy.html') },
          { icon: 'bug-outline' as const, label: 'Reportar un bug', onPress: () => Linking.openURL('mailto:ibangarciacastrillon@gmail.com?subject=Bug%20en%20CORRR&body=Hola%2C%20he%20encontrado%20un%20problema%3A%0A%0A') },
          { icon: 'help-circle-outline' as const, label: 'Centro de ayuda', onPress: () => Linking.openURL('mailto:ibangarciacastrillon@gmail.com?subject=Ayuda%20CORRR') },
        ].map((item, i) => (
          <TouchableOpacity key={i} style={styles.settingsRow} onPress={item.onPress}>
            <Ionicons name={item.icon} size={20} color={colors.textSecondary} style={{ width: 28 }} />
            <Text style={styles.settingsRowLabel}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.settingsRow} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.danger} style={{ width: 28 }} />
          <Text style={[styles.settingsRowLabel, { color: colors.danger }]}>Cerrar sesión</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 100 },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.md,
  },
  avatarContainer: { position: 'relative' },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '900', color: '#fff' },
  levelBadge: {
    position: 'absolute', bottom: -4, right: -4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  levelText: { fontSize: 10, fontWeight: '900', color: '#fff' },
  userInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  username: { fontSize: 20, fontWeight: '900', color: colors.textPrimary },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  location: { fontSize: 12, color: colors.textSecondary },
  xpRow: { gap: 4 },
  xpBar: { height: 4, backgroundColor: colors.bgCardAlt, borderRadius: 2, overflow: 'hidden' },
  xpFill: { height: '100%', backgroundColor: colors.orange, borderRadius: 2 },
  xpText: { fontSize: 10, color: colors.textSecondary },
  statsRow: {
    flexDirection: 'row', marginHorizontal: spacing.md, backgroundColor: colors.bgCard,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, marginBottom: spacing.lg,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  statLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  section: { paddingHorizontal: spacing.md, marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  sectionLink: { fontSize: 13, color: colors.orange, fontWeight: '600' },
  achievementsRow: { flexDirection: 'row', gap: spacing.sm },
  achievement: { flex: 1, alignItems: 'center', gap: 4 },
  achievementIcon: {
    width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  achievementLabel: { fontSize: 11, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  achievementSub: { fontSize: 10, color: colors.textSecondary, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.md },
  runRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm,
  },
  runIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  runInfo: { flex: 1 },
  runPlace: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  runDate: { fontSize: 12, color: colors.textSecondary },
  runStats: { alignItems: 'flex-end' },
  runKm: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  runPace: { fontSize: 12, color: colors.textSecondary },
  stravaCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: '#1A0A00',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#FC4C0260',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stravaLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  stravaIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#FC4C02',
    alignItems: 'center', justifyContent: 'center',
  },
  stravaIconText: { color: '#fff', fontWeight: '900', fontSize: 20 },
  stravaTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  stravaSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  premiumCard: {
    marginHorizontal: spacing.md, backgroundColor: '#120A00', borderRadius: radius.lg,
    padding: spacing.lg, borderWidth: 1, borderColor: `${colors.orange}50`, marginBottom: spacing.lg, gap: spacing.md,
  },
  premiumTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  premiumTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  premiumTitle: { fontSize: 15, fontWeight: '800', color: colors.orange },
  premiumSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  priceBadge: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  priceText: { fontSize: 22, fontWeight: '900', color: colors.textPrimary },
  pricePeriod: { fontSize: 12, color: colors.textSecondary },
  premiumFeatures: { gap: 6 },
  premiumFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  premiumFeature: { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  premiumBtn: {
    backgroundColor: colors.orange, paddingVertical: 14, borderRadius: radius.full,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.xs,
    shadowColor: colors.orange, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
  },
  premiumBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  premiumFooter: { textAlign: 'center', fontSize: 11, color: colors.textMuted },
  settingsRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm,
  },
  settingsRowLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.textPrimary },
});
