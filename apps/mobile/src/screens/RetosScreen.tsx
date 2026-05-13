import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, Challenge } from '../services/api';

type Filter = 'Todos' | 'Formas' | 'Mensuales' | 'Especiales';

const filterMap: Record<Filter, string[]> = {
  Todos: ['shape', 'distance', 'streak', 'steal'],
  Formas: ['shape'],
  Mensuales: ['distance', 'streak'],
  Especiales: ['steal'],
};

const challengeIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  '⭕': 'ellipse-outline',
  '⭐': 'star-outline',
  '∞': 'infinite-outline',
  '💯': 'fitness-outline',
  '🎭': 'glasses-outline',
};

export default function RetosScreen() {
  const [filter, setFilter] = useState<Filter>('Todos');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getChallenges().then(data => { setChallenges(data); setLoading(false); });
  }, []);

  const filtered = challenges.filter(c => filterMap[filter].includes(c.type));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Retos</Text>
        <View style={styles.pointsBadge}>
          <Ionicons name="flame" size={14} color={colors.orange} />
          <Text style={styles.pointsValue}>2.450</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterContent}>
        {(['Todos', 'Formas', 'Mensuales', 'Especiales'] as Filter[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterPill, filter === f && styles.filterPillActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.orange} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {filtered.map(challenge => {
            const pct = Math.min(100, (challenge.progress / challenge.total) * 100);
            const iconName = challengeIcons[challenge.icon] ?? 'star-outline';
            return (
              <View key={challenge.id} style={styles.card}>
                <View style={styles.cardIcon}>
                  <Ionicons name={iconName} size={26} color={colors.orange} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{challenge.title}</Text>
                  <Text style={styles.cardDesc}>{challenge.description}</Text>
                  <View style={styles.progressRow}>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.progressText}>{challenge.progress}/{challenge.total}</Text>
                  </View>
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.rewardValue}>{challenge.reward}</Text>
                  <Text style={styles.rewardLabel}>pts</Text>
                </View>
              </View>
            );
          })}

          <View style={styles.premiumCard}>
            <View style={styles.premiumHeader}>
              <Ionicons name="ribbon" size={18} color={colors.orange} />
              <Text style={styles.premiumTitle}>Desafío premium</Text>
            </View>
            <Text style={styles.premiumName}>Conquistador infinito</Text>
            <Text style={styles.premiumDesc}>Captura 20 zonas en 30 días.</Text>
            <View style={styles.premiumRewardRow}>
              <Ionicons name="ribbon" size={14} color={colors.orange} />
              <Text style={styles.premiumReward}>1.000 pts</Text>
              <Ionicons name="flash" size={14} color={colors.orange} />
              <Text style={styles.premiumReward}>150 XP</Text>
            </View>
            <TouchableOpacity style={styles.premiumBtn}>
              <Ionicons name="ribbon" size={16} color="#fff" />
              <Text style={styles.premiumBtnText}>Hazte Premium</Text>
            </TouchableOpacity>
          </View>
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
  pointsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgCard,
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  pointsValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  filterRow: { maxHeight: 44, marginBottom: spacing.md },
  filterContent: { paddingHorizontal: spacing.md, gap: spacing.sm, alignItems: 'center' },
  filterPill: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  filterPillActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  filterTextActive: { color: '#fff' },
  list: { paddingHorizontal: spacing.md, paddingBottom: 100, gap: spacing.sm },
  card: {
    flexDirection: 'row', backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, alignItems: 'center',
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.bgCardAlt,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  cardDesc: { fontSize: 12, color: colors.textSecondary },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  progressBar: { flex: 1, height: 4, backgroundColor: colors.bgCardAlt, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.orange, borderRadius: 2 },
  progressText: { fontSize: 11, color: colors.textSecondary, minWidth: 28 },
  cardRight: { alignItems: 'center' },
  rewardValue: { fontSize: 18, fontWeight: '800', color: colors.orange },
  rewardLabel: { fontSize: 10, color: colors.textSecondary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  premiumCard: {
    backgroundColor: '#1A0F00', borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: `${colors.orange}60`, gap: spacing.sm, marginTop: spacing.sm,
  },
  premiumHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  premiumTitle: { fontSize: 13, fontWeight: '700', color: colors.orange, textTransform: 'uppercase', letterSpacing: 0.5 },
  premiumName: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  premiumDesc: { fontSize: 13, color: colors.textSecondary },
  premiumRewardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  premiumReward: { fontSize: 13, color: colors.orange, fontWeight: '600' },
  premiumBtn: {
    backgroundColor: colors.orange, paddingVertical: 12, borderRadius: radius.full,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.xs,
  },
  premiumBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
