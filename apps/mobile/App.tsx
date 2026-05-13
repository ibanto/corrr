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

type Tab = 'Mapa' | 'Stats' | 'Ranking' | 'Retos' | 'Perfil';

const TABS: { key: Tab; icon: keyof typeof Ionicons.glyphMap; iconActive: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { key: 'Mapa',    icon: 'map-outline',      iconActive: 'map',        label: 'Mapa' },
  { key: 'Stats',   icon: 'bar-chart-outline', iconActive: 'bar-chart', label: 'Stats' },
  { key: 'Ranking', icon: 'trophy-outline',    iconActive: 'trophy',    label: 'Ranking' },
  { key: 'Retos',   icon: 'star-outline',      iconActive: 'star',      label: 'Retos' },
  { key: 'Perfil',  icon: 'person-outline',    iconActive: 'person',    label: 'Perfil' },
];

const SESSION_KEY = '@corrr_session';
interface User { id: string; username: string; email: string; city?: string; }
interface Session { token: string; user: User; }

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Mapa');
  const [loading, setLoading] = useState(true); // arranca en true mientras leemos storage

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
      case 'Mapa':    return <MapScreen user={user} />;
      case 'Stats':   return <StatsScreen user={user} />;
      case 'Ranking': return <RankingScreen user={user} />;
      case 'Retos':   return <RetosScreen />;
      case 'Perfil':  return <PerfilScreen user={user} onLogout={handleLogout} />;
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screen}>{renderScreen()}</View>
      </SafeAreaView>
      <SafeAreaView style={styles.tabBarSafe}>
        <View style={styles.tabBar}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tabItem}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                {isActive && <View style={styles.tabIndicator} />}
                <Ionicons
                  name={isActive ? tab.iconActive : tab.icon}
                  size={24}
                  color={isActive ? colors.orange : colors.tabInactive}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
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
    paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 0 : 8,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, position: 'relative' },
  tabLabel: { fontSize: 10, fontWeight: '600', color: colors.tabInactive, marginTop: 2 },
  tabLabelActive: { color: colors.orange },
  tabIndicator: { position: 'absolute', top: 0, width: 20, height: 2, backgroundColor: colors.orange, borderRadius: 1 },
});
