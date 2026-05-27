import React from 'react';
import { View, StyleSheet, Image, Dimensions } from 'react-native';
import { colors } from '../theme';

/**
 * RetosScreen — placeholder "Próximamente" usando la imagen oficial.
 *
 * El contenido anterior (semanales / especiales / mensuales / tienda de XP)
 * sigue guardado en RetosScreen.legacy.tsx para reactivarlo en su día.
 * La imagen incluye todo: icono, "PRÓXIMAMENTE" en grafiti y el subtítulo.
 */
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export default function RetosScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/proximamente.png')}
        style={styles.image}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: SCREEN_W,
    height: SCREEN_H * 0.85, // deja un pequeño margen vertical para la tab bar
  },
});
