import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const IMG_WIDTH = SCREEN_WIDTH;
const IMG_HEIGHT = IMG_WIDTH * (1844 / 853);

interface ObjectiveResult {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  current: number;
  target: number;
}

interface Props {
  title: string;
  objectives: ObjectiveResult[];
  onRetry: () => void;
  onClose: () => void;
}

export default function RetoFallidoScreen({ onRetry, onClose }: Props) {
  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/onboarding/reto-fallido.png')}
        style={{ width: IMG_WIDTH, height: IMG_HEIGHT }}
        resizeMode="contain"
      />

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.8}>
          <Ionicons name="refresh" size={20} color="#fff" />
          <Text style={styles.retryBtnText}>INTENTAR DE NUEVO</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={styles.closeBtnText}>VER MIS RETOS</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: spacing.lg, paddingBottom: 20, gap: spacing.sm,
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: 16,
    borderRadius: radius.full, backgroundColor: '#FB0E01', width: '100%',
  },
  retryBtnText: { fontSize: 17, fontWeight: '900', color: '#fff' },
  closeBtn: {
    paddingVertical: 10,
    width: '100%', alignItems: 'center',
  },
  closeBtnText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
});
