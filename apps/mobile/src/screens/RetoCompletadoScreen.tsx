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
const IMG_HEIGHT = IMG_WIDTH * (1842 / 854);

interface Props {
  title: string;
  rewardPoints: number;
  rewardXP: number;
  onClose: () => void;
}

export default function RetoCompletadoScreen({ onClose }: Props) {
  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/onboarding/reto-conseguido.png')}
        style={{ width: IMG_WIDTH, height: IMG_HEIGHT }}
        resizeMode="contain"
      />

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.continueBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={styles.continueBtnText}>CONTINUAR</Text>
          <Ionicons name="arrow-forward" size={20} color="#000" />
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
    paddingHorizontal: spacing.lg, paddingBottom: 60,
  },
  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: 16,
    borderRadius: radius.full, backgroundColor: '#22C55E', width: '100%',
  },
  continueBtnText: { fontSize: 17, fontWeight: '900', color: '#000' },
});
