import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Image, TouchableOpacity, ActivityIndicator, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, FichaCorredor as Ficha } from '../services/api';

/**
 * La ficha de un corredor: se abre al tocarlo en el ranking Y al tocar su
 * territorio en el mapa.
 *
 * Antes había DOS fichas distintas para la misma persona: esta y otra, más
 * pobre, dentro del mapa. Según por dónde llegaras veías unos datos u otros.
 * Ahora es una sola, con lo que tenían las dos.
 *
 * Enseña lo que ya es público dentro del juego —foto, nombre, ciudad, grito de
 * guerra y sus números— y nada más. De aquí no se puede escribir a nadie, que
 * para eso está el hilo que se abre cuando te roban.
 */

const CONDENSADA = Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' });
const numero = (n: number) => Math.round(n).toLocaleString('es-ES');

interface Props {
  userId: string | null;
  onClose: () => void;
  /** Botón de agregar amigo. Se enseña al llegar desde el mapa, que es donde
   *  te topas con un desconocido; en el ranking ya tienes su pestaña. */
  conAmigo?: boolean;
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

export default function FichaCorredor({ userId, onClose, conAmigo = false }: Props) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cargando, setCargando] = useState(false);
  // El trozo de ciudad y el puesto nacional no vienen en la ficha: los trae el
  // territorio. Se piden aparte y si fallan, la ficha se enseña igual.
  const [territorio, setTerritorio] = useState<{ citySharePct: number | null; nationalRank: number | null } | null>(null);

  useEffect(() => {
    if (!userId) { setFicha(null); setTerritorio(null); return; }
    let cancelado = false;
    setCargando(true);
    setTerritorio(null);
    api.getFichaCorredor(userId)
      .then(f => { if (!cancelado) setFicha(f); })
      .finally(() => { if (!cancelado) setCargando(false); });
    api.getTerritory(userId)
      .then(t => { if (!cancelado) setTerritorio(t); })
      .catch(() => {});
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
                {/* Los porcentajes van sobre lo YA conquistado, no sobre la
                    superficie real: contra el terreno de verdad todo el mundo
                    saldría con un 0,0001% de España. */}
                {/* `!= null` (dos iguales) a propósito: así se cae también el
                    `undefined` de una respuesta a la que le falte el campo. Con
                    `!== null` se colaba y la ficha decía "undefined% de Bilbao". */}
                {!!territorio && (territorio.citySharePct != null || territorio.nationalRank != null) && (
                  <Text style={styles.territorioLinea}>
                    {territorio.citySharePct != null && !!ficha.city
                      ? `${territorio.citySharePct}% de ${ficha.city}` : ''}
                    {territorio.nationalRank != null
                      ? `${territorio.citySharePct != null && ficha.city ? '  ·  ' : ''}nº ${territorio.nationalRank} de España`
                      : ''}
                  </Text>
                )}
                {ficha.racha >= 3 && (
                  <Text style={styles.racha}>🔥 {ficha.racha} días seguidos</Text>
                )}
              </View>

              {conAmigo && !ficha.mine && (
                <TouchableOpacity
                  style={styles.amigo}
                  activeOpacity={0.8}
                  onPress={async () => {
                    const nombre = ficha.name;
                    onClose();
                    // El aviso sale igual aunque la petición falle: repetirla no
                    // hace daño y no vale la pena asustar por una solicitud.
                    try { await api.sendFriendRequest(ficha.id); } catch {}
                    Alert.alert('Solicitud enviada', `Le has pedido amistad a ${nombre}`);
                  }}
                >
                  <Ionicons name="person-add" size={18} color="#fff" />
                  <Text style={styles.amigoTexto}>AGREGAR AMIGO</Text>
                </TouchableOpacity>
              )}
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
  territorioLinea: {
    color: colors.textSecondary, fontSize: 12, marginTop: 3, textAlign: 'center',
  },
  amigo: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.md, paddingVertical: 13,
    borderRadius: radius.full, backgroundColor: colors.orange,
  },
  amigoTexto: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  racha: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
});
