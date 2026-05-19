import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';

const { width } = Dimensions.get('window');
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, Achievement } from '../services/api';

type Filter = 'Todos' | 'Distancia' | 'Zonas' | 'Carreras' | 'Tienda';

const filterCategoryMap: Record<Filter, string[]> = {
  Todos: ['distancia', 'zonas', 'carreras', 'robos', 'racha'],
  Distancia: ['distancia'],
  Zonas: ['zonas', 'robos'],
  Carreras: ['carreras', 'racha'],
  Tienda: [],
};

const XP_PACKS = [
  { id: 'xp_50',  xp: 50,   price: '0,50 €',  popular: false },
  { id: 'xp_150', xp: 150,  price: '1,49 €',  popular: true },
  { id: 'xp_500', xp: 500,  price: '3,99 €',  popular: false },
  { id: 'xp_1200', xp: 1200, price: '5,99 €', popular: false },
];

export default function RetosScreen() {
  const [filter, setFilter] = useState<Filter>('Todos');
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [userXP, setUserXP] = useState(0);
  const [earnOpen, setEarnOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [achs, stats] = await Promise.all([
        api.getAchievements().catch(() => []),
        api.getMyStats().catch(() => null),
      ]);
      setAchievements(achs);
      if (stats?.stats?.total_points) {
        setUserXP(Math.floor(stats.stats.total_points / 100));
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = filter === 'Tienda' ? [] : achievements.filter(a => filterCategoryMap[filter].includes(a.category));
  // Sort: unlocked last, then by progress %
  const sorted = [...filtered].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? 1 : -1;
    return (b.progress / b.target) - (a.progress / a.target);
  });

  const unlockedCount = achievements.filter(a => a.unlocked).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Logros</Text>
          <Text style={styles.subtitle}>{unlockedCount}/{achievements.length} desbloqueados</Text>
        </View>
        <View style={styles.pointsBadge}>
          <Text style={styles.balanceLabel}>Tu saldo</Text>
          <Ionicons name="star" size={14} color="#FFD700" />
          <Text style={styles.pointsValue}>{userXP} XP</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {(['Todos', 'Distancia', 'Zonas', 'Carreras', 'Tienda'] as Filter[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterPill, filter === f && styles.filterPillActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.orange} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {/* Achievement grid */}
          {filter !== 'Tienda' && (
          <View style={styles.grid}>
            {sorted.map(ach => {
              const pct = Math.min(100, (ach.progress / ach.target) * 100);
              const isComplete = ach.unlocked;
              return (
                <View
                  key={ach.key}
                  style={[styles.gridCard, isComplete && styles.gridCardComplete]}
                >
                  <View style={styles.gridCardTop}>
                    <Text style={styles.gridCardEmoji}>{ach.icon}</Text>
                    {isComplete && (
                      <View style={styles.checkBadge}>
                        <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
                      </View>
                    )}
                  </View>
                  <View style={styles.gridCardBody}>
                    <Text style={[styles.gridCardTitle, isComplete && styles.gridCardTitleDone]} numberOfLines={2}>{ach.title}</Text>
                    <Text style={styles.gridCardDesc} numberOfLines={2}>{ach.description}</Text>
                  </View>
                  <View style={styles.gridCardBottom}>
                    <View style={styles.gridProgressRow}>
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, isComplete && styles.progressFillDone, { width: `${pct}%` }]} />
                      </View>
                      <Text style={styles.gridProgressText}>
                        {ach.category === 'distancia' ? `${Math.round(ach.progress)}/${ach.target} km` : `${Math.round(ach.progress)}/${ach.target}`}
                      </Text>
                    </View>
                    <View style={styles.gridRewardRow}>
                      <Ionicons name="flame" size={12} color={isComplete ? '#4CAF50' : colors.orange} />
                      <Text style={[styles.gridRewardValue, isComplete && { color: '#4CAF50' }]}>
                        {isComplete ? 'Completado' : `+${ach.reward} pts`}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          )}

          {/* Sección Tienda XP — solo en pestaña Tienda */}
          {filter === 'Tienda' && (
          <View style={styles.shopSection}>
            <View style={styles.shopHeader}>
              <Ionicons name="star" size={20} color="#FFD700" />
              <Text style={styles.shopTitle}>TIENDA XP</Text>
            </View>

            {/* Cómo ganar XP — colapsable */}
            <TouchableOpacity style={styles.earnCard} activeOpacity={0.7} onPress={() => setEarnOpen(!earnOpen)}>
              <View style={styles.earnHeader}>
                <Text style={styles.earnTitle}>GANA XP CORRIENDO</Text>
                <Ionicons name={earnOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
              </View>
              {earnOpen && (
                <View style={styles.earnContent}>
                  <View style={styles.earnRow}>
                    <Ionicons name="footsteps" size={16} color={colors.orange} />
                    <Text style={styles.earnText}>Cada 100 puntos = 1 XP</Text>
                  </View>
                  <View style={styles.earnRow}>
                    <Ionicons name="navigate" size={16} color={colors.orange} />
                    <Text style={styles.earnText}>50 pts por km recorrido</Text>
                  </View>
                  <View style={styles.earnRow}>
                    <Ionicons name="flag" size={16} color={colors.orange} />
                    <Text style={styles.earnText}>100 pts por cerrar un circuito</Text>
                  </View>
                  <View style={styles.earnRow}>
                    <Ionicons name="hand-left" size={16} color={colors.orange} />
                    <Text style={styles.earnText}>50 pts extra por robar zona</Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>

            {/* Gasta XP — colapsable */}
            <TouchableOpacity style={styles.earnCard} activeOpacity={0.7} onPress={() => setSpendOpen(!spendOpen)}>
              <View style={styles.earnHeader}>
                <Text style={styles.earnTitle}>GASTA XP EN POWER-UPS</Text>
                <Ionicons name={spendOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
              </View>
              {spendOpen && (
                <View style={styles.earnContent}>
                  <View style={styles.earnRow}>
                    <Text style={{ fontSize: 16 }}>🛡️</Text>
                    <Text style={styles.earnText}>Centinela 6h — 100 XP</Text>
                  </View>
                  <View style={styles.earnRow}>
                    <Text style={{ fontSize: 16 }}>🛡️</Text>
                    <Text style={styles.earnText}>Centinela 12h — 250 XP</Text>
                  </View>
                  <View style={styles.earnRow}>
                    <Text style={{ fontSize: 16 }}>🛡️</Text>
                    <Text style={styles.earnText}>Centinela 24h — 500 XP</Text>
                  </View>
                  <Text style={styles.earnHint}>Toca una zona tuya en el mapa para activar</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Comprar XP */}
            <Text style={styles.shopSubtitle}>COMPRAR XP</Text>
            <View style={styles.packsGrid}>
              {XP_PACKS.map(pack => (
                <TouchableOpacity
                  key={pack.id}
                  style={[styles.packCard, pack.popular && styles.packCardPopular]}
                  onPress={() => {
                    Alert.alert(
                      'Comprar XP',
                      `¿Comprar ${pack.xp} XP por ${pack.price}?`,
                      [
                        { text: 'Cancelar', style: 'cancel' },
                        { text: 'Comprar', onPress: () => {
                          // TODO: integrar in-app purchase real
                          setUserXP(xp => xp + pack.xp);
                          Alert.alert('✅ ¡Compra realizada!', `Has recibido ${pack.xp} XP`);
                        }},
                      ]
                    );
                  }}
                >
                  {pack.popular && (
                    <View style={styles.packPopularBadge}>
                      <Text style={styles.packPopularText}>POPULAR</Text>
                    </View>
                  )}
                  <View style={styles.packTopRow}>
                    <Ionicons name="star" size={14} color="#FFD700" />
                    <Text style={styles.packXP}>{pack.xp}</Text>
                    <Text style={styles.packXPLabel}>XP</Text>
                  </View>
                  <Text style={styles.packPrice}>{pack.price}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  title: { fontSize: 28, fontWeight: '900', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  pointsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgCard,
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  balanceLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  pointsValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  filterRow: {
    flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterPill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  filterPillActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  filterTextActive: { color: '#fff' },
  list: { paddingHorizontal: spacing.md, paddingBottom: 100, gap: spacing.sm },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
  },
  gridCard: {
    width: (width - spacing.md * 2 - spacing.sm) / 2,
    minHeight: 160,
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'space-between',
  },
  gridCardComplete: { borderColor: '#4CAF50', borderWidth: 1.5, opacity: 0.75 },
  gridCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gridCardEmoji: { fontSize: 28 },
  checkBadge: {},
  gridCardBody: { flex: 1, justifyContent: 'center', gap: 2, marginTop: 4 },
  gridCardTitle: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  gridCardTitleDone: { color: '#4CAF50' },
  gridCardDesc: { fontSize: 10, color: colors.textSecondary, lineHeight: 14 },
  gridCardBottom: { gap: 6 },
  gridProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gridProgressText: { fontSize: 10, color: colors.textSecondary },
  gridRewardRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gridRewardValue: { fontSize: 13, fontWeight: '800', color: colors.orange },
  progressBar: { flex: 1, height: 4, backgroundColor: colors.bgCardAlt, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.orange, borderRadius: 2 },
  progressFillDone: { backgroundColor: '#4CAF50' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Tienda XP
  shopSection: { marginTop: spacing.lg, gap: spacing.sm },
  shopHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shopTitle: { fontSize: 22, fontWeight: '900', color: colors.orange, letterSpacing: 2 },
  shopBalance: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  earnCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  earnHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  earnTitle: {
    fontSize: 13, fontWeight: '800', color: colors.textPrimary,
    letterSpacing: 1,
  },
  earnContent: { gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  earnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  earnText: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  earnHint: {
    fontSize: 11, color: colors.textMuted, fontStyle: 'italic',
    textAlign: 'center', marginTop: 4,
  },
  shopSubtitle: {
    fontSize: 13, fontWeight: '800', color: colors.textPrimary,
    letterSpacing: 1, marginTop: spacing.sm,
  },
  packsGrid: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  packCard: {
    width: (width - spacing.md * 2 - spacing.sm) / 2,
    backgroundColor: colors.bgCard, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: 14, paddingHorizontal: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  packCardPopular: { borderColor: '#FFD700', borderWidth: 2 },
  packPopularBadge: {
    position: 'absolute', top: -8, right: 8,
    backgroundColor: '#FFD700', paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: radius.full, zIndex: 1,
  },
  packPopularText: { fontSize: 7, fontWeight: '800', color: '#000', letterSpacing: 0.5 },
  packTopRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  packXP: { fontSize: 22, fontWeight: '900', color: colors.textPrimary },
  packXPLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '700' },
  packPrice: { fontSize: 15, fontWeight: '800', color: colors.orange },
});
