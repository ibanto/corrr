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
  ImageBackground,
  ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api } from '../services/api';

const { width, height } = Dimensions.get('window');

const INTRO_PAGES: { image: ImageSourcePropType; buttonColor: string; buttonText: string }[] = [
  {
    image: require('../../assets/onboarding/slide1.png'),
    buttonColor: '#FF6600',
    buttonText: 'SIGUIENTE',
  },
  {
    image: require('../../assets/onboarding/slide2.png'),
    buttonColor: '#FF6600',
    buttonText: 'SIGUIENTE',
  },
  {
    image: require('../../assets/onboarding/slide3.png'),
    buttonColor: '#FF6600',
    buttonText: 'SIGUIENTE',
  },
  {
    image: require('../../assets/onboarding/slide4.png'),
    buttonColor: '#FFD700',
    buttonText: '¡VAMOS!',
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
    const currentPage = INTRO_PAGES[introPage];
    const isLast = introPage === INTRO_PAGES.length - 1;

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
            <ImageBackground
              source={item.image}
              style={[styles.introPage, { width }]}
              resizeMode="cover"
            />
          )}
        />
        <View style={styles.introOverlay}>
          <View style={styles.dots}>
            {INTRO_PAGES.map((_, i) => (
              <View key={i} style={[styles.dot, introPage === i && styles.dotActive]} />
            ))}
          </View>
          <TouchableOpacity
            style={[styles.introBtn, { backgroundColor: currentPage.buttonColor }]}
            onPress={() => {
              if (isLast) {
                setMode('splash');
              } else {
                const next = introPage + 1;
                flatListRef.current?.scrollToIndex({ index: next, animated: true });
                setIntroPage(next);
              }
            }}
          >
            <Text style={[styles.introBtnText, isLast && { color: '#000' }]}>
              {currentPage.buttonText}  →
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode('splash')} style={styles.skipBtn}>
            <Text style={styles.skipText}>SALTAR</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (mode === 'splash') {
    return (
      <ImageBackground
        source={require('../../assets/onboarding/splash.png')}
        style={styles.splashContainer}
        resizeMode="cover"
      >
        <View style={styles.splashSpacer} />
        <View style={styles.splashBottom}>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => setMode('register')}>
            <Text style={styles.btnPrimaryText}>EMPEZAR  →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => setMode('login')}>
            <Text style={styles.btnSecondaryText}>Ya tengo cuenta</Text>
          </TouchableOpacity>
        </View>
      </ImageBackground>
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
    backgroundColor: '#000',
  },
  introPage: {
    flex: 1,
    width,
    height,
  },
  introOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 50 : 40,
    gap: 14,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    backgroundColor: '#FF6600',
    width: 24,
  },
  introBtn: {
    paddingVertical: 18,
    borderRadius: radius.full,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    shadowColor: '#FF6600',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  introBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  splashSpacer: { flex: 1 },
  splashBottom: {
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 50 : 40,
    gap: 12,
  },
  btnPrimary: {
    backgroundColor: colors.orange, paddingVertical: 18, borderRadius: radius.full, alignItems: 'center',
    shadowColor: colors.orange, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 10,
  },
  btnPrimaryText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  btnSecondary: {
    paddingVertical: 16, borderRadius: radius.full,
    alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  btnSecondaryText: { color: 'rgba(255,255,255,0.5)', fontSize: 16, fontWeight: '600' },
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
