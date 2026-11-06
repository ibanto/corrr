import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Platform, Dimensions } from 'react-native';
import { colors, spacing, radius } from '../theme';

/** Un vacile de los que vienen del panel (§9-sexies).
 *
 *  Los de TEXTO se pintan en una tarjeta de CORRR, negra con el marco naranja,
 *  en vertical como los carteles de siempre. Los de CARTELES traen una
 *  dirección (`imagen`): el cartel se pinta ENCIMA de la tarjeta, sobre negro,
 *  y si no llega (sin red, dirección caída) queda la tarjeta con su nombre.
 *  Nunca un hueco en blanco. Sirve en miniatura (la cuadrícula del selector)
 *  y a lo grande (antes de enviarlo y al recibirlo, a pantalla completa como
 *  los clásicos). El texto se encoge hasta caber: 140 letras como mucho. */

const CONDENSADA = Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' });
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
// A lo grande, la tarjeta cabe entre el remitente (arriba) y el botón (abajo),
// que van flotando en la pantalla de recibir: por eso se le quitan 260 puntos.
const ALTO_GRANDE = Math.min(SCREEN_HEIGHT - 260, (SCREEN_WIDTH - spacing.lg * 2) * 16 / 9);
const ANCHO_GRANDE = Math.round(ALTO_GRANDE * 9 / 16);

interface Props {
  texto: string;
  /** El nombre de su pestaña, para el pie de la tarjeta. */
  pestana?: string | null;
  /** El cartel (o su miniatura), si es una pestaña de carteles. */
  imagen?: string | null;
  grande?: boolean;
}

export default function VacileTarjeta({ texto, pestana, imagen, grande = false }: Props) {
  // Si el cartel no se puede bajar, se quita y queda la tarjeta de debajo.
  const [fallo, setFallo] = useState(false);
  // El cartel va INVISIBLE hasta que avisa de que ha cargado EL SUYO. Con la
  // arquitectura nueva, iOS reutiliza la vista nativa de una imagen que acaba
  // de desaparecer (la cuadrícula del selector) y, mientras tanto, enseñaría
  // el cartel de otro mensaje: se vio el 6-nov-2026 en el simulador, al
  // recibir un tótem justo después de enviar otro. Mejor la tarjeta con el
  // nombre unos instantes que el cartel equivocado.
  const [cargada, setCargada] = useState<string | null>(null);
  const conCartel = !!imagen && !fallo;
  return (
    <View style={grande ? styles.marcoGrande : styles.marcoMini}>
      <View style={[styles.tarjeta, grande ? styles.tarjetaGrande : styles.tarjetaMini]}>
        <Text style={[styles.sello, grande && styles.selloGrande]}>CORRR</Text>
        <View style={styles.centro}>
          <Text
            style={[styles.texto, grande && styles.textoGrande]}
            adjustsFontSizeToFit
            numberOfLines={grande ? 9 : 7}
            minimumFontScale={0.4}
          >
            {texto.toUpperCase()}
          </Text>
        </View>
        <Text style={[styles.pie, grande && styles.pieGrande]} numberOfLines={1}>
          {(pestana ?? '').toUpperCase() || ' '}
        </Text>
      </View>
      {conCartel && (
        <Image
          key={imagen as string}
          source={{ uri: imagen as string }}
          // 'contain' y sobre negro puro, como los carteles de siempre: tienen
          // proporciones distintas y el texto llega al borde.
          style={[grande ? styles.cartelGrande : styles.cartelMini, cargada !== imagen && styles.cartelEsperando]}
          resizeMode="contain"
          onLoad={() => setCargada(imagen as string)}
          onError={() => setFallo(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  marcoMini: {
    width: '100%',
    height: '100%',
  },
  marcoGrande: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tarjeta: {
    backgroundColor: '#000',
    borderColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tarjetaMini: {
    width: '100%',
    height: '100%',
    borderWidth: 3,
    borderRadius: radius.md,
    padding: 10,
  },
  tarjetaGrande: {
    width: ANCHO_GRANDE,
    height: ALTO_GRANDE,
    borderWidth: 5,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  // El cartel tapa la tarjeta entera; mientras baja se ve la tarjeta.
  cartelMini: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    borderRadius: radius.md,
  },
  cartelGrande: {
    position: 'absolute',
    top: 0, left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#000',
  },
  cartelEsperando: {
    opacity: 0,
  },
  sello: {
    color: colors.orange,
    fontFamily: CONDENSADA,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 3,
  },
  selloGrande: { fontSize: 18, letterSpacing: 5 },
  centro: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  texto: {
    width: '100%',
    color: '#fff',
    fontFamily: CONDENSADA,
    fontWeight: '900',
    fontSize: 24,
    lineHeight: 26,
    textAlign: 'center',
  },
  textoGrande: { fontSize: 52, lineHeight: 54 },
  pie: {
    color: colors.orange,
    fontFamily: CONDENSADA,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 2,
  },
  pieGrande: { fontSize: 15, letterSpacing: 3 },
});
