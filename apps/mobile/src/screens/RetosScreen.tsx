import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, Challenge } from '../services/api';
import RetoDetalleScreen from './RetoDetalleScreen';
import RetoCompletadoScreen from './RetoCompletadoScreen';
import RetoFallidoScreen from './RetoFallidoScreen';
import type { RetoDetalle } from './RetoDetalleScreen';

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

const WELCOME_CHALLENGE: RetoDetalle = {
  id: 'welcome',
  title: '¡Bienvenido a CORRR!',
  description: 'Demuestra de qué estás hecho en tu primera semana. Corre, conquista y roba para ganar tu primera gran recompensa.',
  timeLimit: '7 días',
  objectives: [
    { label: 'Recorre 100 km', icon: 'navigate-outline', current: 0, target: 100 },
    { label: 'Consigue 10 territorios', icon: 'flag-outline', current: 0, target: 10 },
    { label: 'Roba 5 territorios', icon: 'hand-left-outline', current: 0, target: 5 },
  ],
  rewardPoints: 1000,
  rewardXP: 150,
  heroImage: require('../../assets/onboarding/welcome-challenge.png'),
};

const XP_PACKS = [
  { id: 'xp_50',  xp: 50,   price: '0,50 €',  popular: false },
  { id: 'xp_150', xp: 150,  price: '1,49 €',  popular: true },
  { id: 'xp_500', xp: 500,  price: '3,99 €',  popular: false },
  { id: 'xp_1200', xp: 1200, price: '5,99 €', popular: false },
];

export default function RetosScreen() {
  const [filter, setFilter] = useState<Filter>('Todos');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReto, setSelectedReto] = useState<RetoDetalle | null>(null);
  const [welcomeAccepted, setWelcomeAccepted] = useState(false);
  const [resultScreen, setResultScreen] = useState<{ type: 'completed' | 'failed'; reto: RetoDetalle } | null>(null);
  const [userXP, setUserXP] = useState(0);

  const loadXP = useCallback(async () => {
    try {
      const data = await api.getMyStats();
      if (data?.stats?.total_points) {
        setUserXP(Math.floor(data.stats.total_points / 100));
      }
    } catch {}
  }, []);

  useEffect(() => {
    api.getChallenges().then(data => { setChallenges(data); setLoading(false); });
    loadXP();
  }, [loadXP]);

  const filtered = challenges.filter(c => filterMap[filter].includes(c.type));

  // Convierte un Challenge genérico a RetoDetalle para la pantalla de detalle
  const challengeToReto = (c: Challenge): RetoDetalle => ({
    id: c.id,
    title: c.title,
    description: c.description,
    timeLimit: c.type === 'distance' || c.type === 'streak' ? '30 días' : 'Sin límite',
    objectives: [
      { label: c.description, icon: (challengeIcons[c.icon] ?? 'star-outline') as keyof typeof Ionicons.glyphMap, current: c.progress, target: c.total },
    ],
    rewardPoints: c.reward,
    rewardXP: Math.round(c.reward * 0.15),
  });

  // Pantalla de reto completado (genérica para cualquier reto)
  if (resultScreen?.type === 'completed') {
    return (
      <RetoCompletadoScreen
        title={resultScreen.reto.title}
        rewardPoints={resultScreen.reto.rewardPoints}
        rewardXP={resultScreen.reto.rewardXP}
        onClose={() => setResultScreen(null)}
      />
    );
  }

  // Pantalla de reto fallido (genérica para cualquier reto)
  if (resultScreen?.type === 'failed') {
    return (
      <RetoFallidoScreen
        title={resultScreen.reto.title}
        objectives={resultScreen.reto.objectives}
        onRetry={() => {
          const reto = resultScreen.reto;
          setResultScreen(null);
          setSelectedReto({ ...reto, accepted: false });
        }}
        onClose={() => setResultScreen(null)}
      />
    );
  }

  // Si hay un reto seleccionado, mostramos la pantalla de detalle
  if (selectedReto) {
    return (
      <RetoDetalleScreen
        reto={selectedReto}
        onBack={() => setSelectedReto(null)}
        onAccept={(id) => {
          if (id === 'welcome') setWelcomeAccepted(true);
          setSelectedReto(null);
        }}
        onSimulateComplete={() => {
          const reto = selectedReto;
          setSelectedReto(null);
          setResultScreen({ type: 'completed', reto });
        }}
        onSimulateFail={() => {
          const reto = selectedReto;
          setSelectedReto(null);
          setResultScreen({ type: 'failed', reto });
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Retos</Text>
        <View style={styles.pointsBadge}>
          <Ionicons name="star" size={14} color="#FFD700" />
          <Text style={styles.pointsValue}>{userXP} XP</Text>
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
          {/* Welcome challenge - top */}
          <TouchableOpacity
            style={styles.welcomeCard}
            activeOpacity={0.8}
            onPress={() => setSelectedReto({ ...WELCOME_CHALLENGE, accepted: welcomeAccepted })}
          >
            <View style={styles.welcomeHeader}>
              <View style={styles.welcomeIconWrap}>
                <Ionicons name="rocket" size={24} color={colors.orange} />
              </View>
              <View style={styles.welcomeBadge}>
                <Ionicons name="time-outline" size={12} color={colors.orange} />
                <Text style={styles.welcomeBadgeText}>7 días</Text>
              </View>
            </View>
            <Text style={styles.welcomeTitle}>¡Bienvenido a CORRR!</Text>
            <Text style={styles.welcomeDesc}>Recorre 100 km, conquista 10 territorios y roba 5. ¡Demuestra de qué estás hecho!</Text>
            <View style={styles.welcomeRewards}>
              <View style={styles.welcomeRewardItem}>
                <Ionicons name="flame" size={14} color={colors.orange} />
                <Text style={styles.welcomeRewardText}>1.000 pts</Text>
              </View>
              <View style={styles.welcomeRewardItem}>
                <Ionicons name="flash" size={14} color={colors.purple} />
                <Text style={[styles.welcomeRewardText, { color: colors.purple }]}>150 XP</Text>
              </View>
            </View>
            <View style={styles.welcomeBtn}>
              <Text style={styles.welcomeBtnText}>
                {welcomeAccepted ? '✓ Desafío aceptado' : 'Ver desafío →'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Challenge cards */}
          {filtered.map(challenge => {
            const pct = Math.min(100, (challenge.progress / challenge.total) * 100);
            const iconName = challengeIcons[challenge.icon] ?? 'star-outline';
            return (
              <TouchableOpacity
                key={challenge.id}
                style={styles.card}
                activeOpacity={0.8}
                onPress={() => setSelectedReto(challengeToReto(challenge))}
              >
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
              </TouchableOpacity>
            );
          })}

          {/* Premium card - bottom */}
          <View style={styles.premiumCard}>
            <View style={styles.premiumHeader}>
              <Ionicons name="ribbon" size={18} color={colors.orange} />
              <Text style={styles.premiumTitle}>Desafío premium</Text>
            </View>
            <Text style={styles.premiumName}>Conquistador infinito</Text>
            <Text style={styles.premiumDesc}>Captura 20 zonas en 30 días.</Text>
            <View style={[styles.premiumBtn, { opacity: 0.5 }]}>
              <Ionicons name="ribbon" size={16} color="#fff" />
              <Text style={styles.premiumBtnText}>Próximamente</Text>
            </View>
          </View>

          {/* Sección Tienda XP */}
          <View style={styles.shopSection}>
            <View style={styles.shopHeader}>
              <Ionicons name="star" size={20} color="#FFD700" />
              <Text style={styles.shopTitle}>TIENDA XP</Text>
            </View>
            <Text style={styles.shopBalance}>Tu saldo: ⭐ {userXP} XP</Text>

            {/* Cómo ganar XP */}
            <View style={styles.earnCard}>
              <Text style={styles.earnTitle}>GANA XP CORRIENDO</Text>
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

            {/* Qué hacer con XP */}
            <View style={styles.earnCard}>
              <Text style={styles.earnTitle}>GASTA XP EN POWER-UPS</Text>
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
                  <Ionicons name="star" size={24} color="#FFD700" />
                  <Text style={styles.packXP}>{pack.xp}</Text>
                  <Text style={styles.packXPLabel}>XP</Text>
                  <Text style={styles.packPrice}>{pack.price}</Text>
                </TouchableOpacity>
              ))}
            </View>
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
  // Welcome challenge
  welcomeCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1.5, borderColor: colors.orange, gap: spacing.sm,
  },
  welcomeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  welcomeIconWrap: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.orangeGlow,
    alignItems: 'center', justifyContent: 'center',
  },
  welcomeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.bgCardAlt, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  welcomeBadgeText: { fontSize: 11, fontWeight: '700', color: colors.orange },
  welcomeTitle: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
  welcomeDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  welcomeRewards: { flexDirection: 'row', gap: spacing.md },
  welcomeRewardItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  welcomeRewardText: { fontSize: 13, fontWeight: '700', color: colors.orange },
  welcomeBtn: {
    backgroundColor: colors.orange, paddingVertical: 12, borderRadius: radius.full,
    alignItems: 'center', marginTop: spacing.xs,
  },
  welcomeBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  // Challenge cards
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
  // Premium card
  premiumCard: {
    backgroundColor: '#1A0F00', borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: `${colors.orange}60`, gap: spacing.sm, marginTop: spacing.sm,
  },
  premiumHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  premiumTitle: { fontSize: 13, fontWeight: '700', color: colors.orange, textTransform: 'uppercase', letterSpacing: 0.5 },
  premiumName: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  premiumDesc: { fontSize: 13, color: colors.textSecondary },
  premiumBtn: {
    backgroundColor: colors.orange, paddingVertical: 12, borderRadius: radius.full,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.xs,
  },
  premiumBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  // Tienda XP
  shopSection: { marginTop: spacing.lg, gap: spacing.md },
  shopHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shopTitle: { fontSize: 22, fontWeight: '900', color: '#FFD700', letterSpacing: 2 },
  shopBalance: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  earnCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.sm,
  },
  earnTitle: {
    fontSize: 13, fontWeight: '800', color: colors.textPrimary,
    letterSpacing: 1, marginBottom: 4,
  },
  earnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  earnText: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  earnHint: {
    fontSize: 11, color: colors.textMuted, fontStyle: 'italic',
    textAlign: 'center', marginTop: 4,
  },
  shopSubtitle: {
    fontSize: 13, fontWeight: '800', color: colors.textPrimary,
    letterSpacing: 1,
  },
  packsGrid: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  packCard: {
    flex: 1, minWidth: '45%', backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center', gap: 4,
  },
  packCardPopular: { borderColor: '#FFD700', borderWidth: 2 },
  packPopularBadge: {
    position: 'absolute', top: -10,
    backgroundColor: '#FFD700', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: radius.full,
  },
  packPopularText: { fontSize: 9, fontWeight: '800', color: '#000', letterSpacing: 1 },
  packXP: { fontSize: 28, fontWeight: '900', color: colors.textPrimary },
  packXPLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginTop: -4 },
  packPrice: { fontSize: 15, fontWeight: '800', color: colors.orange, marginTop: 4 },
});
