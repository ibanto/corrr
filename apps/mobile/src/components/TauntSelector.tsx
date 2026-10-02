import React, { useMemo, useState } from 'react';
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

/* Las miniaturas son VERTICALES (9:16), no cuadradas: el cartel se lee entero
 * en la cuadrícula en vez de salir recortado por la mitad. Son un archivo
 * aparte (-v.jpg, 288×512) y no la imagen grande encogida, porque diez
 * imágenes de 576×1024 a la vez se comen la memoria del móvil. */

const TAUNTS: TauntMessage[] = [
  { id: 1,  thumb: require('../../assets/taunts/mensaje1-v.jpg'),  full: require('../../assets/taunts/mensaje1.png') },
  { id: 2,  thumb: require('../../assets/taunts/mensaje2-v.jpg'),  full: require('../../assets/taunts/mensaje2.png') },
  { id: 3,  thumb: require('../../assets/taunts/mensaje3-v.jpg'),  full: require('../../assets/taunts/mensaje3.png') },
  { id: 4,  thumb: require('../../assets/taunts/mensaje4-v.jpg'),  full: require('../../assets/taunts/mensaje4.png') },
  { id: 5,  thumb: require('../../assets/taunts/mensaje5-v.jpg'),  full: require('../../assets/taunts/mensaje5.png') },
  { id: 6,  thumb: require('../../assets/taunts/mensaje6-v.jpg'),  full: require('../../assets/taunts/mensaje6.png') },
  { id: 7,  thumb: require('../../assets/taunts/mensaje7-v.jpg'),  full: require('../../assets/taunts/mensaje7.png') },
  { id: 8,  thumb: require('../../assets/taunts/mensaje8-v.jpg'),  full: require('../../assets/taunts/mensaje8.png') },
  { id: 9,  thumb: require('../../assets/taunts/mensaje9-v.jpg'),  full: require('../../assets/taunts/mensaje9.png') },
  { id: 10, thumb: require('../../assets/taunts/mensaje10-v.jpg'), full: require('../../assets/taunts/mensaje10.png') },
];

const RESPONSES: TauntMessage[] = [
  { id: 1,  thumb: require('../../assets/taunts/respuestas/respuesta1-v.jpg'),  full: require('../../assets/taunts/respuestas/respuesta1.png') },
  { id: 2,  thumb: require('../../assets/taunts/respuestas/respuesta2-v.jpg'),  full: require('../../assets/taunts/respuestas/respuesta2.png') },
  { id: 3,  thumb: require('../../assets/taunts/respuestas/respuesta3-v.jpg'),  full: require('../../assets/taunts/respuestas/respuesta3.png') },
  { id: 4,  thumb: require('../../assets/taunts/respuestas/respuesta4-v.jpg'),  full: require('../../assets/taunts/respuestas/respuesta4.png') },
  { id: 5,  thumb: require('../../assets/taunts/respuestas/respuesta5-v.jpg'),  full: require('../../assets/taunts/respuestas/respuesta5.png') },
  { id: 6,  thumb: require('../../assets/taunts/respuestas/respuesta6-v.jpg'),  full: require('../../assets/taunts/respuestas/respuesta6.png') },
  { id: 7,  thumb: require('../../assets/taunts/respuestas/respuesta7-v.jpg'),  full: require('../../assets/taunts/respuestas/respuesta7.png') },
  { id: 8,  thumb: require('../../assets/taunts/respuestas/respuesta8-v.jpg'),  full: require('../../assets/taunts/respuestas/respuesta8.png') },
  { id: 9,  thumb: require('../../assets/taunts/respuestas/respuesta9-v.jpg'),  full: require('../../assets/taunts/respuestas/respuesta9.png') },
  { id: 10, thumb: require('../../assets/taunts/respuestas/respuesta10-v.jpg'), full: require('../../assets/taunts/respuestas/respuesta10.png') },
];

/** Los de Halloween empiezan en 101 A PROPÓSITO.
 *
 *  El identificador del mensaje viaja al servidor y vuelve al móvil de quien
 *  lo recibe, que lo busca en su catálogo. Si los de Halloween fueran también
 *  del 1 al 10, a quien los recibiera le saldría el mensaje clásico con ese
 *  número: otro dibujo, otra frase. El hueco del 11 al 100 deja sitio para
 *  ampliar los clásicos sin volver a pisarse. */
const PRIMER_ID_HALLOWEEN = 101;

/** La calabaza del juego. La misma que se ve en el mapa, para que quien la
 *  recoja reconozca de qué van estos mensajes. */
const CALABAZA = require('../../assets/calabaza.png');

const HALLOWEEN_TAUNTS: TauntMessage[] = [
  { id: 101, thumb: require('../../assets/taunts/halloween/halloween_taunt_01-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_01.png') },
  { id: 102, thumb: require('../../assets/taunts/halloween/halloween_taunt_02-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_02.png') },
  { id: 103, thumb: require('../../assets/taunts/halloween/halloween_taunt_03-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_03.png') },
  { id: 104, thumb: require('../../assets/taunts/halloween/halloween_taunt_04-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_04.png') },
  { id: 105, thumb: require('../../assets/taunts/halloween/halloween_taunt_05-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_05.png') },
  { id: 106, thumb: require('../../assets/taunts/halloween/halloween_taunt_06-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_06.png') },
  { id: 107, thumb: require('../../assets/taunts/halloween/halloween_taunt_07-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_07.png') },
  { id: 108, thumb: require('../../assets/taunts/halloween/halloween_taunt_08-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_08.png') },
  { id: 109, thumb: require('../../assets/taunts/halloween/halloween_taunt_09-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_09.png') },
  { id: 110, thumb: require('../../assets/taunts/halloween/halloween_taunt_10-v.jpg'), full: require('../../assets/taunts/halloween/halloween_taunt_10.png') },
];

const HALLOWEEN_RESPONSES: TauntMessage[] = [
  { id: 101, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_01-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_01.png') },
  { id: 102, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_02-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_02.png') },
  { id: 103, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_03-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_03.png') },
  { id: 104, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_04-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_04.png') },
  { id: 105, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_05-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_05.png') },
  { id: 106, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_06-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_06.png') },
  { id: 107, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_07-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_07.png') },
  { id: 108, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_08-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_08.png') },
  { id: 109, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_09-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_09.png') },
  { id: 110, thumb: require('../../assets/taunts/halloween_replies/halloween_reply_10-v.jpg'), full: require('../../assets/taunts/halloween_replies/halloween_reply_10.png') },
];

export type TauntMode = 'taunt' | 'response';
type Coleccion = 'clasicos' | 'halloween';

function lista(coleccion: Coleccion, mode: TauntMode): TauntMessage[] {
  if (coleccion === 'halloween') return mode === 'response' ? HALLOWEEN_RESPONSES : HALLOWEEN_TAUNTS;
  return mode === 'response' ? RESPONSES : TAUNTS;
}

/** La imagen grande de un mensaje, para enseñarlo al recibirlo.
 *
 *  Busca en las dos colecciones: el identificador ya dice de cuál es (los de
 *  Halloween van del 101 para arriba). Devuelve null si no lo conoce, que es
 *  lo que le pasa a un móvil con una versión antigua cuando le llega uno
 *  nuevo — mejor eso que enseñar el dibujo equivocado. */
export function getTauntFullImage(mode: TauntMode, id: number): ImageSourcePropType | null {
  const donde = id >= PRIMER_ID_HALLOWEEN ? 'halloween' : 'clasicos';
  return lista(donde, mode).find(t => t.id === id)?.full ?? null;
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
  // Calabazas recogidas. Cada una desbloquea UN mensaje de Halloween. Con
  // cero, la pestaña entera sale como "próximamente".
  calabazas?: number;
  // ¿Está Halloween encendido desde el panel? Mientras no lo esté, la pestaña
  // dice "próximamente" aunque alguien tenga calabazas de una prueba.
  halloweenActivo?: boolean;
  onSend: (messageId: number, mode: TauntMode) => void;
  onClose: () => void;
}

export default function TauntSelector({
  visible, mode = 'taunt', rivalName, zoneName,
  unlockedCount = 1, totalSteals = 0, calabazas = 0, halloweenActivo = false,
  onSend, onClose,
}: Props) {
  const [preview, setPreview] = useState<TauntMessage | null>(null);
  const [coleccion, setColeccion] = useState<Coleccion>('clasicos');

  const title = mode === 'taunt' ? 'RESPONDER' : 'DEVOLVER';
  // Clamp al rango [1, 10] por seguridad.
  const unlocked = Math.max(1, Math.min(10, unlockedCount));
  // Robos que faltan para el próximo desbloqueo (siguiente bloque de 10).
  const stealsToNext = unlocked >= 10 ? 0 : 10 - (totalSteals % 10);
  // Una calabaza, un mensaje. Sin calabazas no hay nada que enseñar todavía.
  const halloweenAbiertos = halloweenActivo ? Math.max(0, Math.min(10, calabazas)) : 0;

  const mensajes = useMemo(() => lista(coleccion, mode), [coleccion, mode]);

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

  const esHalloween = coleccion === 'halloween';

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

        {/* Las dos colecciones. La de Halloween se queda puesta si se cambia de
            pestaña y se vuelve, que es lo que uno espera al comparar. */}
        <View style={styles.pestanas}>
          {(['clasicos', 'halloween'] as Coleccion[]).map(c => {
            const activa = coleccion === c;
            return (
              <TouchableOpacity
                key={c}
                style={[styles.pestana, activa && styles.pestanaActiva]}
                onPress={() => setColeccion(c)}
                activeOpacity={0.8}
              >
                <Text style={[styles.pestanaTexto, activa && styles.pestanaTextoActiva]}>
                  {c === 'clasicos' ? 'CLÁSICOS' : 'HALLOWEEN'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Progreso de desbloqueo. Cada colección se gana de una forma, así que
            la línea dice cuál toca — si no, el usuario no sabe qué hacer para
            abrir los de Halloween. */}
        {!esHalloween && unlocked < 10 && (
          <View style={styles.unlockHint}>
            <Text style={styles.unlockHintText}>
              {unlocked}/10 desbloqueado · roba {stealsToNext} {stealsToNext === 1 ? 'celda' : 'celdas'} más para el siguiente
            </Text>
          </View>
        )}
        {esHalloween && halloweenAbiertos > 0 && halloweenAbiertos < 10 && (
          <View style={styles.unlockHint}>
            <Image source={CALABAZA} style={styles.unlockHintCalabaza} resizeMode="contain" />
            <Text style={styles.unlockHintText}>
              {halloweenAbiertos}/10 desbloqueado · coge otra calabaza para el siguiente
            </Text>
          </View>
        )}

        {/* Halloween sin calabazas: no se enseña la cuadrícula entera con diez
            candados, que es deprimente y además chafa las diez sorpresas. */}
        {esHalloween && halloweenAbiertos === 0 ? (
          <View style={styles.proximamente}>
            <Image source={CALABAZA} style={styles.proximamenteCalabaza} resizeMode="contain" />
            <Text style={styles.proximamenteTitulo}>PRÓXIMAMENTE</Text>
            <Text style={styles.proximamenteTexto}>
              Diez mensajes nuevos, solo para Halloween.{'\n'}
              Cada calabaza que cojas del mapa te abre uno.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          >
            {mensajes.map((msg, i) => {
              // En clásicos manda el número del mensaje; en Halloween, cuántas
              // calabazas lleva. `i` es la posición, que es lo que se compara.
              const isLocked = esHalloween ? i >= halloweenAbiertos : msg.id > unlocked;
              return (
                <TouchableOpacity
                  key={msg.id}
                  style={styles.thumbContainer}
                  onPress={() => {
                    if (isLocked) {
                      if (esHalloween) {
                        const faltan = i + 1 - halloweenAbiertos;
                        Alert.alert(
                          'Mensaje bloqueado',
                          `Coge ${faltan} ${faltan === 1 ? 'calabaza más' : 'calabazas más'} del mapa para desbloquearlo.`,
                        );
                        return;
                      }
                      // Cada mensaje #N pide (N-1)*10 robos.
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
                    // 'contain' y no 'cover': los carteles no miden todos
                    // exactamente lo mismo y recortar se comería palabras.
                    resizeMode="contain"
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
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
  pestanas: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pestana: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  pestanaActiva: {
    borderBottomColor: colors.orange,
  },
  pestanaTexto: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.textSecondary,
  },
  pestanaTextoActiva: {
    color: colors.orange,
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
    // Vertical, como el cartel: así se ve entero en la cuadrícula.
    aspectRatio: 9 / 16,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#000',
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
  unlockHintCalabaza: {
    width: 18,
    height: 18,
  },
  proximamente: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  proximamenteCalabaza: {
    width: 120,
    height: 120,
  },
  proximamenteTitulo: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 3,
    color: colors.orange,
  },
  proximamenteTexto: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Preview
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    // Pantalla completa con medidas EXPLÍCITAS. Nada de position:absolute con
    // insets: sin marco explícito el <Image> cae a su tamaño intrínseco y sale
    // ampliadísimo. Y 'contain' (no 'cover'): los taunts tienen proporciones
    // distintas entre sí y el texto llega al borde, así que recortar se comería
    // palabras. Sobre negro puro las bandas del contain no se ven.
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
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
