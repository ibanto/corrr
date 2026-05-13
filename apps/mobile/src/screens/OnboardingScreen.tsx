import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Dimensions,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api } from '../services/api';

const { width, height } = Dimensions.get('window');

const INTRO_PAGES = [
  {
    icon: '🏃',
    title: 'Corre por tu ciudad',
    desc: 'Sal a correr y traza rutas por las calles. Cada carrera cuenta para conquistar territorio.',
    color: '#FF6600',
  },
  {
    icon: '🗺️',
    title: 'Conquista zonas',
    desc: 'Cierra un bucle mientras corres y el terreno que encierres será tuyo. Cuanto más grande, más puntos.',
    color: '#FF8C00',
  },
  {
    icon: '⚔️',
    title: 'Roba a tus rivales',
    desc: 'Si tu ruta encierra la zona de otro corredor, ¡la conquistas! Defiende tu territorio o piérdelo.',
    color: '#FF4500',
  },
  {
    icon: '🏆',
    title: 'Sube en el ranking',
    desc: 'Compite contra corredores de tu ciudad y de toda España. ¿Quién dominará más territorio?',
    color: '#FFD700',
  },
];

interface Props {
  onAuthenticated: (token: string, user: any) => void;
}

type Mode = 'intro' | 'splash' | 'login' | 'register';

export default function OnboardingScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('intro');
  const [introPage, setIntroPage] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      let res;
      if (mode === 'login') {
        res = await api.login(email, password);
      } else {
        if (!username) { Alert.alert('Falta el nombre de usuario'); setLoading(false); return; }
        res = await api.register(username, email, password, city || undefined);
      }
      api.setToken(res.accessToken);
      api.setUserId(res.user.id);
      onAuthenticated(res.accessToken, res.user);
    } catch (err) {
      Alert.alert('Error', String(err));
    } finally {
      setLoading(false);
    }
  };

  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] });

  if (mode === 'intro') {
    return (
      <View style={styles.introContainer}>
        <FlatList
          ref={flatListRef}
          data={INTRO_PAGES}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          onMomentumScrollEnd={(e) => {
            const page = Math.round(e.nativeEvent.contentOffset.x / width);
            setIntroPage(page);
          }}
          renderItem={({ item }) => (
            <View style={[styles.introPage, { width }]}>
              <Text style={styles.introIcon}>{item.icon}</Text>
              <Text style={[styles.introTitle, { color: item.color }]}>{item.title}</Text>
              <Text style={styles.introDesc}>{item.desc}</Text>
            </View>
          )}
        />
        <View style={styles.introBottom}>
          <View style={styles.dots}>
            {INTRO_PAGES.map((_, i) => (
              <View key={i} style={[styles.dot, introPage === i && styles.dotActive]} />
            ))}
          </View>
          {introPage === INTRO_PAGES.length - 1 ? (
            <TouchableOpacity style={styles.btnPrimary} onPress={() => setMode('splash')}>
              <Text style={styles.btnPrimaryText}>¡Vamos! →</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={() => {
                const next = introPage + 1;
                flatListRef.current?.scrollToIndex({ index: next, animated: true });
                setIntroPage(next);
              }}
            >
              <Text style={styles.btnPrimaryText}>Siguiente →</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setMode('splash')} style={styles.skipBtn}>
            <Text style={styles.skipText}>Saltar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (mode === 'splash') {
    return (
      <View style={styles.splashContainer}>
        <Animated.View style={[styles.logoGlow, { opacity: glowOpacity }]} />
        <Animated.View style={[styles.logoContainer, { opacity: fadeAnim, transform: [{ scale: logoScale }] }]}>
          <Text style={styles.flameEmoji}>🔥</Text>
          <Text style={styles.logoText}>CORRR</Text>
          <Text style={styles.logoTagline}>Corre. Conquista. Compite.</Text>
        </Animated.View>
        <Animated.View style={[styles.splashBottom, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.featureRow}>
            {[
              { icon: 'map' as const, text: 'Conquista territorio' },
              { icon: 'trophy' as const, text: 'Compite en España' },
              { icon: 'star' as const, text: 'Supera retos' },
            ].map((f, i) => (
              <View key={i} style={styles.featureItem}>
                <Ionicons name={f.icon} size={32} color={colors.orange} />
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => setMode('register')}>
            <Text style={styles.btnPrimaryText}>Empezar →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => setMode('login')}>
            <Text style={styles.btnSecondaryText}>Ya tengo cuenta</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.authContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableOpacity style={styles.backBtn} onPress={() => setMode('splash')}>
        <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
        <Text style={styles.backBtnText}>Volver</Text>
      </TouchableOpacity>
      <View style={styles.authHeader}>
        <Text style={styles.flameEmoji}>🔥</Text>
        <Text style={styles.authTitle}>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</Text>
        <Text style={styles.authSubtitle}>
          {mode === 'login' ? 'Bienvenido de vuelta, corredor' : 'Únete a miles de corredores en España'}
        </Text>
      </View>
      <View style={styles.form}>
        {mode === 'register' && (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Nombre de usuario</Text>
              <TextInput
                style={styles.input}
                placeholder="RunnerMadrid"
                placeholderTextColor={colors.textMuted}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Ciudad</Text>
              <TextInput
                style={styles.input}
                placeholder="Madrid"
                placeholderTextColor={colors.textMuted}
                value={city}
                onChangeText={setCity}
                autoCapitalize="words"
              />
            </View>
          </>
        )}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="tu@email.com"
            placeholderTextColor={colors.textMuted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Contraseña</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>
        <TouchableOpacity style={[styles.btnPrimary, { marginTop: spacing.lg }]} onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.btnPrimaryText}>{mode === 'login' ? 'Entrar →' : 'Crear cuenta →'}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={styles.switchMode}>
          <Text style={styles.switchModeText}>
            {mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  introContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  introPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  introIcon: {
    fontSize: 80,
    marginBottom: 24,
  },
  introTitle: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 16,
  },
  introDesc: {
    fontSize: 17,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 26,
    paddingHorizontal: spacing.md,
  },
  introBottom: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 60,
    gap: 16,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.orange,
    width: 24,
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '500',
  },
  splashContainer: {
    flex: 1, backgroundColor: colors.bg, alignItems: 'center',
    justifyContent: 'space-between', paddingTop: 100, paddingBottom: 60, paddingHorizontal: spacing.lg,
  },
  logoGlow: {
    position: 'absolute', top: height * 0.15, width: 300, height: 300, borderRadius: 150,
    backgroundColor: colors.orange, shadowColor: colors.orange,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 80, elevation: 20,
  },
  logoContainer: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  flameEmoji: { fontSize: 64, textAlign: 'center' },
  logoText: { fontSize: 56, fontWeight: '900', color: colors.textPrimary, letterSpacing: -1 },
  logoTagline: { fontSize: 16, color: colors.orange, fontWeight: '600', letterSpacing: 1, marginTop: spacing.xs },
  splashBottom: { width: '100%' },
  featureRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.xl },
  featureItem: { alignItems: 'center', gap: spacing.xs },
  featureText: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', fontWeight: '500', marginTop: 4 },
  btnPrimary: {
    backgroundColor: colors.orange, paddingVertical: 18, borderRadius: radius.full, alignItems: 'center',
    shadowColor: colors.orange, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  btnPrimaryText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.5 },
  btnSecondary: {
    marginTop: spacing.md, paddingVertical: 16, borderRadius: radius.full,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  btnSecondaryText: { color: colors.textSecondary, fontSize: 16, fontWeight: '500' },
  authContainer: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg, paddingTop: 60 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xl },
  backBtnText: { color: colors.textSecondary, fontSize: 16 },
  authHeader: { marginBottom: spacing.xl },
  authTitle: { fontSize: 32, fontWeight: '900', color: colors.textPrimary, marginTop: spacing.sm },
  authSubtitle: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.xs },
  form: { gap: spacing.md },
  inputGroup: { gap: spacing.xs },
  inputLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 14,
    color: colors.textPrimary, fontSize: 16,
  },
  switchMode: { alignItems: 'center', marginTop: spacing.md },
  switchModeText: { color: colors.orange, fontSize: 14, fontWeight: '500' },
});
