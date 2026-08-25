import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
  Platform,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { colors, radius, spacing } from '../theme';

/** Robo concreto: a quién y cuántas celdas. */
export type ShareSteal = { name: string; count: number };

export type ShareRunData = {
  distance: number;   // km
  time: number;       // segundos
  points: number;
  /** Celdas conquistadas en la carrera (protagonista si no hubo robo). */
  cells: number;
  /** Nombre del corredor: es quien "roba" o "conquista" en el titular. */
  runnerName: string;
  /** Frase de pique, elegida al azar al terminar la carrera. Se fija ahí para
   *  que no cambie en cada render mientras el usuario mira la tarjeta. */
  phrase: string;
  city?: string;
  steals: ShareSteal[];
};

interface Props {
  visible: boolean;
  data: ShareRunData | null;
  onClose: () => void;
}

/** Proporción de Instagram Stories. La tarjeta se maqueta a este ancho lógico y
 *  se exporta escalada a 1080x1920, así las medidas del diseño son estables
 *  independientemente del tamaño de pantalla del móvil. */
/** Cuenta de Instagram del proyecto, firmada al pie de cada tarjeta. */
const INSTAGRAM_HANDLE = 'corrr.es';

const CARD_W = 360;
const CARD_H = 640;
const EXPORT_W = 1080;
const EXPORT_H = 1920;

const fmtTime = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** Texto del bloque de robo. Con varias víctimas no encadenamos nombres (se
 *  desborda a partir de tres): nombramos a la principal y resumimos el resto. */
function stealLine(steals: ShareSteal[]): { total: number; who: string } {
  const total = steals.reduce((acc, s) => acc + s.count, 0);
  const sorted = [...steals].sort((a, b) => b.count - a.count);
  const who = sorted.length === 1
    ? sorted[0].name
    : `${sorted[0].name} y ${sorted.length - 1} más`;
  return { total, who };
}

export default function ShareRunCard({ visible, data, onClose }: Props) {
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const { width: screenW, height: screenH } = useWindowDimensions();

  if (!data) return null;

  const hasSteals = data.steals.length > 0;
  const steal = hasSteals ? stealLine(data.steals) : null;

  // La tarjeta se maqueta SIEMPRE a CARD_W×CARD_H (así el diseño es exacto y no
  // hay que escalar cada fuente a mano) y solo se reduce si no cabe. En un
  // móvil normal la escala es 1, o sea sin transform, que es el caso en el que
  // la captura es más fiable.
  const previewScale = Math.min(
    1,
    (screenW - spacing.lg * 2) / CARD_W,
    (screenH * 0.66) / CARD_H,
  );
  const scaled = previewScale < 1;

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('No disponible', 'Este dispositivo no permite compartir.');
        return;
      }
      // Capturamos a resolución de Stories (1080x1920), no al tamaño de
      // preview: view-shot escala el render al vuelo.
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        width: EXPORT_W,
        height: EXPORT_H,
      });
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: 'Compartir carrera',
        UTI: 'public.png',
      });
    } catch (e: any) {
      Alert.alert('No se pudo compartir', String(e?.message ?? e));
    } finally {
      setSharing(false);
    }
  };

  const dateLabel = new Date()
    .toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
    .replace('.', '')
    .toUpperCase();

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        {/* Contenedor del tamaño ya escalado; dentro, la tarjeta a tamaño real
            centrada. Con previewScale = 1 no se aplica transform ninguna. */}
        <View style={{
          width: CARD_W * previewScale,
          height: CARD_H * previewScale,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <View>
            <View
              ref={cardRef}
              collapsable={false}
              style={[styles.card, scaled ? { transform: [{ scale: previewScale }] } : null]}
            >
              {/* Cabecera */}
              <View style={styles.cardHeader}>
                <Text style={styles.brand}>CORRR</Text>
                <Text style={styles.dateCity}>
                  {dateLabel}{data.city ? ` · ${data.city.toUpperCase()}` : ''}
                </Text>
              </View>

              {/* Titular. SIN mapa a propósito: publicar el recorrido revela
                  dónde vives (las carreras salen y vuelven de casa), que es el
                  problema que Strava acabó resolviendo con zonas de privacidad.
                  La gracia social se cuenta igual con nombres y cifras. */}
              <View style={styles.headline}>
                <Text style={styles.actor} numberOfLines={1}>{data.runnerName.toUpperCase()}</Text>
                <Text style={styles.verb}>{steal ? 'LE HA ROBADO' : 'HA CONQUISTADO'}</Text>
                {steal && (
                  <Text style={styles.victim} numberOfLines={1}>{steal.who.toUpperCase()}</Text>
                )}

                <View style={styles.cellsBlock}>
                  <View style={styles.cellsRow}>
                    <Text style={styles.cellsValue}>{steal ? steal.total : data.cells}</Text>
                    <Text style={styles.cellsLabel}>
                      {(steal ? steal.total : data.cells) === 1 ? 'CELDA' : 'CELDAS'}
                    </Text>
                  </View>
                </View>

                {/* La frase: el pique. Va aquí porque es donde cae la vista tras
                    el titular, y separada por la línea para que se lea como
                    una pulla y no como un dato más. */}
                <Text style={styles.phrase}>{data.phrase}</Text>
              </View>

              {/* Cifras secundarias */}
              <View style={styles.secondaryRow}>
                <View>
                  <Text style={[styles.secondaryValue, styles.pointsAccent]}>{data.points}</Text>
                  <Text style={styles.secondaryLabel}>PUNTOS</Text>
                </View>
                <View>
                  <Text style={styles.secondaryValue}>{data.distance.toFixed(2)}</Text>
                  <Text style={styles.secondaryLabel}>KM</Text>
                </View>
                <View>
                  <Text style={styles.secondaryValue}>{fmtTime(data.time)}</Text>
                  <Text style={styles.secondaryLabel}>TIEMPO</Text>
                </View>
              </View>

              {/* Firma: la cuenta de Instagram del proyecto. Va al pie y en
                  gris para que sea atribución, no publicidad gritada. */}
              <View style={styles.footer}>
                <Text style={styles.handle}>@{INSTAGRAM_HANDLE}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Acciones (fuera de la tarjeta: no salen en la imagen) */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} disabled={sharing}>
            {sharing
              ? <ActivityIndicator color="#000" />
              : <>
                  <Ionicons name="share-social" size={18} color="#000" />
                  <Text style={styles.shareBtnText}>COMPARTIR</Text>
                </>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={sharing}>
            <Text style={styles.closeBtnText}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.lg,
  },
  card: {
    width: CARD_W, height: CARD_H,
    backgroundColor: '#0A0A0A',
  },
  cardHeader: {
    paddingHorizontal: 22, paddingTop: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  brand: {
    fontSize: 19, color: '#FFFFFF', letterSpacing: 2,
    fontFamily: Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' }),
    fontWeight: '800',
  },
  dateCity: { fontSize: 11, color: colors.textSecondary, letterSpacing: 1 },
  headline: { paddingHorizontal: 24, paddingTop: 42, flex: 1 },
  // Nota general de tipografía: lineHeight siempre con holgura sobre fontSize
  // y includeFontPadding:false. Con lineHeight == fontSize, la condensada
  // recortaba la parte inferior de las cifras en la imagen exportada.
  actor: {
    fontSize: 46, lineHeight: 52, color: colors.orange, letterSpacing: -1,
    fontFamily: Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' }),
    fontWeight: '800', includeFontPadding: false,
  },
  verb: {
    fontSize: 17, color: '#FFFFFF', letterSpacing: 2.5, fontWeight: '700',
    marginTop: 8, marginBottom: 4,
  },
  victim: {
    fontSize: 46, lineHeight: 52, color: colors.danger, letterSpacing: -1,
    fontFamily: Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' }),
    fontWeight: '800', includeFontPadding: false,
  },
  cellsBlock: {
    marginTop: 26, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20,
  },
  cellsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  cellsValue: {
    fontSize: 84, lineHeight: 92, color: '#FFFFFF', letterSpacing: -3,
    fontFamily: Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' }),
    fontWeight: '800', includeFontPadding: false,
  },
  cellsLabel: { fontSize: 19, color: '#FFFFFF', letterSpacing: 2, paddingBottom: 14, fontWeight: '700' },
  phrase: {
    // Estilo BEBAS, misma convención que la frase motivacional de la carrera:
    // condensada del sistema en cada plataforma (iOS no tiene
    // 'sans-serif-condensed'). Si algún día se carga Bebas Neue real con
    // expo-font, se cambia aquí y en MapScreen.motivationalPhrase.
    fontFamily: Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' }),
    fontSize: 34, lineHeight: 37, color: colors.orangeLight,
    fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: 20, includeFontPadding: false,
  },
  pointsAccent: { color: colors.orange },
  secondaryRow: {
    flexDirection: 'row', gap: 30, marginHorizontal: 24,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14,
  },
  secondaryValue: {
    fontSize: 28, lineHeight: 34, color: '#FFFFFF',
    fontFamily: Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' }),
    fontWeight: '800',
    includeFontPadding: false,
  },
  secondaryLabel: { fontSize: 10, color: colors.textSecondary, letterSpacing: 2, marginTop: 2 },
  footer: {
    // marginTop:'auto' empuja la firma al fondo de la tarjeta, así queda a la
    // misma altura tanto si hay bloque de robo como si no.
    marginTop: 'auto', paddingHorizontal: 22, paddingBottom: 22,
  },
  handle: { fontSize: 13, color: colors.textSecondary, letterSpacing: 1.2, fontWeight: '600' },
  actions: { marginTop: spacing.lg, alignItems: 'center', width: '100%', paddingHorizontal: spacing.lg },
  shareBtn: {
    backgroundColor: colors.orange, borderRadius: radius.full,
    paddingVertical: 15, paddingHorizontal: 40,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minWidth: 220,
  },
  shareBtnText: { fontSize: 15, fontWeight: '800', color: '#000', letterSpacing: 1.5 },
  closeBtn: { marginTop: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  closeBtnText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
});
