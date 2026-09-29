import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Image, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, FichaCorredor as Ficha } from '../services/api';

/**
 * La ficha de un corredor: se abre al tocarlo en el ranking.
 *
 * Enseña lo que ya es público dentro del juego —foto, nombre, ciudad, grito de
 * guerra y sus números— y nada más. Solo se mira: de aquí no se puede escribir
 * a nadie, que para eso está el hilo que se abre cuando te roban.
 */

const CONDENSADA = Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' });
const numero = (n: number) => Math.round(n).toLocaleString('es-ES');

interface Props {
  userId: string | null;
  onClose: () => void;
}

function Dato({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <View style={styles.dato}>
      <Text style={styles.datoValor} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
        {valor}
      </Text>
      <Text style={styles.datoEtiqueta}>{etiqueta}</Text>
    </View>
  );
}

export default function FichaCorredor({ userId, onClose }: Props) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!userId) { setFicha(null); return; }
    let cancelado = false;
    setCargando(true);
    api.getFichaCorredor(userId)
      .then(f => { if (!cancelado) setFicha(f); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [userId]);

  return (
    <Modal transparent visible={!!userId} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.tarjeta}>
          <TouchableOpacity style={styles.cerrar} onPress={onClose} accessibilityLabel="Cerrar">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>

          {cargando && !ficha ? (
            <ActivityIndicator color={colors.orange} style={{ paddingVertical: spacing.xl }} />
          ) : !ficha ? (
            <Text style={styles.error}>No se ha podido cargar la ficha.</Text>
          ) : (
            <>
              {ficha.avatar
                ? <Image source={{ uri: ficha.avatar }} style={styles.foto} />
                : (
                  <View style={[styles.foto, styles.fotoVacia]}>
                    <Text style={styles.inicial}>{(ficha.name ?? '?').charAt(0).toUpperCase()}</Text>
                  </View>
                )}

              <Text style={styles.nombre} numberOfLines={1}>{ficha.name}</Text>
              {!!ficha.city && (
                <View style={styles.ciudadFila}>
                  <Ionicons name="location" size={14} color={colors.textSecondary} />
                  <Text style={styles.ciudad}>{ficha.city}</Text>
                </View>
              )}

              {!!ficha.warCry && <Text style={styles.grito}>"{ficha.warCry}"</Text>}

              <View style={styles.datos}>
                <Dato valor={numero(ficha.zonas)} etiqueta="ZONAS" />
                <Dato valor={ficha.km.toFixed(1)} etiqueta="KM" />
                <Dato valor={numero(ficha.carreras)} etiqueta="CARRERAS" />
                <Dato valor={numero(ficha.puntos)} etiqueta="PUNTOS" />
              </View>

              <View style={styles.territorio}>
                <Text style={styles.territorioTexto}>
                  {ficha.hectareas >= 0.1
                    ? `${ficha.hectareas.toFixed(1)} hectáreas de territorio`
                    : 'Todavía sin territorio'}
                </Text>
                {ficha.racha >= 3 && (
                  <Text style={styles.racha}>🔥 {ficha.racha} días seguidos</Text>
                )}
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.md,
  },
  tarjeta: {
    width: '100%', maxWidth: 380, backgroundColor: colors.bgCard,
    borderRadius: radius.xl, padding: spacing.lg, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  cerrar: { position: 'absolute', top: spacing.sm, right: spacing.sm, padding: spacing.sm, zIndex: 2 },
  error: { color: colors.textSecondary, paddingVertical: spacing.lg },

  foto: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 3, borderColor: colors.orange, backgroundColor: colors.bg,
  },
  fotoVacia: { alignItems: 'center', justifyContent: 'center' },
  inicial: { color: colors.textSecondary, fontSize: 38, fontWeight: '900' },

  nombre: {
    color: colors.textPrimary, fontSize: 26, fontWeight: '900',
    marginTop: spacing.sm, maxWidth: '100%',
  },
  ciudadFila: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ciudad: { color: colors.textSecondary, fontSize: 14 },
  grito: {
    color: colors.orange, fontSize: 16, fontStyle: 'italic',
    textAlign: 'center', marginTop: spacing.sm,
  },

  datos: {
    flexDirection: 'row', marginTop: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md,
  },
  dato: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  datoValor: {
    color: colors.textPrimary, fontSize: 24, fontFamily: CONDENSADA, fontWeight: '900',
  },
  datoEtiqueta: { color: colors.textSecondary, fontSize: 10, letterSpacing: 1, marginTop: 2 },

  territorio: { marginTop: spacing.md, alignItems: 'center' },
  territorioTexto: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  racha: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
});
