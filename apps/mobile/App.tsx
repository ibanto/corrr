import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ActivityIndicator,
  Dimensions,
  Image,
  ImageSourcePropType,
  Alert,
  Linking,
  AppState,
} from 'react-native';
import { checkForUpdates, CURRENT_VERSION } from './src/utils/checkForUpdates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './src/theme';
import { api } from './src/services/api';
import OnboardingScreen from './src/screens/OnboardingScreen';
import MapScreen from './src/screens/MapScreen';
import StatsScreen from './src/screens/StatsScreen';
import RankingScreen from './src/screens/RankingScreen';
import RetosScreen from './src/screens/RetosScreen';
import PerfilScreen from './src/screens/PerfilScreen';
import { registerForPushNotifications } from './src/services/notifications';
import ZonePopup, { PopupType } from './src/components/ZonePopup';
import * as Notifications from 'expo-notifications';

type Tab = 'Mapa' | 'Stats' | 'Ranking' | 'Retos' | 'Perfil';

const TAB_ICONS: Record<Tab, { inactive: ImageSourcePropType; active: ImageSourcePropType }> = {
  Mapa:    { inactive: require('./assets/tabs/mapa-inactive.png'),    active: require('./assets/tabs/mapa-active.png') },
  Stats:   { inactive: require('./assets/tabs/stats-inactive.png'),   active: require('./assets/tabs/stats-active.png') },
  Ranking: { inactive: require('./assets/tabs/ranking-inactive.png'), active: require('./assets/tabs/ranking-active.png') },
  Retos:   { inactive: require('./assets/tabs/retos-inactive.png'),   active: require('./assets/tabs/retos-active.png') },
  Perfil:  { inactive: require('./assets/tabs/perfil-inactive.png'),  active: require('./assets/tabs/perfil-active.png') },
};

const TABS: { key: Tab; label: string }[] = [
  { key: 'Mapa',    label: 'Mapa' },
  { key: 'Stats',   label: 'Stats' },
  { key: 'Ranking', label: 'Ranking' },
  { key: 'Retos',   label: 'Retos' },
  { key: 'Perfil',  label: 'Perfil' },
];

const SESSION_KEY = '@corrr_session';
// CURRENT_VERSION ahora vive en src/utils/checkForUpdates.ts — no aquí —
// para romper la dependencia circular App ↔ PerfilScreen que rompía el
// botón "Buscar actualizaciones".
interface User { id: string; username: string; email: string; city?: string; }
interface Session { token: string; user: User; }

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Mapa');
  const [loading, setLoading] = useState(true);
  const [stolenPopup, setStolenPopup] = useState<{ visible: boolean; rivalName?: string; points?: number }>({ visible: false });
  const [pendingFriends, setPendingFriends] = useState(0);

  // Escuchar notificaciones push (te han robado una zona)
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(notification => {
      const data = notification.request.content.data as any;
      if (data?.type === 'zone_stolen') {
        setStolenPopup({
          visible: true,
          rivalName: data.rivalName ?? 'Un rival',
          points: data.points ?? 0,
        });
      }
    });
    return () => sub.remove();
  }, []);

  // Al montar, intentar restaurar sesión guardada
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SESSION_KEY);
        if (raw) {
          const session: Session = JSON.parse(raw);
          api.setToken(session.token);
          api.setUserId(session.user.id);
          setUser(session.user);
          registerForPushNotifications().catch(() => {});
          // Cargar solicitudes de amistad pendientes
          api.getPendingFriendRequests().then(r => setPendingFriends(r.length)).catch(() => {});
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  // Auto-check de versión: al arrancar la app Y cada vez que vuelva a
  // foreground tras estar en background. Antes solo corría al montar
  // (useEffect con deps vacías) → si el usuario nunca cerraba la app del
  // todo, el aviso de "nueva versión" no llegaba nunca. Con AppState lo
  // reintentamos al activar la app, que es cuando es útil para el usuario.
  // Modo silent: no decimos nada si no hay update ni si la red falla.
  useEffect(() => {
    checkForUpdates(CURRENT_VERSION, true);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkForUpdates(CURRENT_VERSION, true);
    });
    return () => sub.remove();
  }, []);

  const handleAuthenticated = async (token: string, userData: User) => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ token, user: userData }));
    setUser(userData);
    registerForPushNotifications().catch(() => {});
    api.getPendingFriendRequests().then(r => setPendingFriends(r.length)).catch(() => {});
  };

  // Strava signup pending state (set when the OAuth callback deep link arrives
  // with a temp token and the athlete isn't yet linked to a CORRR account).
  // Pasamos esto al OnboardingScreen para que pinte el formulario prefilled.
  const [pendingStravaSignup, setPendingStravaSignup] = useState<{
    signupToken: string;
    prefill: { firstName: string | null; lastName: string | null; city: string | null; gender: 'M' | 'F' | null; avatarUrl: string | null; bio: string | null };
  } | null>(null);

  /** Procesa una URL del esquema corrr:// (deep link). Hoy solo manejamos
   *  el callback de Strava signup; futuros usos pueden añadirse aquí. */
  const handleDeepLink = useCallback(async (url: string | null) => {
    if (!url) return;
    if (!url.startsWith('corrr://strava-auth')) return;
    const match = url.match(/[?&]temp=([^&]+)/);
    if (!match) return;
    const temp = decodeURIComponent(match[1]);
    try {
      const res = await api.stravaExchange(temp);
      if (res.kind === 'login' && res.accessToken && res.user) {
        api.setToken(res.accessToken);
        api.setUserId(res.user.id);
        await handleAuthenticated(res.accessToken, {
          id: res.user.id,
          username: res.user.username,
          email: res.user.email,
          city: res.user.city ?? undefined,
        });
      } else if (res.kind === 'signup' && res.signupToken && res.prefill) {
        setPendingStravaSignup({ signupToken: res.signupToken, prefill: res.prefill });
      }
    } catch (e: any) {
      Alert.alert('Error con Strava', e?.message ?? 'No se pudo completar la autenticación con Strava.');
    }
  }, []);

  // Listener de deep links: tanto la URL inicial (si la app se abrió fría)
  // como las que llegan mientras está abierta.
  useEffect(() => {
    Linking.getInitialURL().then(handleDeepLink).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handleDeepLink(e.url));
    return () => sub.remove();
  }, [handleDeepLink]);

  const handleLogout = async () => {
    await AsyncStorage.removeItem(SESSION_KEY);
    api.setToken('');
    api.setUserId('');
    setUser(null);
    setActiveTab('Mapa');
  };

  // Pantalla de carga mientras restauramos sesión
  if (loading) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <Text style={styles.splashLogo}>CORRR</Text>
        <ActivityIndicator color={colors.orange} style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (!user) {
    return (
      <>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <OnboardingScreen
          onAuthenticated={handleAuthenticated}
          pendingStravaSignup={pendingStravaSignup}
          onStravaSignupConsumed={() => setPendingStravaSignup(null)}
        />
      </>
    );
  }

  // MapScreen stays mounted across tab switches so an active run survives navigation
  // (location watchers, timers, pathRef etc. are component state that would be lost on unmount).
  // Other tabs mount/unmount on demand — only the map is "live" enough to need persistence.
  const renderOverlayScreen = () => {
    switch (activeTab) {
      case 'Stats':   return <StatsScreen user={user} />;
      case 'Ranking': return <RankingScreen user={user} pendingCount={pendingFriends} onPendingCountChange={setPendingFriends} />;
      case 'Retos':   return <RetosScreen />;
      case 'Perfil':  return <PerfilScreen user={user} onLogout={handleLogout} />;
      default:        return null;
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <ZonePopup
        visible={stolenPopup.visible}
        type="stolen_from_you"
        points={stolenPopup.points}
        rivalName={stolenPopup.rivalName}
        onClose={() => setStolenPopup({ visible: false })}
      />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screen}>
          <View style={[StyleSheet.absoluteFill, { display: activeTab === 'Mapa' ? 'flex' : 'none' }]}>
            <MapScreen user={user} onNavigateToShop={() => setActiveTab('Retos')} />
          </View>
          {activeTab !== 'Mapa' && renderOverlayScreen()}
        </View>
      </SafeAreaView>
      <SafeAreaView style={styles.tabBarSafe}>
        <View style={styles.tabBar}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            const icons = TAB_ICONS[tab.key];
            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tabItem}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <View style={styles.tabItemInner}>
                  <Image
                    source={isActive ? icons.active : icons.inactive}
                    style={styles.tabIcon}
                    resizeMode="contain"
                  />
                  {tab.key === 'Ranking' && pendingFriends > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{pendingFriends}</Text>
                    </View>
                  )}
                </View>
                {/* <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text> */}
              </TouchableOpacity>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  splashLogo: {
    fontSize: 48, fontWeight: '900', color: colors.orange, letterSpacing: 4,
  },
  root: { flex: 1, backgroundColor: colors.bg },
  safeArea: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 32) + 12 : 0 },
  screen: { flex: 1 },
  tabBarSafe: { backgroundColor: colors.bgCard },
  tabBar: {
    flexDirection: 'row', backgroundColor: colors.bgCard,
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 0 : 48,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  tabItemInner: { position: 'relative' },
  tabIcon: { width: 88, height: 88 },
  tabLabel: { fontSize: 10, fontWeight: '600', color: colors.textMuted, marginTop: 2 },
  tabLabelActive: { color: colors.orange, fontWeight: '700' },
  badge: {
    position: 'absolute', top: 2, right: -4,
    backgroundColor: '#FB0E01', borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5, borderWidth: 2, borderColor: colors.bgCard,
  },
  badgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
});
