import React from 'react';
import { View, Text, StyleSheet, Platform, Dimensions } from 'react-native';
import { colors, spacing, radius } from '../theme';

/** Un vacile de los que se escriben desde el panel (§9-sexies): no hay dibujo
 *  dentro de la app, así que el texto se pinta en una tarjeta de CORRR, negra
 *  con el marco naranja, en vertical como los carteles de siempre. Sirve en
 *  miniatura (la cuadrícula del selector) y a lo grande (antes de enviarlo y
 *  al recibirlo). El texto se encoge hasta caber: 140 letras como mucho. */

const CONDENSADA = Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' });
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
// A lo grande cabe entre el remitente (arriba) y el botón (abajo), que van
// flotando en la pantalla de recibir: por eso se le quitan 260 puntos.
const ALTO_GRANDE = Math.min(SCREEN_HEIGHT - 260, (SCREEN_WIDTH - spacing.lg * 2) * 16 / 9);
const ANCHO_GRANDE = Math.round(ALTO_GRANDE * 9 / 16);

interface Props {
  texto: string;
  /** El nombre de su pestaña, para el pie de la tarjeta. */
  pestana?: string | null;
  grande?: boolean;
}

export default function VacileTarjeta({ texto, pestana, grande = false }: Props) {
  return (
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
  );
}

const styles = StyleSheet.create({
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
