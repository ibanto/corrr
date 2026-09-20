import React from 'react';
import {
  View, Text, StyleSheet, Modal, Image, ScrollView, TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import type { Podium, PodiumEntry } from '../services/api';

/**
 * El podio de los sábados: quién manda en España y en tu ciudad.
 *
 * Solo se mira: no lleva a ninguna parte ni permite picarse desde aquí. Es un
 * recordatorio semanal de a quién hay que ir a robarle.
 */

interface Props {
  visible: boolean;
  podium: Podium;
  currentUserId?: string;
  onClose: () => void;
}

const MEDALLAS = ['🥇', '🥈', '🥉'];

function Fila({ entry, position, isMe }: { entry: PodiumEntry; position: number; isMe: boolean }) {
  return (
    <View style={[styles.fila, isMe && styles.filaMia]}>
      <Text style={styles.medalla}>{MEDALLAS[position] ?? ''}</Text>
      {entry.avatar
        ? <Image source={{ uri: entry.avatar }} style={styles.foto} />
        : <View style={[styles.foto, styles.fotoVacia]}><Text style={styles.inicial}>{(entry.name ?? '?').charAt(0).toUpperCase()}</Text></View>}
      <Text style={[styles.nombre, isMe && styles.nombreMio]} numberOfLines={1}>
        {entry.name}{isMe ? ' (tú)' : ''}
      </Text>
      <Text style={styles.puntos}>{entry.points.toLocaleString('es-ES')}</Text>
    </View>
  );
}

function Bloque({ titulo, entradas, currentUserId, vacio }: {
  titulo: string; entradas: PodiumEntry[]; currentUserId?: string; vacio: string;
}) {
  return (
    <View style={styles.bloque}>
      <Text style={styles.bloqueTitulo}>{titulo}</Text>
      {entradas.length === 0
        ? <Text style={styles.vacio}>{vacio}</Text>
        : entradas.map((e, i) => (
            <Fila key={e.userId} entry={e} position={i} isMe={e.userId === currentUserId} />
          ))}
    </View>
  );
}

export default function PodioModal({ visible, podium, currentUserId, onClose }: Props) {
  // La altura de la lista se ajusta a la pantalla: en un iPhone pequeño no
  // puede comerse el botón de cerrar, y en uno grande no tiene sentido dejar
  // hueco vacío obligando a hacer scroll.
  const { height } = useWindowDimensions();
  const ciudad = (podium.city ?? '').toUpperCase();
  const desde = new Date(podium.weekStart).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.tarjeta}>
          <Text style={styles.titulo}>EL PODIO</Text>
          <Text style={styles.subtitulo}>Quién manda desde el {desde}</Text>

          <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={styles.scrollContenido}>
            <Bloque
              titulo="ESTA SEMANA EN ESPAÑA"
              entradas={podium.week.spain}
              currentUserId={currentUserId}
              vacio="Nadie ha corrido todavía esta semana. Hay sitio libre."
            />
            {ciudad ? (
              <Bloque
                titulo={`ESTA SEMANA EN ${ciudad}`}
                entradas={podium.week.city}
                currentUserId={currentUserId}
                vacio={`Nadie ha corrido en ${ciudad} esta semana. Sal tú.`}
              />
            ) : null}
            <Bloque
              titulo="DE SIEMPRE EN ESPAÑA"
              entradas={podium.allTime.spain}
              currentUserId={currentUserId}
              vacio="Aún no hay nadie."
            />
            {ciudad ? (
              <Bloque
                titulo={`DE SIEMPRE EN ${ciudad}`}
                entradas={podium.allTime.city}
                currentUserId={currentUserId}
                vacio={`Aún no hay nadie en ${ciudad}.`}
              />
            ) : null}
          </ScrollView>

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
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  tarjeta: {
    width: '100%', maxWidth: 420, backgroundColor: colors.bgCard,
    borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.orange,
  },
  titulo: {
    color: colors.orange, fontSize: 30, fontWeight: '900',
    textAlign: 'center', letterSpacing: 2,
  },
  subtitulo: {
    color: colors.textSecondary, fontSize: 13, textAlign: 'center',
    marginTop: 2, marginBottom: spacing.md,
  },
  scrollContenido: { paddingBottom: spacing.sm },
  bloque: { marginBottom: spacing.md },
  bloqueTitulo: {
    color: colors.textPrimary, fontSize: 12, fontWeight: '800',
    letterSpacing: 1, marginBottom: spacing.xs, opacity: 0.7,
  },
  fila: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  filaMia: { backgroundColor: 'rgba(255,102,0,0.15)' },
  medalla: { fontSize: 18, width: 26 },
  foto: { width: 30, height: 30, borderRadius: 15, marginRight: spacing.sm, backgroundColor: colors.bg },
  fotoVacia: { alignItems: 'center', justifyContent: 'center' },
  inicial: { color: colors.textSecondary, fontWeight: '800' },
  nombre: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  nombreMio: { color: colors.orange, fontWeight: '900' },
  puntos: { color: colors.orange, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  vacio: { color: colors.textSecondary, fontSize: 13, fontStyle: 'italic', paddingHorizontal: spacing.sm },
  boton: {
    backgroundColor: colors.orange, borderRadius: radius.lg,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm,
  },
  botonTexto: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
});
