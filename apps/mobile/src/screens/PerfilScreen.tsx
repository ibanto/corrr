import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api } from '../services/api';

interface Props {
  user: { username: string; id: string } | null;
  onLogout: () => void;
}

export default function PerfilScreen({ user, onLogout }: Props) {
  const displayName = user?.username ?? 'RunnerMadrid';
  const [stravaLoading, setStravaLoading] = useState(false);

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>24</Text>
          </View>
        </View>
        <View style={styles.userInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.username}>{displayName}</Text>
            <Ionicons name="checkmark-circle" size={16} color={colors.orange} />
          </View>
          <View style={styles.locationRow}>
            <Ionicons name="location" size={12} color={colors.textSecondary} />
            <Text style={styles.location}>Madrid, España</Text>
          </View>
          <View style={styles.xpRow}>
            <View style={styles.xpBar}>
              <View style={[styles.xpFill, { width: '65%' }]} />
            </View>
            <Text style={styles.xpText}>16.460 / 26.000 XP</Text>
          </View>
        </View>
        <TouchableOpacity>
          <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        {[
          { value: '87', label: 'Zonas' },
          { value: '1.248', label: 'km totales' },
          { value: '43', label: 'Carreras' },
          { value: '18', label: 'Racha' },
        ].map((s, i) => (
          <View key={i} style={styles.statItem}>
            {i === 3 && <Ionicons name="flame" size={14} color={colors.orange} />}
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
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
          <TouchableOpacity><Text style={styles.sectionLink}>Ver todo</Text></TouchableOpacity>
        </View>
        {[
          { date: 'Hoy', place: 'Madrid Centro', km: 8.42, pace: '5:18' },
          { date: 'Ayer', place: 'Casa de Campo', km: 6.21, pace: '5:05' },
          { date: '19 may.', place: 'El Retiro', km: 10.03, pace: '5:24' },
        ].map((run, i) => (
          <View key={i} style={styles.runRow}>
            <View style={styles.runIcon}>
              <Ionicons name="walk" size={18} color={colors.orange} />
            </View>
            <View style={styles.runInfo}>
              <Text style={styles.runPlace}>{run.place}</Text>
              <Text style={styles.runDate}>{run.date}</Text>
            </View>
            <View style={styles.runStats}>
              <Text style={styles.runKm}>{run.km} km</Text>
              <Text style={styles.runPace}>{run.pace} /km</Text>
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
          { icon: 'person-outline' as const, label: 'Cuenta' },
          { icon: 'notifications-outline' as const, label: 'Notificaciones' },
          { icon: 'lock-closed-outline' as const, label: 'Privacidad' },
          { icon: 'help-circle-outline' as const, label: 'Centro de ayuda' },
        ].map((item, i) => (
          <TouchableOpacity key={i} style={styles.settingsRow}>
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
