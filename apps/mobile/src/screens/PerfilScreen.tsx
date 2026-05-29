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
import { api, MyStats, RunRecord, Achievement, ProfileData } from '../services/api';
import EditProfileScreen from './EditProfileScreen';
import { checkForUpdates, CURRENT_VERSION } from '../utils/checkForUpdates';

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

const logroImages: Record<string, any> = {
  distancia: require('../../assets/logros/logro-distancia.png'),
  carreras: require('../../assets/logros/logro-carreras.png'),
  racha: require('../../assets/logros/logro-robos.png'),
  zonas: require('../../assets/logros/logro-zonas.png'),
  robos: require('../../assets/logros/logro-robos.png'),
};

export default function PerfilScreen({ user, onLogout }: Props) {
  const displayName = user?.username ?? 'Runner';
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // True mientras la foto está subiéndose al backend. Bloqueamos la
  // navegación con un overlay para que el usuario no cambie de tab y pierda
  // el state local (PerfilScreen se desmonta al cambiar de tab).
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profileCity, setProfileCity] = useState(user?.city ?? '');
  const [profileName, setProfileName] = useState(displayName);
  const [editModal, setEditModal] = useState(false);
  const [editName, setEditName] = useState(displayName);
  const [editCity, setEditCity] = useState(user?.city ?? '');
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [pointsModalVisible, setPointsModalVisible] = useState(false);
  const [achievementModalVisible, setAchievementModalVisible] = useState(false);
  // Perfil ampliado (form de "Editar perfil" v1.9): cargamos el snapshot completo
  // del backend y se lo pasamos al modal. Tras guardar, refrescamos para que
  // el banner del bonus desaparezca si se ha reclamado.
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const loadProfileData = useCallback(async () => {
    try {
      const data = await api.getProfile();
      setProfileData(data);
    } catch {}
  }, []);
  useEffect(() => { loadProfileData(); }, [loadProfileData]);

  const profileCompletion = (() => {
    if (!profileData) return 0;
    const fields = [
      profileData.first_name, profileData.surname, profileData.war_cry,
      profileData.shoe_brand, profileData.birth_year, profileData.gender,
      profileData.usual_distance, profileData.weekly_frequency,
    ];
    const filled = fields.filter(f => f != null && f !== '').length;
    return Math.round((filled / fields.length) * 100);
  })();

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
      const [data, profile, achs] = await Promise.all([
        api.getMyStats(),
        api.getProfile(),
        api.getAchievements().catch(() => []),
      ]);
      setStats(data);
      setAchievements(achs);
      // Setear siempre (incluso null) para que si el avatar se borra desde
      // backend o desde otro dispositivo, el local se actualice. Antes solo
      // se seteaba si había valor → avatar viejo se quedaba pegado.
      setAvatarUrl(profile.avatar_url ?? null);
      if (profile.display_name) setProfileName(profile.display_name);
      if (profile.city) {
        setProfileCity(profile.city);
      } else {
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

  const handleAvatarResult = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.base64) {
      Alert.alert('Error', 'No se pudo procesar la imagen. Vuelve a intentarlo.');
      return;
    }
    // Construir directamente el dataUri base64 (no usamos asset.uri file://
    // porque ese URI puede invalidarse si el usuario navega o cierra la app
    // antes de que termine la subida → la foto desaparecería).
    const dataUri = `data:image/jpeg;base64,${asset.base64}`;

    // Mostrar la foto inmediatamente como feedback visual ANTES de subir.
    setAvatarUrl(dataUri);

    // Bloquear navegación con overlay de "Subiendo foto..." hasta que el
    // backend confirme. Antes el usuario podía cambiar de tab a mitad de la
    // subida → PerfilScreen se desmontaba → al volver la foto NO aparecía
    // (componente remontado con avatarUrl=null y backend con avatar_url=null
    // porque la subida quedó a medias).
    setUploadingAvatar(true);
    try {
      await api.updateProfile({ avatarUrl: dataUri });
      // Éxito: la foto ya está persistida en backend. avatarUrl ya es el
      // dataUri (lo seteamos arriba) — no hace falta volver a setearlo.
    } catch (e: any) {
      // Si falla, la foto sigue visible localmente pero avisamos para que
      // el usuario sepa que NO está guardada en el servidor (al cerrar y
      // reabrir la app no estará).
      Alert.alert(
        'No se pudo guardar la foto',
        `${e?.message ?? 'Error desconocido'}. La foto se ve aquí pero no se ha guardado. Inténtalo de nuevo con más conexión.`,
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const pickAvatar = () => {
    Alert.alert('Foto de perfil', 'Elige una opción', [
      {
        text: 'Hacer foto',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permiso necesario', 'CORRR necesita acceso a la cámara.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            // No usamos allowsEditing porque en Android cada OEM (MIUI,
            // Samsung, OPPO) abre su propio editor de recorte con UX
            // inconsistente — en MIUI el botón de confirmar ("CORTAR")
            // parece un título de sección y el usuario se queda atrapado.
            // El avatar se renderiza como círculo con resizeMode:'cover',
            // así que el ratio de la foto da igual visualmente.
            quality: 0.3,
            base64: true,
          });
          handleAvatarResult(result);
        },
      },
      {
        text: 'Elegir de galería',
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            // Sin allowsEditing por el mismo motivo que en launchCameraAsync.
            quality: 0.3,
            base64: true,
          });
          handleAvatarResult(result);
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
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
        {/* El antiguo botón "create-outline" para editar name+city quedó
            redundante con la nueva tarjeta "Editar perfil" debajo (que abre
            EditProfileScreen con todos los campos). Eliminado. */}
      </View>

      {/* Tarjeta "Editar perfil" — banner que invita a completar el perfil.
          Va ANTES de las stats por petición del usuario. Si está al 100% se
          muestra como CTA discreto; si falta algo, se enfatiza el bonus. */}
      <TouchableOpacity
        style={[
          styles.editProfileCard,
          profileCompletion < 100 && profileData && !profileData.profile_bonus_claimed && styles.editProfileCardHighlight,
        ]}
        onPress={() => setEditProfileOpen(true)}
      >
        <View style={styles.editProfileLeft}>
          <View style={[styles.editProfileIcon, profileCompletion < 100 && profileData && !profileData.profile_bonus_claimed && { backgroundColor: colors.orange }]}>
            <Ionicons
              name={profileCompletion === 100 ? 'person' : 'person-add'}
              size={20}
              color={profileCompletion < 100 && profileData && !profileData.profile_bonus_claimed ? '#000' : colors.orange}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.editProfileTitle}>
              {profileCompletion === 100 ? 'Editar perfil' : 'Completa tu perfil'}
            </Text>
            <Text style={styles.editProfileSub}>
              {profileData && !profileData.profile_bonus_claimed
                ? `${profileCompletion}% completado · +50 pts al completarlo`
                : profileCompletion === 100
                  ? 'Tu información, grito de guerra, zapatillas y más'
                  : `${profileCompletion}% completado`}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      {/* Stats principales — protagonistas del Perfil ahora que Logros y
          Actividad reciente se han movido a Stats. 2 columnas × 2 filas con
          tarjetas grandes para que se vean de un vistazo. */}
      <View style={styles.bigStatsGrid}>
        {[
          { value: String(s?.total_zones ?? 0), label: 'Zonas', icon: 'flag' as const },
          { value: formatKm(s?.total_km ?? 0), label: 'km totales', icon: 'navigate' as const },
          { value: String(s?.total_runs ?? 0), label: 'Carreras', icon: 'walk' as const },
          { value: String(s?.total_points ?? 0), label: 'Puntos', icon: 'flame' as const },
        ].map((item, i) => (
          <View key={i} style={styles.bigStatCard}>
            <Ionicons name={item.icon} size={28} color={colors.orange} />
            <Text style={styles.bigStatValue}>{item.value}</Text>
            <Text style={styles.bigStatLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Logros y Actividad reciente eliminados del Perfil — ahora viven en
          la pestaña Stats. El Perfil se centra en identidad + edición + stats
          principales bien grandes + integraciones (Strava, premium). */}

      {/* Strava Connect — usa el botón oficial de Strava (brand guidelines obligan
          a usar este botón exacto en flujos OAuth, no se puede recrear). */}
      <View style={styles.stravaSection}>
        <Text style={styles.stravaSectionSub}>Conquista zonas con tus últimas carreras de Strava</Text>
        <TouchableOpacity onPress={handleConnectStrava} disabled={stravaLoading} activeOpacity={0.85}>
          {stravaLoading ? (
            <View style={styles.stravaButtonLoading}>
              <ActivityIndicator size="small" color="#fff" />
            </View>
          ) : (
            <Image
              source={require('../../assets/btn_strava_connect_with_orange.png')}
              style={styles.stravaButton}
              resizeMode="contain"
            />
          )}
        </TouchableOpacity>
      </View>

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

      <View style={styles.section}>
        {[
          { icon: 'flame-outline' as const, label: 'Cómo funcionan los puntos', onPress: () => setPointsModalVisible(true) },
          { icon: 'trophy-outline' as const, label: 'Puntos por logros', onPress: () => setAchievementModalVisible(true) },
          { icon: 'trash-outline' as const, label: 'Eliminar cuenta', onPress: handleDeleteAccount },
          { icon: 'notifications-outline' as const, label: 'Notificaciones', onPress: () => {
            if (Platform.OS === 'ios') {
              Linking.openURL('app-settings:');
            } else {
              Linking.openSettings();
            }
          }},
          { icon: 'lock-closed-outline' as const, label: 'Privacidad', onPress: () => Linking.openURL('https://ibanto.github.io/corrr/privacy.html') },
          { icon: 'bug-outline' as const, label: 'Reportar un bug', onPress: () => Linking.openURL('mailto:hola@corrr.es?subject=Bug%20en%20CORRR&body=Hola%2C%20he%20encontrado%20un%20problema%3A%0A%0A') },
          { icon: 'help-circle-outline' as const, label: 'Centro de ayuda', onPress: () => Linking.openURL('mailto:hola@corrr.es?subject=Ayuda%20CORRR') },
          // silent:false → siempre da feedback ("estás al día" o "sin
          // conexión"). El auto-check de arranque/foreground usa silent:true.
          { icon: 'cloud-download-outline' as const, label: 'Buscar actualizaciones', onPress: () => checkForUpdates(CURRENT_VERSION, false) },
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

    {/* EditProfileScreen — form completo del perfil del corredor (v1.9). Se
        abre desde la tarjeta "Editar perfil" arriba. Al guardar refrescamos
        profileData para que el banner del bonus desaparezca al reclamarlo. */}
    <EditProfileScreen
      visible={editProfileOpen}
      initial={profileData}
      onClose={() => setEditProfileOpen(false)}
      onSaved={async (bonusAwarded) => {
        setEditProfileOpen(false);
        await loadProfileData();
        if (bonusAwarded) {
          Alert.alert('🎁 ¡Perfil completo!', 'Has ganado +50 pts por rellenar tu perfil. ¡Sigue corriendo!');
          loadStats();
        }
      }}
    />

    {/* Modal: Cómo funcionan los puntos */}
    <Modal visible={pointsModalVisible} animationType="slide" transparent={false}>
      <View style={styles.infoModalContainer}>
        <View style={styles.infoModalHeader}>
          <TouchableOpacity onPress={() => setPointsModalVisible(false)}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.infoModalTitle}>Cómo funcionan los puntos</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView style={styles.infoModalScroll} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="navigate" size={18} color={colors.orange} /></View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Por kilómetro</Text>
                <Text style={styles.infoDesc}>Ganas puntos por cada km recorrido</Text>
              </View>
              <Text style={styles.infoValue}>10 pts/km</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="grid" size={18} color={colors.orange} /></View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Celda nueva reclamada</Text>
                <Text style={styles.infoDesc}>Por cada cuadrado de 5×5m que pisas por primera vez</Text>
              </View>
              <Text style={styles.infoValue}>+1 pt</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="hand-left" size={18} color="#FF3B30" /></View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Celda robada a rival</Text>
                <Text style={styles.infoDesc}>Por cada celda de otro corredor que pisas</Text>
              </View>
              <Text style={styles.infoValue}>+2 pts</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="shield-half-outline" size={18} color="#FF3B30" /></View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Si te roban celdas</Text>
                <Text style={styles.infoDesc}>Pierdes puntos por cada celda que te quiten</Text>
              </View>
              <Text style={styles.infoValue}>−1 pt/celda</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="flag" size={18} color={colors.orange} /></View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Cerrar loop ≥ 3 km</Text>
                <Text style={styles.infoDesc}>Bonus por cerrar una zona grande</Text>
              </View>
              <Text style={styles.infoValue}>+50 pts</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="flag-outline" size={18} color={colors.textSecondary} /></View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Cerrar loop {'<'} 3 km</Text>
                <Text style={styles.infoDesc}>Bonus por cerrar una zona pequeña</Text>
              </View>
              <Text style={styles.infoValue}>+25 pts</Text>
            </View>
          </View>

          <Text style={styles.achInfoSubtitle}>Multiplicadores</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="flame" size={18} color="#FF9500" /></View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Racha de 3 días</Text>
                <Text style={styles.infoDesc}>Corre 3 días seguidos para activar el bonus en la siguiente carrera</Text>
              </View>
              <Text style={styles.infoValue}>×1.5</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="trophy" size={18} color="#FFD700" /></View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>Mejor km/día</Text>
                <Text style={styles.infoDesc}>Supera tu marca personal de km en un día</Text>
              </View>
              <Text style={styles.infoValue}>×1.2 sobre km</Text>
            </View>
          </View>

          <Text style={styles.achInfoSubtitle}>Experiencia</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}><Ionicons name="flash" size={18} color="#FFD700" /></View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>XP por puntos</Text>
                <Text style={styles.infoDesc}>Sube de nivel acumulando puntos</Text>
              </View>
              <Text style={styles.infoValue}>1 XP / 100 pts</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>

    {/* Modal: Puntos por logros */}
    <Modal visible={achievementModalVisible} animationType="slide" transparent={false}>
      <View style={styles.infoModalContainer}>
        <View style={styles.infoModalHeader}>
          <TouchableOpacity onPress={() => setAchievementModalVisible(false)}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.infoModalTitle}>Puntos por logros</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView style={styles.infoModalScroll} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.achInfoSubtitle}>Los logros se desbloquean automáticamente al alcanzar el objetivo. Los puntos se suman a tu total.</Text>

          {/* Distancia */}
          <View style={styles.infoCard}>
            <Text style={styles.achCategoryHeader}>📏  Distancia</Text>
            {[
              { name: 'Primeros pasos 👟', goal: '10 km', pts: '100 pts' },
              { name: 'Medio maratón 🏃', goal: '50 km', pts: '300 pts' },
              { name: 'Centenario 💯', goal: '100 km', pts: '600 pts' },
              { name: 'Ultra runner 🏅', goal: '500 km', pts: '1.500 pts' },
            ].map((a, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.infoDivider} />}
                <View style={styles.achInfoRow}>
                  <Text style={styles.achInfoName}>{a.name}</Text>
                  <Text style={styles.achInfoGoal}>{a.goal}</Text>
                  <Text style={styles.achInfoPts}>{a.pts}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Zonas */}
          <View style={styles.infoCard}>
            <Text style={styles.achCategoryHeader}>🗺️  Zonas</Text>
            {[
              { name: 'Conquistador novato', goal: '5 zonas', pts: '100 pts' },
              { name: 'Señor del territorio 🏰', goal: '25 zonas', pts: '400 pts' },
              { name: 'Emperador 👑', goal: '50 zonas', pts: '800 pts' },
              { name: 'Leyenda territorial ⚔️', goal: '100 zonas', pts: '2.000 pts' },
            ].map((a, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.infoDivider} />}
                <View style={styles.achInfoRow}>
                  <Text style={styles.achInfoName}>{a.name}</Text>
                  <Text style={styles.achInfoGoal}>{a.goal}</Text>
                  <Text style={styles.achInfoPts}>{a.pts}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Carreras */}
          <View style={styles.infoCard}>
            <Text style={styles.achCategoryHeader}>🏃  Carreras</Text>
            {[
              { name: 'Calentamiento 🔥', goal: '5 carreras', pts: '100 pts' },
              { name: 'Rutina sana 💪', goal: '20 carreras', pts: '400 pts' },
              { name: 'Máquina imparable ⚡', goal: '50 carreras', pts: '1.000 pts' },
            ].map((a, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.infoDivider} />}
                <View style={styles.achInfoRow}>
                  <Text style={styles.achInfoName}>{a.name}</Text>
                  <Text style={styles.achInfoGoal}>{a.goal}</Text>
                  <Text style={styles.achInfoPts}>{a.pts}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Robos */}
          <View style={styles.infoCard}>
            <Text style={styles.achCategoryHeader}>🎭  Robos</Text>
            {[
              { name: 'Primer robo 🎭', goal: '1 robo', pts: '150 pts' },
              { name: 'Ladrón experto 🦹', goal: '10 robos', pts: '500 pts' },
              { name: 'El terror del barrio 😈', goal: '25 robos', pts: '1.200 pts' },
            ].map((a, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.infoDivider} />}
                <View style={styles.achInfoRow}>
                  <Text style={styles.achInfoName}>{a.name}</Text>
                  <Text style={styles.achInfoGoal}>{a.goal}</Text>
                  <Text style={styles.achInfoPts}>{a.pts}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Rachas */}
          <View style={styles.infoCard}>
            <Text style={styles.achCategoryHeader}>🔥  Rachas</Text>
            {[
              { name: 'Racha de 3 🔥', goal: '3 días seguidos', pts: '200 pts' },
              { name: 'Semana perfecta 📅', goal: '7 días seguidos', pts: '500 pts' },
              { name: 'Imparable 🌟', goal: '14 días seguidos', pts: '1.000 pts' },
            ].map((a, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.infoDivider} />}
                <View style={styles.achInfoRow}>
                  <Text style={styles.achInfoName}>{a.name}</Text>
                  <Text style={styles.achInfoGoal}>{a.goal}</Text>
                  <Text style={styles.achInfoPts}>{a.pts}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>

    {/* Overlay de subida de foto. Modal a nivel app que bloquea TODA la
        interacción (incluida la tab bar) hasta que la subida termina.
        Necesario porque PerfilScreen se desmonta al cambiar de tab y antes
        el usuario podía irse a mitad de subida y perder la foto. */}
    <Modal visible={uploadingAvatar} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.uploadOverlay}>
        <View style={styles.uploadCard}>
          <ActivityIndicator size="large" color={colors.orange} />
          <Text style={styles.uploadText}>Subiendo foto...</Text>
          <Text style={styles.uploadSubtext}>No cierres la app</Text>
        </View>
      </View>
    </Modal>

    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 100 },
  // Overlay para subida de foto. Card centrada con backdrop semitransparente.
  uploadOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl * 1.5,
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 220,
  },
  uploadText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  uploadSubtext: {
    fontSize: 12,
    color: colors.textSecondary,
  },
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
  editProfileCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: spacing.md, marginBottom: spacing.md,
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
  },
  editProfileCardHighlight: {
    borderColor: colors.orange,
    backgroundColor: `${colors.orange}10`,
  },
  editProfileLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  editProfileIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  editProfileTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  editProfileSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  viewAllBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  viewAllText: { fontSize: 14, fontWeight: '700', color: colors.orange },
  statsRow: {
    flexDirection: 'row', marginHorizontal: spacing.md, backgroundColor: colors.bgCard,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, marginBottom: spacing.lg,
  },
  // Grid 2×2 grande para las stats del Perfil (Zonas / km / Carreras / Puntos).
  // Gap entre tarjetas reducido a xs (4) — antes con sm (8) las tarjetas se
  // veían "separadas" en pantalla.
  bigStatsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  // Card más compacta verticalmente — antes paddingVertical: xl (32) dejaba
  // mucho aire dentro de cada tarjeta y separaba el bloque entero. Ahora md
  // (16) → tarjetas más bajas y los 4 elementos quedan agrupados.
  bigStatCard: {
    width: '49%', flexGrow: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    alignItems: 'center', gap: 4,
  },
  // Cifras grandes (44) y label algo más visible (13) — protagonistas del Perfil.
  bigStatValue: {
    fontSize: 44, fontWeight: '900', color: colors.textPrimary,
    letterSpacing: -1.5, lineHeight: 48,
  },
  bigStatLabel: {
    fontSize: 13, fontWeight: '700', color: colors.textSecondary,
    letterSpacing: 1.2, textTransform: 'uppercase',
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
    width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  achievementIconDone: { borderColor: '#4CAF50', borderWidth: 1.5 },
  achievementLabel: { fontSize: 11, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', lineHeight: 14, height: 28, textAlignVertical: 'top' },
  achievementSub: { fontSize: 10, color: colors.textSecondary, textAlign: 'center' },
  achProgress: { width: '80%', height: 3, backgroundColor: colors.bgCardAlt, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  achProgressFill: { height: '100%', backgroundColor: colors.orange, borderRadius: 2 },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.md },
  // Info modals (puntos & logros)
  infoModalContainer: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === 'ios' ? 56 : 24 },
  infoModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  infoModalTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  infoModalScroll: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  infoCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 },
  infoIcon: {
    width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.bgCardAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  infoBody: { flex: 1 },
  infoLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  infoDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  infoValue: { fontSize: 14, fontWeight: '800', color: colors.orange },
  infoDivider: { height: 1, backgroundColor: colors.border },
  achInfoSubtitle: {
    fontSize: 13, color: colors.textSecondary, lineHeight: 18,
    marginBottom: spacing.md, paddingHorizontal: 2,
  },
  achCategoryHeader: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginBottom: 8 },
  achInfoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  achInfoName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  achInfoGoal: { fontSize: 12, color: colors.textSecondary, marginRight: spacing.sm },
  achInfoPts: { fontSize: 13, fontWeight: '800', color: colors.orange, minWidth: 65, textAlign: 'right' },
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
  stravaSection: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  stravaSectionSub: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  // Botón oficial de Strava. Mantenemos la aspect ratio (5.95:1 según el PNG
  // oficial) para no distorsionar la marca. Alto fijo, ancho lo calcula RN.
  stravaButton: {
    height: 48,
    width: 48 * 5.95,
    maxWidth: '100%',
  },
  stravaButtonLoading: {
    height: 48,
    width: 48 * 5.95,
    maxWidth: '100%',
    backgroundColor: '#FC4C02',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
