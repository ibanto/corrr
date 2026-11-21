import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, ScrollView } from 'react-native';
import { colors, spacing } from '../theme';

/**
 * La franja negra de «te han robado».
 *
 * Quien pasa unos días sin abrir la app acumulaba un aviso por cada ladrón,
 * uno detrás de otro. Ahora sale UN solo aviso y todos los nombres van aquí,
 * en una franja que los pasa en carrusel (no una lista: con diez ladrones una
 * lista taparía el mapa). Se queda hasta que la cierras con la X.
 */

const PX_POR_SEGUNDO = 45;

type Props = { nombres: string[]; onCerrar: () => void; onPulsar?: () => void };

export default function FranjaLadrones({ nombres, onCerrar, onPulsar }: Props) {
  const [anchoCaja, setAnchoCaja] = useState(0);
  const [anchoTexto, setAnchoTexto] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  const texto = nombres.map(n => n.toUpperCase()).join('   ·   ') + '   ·   ';
  // Si cabe entero no hace falta moverlo: se queda quieto.
  const seMueve = anchoTexto > 0 && anchoCaja > 0 && anchoTexto > anchoCaja;

  useEffect(() => {
    x.setValue(0);
    if (!seMueve) return;
    const anim = Animated.loop(
      Animated.timing(x, {
        toValue: -anchoTexto,
        duration: (anchoTexto / PX_POR_SEGUNDO) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [seMueve, anchoTexto, texto, x]);

  if (nombres.length === 0) return null;

  return (
    <View style={s.franja} accessibilityRole="alert"
      accessibilityLabel={`Te han robado: ${nombres.join(', ')}`}>
      <Text style={s.etiqueta}>😱 TE HAN ROBADO</Text>
      <TouchableOpacity style={s.caja} activeOpacity={0.8} onPress={onPulsar} disabled={!onPulsar}
        onLayout={e => setAnchoCaja(e.nativeEvent.layout.width)}>
        {/* Dentro de un ScrollView horizontal el texto no se encoge al ancho
            de la caja, así que se puede medir entero. */}
        <ScrollView horizontal scrollEnabled={false} pointerEvents="none" showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.contenido}>
          <Animated.View style={[s.pista, { transform: [{ translateX: x }] }]}>
            <Text style={s.nombres} numberOfLines={1}
              onLayout={e => setAnchoTexto(e.nativeEvent.layout.width)}>{texto}</Text>
            {seMueve && <Text style={s.nombres} numberOfLines={1}>{texto}</Text>}
          </Animated.View>
        </ScrollView>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCerrar} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel="Cerrar">
        <Text style={s.cerrar}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  franja: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#000',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 8, gap: 10,
  },
  etiqueta: { color: colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  caja: { flex: 1, overflow: 'hidden', height: 20, justifyContent: 'center' },
  contenido: { alignItems: 'center' },
  pista: { flexDirection: 'row' },
  nombres: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  cerrar: { color: colors.textSecondary, fontSize: 16, fontWeight: '700' },
});
