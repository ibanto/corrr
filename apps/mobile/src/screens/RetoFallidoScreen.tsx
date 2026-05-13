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

interface ObjectiveResult {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  current: number;
  target: number;
}

interface Props {
  title: string;
  objectives: ObjectiveResult[];
  onRetry: () => void;
  onClose: () => void;
}

export default function RetoFallidoScreen({ title, objectives, onRetry, onClose }: Props) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(shake, { toValue: 10, duration: 80, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -10, duration: 80, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 6, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -6, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, { opacity, transform: [{ scale }, { translateX: shake }] }]}>
        {/* Icon */}
        <View style={styles.heroCircle}>
          <View style={styles.heroInner}>
            <Ionicons name="time" size={64} color={colors.danger} />
          </View>
        </View>

        <Text style={styles.failTitle}>TIEMPO AGOTADO</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>No has conseguido completar todos los objetivos a tiempo. ¡Pero no te rindas!</Text>

        {/* Objectives summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Resumen</Text>
          {objectives.map((obj, i) => {
            const completed = obj.current >= obj.target;
            return (
              <View key={i} style={styles.objectiveRow}>
                <View style={[styles.statusDot, completed && styles.statusDotDone]}>
                  <Ionicons
                    name={completed ? 'checkmark' : 'close'}
                    size={14}
                    color={completed ? colors.success : colors.danger}
                  />
                </View>
                <View style={styles.objIconWrap}>
                  <Ionicons name={obj.icon} size={18} color={completed ? colors.success : colors.textSecondary} />
                </View>
                <Text style={[styles.objLabel, completed && styles.objLabelDone]}>{obj.label}</Text>
                <Text style={[styles.objCount, completed && styles.objCountDone]}>
                  {obj.current}/{obj.target}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Motivational message */}
        <View style={styles.motivationCard}>
          <Ionicons name="bulb-outline" size={20} color={colors.warning} />
          <Text style={styles.motivationText}>
            Cada intento te acerca más. ¡Vuelve a intentarlo y demuestra de qué estás hecho!
          </Text>
        </View>

        {/* Buttons */}
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.8}>
          <Ionicons name="refresh" size={20} color="#fff" />
          <Text style={styles.retryBtnText}>Intentar de nuevo</Text>
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
  content: { alignItems: 'center', width: '100%' },
  heroCircle: {
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(239, 68, 68, 0.3)',
    marginBottom: spacing.lg,
  },
  heroInner: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  failTitle: {
    fontSize: 28, fontWeight: '900', color: colors.danger,
    letterSpacing: 2, marginBottom: spacing.xs,
  },
  title: {
    fontSize: 18, fontWeight: '800', color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center',
    marginTop: spacing.sm, lineHeight: 21,
  },
  summaryCard: {
    width: '100%', backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, marginTop: spacing.lg,
    borderWidth: 1, borderColor: colors.border, gap: spacing.sm,
  },
  summaryTitle: {
    fontSize: 13, fontWeight: '700', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs,
  },
  objectiveRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  statusDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  statusDotDone: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  objIconWrap: {
    width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.bgCardAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  objLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  objLabelDone: { color: colors.success },
  objCount: { fontSize: 12, fontWeight: '700', color: colors.danger, minWidth: 40, textAlign: 'right' },
  objCountDone: { color: colors.success },
  motivationCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.md,
    borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  motivationText: { flex: 1, fontSize: 13, color: colors.warning, lineHeight: 19 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingVertical: 16,
    borderRadius: radius.full, backgroundColor: colors.orange, width: '100%',
  },
  retryBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  closeBtn: {
    marginTop: spacing.sm, paddingVertical: 14, paddingHorizontal: spacing.xl,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, width: '100%', alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
});
