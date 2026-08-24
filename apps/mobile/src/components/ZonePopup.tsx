import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Image,
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

export default function ZonePopup({ visible, type, onClose, onRespond }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;

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
          style={styles.image}
          resizeMode="contain"
        />

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
  closeBtn: {
    position: 'absolute', top: 50, right: spacing.md, zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  image: {
    // Pantalla completa con 'contain', NO 'cover'. Con 'cover' la imagen salía
    // ampliadísima en el iPhone (solo se veía un trozo), así que no dependemos
    // de que el contenedor se mida bien: 'contain' garantiza que se ve el arte
    // ENTERO pase lo que pase. Como el arte tiene fondo negro puro y el
    // contenedor también, las bandas son invisibles y se ve edge-to-edge.
    ...StyleSheet.absoluteFillObject,
  },
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
