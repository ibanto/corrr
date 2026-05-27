import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Image,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Easing,
} from 'react-native';
import { colors, spacing } from '../theme';

/**
 * Pantalla de carga: aro circular naranja girando alrededor del logo CORRR,
 * con un slogan estilo grafiti debajo. Se usa en:
 *   - carga inicial del mapa
 *   - guardado post-carrera (mientras saveRun + loadCells están en vuelo)
 *
 * El aro se hace con un View bordereado: 3 de los 4 bordes transparentes y
 * uno solo en naranja → al rotarlo da el efecto clásico de "loading
 * spinner". Animated con useNativeDriver: true → 60fps sin saturar el JS
 * thread mientras el guardado/carga corre en paralelo.
 */

const LOGO_SIZE = 88;
const RING_SIZE = 132;        // ~50% más grande que el logo → halo visible
const RING_THICKNESS = 5;

const SLOGANS = [
  'CONQUISTANDO ZONA...',
  'PINTANDO TERRITORIO...',
  'QUEMANDO ASFALTO...',
  'CARGANDO LADRILLOS...',
  'SUBIENDO XP...',
];

interface Props {
  visible: boolean;
  /** Texto de abajo. Si no se pasa, elige uno aleatorio de SLOGANS. */
  subtitle?: string;
}

export default function LoadingScreen({ visible, subtitle }: Props) {
  const rotateAnim = useRef(new Animated.Value(0)).current;

  // Slogan fijo durante la vida del overlay — si fuera aleatorio en cada
  // render, parpadearía cambiando de texto en cada tick.
  const slogan = useMemo(
    () => subtitle ?? SLOGANS[Math.floor(Math.random() * SLOGANS.length)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, subtitle],
  );

  useEffect(() => {
    if (!visible) return;
    rotateAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 1100,            // un giro cada 1.1s → ritmo "activo" sin marear
        easing: Easing.linear,     // velocidad constante (un spinner no acelera/desacelera)
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, rotateAnim]);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.container}>
        <View style={styles.ringWrapper}>
          {/* Anillo rotante: borderTopColor en naranja, el resto transparente.
              Al girarlo se ve un arco naranja recorriendo todo el círculo. */}
          <Animated.View
            style={[
              styles.ring,
              { transform: [{ rotate }] },
            ]}
          />
          {/* Logo centrado en el aro. Posicionado absoluto para que el ring
              quede como halo a su alrededor en lugar de empujarlo. */}
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.slogan}>{slogan}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  ringWrapper: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_THICKNESS,
    // Tres bordes en naranja muy translúcido (track del spinner) y uno
    // sólido naranja arriba (cabeza que gira). Da el típico look de carga
    // sin necesitar SVG ni librería extra.
    borderColor: `${colors.orange}25`,
    borderTopColor: colors.orange,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: 20,
  },
  slogan: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.orange,
    letterSpacing: 3,
    textAlign: 'center',
    textTransform: 'uppercase',
    // Sombra dura tipo grafiti: offset duro sin blur. Le da el look "pintado".
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
});
