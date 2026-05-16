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
  Image,
  ImageSourcePropType,
} from 'react-native';

const { width } = Dimensions.get('window');
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, Challenge } from '../services/api';
import RetoDetalleScreen from './RetoDetalleScreen';
import RetoCompletadoScreen from './RetoCompletadoScreen';
import RetoFallidoScreen from './RetoFallidoScreen';
import type { RetoDetalle } from './RetoDetalleScreen';

type Filter = 'Semanales' | 'Especiales' | 'Mensuales' | 'Tienda';

const filterMap: Record<Filter, string[]> = {
  Semanales: ['shape', 'distance', 'streak', 'steal'],
  Especiales: ['steal', 'shape'],
  Mensuales: ['distance', 'streak'],
  Tienda: [],
};

const challengeIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  '⭕': 'ellipse-outline',
  '⭐': 'star-outline',
  '∞': 'infinite-outline',
  '💯': 'fitness-outline',
  '🎭': 'glasses-outline',
};

// Iconos por categoría de reto (imágenes custom)
const categoryImages: Record<string, ImageSourcePropType | null> = {
  semanales: require('../../assets/retos/icono-retosemanal.png'),
  especiales: require('../../assets/retos/icono-retoespecial.png'),
  mensuales: require('../../assets/retos/icono-retosmensuales.png'),
};

// Mapeo de filtro a categoría para obtener la imagen correcta
const filterToCategory: Record<Filter, string> = {
  Semanales: 'semanales',
  Especiales: 'especiales',
  Mensuales: 'mensuales',
  Tienda: 'semanales',
};

const WELCOME_CHALLENGE: RetoDetalle = {
  id: 'welcome',
  title: '¡Bienvenido a CORRR!',
  description: 'Demuestra de qué estás hecho en tu primera semana. Corre, conquista y roba para ganar tu primera gran recompensa.',
  timeLimit: '7 días',
  objectives: [
    { label: 'Recorre 20 km', icon: 'navigate-outline', current: 0, target: 20 },
    { label: 'Consigue 10 territorios', icon: 'flag-outline', current: 0, target: 10 },
    { label: 'Roba 5 territorios', icon: 'hand-left-outline', current: 0, target: 5 },
  ],
  rewardPoints: 500,
  rewardXP: 50,
  penalty: 200,
  heroImage: require('../../assets/onboarding/welcome-challenge.png'),
};

const BATALLA_ALBA: RetoDetalle = {
  id: 'batalla_alba',
  title: '¡Batalla al alba!',
  description: 'Haz una carrera de mínimo 5 km y roba alguna zona entre las 20:00 y la salida del sol. ¿Te atreves?',
  timeLimit: '1 día (20:00 → amanecer)',
  objectives: [
    { label: 'Corre mínimo 5 km', icon: 'navigate-outline', current: 0, target: 5 },
    { label: 'Roba al menos 1 zona', icon: 'hand-left-outline', current: 0, target: 1 },
  ],
  rewardPoints: 500,
  rewardXP: 50,
  penalty: 250,
  activatesAtHour: 20,
  heroImage: require('../../assets/retos/batalla-alba.png'),
};

// Calcula días restantes del mes actual
const getDaysLeftInMonth = () => {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
};

const ROBA_Y_ROBA: RetoDetalle = {
  id: 'roba_y_roba',
  title: '¡Roba y roba!',
  description: 'Roba 5 zonas a 10 personas distintas. ¿Eres el más pesado o eres una leyenda?',
  timeLimit: '30 días',
  daysLeft: getDaysLeftInMonth(),
  penalty: 500,
  objectives: [
    { label: 'Roba 5 zonas a 10 personas distintas', icon: 'hand-left-outline', current: 0, target: 50 },
  ],
  rewardPoints: 2500,
  rewardXP: 150,
  heroImage: require('../../assets/retos/roba-y-roba.png'),
};

const XP_PACKS = [
  { id: 'xp_50',  xp: 50,   price: '0,50 €',  popular: false },
  { id: 'xp_150', xp: 150,  price: '1,49 €',  popular: true },
  { id: 'xp_500', xp: 500,  price: '3,99 €',  popular: false },
  { id: 'xp_1200', xp: 1200, price: '5,99 €', popular: false },
];

export default function RetosScreen() {
  const [filter, setFilter] = useState<Filter>('Semanales');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReto, setSelectedReto] = useState<RetoDetalle | null>(null);
  const [welcomeAccepted, setWelcomeAccepted] = useState(false);
  const [batallaAccepted, setBatallaAccepted] = useState(false);
  const [robaAccepted, setRobaAccepted] = useState(false);
  const [resultScreen, setResultScreen] = useState<{ type: 'completed' | 'failed'; reto: RetoDetalle } | null>(null);
  const [userXP, setUserXP] = useState(0);
  const [earnOpen, setEarnOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);

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
          if (id === 'batalla_alba') setBatallaAccepted(true);
          if (id === 'roba_y_roba') setRobaAccepted(true);
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
          <Text style={styles.balanceLabel}>Tu saldo</Text>
          <Ionicons name="star" size={14} color="#FFD700" />
          <Text style={styles.pointsValue}>{userXP} XP</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {(['Semanales', 'Especiales', 'Mensuales', 'Tienda'] as Filter[]).map(f => (
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
          {/* Grid 2 columnas — oculto en Tienda */}
          {filter !== 'Tienda' && (
          <View style={styles.grid}>
            {/* Bienvenido + Premium solo en Todos */}
            {filter === 'Semanales' && (
              <>
                <TouchableOpacity
                  style={[styles.gridCard, styles.gridCardHighlight]}
                  activeOpacity={0.8}
                  onPress={() => setSelectedReto({ ...WELCOME_CHALLENGE, accepted: welcomeAccepted })}
                >
                  <View style={styles.gridCardIcon}>
                    {categoryImages.semanales ? (
                      <Image source={categoryImages.semanales} style={styles.gridCardIconImage} />
                    ) : (
                      <Ionicons name="rocket" size={24} color={colors.orange} />
                    )}
                  </View>
                  <View style={styles.gridCardBody}>
                    <Text style={styles.gridCardTitle} numberOfLines={2}>¡Bienvenido a CORRR!</Text>
                    <Text style={styles.gridCardDesc} numberOfLines={2}>20 km, 10 territorios y roba 5</Text>
                  </View>
                  <View style={styles.gridCardBottom}>
                    <View style={styles.gridRewardRow}>
                      <Ionicons name="flame" size={12} color={colors.orange} />
                      <Text style={styles.gridRewardValue}>500 pts</Text>
                      <Ionicons name="flash" size={12} color={colors.purple} style={{ marginLeft: 6 }} />
                      <Text style={[styles.gridRewardValue, { color: colors.purple }]}>50 XP</Text>
                    </View>
                    <View style={styles.gridBadge}>
                      <Ionicons name="time-outline" size={10} color={colors.orange} />
                      <Text style={styles.gridBadgeText}>7 días</Text>
                    </View>
                  </View>
                </TouchableOpacity>

                <View style={[styles.gridCard, styles.gridCardPremium]}>
                  <View style={[styles.gridCardIcon, { backgroundColor: 'rgba(255,85,0,0.25)' }]}>
                    {categoryImages.semanales ? (
                      <Image source={categoryImages.semanales} style={[styles.gridCardIconImage, { opacity: 0.6 }]} />
                    ) : (
                      <Ionicons name="ribbon" size={24} color={colors.orange} />
                    )}
                  </View>
                  <View style={styles.gridCardBody}>
                    <Text style={styles.gridCardTitle} numberOfLines={2}>Conquistador infinito</Text>
                    <Text style={styles.gridCardDesc} numberOfLines={2}>Captura 20 zonas en 30 días</Text>
                  </View>
                  <View style={styles.gridCardBottom}>
                    <View style={styles.gridPremiumTag}>
                      <Ionicons name="lock-closed" size={10} color={colors.textSecondary} />
                      <Text style={styles.gridPremiumText}>Próximamente</Text>
                    </View>
                  </View>
                </View>
              </>
            )}

            {/* Especiales: Batalla al alba */}
            {filter === 'Especiales' && (
              <TouchableOpacity
                style={[styles.gridCard, styles.gridCardHighlight]}
                activeOpacity={0.8}
                onPress={() => setSelectedReto({ ...BATALLA_ALBA, accepted: batallaAccepted })}
              >
                <View style={styles.gridCardIcon}>
                  {categoryImages.especiales ? (
                    <Image source={categoryImages.especiales} style={styles.gridCardIconImage} />
                  ) : (
                    <Ionicons name="flash" size={24} color={colors.orange} />
                  )}
                </View>
                <View style={styles.gridCardBody}>
                  <Text style={styles.gridCardTitle} numberOfLines={2}>¡Batalla al alba!</Text>
                  <Text style={styles.gridCardDesc} numberOfLines={2}>5 km + roba una zona</Text>
                </View>
                <View style={styles.gridCardBottom}>
                  <View style={styles.gridRewardRow}>
                    <Ionicons name="flame" size={12} color={colors.orange} />
                    <Text style={styles.gridRewardValue}>500 pts</Text>
                    <Ionicons name="flash" size={12} color={colors.purple} style={{ marginLeft: 6 }} />
                    <Text style={[styles.gridRewardValue, { color: colors.purple }]}>50 XP</Text>
                  </View>
                  <View style={styles.gridBadge}>
                    <Ionicons name="time-outline" size={10} color={colors.orange} />
                    <Text style={styles.gridBadgeText}>1 día</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            {/* Mensuales: ¡Roba y roba! */}
            {filter === 'Mensuales' && (
              <TouchableOpacity
                style={[styles.gridCard, styles.gridCardHighlight]}
                activeOpacity={0.8}
                onPress={() => setSelectedReto({ ...ROBA_Y_ROBA, accepted: robaAccepted })}
              >
                <View style={styles.gridCardIcon}>
                  {categoryImages.mensuales ? (
                    <Image source={categoryImages.mensuales} style={styles.gridCardIconImage} />
                  ) : (
                    <Ionicons name="hand-left" size={24} color={colors.orange} />
                  )}
                </View>
                <View style={styles.gridCardBody}>
                  <Text style={styles.gridCardTitle} numberOfLines={2}>¡Roba y roba!</Text>
                  <Text style={styles.gridCardDesc} numberOfLines={2}>Roba a 10 personas 10 veces</Text>
                </View>
                <View style={styles.gridCardBottom}>
                  <View style={styles.gridRewardRow}>
                    <Ionicons name="flame" size={12} color={colors.orange} />
                    <Text style={styles.gridRewardValue}>2.500 pts</Text>
                    <Ionicons name="flash" size={12} color={colors.purple} style={{ marginLeft: 6 }} />
                    <Text style={[styles.gridRewardValue, { color: colors.purple }]}>150 XP</Text>
                  </View>
                  <View style={styles.gridBadge}>
                    <Ionicons name="time-outline" size={10} color={colors.orange} />
                    <Text style={styles.gridBadgeText}>30 días</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            {/* Retos dinámicos filtrados */}
            {filtered.map(challenge => {
              const pct = Math.min(100, (challenge.progress / challenge.total) * 100);
              const catKey = (challenge as any).category || filterToCategory[filter];
              const catImage = categoryImages[catKey];
              return (
                <TouchableOpacity
                  key={challenge.id}
                  style={styles.gridCard}
                  activeOpacity={0.8}
                  onPress={() => setSelectedReto(challengeToReto(challenge))}
                >
                  <View style={styles.gridCardIcon}>
                    {catImage ? (
                      <Image source={catImage} style={styles.gridCardIconImage} />
                    ) : (
                      <Ionicons name={challengeIcons[challenge.icon] ?? 'star-outline'} size={24} color={colors.orange} />
                    )}
                  </View>
                  <View style={styles.gridCardBody}>
                    <Text style={styles.gridCardTitle} numberOfLines={2}>{challenge.title}</Text>
                    <Text style={styles.gridCardDesc} numberOfLines={2}>{challenge.description}</Text>
                  </View>
                  <View style={styles.gridCardBottom}>
                    <View style={styles.gridProgressRow}>
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${pct}%` }]} />
                      </View>
                      <Text style={styles.gridProgressText}>{challenge.progress}/{challenge.total}</Text>
                    </View>
                    <View style={styles.gridRewardRow}>
                      <Ionicons name="flame" size={12} color={colors.orange} />
                      <Text style={styles.gridRewardValue}>{challenge.reward} pts</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Próximamente — siempre al final del grid */}
            <View style={[styles.gridCard, styles.gridCardSoon]}>
              <View style={[styles.gridCardIcon, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
                <Ionicons name="lock-closed" size={24} color={colors.textMuted} />
              </View>
              <View style={styles.gridCardBody}>
                <Text style={[styles.gridCardTitle, { color: colors.textMuted }]}>Próximamente</Text>
                <Text style={styles.gridCardDesc}>Nuevos retos cada semana</Text>
              </View>
              <View style={styles.gridCardBottom} />
            </View>
            <View style={[styles.gridCard, styles.gridCardSoon]}>
              <View style={[styles.gridCardIcon, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
                <Ionicons name="help-outline" size={24} color={colors.textMuted} />
              </View>
              <View style={styles.gridCardBody}>
                <Text style={[styles.gridCardTitle, { color: colors.textMuted }]}>Próximamente</Text>
                <Text style={styles.gridCardDesc}>Sigue corriendo...</Text>
              </View>
              <View style={styles.gridCardBottom} />
            </View>
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
  // Challenge grid
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
  },
  gridCard: {
    width: (width - spacing.md * 2 - spacing.sm) / 2,
    aspectRatio: 1,
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'space-between',
  },
  gridCardIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.orangeGlow,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  gridCardIconImage: {
    width: 44, height: 44, resizeMode: 'cover',
  },
  gridCardBody: { flex: 1, justifyContent: 'center', gap: 4 },
  gridCardTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  gridCardDesc: { fontSize: 11, color: colors.textSecondary, lineHeight: 15 },
  gridCardBottom: { gap: 6 },
  gridProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gridProgressText: { fontSize: 10, color: colors.textSecondary },
  gridRewardRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gridRewardValue: { fontSize: 13, fontWeight: '800', color: colors.orange },
  gridCardHighlight: { borderColor: colors.orange, borderWidth: 1.5 },
  gridCardPremium: { borderColor: `${colors.orange}60`, backgroundColor: '#1A0F00', opacity: 0.7 },
  gridBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    alignSelf: 'flex-start', backgroundColor: colors.bgCardAlt,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  gridBadgeText: { fontSize: 9, fontWeight: '700', color: colors.orange },
  gridPremiumTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', backgroundColor: colors.bgCardAlt,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full,
  },
  gridPremiumText: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  gridCardSoon: { borderStyle: 'dashed', borderColor: colors.textMuted, opacity: 0.5 },
  progressBar: { flex: 1, height: 4, backgroundColor: colors.bgCardAlt, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.orange, borderRadius: 2 },
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
