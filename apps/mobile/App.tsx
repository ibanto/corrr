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
  DeviceEventEmitter,
} from 'react-native';
import { checkForUpdates, storeUrl, CURRENT_VERSION } from './src/utils/checkForUpdates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
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
import { importNewWorkouts, RUNS_IMPORTED_EVENT } from './src/services/healthkit';
import ZonePopup, { PopupType } from './src/components/ZonePopup';
import { CHECK_TAUNTS_EVENT, RUN_TABS_EVENT } from './src/services/notifications';
import PodioModal from './src/components/PodioModal';
import type { Podium } from './src/services/api';
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

// Sesión partida en dos a propósito:
//
//   · El TOKEN va en SecureStore, que lo cifra usando el Llavero de iOS y el
//     Keystore de Android. Antes vivía en AsyncStorage, que NO cifra nada: es
//     un fichero legible en un móvil con root o jailbreak, o desde una copia
//     de seguridad sin cifrar. Y como el token dura 90 días y no se puede
//     revocar, quien lo sacara tenía la cuenta durante tres meses.
//
//   · El PERFIL sigue en AsyncStorage porque SecureStore tiene un tope de
//     ~2 KB por valor en Android, y el avatar en base64 lo revienta. No es
//     dato sensible: es lo que la propia app ya muestra en pantalla.
const TOKEN_KEY = 'corrr.session.token';   // SecureStore (cifrado)
const USER_KEY = '@corrr_user';            // AsyncStorage (no sensible)
const LEGACY_SESSION_KEY = '@corrr_session'; // formato antiguo, solo para migrar
// CURRENT_VERSION ahora vive en src/utils/checkForUpdates.ts — no aquí —
// para romper la dependencia circular App ↔ PerfilScreen que rompía el
// botón "Buscar actualizaciones".
/** El sábado de esta semana, como "2026-09-19".
 *
 *  Es la clave del aviso del podio: mientras no cambie, no se vuelve a
 *  enseñar. Sale el sábado, y si ese día no abres la app, la primera vez que
 *  la abras después — mejor que perderte la semana entera. */
function saturdayOfThisWeek(now: Date = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); // domingo=0 … sábado=6
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

interface User { id: string; username: string; email: string; city?: string; }
interface Session { token: string; user: User; }

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Mapa');
  const [loading, setLoading] = useState(true);
  const [stolenPopup, setStolenPopup] = useState<{ visible: boolean; rivalName?: string; points?: number }>({ visible: false });
  const [podium, setPodium] = useState<Podium | null>(null);
  // Versión por debajo de la mínima: la app se bloquea hasta actualizar. El
  // territorio es compartido, así que una versión con el reparto de celdas
  // roto le estropea el mapa a todos, no solo a quien la tiene.
  const [updateRequired, setUpdateRequired] = useState(false);
  /** Carrera en marcha: el menú de abajo se esconde. */
  const [runActive, setRunActive] = useState(false);
  const [pendingFriends, setPendingFriends] = useState(0);

  // El mapa avisa de cuándo hay una carrera en marcha, para esconder el menú
  // de abajo: la pantalla de carrera ya lo tapaba, pero al abrir el mapa
  // durante la carrera volvía a aparecer y se podía cambiar de pestaña.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(RUN_TABS_EVENT, (activa: boolean) => setRunActive(!!activa));
    return () => sub.remove();
  }, []);

  // Notificaciones push: "te han robado una zona".
  //
  // Antes solo se escuchaba la notificación que LLEGA con la app abierta. Si
  // la app estaba cerrada o en segundo plano —lo normal— y pulsabas la
  // notificación, la app abría el mapa y no pasaba nada: el aviso no salía
  // hasta que el sondeo del buzón se disparaba, cada 45 segundos. De ahí el
  // "tienes que navegar por el menú un rato hasta que salta".
  //
  // Ahora hay tres puertas: la notificación que llega con la app abierta, el
  // toque sobre ella, y el arranque en frío desde la notificación (la app
  // estaba cerrada del todo).
  useEffect(() => {
    const mostrar = (data: any) => {
      if (data?.type === 'zone_stolen') {
        setStolenPopup({
          visible: true,
          rivalName: data.rivalName ?? 'Un rival',
          points: data.points ?? 0,
        });
      }
      // Sea del tipo que sea, el buzón puede tener algo esperando: que lo
      // mire YA en vez de esperar al siguiente sondeo.
      DeviceEventEmitter.emit(CHECK_TAUNTS_EVENT);
    };

    const recibida = Notifications.addNotificationReceivedListener(n => mostrar(n.request.content.data));
    const pulsada = Notifications.addNotificationResponseReceivedListener(r => mostrar(r.notification.request.content.data));
    // Arranque en frío: la app se ha abierto pulsando la notificación.
    Notifications.getLastNotificationResponseAsync()
      .then(r => { if (r) mostrar(r.notification.request.content.data); })
      .catch(() => {});

    return () => { recibida.remove(); pulsada.remove(); };
  }, []);

  // Al montar, intentar restaurar sesión guardada
  useEffect(() => {
    (async () => {
      try {
        let token = await SecureStore.getItemAsync(TOKEN_KEY);
        let rawUser = await AsyncStorage.getItem(USER_KEY);

        // Migración desde el formato antiguo (todo junto y sin cifrar). Se
        // hace en silencio para no cerrarle la sesión a quien ya la tenía.
        if (!token) {
          const legacy = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
          if (legacy) {
            const old: Session = JSON.parse(legacy);
            token = old.token;
            rawUser = JSON.stringify(old.user);
            await SecureStore.setItemAsync(TOKEN_KEY, old.token);
            await AsyncStorage.setItem(USER_KEY, rawUser);
            await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
          }
        }

        if (token && rawUser) {
          const savedUser: User = JSON.parse(rawUser);
          api.setToken(token);
          api.setUserId(savedUser.id);
          setUser(savedUser);
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
    const comprobar = async () => {
      if ((await checkForUpdates(CURRENT_VERSION, true)) === 'required') setUpdateRequired(true);
    };
    comprobar();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') comprobar();
    });
    return () => sub.remove();
  }, []);

  // Apple Watch: al abrir la app y al volver a ella se importan los entrenos
  // nuevos del reloj (solo si el usuario lo conectó en su perfil). Ver
  // src/services/healthkit.ts.
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    const importFromWatch = async () => {
      const done = await importNewWorkouts(userId);
      if (done.length === 0) return;
      DeviceEventEmitter.emit(RUNS_IMPORTED_EVENT);
      const km = done.reduce((sum, w) => sum + w.distanceKm, 0);
      const cells = done.reduce((sum, w) => sum + w.cells, 0);
      const stolen = done.reduce((sum, w) => sum + w.stolenCells, 0);
      Alert.alert(
        done.length === 1
          ? '⌚ Carrera del Apple Watch importada'
          : `⌚ ${done.length} carreras del Apple Watch importadas`,
        `${km.toFixed(2).replace('.', ',')} km · ${cells} ${cells === 1 ? 'celda nueva' : 'celdas nuevas'}`
          + (stolen > 0 ? ` · ${stolen} robadas` : ''),
      );
    };
    importFromWatch();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') importFromWatch();
    });
    return () => sub.remove();
  }, [user?.id]);

  // El podio de los sábados. Sale una vez por semana, la primera vez que
  // abres la app en sábado (o cualquier día después, si ese sábado no la
  // abriste): enseña quién manda en España y en tu ciudad, esta semana y de
  // siempre. Solo se mira; de ahí no se va a ningún sitio.
  //
  // Se muestra con retardo a propósito: en iOS, montar un Modal mientras la
  // app arranca o mientras se cierra otro hace que no se presente nunca
  // (mismo motivo que `popupReady` y `summaryReady` en el mapa).
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const maybeShowPodium = async () => {
      try {
        const key = `corrr:podio:${userId}`;
        const semana = saturdayOfThisWeek();
        const visto = await AsyncStorage.getItem(key);
        if (visto === semana) return;
        const data = await api.getPodium();
        if (!data || cancelled) return;
        await AsyncStorage.setItem(key, semana);
        timer = setTimeout(() => { if (!cancelled) setPodium(data); }, 1200);
      } catch {}
    };

    maybeShowPodium();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeShowPodium();
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [user?.id]);

  const handleAuthenticated = async (token: string, userData: User) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(userData));
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
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    await AsyncStorage.multiRemove([USER_KEY, LEGACY_SESSION_KEY]);
    api.setToken('');
    api.setUserId('');
    setUser(null);
    setActiveTab('Mapa');
  };

  // Sesión caducada (token de 7d expirado → 401 en una llamada autenticada):
  // cerramos sesión y mandamos a login para obtener un token nuevo. El guard
  // "una sola vez" vive en api.ts y se rearma al volver a loguear.
  useEffect(() => {
    api.setOnUnauthorized(() => {
      Alert.alert('Sesión caducada', 'Por seguridad tu sesión ha expirado. Vuelve a iniciar sesión.');
      handleLogout();
    });
  }, []);

  // Versión inservible: pantalla completa, sin salida. Va ANTES que todo lo
  // demás —incluso que la carga de sesión— para que no se pueda correr con
  // ella.
  if (updateRequired) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <Text style={styles.splashLogo}>CORRR</Text>
        <Text style={styles.bloqueoTitulo}>Toca actualizar</Text>
        <Text style={styles.bloqueoTexto}>
          Esta versión ya no puede registrar carreras: repartía mal el territorio y le
          ensuciaba el mapa a todo el mundo. Actualiza y sigues donde lo dejaste.
        </Text>
        <TouchableOpacity style={styles.bloqueoBoton} onPress={() => Linking.openURL(storeUrl())}>
          <Text style={styles.bloqueoBotonTexto}>ACTUALIZAR</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
      {podium && (
        <PodioModal
          visible
          podium={podium}
          currentUserId={user?.id}
          onClose={() => setPodium(null)}
        />
      )}
      <ZonePopup
        visible={stolenPopup.visible}
        type="stolen_from_you"
        points={stolenPopup.points}
        rivalName={stolenPopup.rivalName}
        onClose={() => setStolenPopup({ visible: false })}
      />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screen}>
          {/* MapScreen NO se oculta con display:'none'. En iOS un <Modal> que
              vive dentro de un subárbol con display:'none' no llega a
              presentarse, y los avisos de "te han robado" / mensaje recibido
              se quedaban esperando hasta que el usuario toqueteaba el menú y
              algo forzaba un re-render. En su lugar lo tapamos con la pantalla
              de la pestaña activa, que es opaca y ocupa todo. (display:'none'
              sobre el mapa ya dio problemas antes con los polígonos — ver
              CLAUDE.md, bugs históricos.) */}
          <View style={StyleSheet.absoluteFill} pointerEvents={activeTab === 'Mapa' ? 'auto' : 'none'}>
            <MapScreen user={user} onNavigateToShop={() => setActiveTab('Retos')} />
          </View>
          {activeTab !== 'Mapa' && (
            <View style={[StyleSheet.absoluteFill, styles.overlayScreen]}>
              {renderOverlayScreen()}
            </View>
          )}
        </View>
      </SafeAreaView>
      <SafeAreaView style={[styles.tabBarSafe, runActive && styles.oculto]}>
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
  bloqueoTitulo: {
    color: colors.textPrimary, fontSize: 22, fontWeight: '900',
    marginTop: 28, letterSpacing: 1,
  },
  bloqueoTexto: {
    color: colors.textSecondary, fontSize: 15, lineHeight: 22,
    textAlign: 'center', marginTop: 12, paddingHorizontal: 32,
  },
  bloqueoBoton: {
    backgroundColor: colors.orange, borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 48, marginTop: 28,
  },
  bloqueoBotonTexto: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  root: { flex: 1, backgroundColor: colors.bg },
  safeArea: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 32) + 12 : 0 },
  screen: { flex: 1 },
  // Opaca: tapa por completo el mapa, que ahora sigue montado y "visible"
  // detrás para que sus modales puedan presentarse.
  overlayScreen: { backgroundColor: colors.bg },
  tabBarSafe: { backgroundColor: colors.bgCard },
  oculto: { display: 'none' },
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
