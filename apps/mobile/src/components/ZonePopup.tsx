import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Image,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

export type PopupType = 'conquered' | 'stolen_by_you' | 'stolen_from_you';

interface Props {
  visible: boolean;
  type: PopupType;
  zoneName?: string;
  points?: number;
  rivalName?: string;
  onClose: () => void;
}

const IMAGES: Record<PopupType, any> = {
  conquered: require('../../assets/onboarding/zona-conquistada.png'),
  stolen_by_you: require('../../assets/onboarding/zona-robada.png'),
  stolen_from_you: require('../../assets/onboarding/te-han-robado.png'),
};

export default function ZonePopup({ visible, type, onClose }: Props) {
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
        {/* X arriba a la derecha */}
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {/* Imagen a pantalla completa */}
        <Image
          source={IMAGES[type]}
          style={styles.image}
          resizeMode="contain"
        />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute', top: 50, right: spacing.md, zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
});
