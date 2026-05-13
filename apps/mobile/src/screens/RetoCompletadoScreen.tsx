import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

interface Props {
  title: string;
  rewardPoints: number;
  rewardXP: number;
  onClose: () => void;
}

export default function RetoCompletadoScreen({ title, rewardPoints, rewardXP, onClose }: Props) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const confettiY = useRef(new Animated.Value(-40)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
      Animated.loop(
        Animated.sequence([
          Animated.timing(confettiY, { toValue: 10, duration: 1500, useNativeDriver: true }),
          Animated.timing(confettiY, { toValue: -10, duration: 1500, useNativeDriver: true }),
        ])
      ),
    ]).start();
  }, []);

  return (
    <View style={styles.container}>
      {/* Confetti particles */}
      {['#FF5500', '#FFD700', '#22C55E', '#7B2FBE', '#FF5500', '#FFD700'].map((color, i) => (
        <Animated.View
          key={i}
          style={[
            styles.confetti,
            {
              backgroundColor: color,
              left: `${15 + i * 14}%`,
              top: `${10 + (i % 3) * 8}%`,
              transform: [
                { translateY: confettiY },
                { rotate: `${i * 60}deg` },
              ],
              opacity,
            },
          ]}
        />
      ))}

      <Animated.View style={[styles.content, { opacity, transform: [{ scale }] }]}>
        {/* Trophy icon */}
        <View style={styles.heroCircle}>
          <View style={styles.heroInner}>
            <Ionicons name="trophy" size={64} color="#FFD700" />
          </View>
        </View>

        <Text style={styles.congrats}>¡CONSEGUIDO!</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>Has completado el desafío con éxito. ¡Eres una máquina!</Text>

        {/* Rewards earned */}
        <View style={styles.rewardsCard}>
          <Text style={styles.rewardsTitle}>Recompensas obtenidas</Text>
          <View style={styles.rewardsRow}>
            <View style={styles.rewardBox}>
              <Ionicons name="flame" size={28} color={colors.orange} />
              <Text style={styles.rewardValue}>+{rewardPoints.toLocaleString()}</Text>
              <Text style={styles.rewardLabel}>Puntos</Text>
            </View>
            <View style={styles.rewardBox}>
              <Ionicons name="flash" size={28} color={colors.purple} />
              <Text style={[styles.rewardValue, { color: colors.purple }]}>+{rewardXP}</Text>
              <Text style={styles.rewardLabel}>XP</Text>
            </View>
          </View>
        </View>

        {/* Share & close */}
        <TouchableOpacity style={styles.shareBtn} activeOpacity={0.8}>
          <Ionicons name="share-social" size={20} color={colors.orange} />
          <Text style={styles.shareBtnText}>Compartir logro</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={styles.closeBtnText}>Volver a retos</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  confetti: {
    position: 'absolute', width: 12, height: 12, borderRadius: 3,
  },
  content: { alignItems: 'center', width: '100%' },
  heroCircle: {
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255, 215, 0, 0.3)',
    marginBottom: spacing.lg,
  },
  heroInner: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  congrats: {
    fontSize: 32, fontWeight: '900', color: '#FFD700',
    letterSpacing: 3, marginBottom: spacing.xs,
  },
  title: {
    fontSize: 20, fontWeight: '800', color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15, color: colors.textSecondary, textAlign: 'center',
    marginTop: spacing.sm, lineHeight: 22,
  },
  rewardsCard: {
    width: '100%', backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, marginTop: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', gap: spacing.md,
  },
  rewardsTitle: {
    fontSize: 13, fontWeight: '700', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  rewardsRow: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  rewardBox: {
    flex: 1, backgroundColor: colors.bgCardAlt, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  rewardValue: { fontSize: 24, fontWeight: '900', color: colors.orange },
  rewardLabel: { fontSize: 11, color: colors.textSecondary },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingVertical: 14, paddingHorizontal: spacing.lg,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.orange,
  },
  shareBtnText: { fontSize: 15, fontWeight: '700', color: colors.orange },
  closeBtn: {
    marginTop: spacing.md, paddingVertical: 14, paddingHorizontal: spacing.xl,
    borderRadius: radius.full, backgroundColor: colors.orange, width: '100%', alignItems: 'center',
  },
  closeBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
