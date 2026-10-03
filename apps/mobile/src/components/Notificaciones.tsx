import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, Notificacion } from '../services/api';

/**
 * La bandeja: lo que te ha pasado a ti.
 *
 * Robos y cercos salían antes a pantalla completa, uno por uno, nada más abrir
 * la app. Eso es machacón —el robo es cosa de todos los días— y además tapaba
 * los carteles de verdad, los que anuncian algo a todo el mundo. Aquí están
 * todos juntos y se miran cuando a uno le apetece.
 */

const CORTE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** "hace 2 horas", "ayer", "el 28 de sep". */
function cuando(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return min <= 1 ? 'ahora mismo' : `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return `hace ${d} días`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/** Los *asteriscos* del texto salen en naranja, como en los carteles. */
function conResaltes(texto: string) {
  return texto.split('*').map((trozo, i) =>
    i % 2 === 1
      ? <Text key={i} style={styles.resalte}>{trozo}</Text>
      : <Text key={i}>{trozo}</Text>);
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function Notificaciones({ visible, onClose }: Props) {
  const [lista, setLista] = useState<Notificacion[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setCargando(true);
    api.getNotificaciones()
      .then(r => setLista(r.notificaciones))
      .finally(() => setCargando(false));
    // Se dan por vistas al abrir: si has llegado hasta aquí, ya las has visto.
    api.marcarNotificacionesVistas();
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.cabecera}>
          <TouchableOpacity onPress={onClose} style={styles.cerrar}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.titulo}>LO QUE TE HA PASADO</Text>
          <View style={{ width: 40 }} />
        </View>

        {cargando ? (
          <View style={styles.centro}><ActivityIndicator size="large" color={colors.orange} /></View>
        ) : lista.length === 0 ? (
          <View style={styles.centro}>
            <Ionicons name="shield-checkmark-outline" size={48} color={colors.textMuted} />
            <Text style={styles.vacio}>Nadie te ha tocado el territorio.{'\n'}De momento.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.lista}>
            {lista.map(n => (
              <View key={n.id} style={[styles.nota, !n.vista && styles.notaNueva]}>
                <View style={styles.notaCabecera}>
                  <Text style={styles.notaTitulo}>{n.titulo}</Text>
                  <Text style={styles.notaCuando}>{cuando(n.creado_at)}</Text>
                </View>
                <Text style={styles.notaTexto}>{conResaltes(n.texto)}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: colors.bg },
  cabecera: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 50, paddingBottom: spacing.sm, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  cerrar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titulo: { color: colors.textPrimary, fontSize: 15, fontWeight: '900', letterSpacing: 1.5 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  vacio: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  lista: { padding: spacing.md, gap: spacing.sm },
  nota: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  // Un filo naranja a la izquierda en las que aún no has visto. Sin globos ni
  // "NUEVO": se nota de un vistazo y no grita.
  notaNueva: { borderLeftWidth: 3, borderLeftColor: colors.orange },
  notaCabecera: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginBottom: 4, gap: spacing.sm,
  },
  notaTitulo: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  notaCuando: { color: colors.textMuted, fontSize: 12 },
  notaTexto: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  resalte: { color: colors.orange, fontWeight: '700' },
});
