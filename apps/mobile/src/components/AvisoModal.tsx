import React from 'react';
import { View, Text, StyleSheet, Modal, Image, TouchableOpacity, Linking } from 'react-native';
import { colors, spacing, radius } from '../theme';
import type { Aviso } from '../services/api';

/**
 * El aviso que manda el servidor: sale al abrir la app y se escribe desde el
 * panel, sin sacar versión nueva. Sirve para anunciar una novedad, lanzar un
 * reto o avisar de algo puntual.
 *
 * A propósito es tonto: enseña lo que le dan (título, texto, foto opcional y
 * un botón) y no sabe nada de a quién le toca ni de cuándo — eso lo decide el
 * servidor. Así un aviso nuevo nunca necesita tocar la app.
 */

interface Props {
  visible: boolean;
  aviso: Aviso;
  onClose: () => void;
}

export default function AvisoModal({ visible, aviso, onClose }: Props) {
  const texto = (aviso.boton ?? '').trim() || 'VALE';

  const pulsar = () => {
    // Si el aviso lleva enlace, el botón lo abre y cierra. Si el enlace falla
    // (una dirección mal escrita en el panel), el aviso se cierra igual: no se
    // deja a nadie atrapado en un pop-up por una errata.
    const enlace = (aviso.enlace ?? '').trim();
    if (enlace) Linking.openURL(enlace).catch(() => {});
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.tarjeta}>
          {!!aviso.imagen && (
            <Image source={{ uri: aviso.imagen }} style={styles.imagen} resizeMode="cover" />
          )}
          <Text style={styles.titulo}>{aviso.titulo}</Text>
          <Text style={styles.texto}>{aviso.texto}</Text>
          <TouchableOpacity style={styles.boton} onPress={pulsar} accessibilityRole="button">
            <Text style={styles.botonTexto}>{texto.toUpperCase()}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.md,
  },
  tarjeta: {
    width: '100%', maxWidth: 400, backgroundColor: colors.bgCard,
    borderRadius: radius.xl, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.orange,
  },
  imagen: {
    width: '100%', height: 150, borderRadius: radius.lg,
    marginBottom: spacing.md, backgroundColor: colors.bg,
  },
  titulo: {
    color: colors.orange, fontSize: 26, fontWeight: '900',
    textAlign: 'center', letterSpacing: 1.5,
  },
  texto: {
    color: colors.textPrimary, fontSize: 15, lineHeight: 21,
    textAlign: 'center', marginTop: spacing.sm,
  },
  boton: {
    backgroundColor: colors.orange, borderRadius: radius.lg,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg,
  },
  botonTexto: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: 1 },
});
