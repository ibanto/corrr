import React, { useState, useEffect } from 'react';
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
} from 'react-native';
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
interface User { id: string; username: string; email: string; city?: string; }
interface Session { token: string; user: User; }

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Mapa');
  const [loading, setLoading] = useState(true);
  const [stolenPopup, setStolenPopup] = useState<{ visible: boolean; rivalName?: string; points?: number }>({ visible: false });

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
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const handleAuthenticated = async (token: string, userData: User) => {
    // Guardar sesión en storage
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ token, user: userData }));
    setUser(userData);
    // Registrar push notifications
    registerForPushNotifications().catch(() => {});
  };

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
        <OnboardingScreen onAuthenticated={handleAuthenticated} />
      </>
    );
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'Mapa':    return <MapScreen user={user} onNavigateToShop={() => setActiveTab('Retos')} />;
      case 'Stats':   return <StatsScreen user={user} />;
      case 'Ranking': return <RankingScreen user={user} />;
      case 'Retos':   return <RetosScreen />;
      case 'Perfil':  return <PerfilScreen user={user} onLogout={handleLogout} />;
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
        <View style={styles.screen}>{renderScreen()}</View>
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
                <Image
                  source={isActive ? icons.active : icons.inactive}
                  style={styles.tabIcon}
                  resizeMode="contain"
                />
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
    paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 0 : 32,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  tabIcon: { width: 60, height: 92 },
});
