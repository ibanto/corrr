import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

interface RetoDetalle {
  id: string;
  title: string;
  description: string;
  objectives: { label: string; icon: keyof typeof Ionicons.glyphMap; current: number; target: number }[];
  rewardPoints: number;
  rewardXP: number;
  timeLimit: string;
  accepted?: boolean;
  heroImage?: any;
  penalty?: number;
  daysLeft?: number;
  activatesAtHour?: number; // hora a partir de la cual se puede activar (ej: 20)
}

interface Props {
  reto: RetoDetalle;
  onBack: () => void;
  onAccept: (id: string) => void;
  onSimulateComplete?: () => void;
  onSimulateFail?: () => void;
}

export default function RetoDetalleScreen({ reto, onBack, onAccept, onSimulateComplete, onSimulateFail }: Props) {
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detalle del reto</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero: imagen custom o icono por defecto */}
        {reto.heroImage ? (
          <Image
            source={reto.heroImage}
            style={{
              width: SCREEN_WIDTH - 32,
              height: (SCREEN_WIDTH - 32) * (736 / 1080),
              alignSelf: 'center' as const,
              marginTop: 8,
              marginBottom: 4,
            }}
            resizeMode="contain"
          />
        ) : (
          <>
            <View style={styles.heroIcon}>
              <Ionicons name="trophy" size={48} color={colors.orange} />
            </View>
            <Text style={styles.title}>{reto.title}</Text>
          </>
        )}
        <Text style={styles.description}>{reto.description}</Text>

        {/* Time limit + countdown */}
        <View style={styles.timeRow}>
          <View style={styles.timeBadge}>
            <Ionicons name="time-outline" size={16} color={colors.orange} />
            <Text style={styles.timeText}>{reto.timeLimit}</Text>
          </View>
          {reto.daysLeft != null && (
            <View style={[styles.timeBadge, styles.daysLeftBadge]}>
              <Ionicons name="calendar-outline" size={16} color={reto.daysLeft <= 3 ? '#FF3B30' : colors.orange} />
              <Text style={[styles.timeText, reto.daysLeft <= 3 && { color: '#FF3B30' }]}>
                {reto.daysLeft > 0 ? `Quedan ${reto.daysLeft} días` : '¡Último día!'}
              </Text>
            </View>
          )}
        </View>

        {/* Objectives */}
        <Text style={styles.sectionTitle}>Objetivos</Text>
        <View style={styles.objectivesCard}>
          {reto.objectives.map((obj, i) => {
            const pct = Math.min(100, (obj.current / obj.target) * 100);
            return (
              <View key={i} style={styles.objectiveRow}>
                <View style={styles.objIconWrap}>
                  <Ionicons name={obj.icon} size={20} color={colors.orange} />
                </View>
                <View style={styles.objBody}>
                  <Text style={styles.objLabel}>{obj.label}</Text>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                </View>
                <Text style={styles.objCount}>{obj.current}/{obj.target}</Text>
              </View>
            );
          })}
        </View>

        {/* Rewards */}
        <Text style={styles.sectionTitle}>Recompensa</Text>
        <View style={styles.rewardsRow}>
          <View style={styles.rewardBox}>
            <Ionicons name="flame" size={24} color={colors.orange} />
            <Text style={styles.rewardValue}>{reto.rewardPoints.toLocaleString()}</Text>
            <Text style={styles.rewardLabel}>Puntos</Text>
          </View>
          <View style={styles.rewardBox}>
            <Ionicons name="flash" size={24} color={colors.purple} />
            <Text style={[styles.rewardValue, { color: colors.purple }]}>{reto.rewardXP}</Text>
            <Text style={styles.rewardLabel}>XP</Text>
          </View>
        </View>

        {/* Penalty warning */}
        {reto.penalty != null && reto.penalty > 0 && (
          <View style={styles.penaltyCard}>
            <View style={styles.penaltyHeader}>
              <Ionicons name="warning" size={20} color="#FF3B30" />
              <Text style={styles.penaltyTitle}>Penalización</Text>
            </View>
            <Text style={styles.penaltyText}>
              Si no completas el reto perderás {reto.penalty.toLocaleString()} puntos{'\n'}
              <Text style={{ fontSize: 11, color: '#FF8A80' }}>Tu saldo nunca bajará de 0</Text>
            </Text>
          </View>
        )}

        {/* Accept button */}
        {reto.accepted ? (
          <View style={styles.acceptedBadge}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.acceptedText}>Desafío aceptado</Text>
          </View>
        ) : reto.activatesAtHour != null && new Date().getHours() < reto.activatesAtHour ? (
          <View style={styles.acceptBtnDisabled}>
            <Ionicons name="lock-closed" size={20} color={colors.textMuted} />
            <Text style={styles.acceptBtnTextDisabled}>Se activa a las {reto.activatesAtHour}:00</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.acceptBtn} onPress={() => onAccept(reto.id)} activeOpacity={0.8}>
            <Ionicons name="rocket" size={20} color="#fff" />
            <Text style={styles.acceptBtnText}>¡Quiero el desafío!</Text>
          </TouchableOpacity>
        )}


      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: radius.full,
    backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  content: { paddingHorizontal: spacing.md, paddingBottom: 100 },
  heroImage: {
    width: '50%', aspectRatio: 1, alignSelf: 'center',
    marginTop: spacing.sm, marginBottom: spacing.xs,
  },
  heroIcon: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.orangeGlow,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
    marginTop: spacing.lg, marginBottom: spacing.md,
    borderWidth: 2, borderColor: `${colors.orange}40`,
  },
  title: { fontSize: 24, fontWeight: '900', color: colors.textPrimary, textAlign: 'center' },
  description: {
    fontSize: 15, color: colors.textSecondary, textAlign: 'center',
    marginTop: spacing.xs, lineHeight: 22,
  },
  timeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap',
  },
  timeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.bgCard, paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  daysLeftBadge: {
    borderColor: 'rgba(255,59,48,0.3)', backgroundColor: 'rgba(255,59,48,0.08)',
  },
  timeText: { fontSize: 13, fontWeight: '600', color: colors.orange },
  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: colors.textPrimary,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  objectivesCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md,
  },
  objectiveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  objIconWrap: {
    width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.bgCardAlt,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  objBody: { flex: 1, gap: 4 },
  objLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  progressBar: { height: 4, backgroundColor: colors.bgCardAlt, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.orange, borderRadius: 2 },
  objCount: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, minWidth: 32, textAlign: 'right' },
  rewardsRow: { flexDirection: 'row', gap: spacing.sm },
  rewardBox: {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  rewardValue: { fontSize: 22, fontWeight: '900', color: colors.orange },
  rewardLabel: { fontSize: 11, color: colors.textSecondary },
  acceptBtn: {
    backgroundColor: colors.orange, paddingVertical: 16, borderRadius: radius.full,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.lg,
  },
  acceptBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  acceptBtnDisabled: {
    backgroundColor: colors.bgCard, paddingVertical: 16, borderRadius: radius.full,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  acceptBtnTextDisabled: { color: colors.textMuted, fontSize: 17, fontWeight: '800' },
  acceptedBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingVertical: 16,
    backgroundColor: colors.bgCard, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.success,
  },
  acceptedText: { fontSize: 15, fontWeight: '700', color: colors.success },
  penaltyCard: {
    backgroundColor: 'rgba(255,59,48,0.08)', borderRadius: radius.lg,
    padding: spacing.md, marginTop: spacing.md,
    borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)',
  },
  penaltyHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6,
  },
  penaltyTitle: { fontSize: 15, fontWeight: '800', color: '#FF3B30' },
  penaltyText: { fontSize: 13, color: '#FF8A80', lineHeight: 20 },
  devRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.xl, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  devLabel: { fontSize: 12, color: colors.textMuted },
  devBtnGreen: {
    flex: 1, paddingVertical: 10, borderRadius: radius.full,
    backgroundColor: '#22C55E', alignItems: 'center',
  },
  devBtnRed: {
    flex: 1, paddingVertical: 10, borderRadius: radius.full,
    backgroundColor: colors.danger, alignItems: 'center',
  },
  devBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});

export type { RetoDetalle };
