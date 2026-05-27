import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Modal,
  Dimensions,
  ImageSourcePropType,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const THUMB_WIDTH = (SCREEN_WIDTH - spacing.md * 3) / 2;

interface TauntMessage {
  id: number;
  thumb: ImageSourcePropType;
  full: ImageSourcePropType;
}

const TAUNTS: TauntMessage[] = [
  { id: 1,  thumb: require('../../assets/taunts/mensaje1-s.png'),  full: require('../../assets/taunts/mensaje1.png') },
  { id: 2,  thumb: require('../../assets/taunts/mensaje2-s.png'),  full: require('../../assets/taunts/mensaje2.png') },
  { id: 3,  thumb: require('../../assets/taunts/mensaje3-s.png'),  full: require('../../assets/taunts/mensaje3.png') },
  { id: 4,  thumb: require('../../assets/taunts/mensaje4-s.png'),  full: require('../../assets/taunts/mensaje4.png') },
  { id: 5,  thumb: require('../../assets/taunts/mensaje5-s.png'),  full: require('../../assets/taunts/mensaje5.png') },
  { id: 6,  thumb: require('../../assets/taunts/mensaje6-s.png'),  full: require('../../assets/taunts/mensaje6.png') },
  { id: 7,  thumb: require('../../assets/taunts/mensaje7-s.png'),  full: require('../../assets/taunts/mensaje7.png') },
  { id: 8,  thumb: require('../../assets/taunts/mensaje8-s.png'),  full: require('../../assets/taunts/mensaje8.png') },
  { id: 9,  thumb: require('../../assets/taunts/mensaje9-s.png'),  full: require('../../assets/taunts/mensaje9.png') },
  { id: 10, thumb: require('../../assets/taunts/mensaje10-s.png'), full: require('../../assets/taunts/mensaje10.png') },
];

const RESPONSES: TauntMessage[] = [
  { id: 1,  thumb: require('../../assets/taunts/respuestas/respuesta1-s.png'),  full: require('../../assets/taunts/respuestas/respuesta1.png') },
  { id: 2,  thumb: require('../../assets/taunts/respuestas/respuesta2-s.png'),  full: require('../../assets/taunts/respuestas/respuesta2.png') },
  { id: 3,  thumb: require('../../assets/taunts/respuestas/respuesta3-s.png'),  full: require('../../assets/taunts/respuestas/respuesta3.png') },
  { id: 4,  thumb: require('../../assets/taunts/respuestas/respuesta4-s.png'),  full: require('../../assets/taunts/respuestas/respuesta4.png') },
  { id: 5,  thumb: require('../../assets/taunts/respuestas/respuesta5-s.png'),  full: require('../../assets/taunts/respuestas/respuesta5.png') },
  { id: 6,  thumb: require('../../assets/taunts/respuestas/respuesta6-s.png'),  full: require('../../assets/taunts/respuestas/respuesta6.png') },
  { id: 7,  thumb: require('../../assets/taunts/respuestas/respuesta7-s.png'),  full: require('../../assets/taunts/respuestas/respuesta7.png') },
  { id: 8,  thumb: require('../../assets/taunts/respuestas/respuesta8-s.png'),  full: require('../../assets/taunts/respuestas/respuesta8.png') },
  { id: 9,  thumb: require('../../assets/taunts/respuestas/respuesta9-s.png'),  full: require('../../assets/taunts/respuestas/respuesta9.png') },
  { id: 10, thumb: require('../../assets/taunts/respuestas/respuesta10-s.png'), full: require('../../assets/taunts/respuestas/respuesta10.png') },
];

export type TauntMode = 'taunt' | 'response';

/** Used by MapScreen to render received taunts full-screen. The shared list
 *  is the same one we expose via the picker. */
export function getTauntFullImage(mode: TauntMode, id: number): ImageSourcePropType | null {
  const list = mode === 'response' ? RESPONSES : TAUNTS;
  const item = list.find(t => t.id === id);
  return item?.full ?? null;
}

interface Props {
  visible: boolean;
  mode?: TauntMode;
  rivalName?: string;
  zoneName?: string;
  // Nº de mensajes/respuestas desbloqueados. Por defecto 1 (solo el primero).
  // Se desbloquea +1 por cada 10 celdas robadas a rivales (capped a 10).
  // El mismo nº aplica tanto a TAUNTS como a RESPONSES.
  unlockedCount?: number;
  // Robos totales del usuario, para calcular cuánto le falta al próximo
  // desbloqueo y enseñárselo al usuario cuando pulsa un mensaje bloqueado.
  totalSteals?: number;
  onSend: (messageId: number, mode: TauntMode) => void;
  onClose: () => void;
}

export default function TauntSelector({
  visible, mode = 'taunt', rivalName, zoneName,
  unlockedCount = 1, totalSteals = 0,
  onSend, onClose,
}: Props) {
  const [preview, setPreview] = useState<TauntMessage | null>(null);

  const messages = mode === 'taunt' ? TAUNTS : RESPONSES;
  const title = mode === 'taunt' ? 'RESPONDER' : 'DEVOLVER';
  // Clamp al rango [1, 10] por seguridad.
  const unlocked = Math.max(1, Math.min(10, unlockedCount));
  // Robos que faltan para el próximo desbloqueo (siguiente bloque de 10).
  const stealsToNext = unlocked >= 10 ? 0 : 10 - (totalSteals % 10);

  if (!visible) return null;

  // Preview pantalla completa
  if (preview) {
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent>
        <View style={styles.previewContainer}>
          <Image
            source={preview.full}
            style={styles.previewImage}
            resizeMode="contain"
          />

          {/* Botón cerrar */}
          <TouchableOpacity style={styles.previewClose} onPress={() => setPreview(null)}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>

          {/* Botón enviar */}
          <View style={styles.previewBottom}>
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={() => {
                onSend(preview.id, mode);
                setPreview(null);
              }}
            >
              <Ionicons name="send" size={18} color="#000" />
              <Text style={styles.sendBtnText}>ENVIAR</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // Grid selector 2x5
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn}>
            <Ionicons name="close" size={28} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{title}</Text>
            {rivalName && <Text style={styles.headerSubtitle}>a {rivalName}</Text>}
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Hint con progreso de desbloqueo. Solo se muestra si aún quedan
            mensajes por desbloquear, para no ensuciar la UI cuando ya están
            todos disponibles. */}
        {unlocked < 10 && (
          <View style={styles.unlockHint}>
            <Ionicons name="lock-closed" size={14} color={colors.orange} />
            <Text style={styles.unlockHintText}>
              {unlocked}/10 desbloqueado · roba {stealsToNext} {stealsToNext === 1 ? 'celda' : 'celdas'} más para el siguiente
            </Text>
          </View>
        )}

        {/* Grid */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        >
          {messages.map(msg => {
            const isLocked = msg.id > unlocked;
            return (
              <TouchableOpacity
                key={msg.id}
                style={styles.thumbContainer}
                onPress={() => {
                  if (isLocked) {
                    // Bloqueado: feedback claro al usuario en vez de silencio.
                    // Calculamos cuántos robos faltan para que ESTE mensaje en
                    // concreto se desbloquee (cada mensaje #N requiere
                    // (N-1)*10 robos).
                    const need = Math.max(1, (msg.id - 1) * 10 - totalSteals);
                    Alert.alert(
                      'Mensaje bloqueado',
                      `Roba ${need} ${need === 1 ? 'celda' : 'celdas'} más a rivales para desbloquearlo.`,
                    );
                    return;
                  }
                  setPreview(msg);
                }}
                activeOpacity={isLocked ? 1 : 0.8}
              >
                <Image
                  source={msg.thumb}
                  style={[styles.thumbImage, isLocked && styles.thumbLocked]}
                  resizeMode="cover"
                />
                {isLocked && (
                  <View style={styles.lockOverlay}>
                    <Ionicons name="lock-closed" size={28} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: 50,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.textPrimary,
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.orange,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
    paddingBottom: 40,
  },
  thumbContainer: {
    width: THUMB_WIDTH,
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  // Cuando el mensaje está bloqueado: bajamos opacidad a la imagen y
  // superponemos un overlay oscuro con un candado. Visualmente lee como
  // "no disponible todavía" sin esconder del todo qué hay detrás.
  thumbLocked: {
    opacity: 0.25,
  },
  lockOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  unlockHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: `${colors.orange}15`,
    borderBottomWidth: 1,
    borderBottomColor: `${colors.orange}30`,
  },
  unlockHintText: {
    fontSize: 12,
    color: colors.orange,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Preview
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.75,
  },
  previewClose: {
    position: 'absolute',
    top: 50,
    left: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBottom: {
    position: 'absolute',
    bottom: 50,
    left: spacing.md,
    right: spacing.md,
  },
  sendBtn: {
    backgroundColor: colors.orange,
    paddingVertical: 16,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  sendBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000',
    letterSpacing: 1,
  },
});
