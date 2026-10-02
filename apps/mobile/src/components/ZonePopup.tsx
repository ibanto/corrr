import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Image,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

export type PopupType = 'conquered' | 'stolen_by_you' | 'stolen_from_you';

interface Props {
  visible: boolean;
  type: PopupType;
  zoneName?: string;
  points?: number;
  rivalName?: string;
  onClose: () => void;
  onRespond?: () => void;
}

const IMAGES: Record<PopupType, any> = {
  conquered: require('../../assets/onboarding/zona-conquistada.png'),
  stolen_by_you: require('../../assets/onboarding/zona-robada.png'),
  stolen_from_you: require('../../assets/onboarding/te-han-robado.png'),
};

export default function ZonePopup({ visible, type, points, rivalName, onClose, onRespond }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  // Medidas explícitas y reactivas. NO usar position:absolute + insets 0 para
  // dimensionar la imagen: sin un marco explícito el <Image> cae a su tamaño
  // INTRÍNSECO (720x1556 pt) sobre una pantalla de ~393pt, y se veía ampliada
  // mostrando solo un trozo.
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    if (visible) {
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, [visible]);

  const handleClose = () => {
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true })
      .start(() => onClose());
  };

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.container, { opacity }]}>
        {/* Imagen a pantalla completa REAL (edge-to-edge). Va la PRIMERA en el
            JSX para que la X y el botón queden por encima: en RN los hermanos
            posteriores pintan encima, y la imagen ahora es absoluta. */}
        <Image
          source={IMAGES[type]}
          style={{ width, height }}
          resizeMode="contain"
        />

        {/* QUIÉN. El cartel es el mismo dibujo siempre, así que sin esta línea
            no hay forma de saber a quién le has quitado la zona ni quién te la
            ha quitado a ti: el nombre llegaba SOLO en la notificación del
            móvil, y quien las tiene apagadas no se enteraba nunca.
            Va en la franja negra de arriba, que en los dos dibujos está
            limpia, y con hueco a la derecha para no pisar la X. */}
        {!!rivalName && (
          <View style={styles.quien} pointerEvents="none">
            <Text style={styles.quienTexto} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
              {type === 'stolen_from_you'
                ? `${rivalName} te la ha quitado`
                : `Se la has quitado a ${rivalName}`}
            </Text>
            {type === 'stolen_by_you' && !!points && (
              <Text style={styles.quienPuntos}>+{points} puntos</Text>
            )}
          </View>
        )}

        {/* X arriba a la derecha */}
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {/* Botón RESPONDER solo cuando te roban */}
        {type === 'stolen_from_you' && onRespond && (
          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.respondBtn} onPress={() => { handleClose(); setTimeout(onRespond, 250); }}>
              <Ionicons name="flame" size={18} color="#000" />
              <Text style={styles.respondBtnText}>RESPONDER</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    // Negro puro (no colors.bg): el arte de estas cartelas tiene fondo negro y
    // cualquier diferencia de tono se notaba como un "pegote" recortado.
    flex: 1, backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
  },
  quien: {
    position: 'absolute', top: 58, left: spacing.lg, right: 72, zIndex: 10,
    alignItems: 'center',
  },
  quienTexto: {
    color: '#fff', fontSize: 19, fontWeight: '900', textAlign: 'center',
    letterSpacing: 0.3,
    // El dibujo es oscuro pero tiene salpicaduras rojas: la sombra garantiza
    // que el nombre se lea caiga donde caiga.
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  quienPuntos: {
    color: colors.orange, fontSize: 15, fontWeight: '800', marginTop: 2,
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  closeBtn: {
    position: 'absolute', top: 50, right: spacing.md, zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  // (la imagen se dimensiona inline con useWindowDimensions — ver arriba)
  bottomBar: {
    position: 'absolute',
    bottom: 50,
    left: spacing.md,
    right: spacing.md,
  },
  respondBtn: {
    backgroundColor: colors.orange,
    paddingVertical: 16,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  respondBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000',
    letterSpacing: 1,
  },
});
