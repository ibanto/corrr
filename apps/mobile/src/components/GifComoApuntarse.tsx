import React from 'react';
import { View, Text, StyleSheet, Modal, Image, TouchableOpacity, Dimensions } from 'react-native';
import { colors } from '../theme';

/**
 * «¿Cómo me apunto a un reto?»: el GIF explicativo en un marco 9:16 centrado, sin
 * llenar la pantalla (Iban, 21-nov-2026: «que no llene toda la página, para curarnos
 * en salud en los diferentes móviles»). El tamaño se calcula con el ancho Y el alto
 * del móvil, así que cabe en cualquiera. Se cambia desde el panel, sin versión.
 */

const { width: W, height: H } = Dimensions.get('window');
// Como mucho el 72 % del ancho y el 62 % del alto, siempre en 9:16.
const ANCHO = Math.min(W * 0.72, H * 0.62 * (9 / 16));
const ALTO = ANCHO * (16 / 9);

type Props = { visible: boolean; uri: string | null; onCerrar: () => void };

export default function GifComoApuntarse({ visible, uri, onCerrar }: Props) {
  if (!uri) return null;
  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onCerrar}>
      <TouchableOpacity style={s.fondo} activeOpacity={1} onPress={onCerrar}>
        <View style={s.caja}>
          <Image source={{ uri }} style={{ width: ANCHO, height: ALTO, borderRadius: 18 }} resizeMode="contain" />
          <TouchableOpacity style={s.cerrar} onPress={onCerrar} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Cerrar">
            <Text style={s.cerrarTexto}>✕</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.pie}>Toca fuera para cerrar</Text>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center' },
  caja: { alignItems: 'center' },
  cerrar: {
    position: 'absolute', top: -14, right: -14, width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center',
  },
  cerrarTexto: { color: '#000', fontSize: 16, fontWeight: '900' },
  pie: { color: colors.textMuted, fontSize: 13, marginTop: 18 },
});
