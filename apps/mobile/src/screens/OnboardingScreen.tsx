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
  ScrollView,
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

type Mode = 'intro' | 'splash' | 'login' | 'register' | 'forgot' | 'verify';

export default function OnboardingScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('intro');
  const [introPage, setIntroPage] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [usernameMsg, setUsernameMsg] = useState('');
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);

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

  const checkUsername = (text: string) => {
    setUsername(text);
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    if (!text || text.length < 3) {
      setUsernameStatus(text.length > 0 ? 'invalid' : 'idle');
      setUsernameMsg(text.length > 0 ? 'Mínimo 3 caracteres' : '');
      return;
    }
    setUsernameStatus('checking');
    setUsernameMsg('');
    usernameTimer.current = setTimeout(async () => {
      try {
        const res = await api.checkUsername(text);
        if (res.available) {
          setUsernameStatus('available');
          setUsernameMsg('✓ Disponible');
        } else {
          setUsernameStatus('taken');
          setUsernameMsg(res.reason || 'No disponible');
        }
      } catch {
        setUsernameStatus('idle');
      }
    }, 500);
  };

  const handleResendVerification = async () => {
    setResendLoading(true);
    try {
      await api.resendVerification(email);
      setResendDone(true);
    } catch {
      Alert.alert('Error', 'No se pudo reenviar el email');
    } finally {
      setResendLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) { Alert.alert('Email necesario', 'Introduce tu email para recuperar la contraseña.'); return; }
    setLoading(true);
    try {
      await api.forgotPassword(email);
      Alert.alert('Email enviado', 'Te hemos enviado un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada.');
      setMode('login');
    } catch (err: any) {
      Alert.alert('Error', err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!email || !password) return;
    if (mode === 'register' && usernameStatus === 'taken') {
      Alert.alert('Nombre no disponible', 'Elige otro nombre de usuario.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await api.login(email, password);
        api.setToken(res.accessToken);
        api.setUserId(res.user.id);
        onAuthenticated(res.accessToken, res.user);
      } else {
        if (!username) { Alert.alert('Falta el nombre de usuario'); setLoading(false); return; }
        const res = await api.register(username, email, password, city || undefined);
        if (res.pendingVerification) {
          setResendDone(false);
          setMode('verify');
        } else if (res.accessToken && res.user) {
          api.setToken(res.accessToken);
          api.setUserId(res.user.id);
          onAuthenticated(res.accessToken, res.user);
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      const body = err?.body;
      if (body?.pendingVerification) {
        setResendDone(false);
        setMode('verify');
      } else if (msg.includes('Email ya registrado')) {
        Alert.alert('Email en uso', 'Ya existe una cuenta con este email. ¿Quieres iniciar sesión?', [
          { text: 'Iniciar sesión', onPress: () => setMode('login') },
          { text: 'Cancelar', style: 'cancel' },
        ]);
      } else if (msg.includes('nombre de usuario ya está en uso')) {
        Alert.alert('Nombre en uso', 'Ese nombre de usuario ya está cogido. Prueba con otro.');
      } else if (msg.includes('Credenciales incorrectas')) {
        Alert.alert('Error', 'Email o contraseña incorrectos.');
      } else if (msg.includes('Email no verificado')) {
        setResendDone(false);
        setMode('verify');
      } else {
        Alert.alert('Error', msg);
      }
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
      <View style={styles.splashContainer}>
        <ImageBackground
          source={require('../../assets/onboarding/splash.png')}
          style={styles.splashImage}
          resizeMode="cover"
        />
        <View style={styles.splashBottom}>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => setMode('register')}>
            <Text style={styles.btnPrimaryText}>EMPEZAR  →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => setMode('login')}>
            <Text style={styles.btnSecondaryText}>Ya tengo cuenta</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (mode === 'verify') {
    return (
      <View style={styles.authContainer}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg }}>
          <Text style={{ fontSize: 64, marginBottom: spacing.lg }}>📧</Text>
          <Text style={{ fontSize: 28, fontWeight: '900', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm }}>
            Verifica tu email
          </Text>
          <Text style={{ fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xs }}>
            Hemos enviado un enlace de verificación a:
          </Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.orange, textAlign: 'center', marginBottom: spacing.xl }}>
            {email}
          </Text>
          <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.xl, lineHeight: 20 }}>
            Haz clic en el enlace del email para activar tu cuenta. Después vuelve aquí e inicia sesión.
          </Text>
          <TouchableOpacity
            style={[styles.btnPrimary, { width: '100%' }]}
            onPress={() => setMode('login')}
          >
            <Text style={styles.btnPrimaryText}>Iniciar sesión →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ marginTop: spacing.lg, padding: spacing.sm }}
            onPress={handleResendVerification}
            disabled={resendLoading || resendDone}
          >
            {resendLoading ? (
              <ActivityIndicator color={colors.orange} />
            ) : (
              <Text style={{ color: resendDone ? colors.textMuted : colors.orange, fontSize: 14 }}>
                {resendDone ? '✓ Email reenviado' : 'Reenviar email de verificación'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.authContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.authScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => setMode('splash')}>
          <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
        <View style={styles.authHeader}>
          <Text style={{ fontSize: 48, textAlign: 'center' }}>🔥</Text>
          <Text style={styles.authTitle}>
            {mode === 'forgot' ? 'Recuperar contraseña' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </Text>
          <Text style={styles.authSubtitle}>
            {mode === 'forgot'
              ? 'Te enviaremos un enlace para restablecer tu contraseña'
              : mode === 'login' ? 'Bienvenido de vuelta, corredor' : 'Únete a miles de corredores en España'}
          </Text>
        </View>
        <View style={styles.form}>
          {mode === 'register' && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Nombre de usuario</Text>
                <View style={{ position: 'relative' }}>
                  <TextInput
                    style={[styles.input, usernameStatus === 'available' && { borderColor: '#22C55E' }, usernameStatus === 'taken' && { borderColor: '#EF4444' }, usernameStatus === 'invalid' && { borderColor: '#EF4444' }]}
                    placeholder="RunnerMadrid"
                    placeholderTextColor={colors.textMuted}
                    value={username}
                    onChangeText={checkUsername}
                    autoCapitalize="none"
                  />
                  {usernameStatus === 'checking' && (
                    <ActivityIndicator size="small" color={colors.orange} style={{ position: 'absolute', right: 14, top: 14 }} />
                  )}
                  {usernameStatus === 'available' && (
                    <Text style={{ position: 'absolute', right: 14, top: 14, color: '#22C55E', fontSize: 16 }}>✓</Text>
                  )}
                  {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                    <Text style={{ position: 'absolute', right: 14, top: 14, color: '#EF4444', fontSize: 16 }}>✗</Text>
                  )}
                </View>
                {usernameMsg !== '' && (
                  <Text style={{ color: usernameStatus === 'available' ? '#22C55E' : '#EF4444', fontSize: 12, marginTop: 4 }}>{usernameMsg}</Text>
                )}
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
          {mode !== 'forgot' && (
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
              {mode === 'login' && (
                <TouchableOpacity onPress={() => setMode('forgot')} style={{ marginTop: 8 }}>
                  <Text style={styles.forgotText}>¿Has olvidado tu contraseña?</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {mode === 'forgot' ? (
            <TouchableOpacity style={[styles.btnPrimary, { marginTop: spacing.lg }]} onPress={handleForgotPassword} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.btnPrimaryText}>Enviar enlace →</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.btnPrimary, { marginTop: spacing.lg }]} onPress={handleSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.btnPrimaryText}>{mode === 'login' ? 'Entrar →' : 'Crear cuenta →'}</Text>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setMode(mode === 'forgot' ? 'login' : mode === 'login' ? 'register' : 'login')} style={styles.switchMode}>
            <Text style={styles.switchModeText}>
              {mode === 'forgot' ? 'Volver a iniciar sesión'
                : mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
    paddingBottom: Platform.OS === 'ios' ? 50 : 64,
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
  splashImage: { flex: 1 },
  splashBottom: {
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 50 : 64,
    paddingTop: 20,
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
  authContainer: { flex: 1, backgroundColor: colors.bg },
  authScroll: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: 60, paddingBottom: 40 },
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
  forgotText: { color: colors.textSecondary, fontSize: 13, textAlign: 'right' },
});
