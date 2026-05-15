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
  Image,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { colors, spacing, radius } from '../theme';
import { api, MyStats, RunRecord } from '../services/api';
import ZonePopup, { PopupType } from '../components/ZonePopup';
import TauntSelector, { TauntMode } from '../components/TauntSelector';

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
  const displayName = user?.username ?? 'Runner';
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profileCity, setProfileCity] = useState(user?.city ?? '');
  const [profileName, setProfileName] = useState(displayName);
  const [editModal, setEditModal] = useState(false);
  const [editName, setEditName] = useState(displayName);
  const [editCity, setEditCity] = useState(user?.city ?? '');
  const [testPopup, setTestPopup] = useState<PopupType | null>(null);
  const [showTaunts, setShowTaunts] = useState<TauntMode | null>(null);

  const detectCity = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getLastKnownPositionAsync() ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!loc) return;
      const results = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      if (results.length > 0) {
        const city = results[0].city || results[0].region || '';
        if (city) {
          setProfileCity(city);
          setEditCity(city);
          // Guardar en backend para que el ranking y otros sitios lo usen
          try { await api.updateProfile({ city }); } catch {}
        }
      }
    } catch {}
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const [data, profile] = await Promise.all([api.getMyStats(), api.getProfile()]);
      setStats(data);
      if (profile.avatar_url) setAvatarUrl(profile.avatar_url);
      if (profile.display_name) setProfileName(profile.display_name);
      if (profile.city) {
        setProfileCity(profile.city);
      } else {
        // Si no tiene ciudad en el backend, detectar por GPS
        detectCity();
      }
    } catch {
      // silencioso
    }
  }, [detectCity]);

  useEffect(() => {
    loadStats();
    // Siempre intentar actualizar la ciudad por GPS
    detectCity();
  }, [loadStats, detectCity]);

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      const dataUri = `data:image/jpeg;base64,${result.assets[0].base64}`;
      setAvatarUrl(dataUri);
      try { await api.updateProfile({ avatarUrl: dataUri }); } catch {}
    }
  };

  const saveProfile = async () => {
    try {
      await api.updateProfile({ displayName: editName, city: editCity });
      setProfileName(editName);
      setProfileCity(editCity);
      setEditModal(false);
    } catch {
      Alert.alert('Error', 'No se pudo guardar el perfil');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Eliminar cuenta',
      '¿Estás seguro? Se borrarán todas tus zonas, carreras y estadísticas. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirmación final',
              'Escribe ELIMINAR mentalmente y pulsa OK para borrar tu cuenta permanentemente.',
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'OK, eliminar',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await api.deleteAccount();
                      Alert.alert('Cuenta eliminada', 'Tu cuenta ha sido eliminada correctamente.');
                      onLogout();
                    } catch {
                      Alert.alert('Error', 'No se pudo eliminar la cuenta. Inténtalo de nuevo.');
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
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
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.avatarContainer} onPress={pickAvatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{profileName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.avatarEditBadge}>
            <Ionicons name="camera" size={12} color="#fff" />
          </View>
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>{Math.floor((s?.total_zones ?? 0) / 5) + 1}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.userInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.username}>{profileName}</Text>
            <Ionicons name="checkmark-circle" size={16} color={colors.orange} />
          </View>
          {profileCity ? (
            <View style={styles.locationRow}>
              <Ionicons name="location" size={12} color={colors.textSecondary} />
              <Text style={styles.location}>{profileCity}</Text>
            </View>
          ) : null}
          <View style={styles.xpRow}>
            <Ionicons name="star" size={14} color="#FFD700" />
            <Text style={styles.xpText}>{Math.floor((s?.total_points ?? 0) / 100)} XP</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => { setEditName(profileName); setEditCity(profileCity); setEditModal(true); }}>
          <Ionicons name="create-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        {[
          { value: String(s?.total_zones ?? 0), label: 'Zonas', icon: 'flag' as const },
          { value: formatKm(s?.total_km ?? 0), label: 'km totales', icon: 'navigate' as const },
          { value: String(s?.total_runs ?? 0), label: 'Carreras', icon: 'walk' as const },
          { value: String(s?.total_points ?? 0), label: 'Puntos', icon: 'flame' as const },
        ].map((item, i) => (
          <View key={i} style={styles.statItem}>
            <Ionicons name={item.icon} size={16} color={colors.orange} />
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
            { img: require('../../assets/logros/conquistador.png'), label: 'Conquistador', sub: '10 zonas' },
            { img: require('../../assets/logros/imparable.png'), label: 'Imparable', sub: '10 rachas' },
            { img: require('../../assets/logros/explorador.png'), label: 'Explorador', sub: '100 km' },
            { img: require('../../assets/logros/leyenda.png'), label: 'Leyenda', sub: 'Top 5%' },
          ].map((a, i) => (
            <View key={i} style={styles.achievement}>
              <View style={styles.achievementIcon}>
                <Image source={a.img} style={{ width: 48, height: 48 }} resizeMode="contain" />
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
        <View style={[styles.premiumBtn, { opacity: 0.5 }]}>
          <Ionicons name="ribbon" size={16} color="#fff" />
          <Text style={styles.premiumBtnText}>Próximamente</Text>
        </View>
      </View>

      {/* DEV: test popups de zona */}
      <View style={[styles.section, { gap: spacing.xs }]}>
        <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>🧪 TEST POPUPS</Text>
        <TouchableOpacity style={{ backgroundColor: '#22C55E', paddingVertical: 10, borderRadius: radius.full, alignItems: 'center' }} onPress={() => setTestPopup('conquered')}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Zona conquistada</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ backgroundColor: colors.orange, paddingVertical: 10, borderRadius: radius.full, alignItems: 'center' }} onPress={() => setTestPopup('stolen_by_you')}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Zona robada</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ backgroundColor: '#FB0E01', paddingVertical: 10, borderRadius: radius.full, alignItems: 'center' }} onPress={() => setTestPopup('stolen_from_you')}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Te han robado</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ backgroundColor: '#9333EA', paddingVertical: 10, borderRadius: radius.full, alignItems: 'center' }} onPress={() => setShowTaunts('taunt')}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Taunts (cuando te roban)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ backgroundColor: '#2563EB', paddingVertical: 10, borderRadius: radius.full, alignItems: 'center' }} onPress={() => setShowTaunts('response')}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Respuestas (cuando robas)</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        {[
          { icon: 'trash-outline' as const, label: 'Eliminar cuenta', onPress: handleDeleteAccount },
          { icon: 'notifications-outline' as const, label: 'Notificaciones', onPress: () => {
            if (Platform.OS === 'ios') {
              Linking.openURL('app-settings:');
            } else {
              Linking.openSettings();
            }
          }},
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

    {/* Modal editar perfil */}
    <Modal visible={editModal} animationType="slide" transparent>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Editar perfil</Text>
          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>NOMBRE</Text>
            <TextInput
              style={styles.modalInput}
              value={editName}
              onChangeText={setEditName}
              placeholderTextColor={colors.textMuted}
              placeholder="Tu nombre"
            />
          </View>
          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>CIUDAD</Text>
            <TextInput
              style={styles.modalInput}
              value={editCity}
              onChangeText={setEditCity}
              placeholderTextColor={colors.textMuted}
              placeholder="Tu ciudad"
              autoCapitalize="words"
            />
          </View>
          <TouchableOpacity style={styles.modalSaveBtn} onPress={saveProfile}>
            <Text style={styles.modalSaveBtnText}>Guardar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setEditModal(false)}>
            <Text style={styles.modalCancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    {/* Test popup de zona */}
    {testPopup && (
      <ZonePopup
        visible={true}
        type={testPopup}
        onClose={() => setTestPopup(null)}
        onRespond={() => setShowTaunts('taunt')}
      />
    )}

    {/* Selector de taunts */}
    <TauntSelector
      visible={showTaunts !== null}
      mode={showTaunts ?? 'taunt'}
      rivalName="TestRival"
      onSend={(messageId, mode) => {
        console.log(`[Taunt] Enviado ${mode} #${messageId}`);
        setShowTaunts(null);
      }}
      onClose={() => setShowTaunts(null)}
    />
    </>
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
  avatarEditBadge: {
    position: 'absolute', bottom: -2, left: -2, width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.textSecondary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
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
  xpRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  xpText: { fontSize: 13, fontWeight: '700', color: '#FFD700' },
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
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, gap: spacing.md,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  modalField: { gap: spacing.xs },
  modalLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, letterSpacing: 0.5 },
  modalInput: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 14,
    color: colors.textPrimary, fontSize: 16,
  },
  modalSaveBtn: {
    backgroundColor: colors.orange, paddingVertical: 16, borderRadius: radius.full,
    alignItems: 'center', marginTop: spacing.sm,
  },
  modalSaveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  modalCancelBtn: { alignItems: 'center', paddingVertical: 8 },
  modalCancelText: { color: colors.textSecondary, fontSize: 15 },
});
