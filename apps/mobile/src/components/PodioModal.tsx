import React from 'react';
import {
  View, Text, StyleSheet, Modal, Image, TouchableOpacity, useWindowDimensions,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import type { Podium, PodiumEntry } from '../services/api';

/**
 * El podio de los sábados: quién manda en España y en tu ciudad.
 *
 * Solo se mira: no lleva a ninguna parte ni permite picarse desde aquí. Es un
 * recordatorio semanal de a quién hay que ir a robarle.
 *
 * Entra TODO sin deslizar, a propósito: el podio de España en grande con las
 * caras, el de tu ciudad en pequeño y lo de siempre en una línea. Un aviso que
 * hay que desplazar para leerlo entero se cierra sin leer.
 */

interface Props {
  visible: boolean;
  podium: Podium;
  currentUserId?: string;
  onClose: () => void;
}

const MEDALLAS = ['🥇', '🥈', '🥉'];
/** Orden en pantalla: segundo, primero, tercero — como un podio de verdad. */
const ORDEN_PODIO = [1, 0, 2];

const puntos = (n: number) => n.toLocaleString('es-ES');
const inicial = (nombre: string) => (nombre ?? '?').charAt(0).toUpperCase();

/** Una cara del podio grande. El primero va más grande y más alto. */
function Cara({ entry, position, isMe, size }: {
  entry: PodiumEntry; position: number; isMe: boolean; size: number;
}) {
  const borde = position === 0 ? colors.orange : colors.border;
  return (
    <View style={[styles.caraCol, position === 0 && styles.caraColPrimero]}>
      <View>
        {entry.avatar
          ? <Image source={{ uri: entry.avatar }} style={[styles.cara, { width: size, height: size, borderRadius: size / 2, borderColor: borde }]} />
          : (
            <View style={[styles.cara, styles.caraVacia, { width: size, height: size, borderRadius: size / 2, borderColor: borde }]}>
              <Text style={[styles.inicial, { fontSize: size * 0.4 }]}>{inicial(entry.name)}</Text>
            </View>
          )}
        <Text style={styles.medallaFlotante}>{MEDALLAS[position]}</Text>
      </View>
      <Text style={[styles.caraNombre, isMe && styles.mio]} numberOfLines={1}>
        {isMe ? `${entry.name} (tú)` : entry.name}
      </Text>
      <Text style={styles.caraPuntos}>{puntos(entry.points)}</Text>
    </View>
  );
}

function FilaPequena({ entry, position, isMe }: { entry: PodiumEntry; position: number; isMe: boolean }) {
  return (
    <View style={[styles.fila, isMe && styles.filaMia]}>
      <Text style={styles.medallaPequena}>{MEDALLAS[position]}</Text>
      {entry.avatar
        ? <Image source={{ uri: entry.avatar }} style={styles.fotoPequena} />
        : <View style={[styles.fotoPequena, styles.caraVacia]}><Text style={styles.inicialPequena}>{inicial(entry.name)}</Text></View>}
      <Text style={[styles.filaNombre, isMe && styles.mio]} numberOfLines={1}>
        {isMe ? `${entry.name} (tú)` : entry.name}
      </Text>
      <Text style={styles.filaPuntos}>{puntos(entry.points)}</Text>
    </View>
  );
}

export default function PodioModal({ visible, podium, currentUserId, onClose }: Props) {
  const { width } = useWindowDimensions();
  const ciudad = (podium.city ?? '').toUpperCase();
  const desde = new Date(podium.weekStart).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

  // Las caras se ajustan al ancho para que quepan las tres sin apretarse.
  const caraGrande = Math.min(104, Math.max(76, width * 0.24));
  const caraChica = caraGrande * 0.72;

  const espana = podium.week.spain;
  const reyEspana = podium.allTime.spain[0];
  const reyCiudad = podium.allTime.city[0];

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.tarjeta}>
          <Text style={styles.titulo}>EL PODIO</Text>
          <Text style={styles.subtitulo}>Esta semana, desde el {desde}</Text>

          <Text style={styles.seccion}>EN ESPAÑA</Text>
          {espana.length === 0 ? (
            <Text style={styles.vacio}>Nadie ha corrido todavía esta semana. Está libre.</Text>
          ) : (
            <View style={styles.podio}>
              {ORDEN_PODIO.filter(i => espana[i]).map(i => (
                <Cara
                  key={espana[i].userId}
                  entry={espana[i]}
                  position={i}
                  isMe={espana[i].userId === currentUserId}
                  size={i === 0 ? caraGrande : caraChica}
                />
              ))}
            </View>
          )}

          {ciudad ? (
            <>
              <Text style={styles.seccion}>EN {ciudad}</Text>
              {podium.week.city.length === 0 ? (
                <Text style={styles.vacio}>Nadie ha corrido en {ciudad} esta semana. Sal tú.</Text>
              ) : (
                podium.week.city.map((e, i) => (
                  <FilaPequena key={e.userId} entry={e} position={i} isMe={e.userId === currentUserId} />
                ))
              )}
            </>
          ) : null}

          {(reyEspana || reyCiudad) && (
            <View style={styles.siempre}>
              {reyEspana && (
                <Text style={styles.siempreLinea} numberOfLines={1}>
                  De siempre en España: <Text style={styles.siempreNombre}>{reyEspana.name}</Text> · {puntos(reyEspana.points)}
                </Text>
              )}
              {reyCiudad && ciudad ? (
                <Text style={styles.siempreLinea} numberOfLines={1}>
                  De siempre en {podium.city}: <Text style={styles.siempreNombre}>{reyCiudad.name}</Text> · {puntos(reyCiudad.points)}
                </Text>
              ) : null}
            </View>
          )}

          <TouchableOpacity style={styles.boton} onPress={onClose} accessibilityRole="button">
            <Text style={styles.botonTexto}>A ROBARLES</Text>
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
    width: '100%', maxWidth: 430, backgroundColor: colors.bgCard,
    borderRadius: radius.xl, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.orange,
  },
  titulo: {
    color: colors.orange, fontSize: 34, fontWeight: '900',
    textAlign: 'center', letterSpacing: 3,
  },
  subtitulo: {
    color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 2,
  },
  seccion: {
    color: colors.textSecondary, fontSize: 12, fontWeight: '800',
    letterSpacing: 1.5, marginTop: spacing.md, marginBottom: spacing.xs,
  },

  // Podio grande
  podio: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end' },
  caraCol: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  caraColPrimero: { marginBottom: spacing.md }, // el primero, más alto
  cara: { borderWidth: 3, backgroundColor: colors.bg },
  caraVacia: { alignItems: 'center', justifyContent: 'center' },
  inicial: { color: colors.textSecondary, fontWeight: '900' },
  // La medalla, pegada a la cara: se entiende el puesto de un vistazo.
  medallaFlotante: { position: 'absolute', bottom: -6, right: -4, fontSize: 24 },
  caraNombre: {
    color: colors.textPrimary, fontSize: 14, fontWeight: '700',
    marginTop: spacing.sm, maxWidth: '100%',
  },
  caraPuntos: { color: colors.orange, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  mio: { color: colors.orange },

  // Lista pequeña (tu ciudad)
  fila: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5, paddingHorizontal: spacing.sm, borderRadius: radius.md,
  },
  filaMia: { backgroundColor: colors.orangeGlow },
  medallaPequena: { fontSize: 15, width: 22 },
  fotoPequena: {
    width: 26, height: 26, borderRadius: 13,
    marginRight: spacing.sm, backgroundColor: colors.bg,
  },
  inicialPequena: { color: colors.textSecondary, fontWeight: '800', fontSize: 12 },
  filaNombre: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  filaPuntos: { color: colors.orange, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },

  vacio: {
    color: colors.textSecondary, fontSize: 13, fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },

  siempre: {
    marginTop: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  siempreLinea: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  siempreNombre: { color: colors.textPrimary, fontWeight: '800' },

  boton: {
    backgroundColor: colors.orange, borderRadius: radius.lg,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md,
  },
  botonTexto: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: 1 },
});
