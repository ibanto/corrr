import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { colors, spacing, radius } from '../theme';

/**
 * «¿A quién se lo mandas?»: al pulsar Devolver, se elige a quién de los que te
 * han robado. Salen todos marcados; se pueden quitar los que no, o mandarlo a
 * todos de una vez.
 */

export type Ladron = { id: string; nombre: string; runId: string | null };

type Props = {
  visible: boolean;
  ladrones: Ladron[];
  onContinuar: (elegidos: Ladron[]) => void;
  onCancelar: () => void;
};

export default function ElegirLadrones({ visible, ladrones, onContinuar, onCancelar }: Props) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  // Cada vez que se abre, todos marcados.
  useEffect(() => {
    if (visible) setMarcados(new Set(ladrones.map(l => l.id)));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const todos = marcados.size === ladrones.length;
  const alternar = (id: string) => setMarcados(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onCancelar}>
      <View style={s.fondo}>
        <View style={s.tarjeta}>
          <Text style={s.titulo}>¿A QUIÉN SE LO MANDAS?</Text>
          <TouchableOpacity
            onPress={() => setMarcados(todos ? new Set() : new Set(ladrones.map(l => l.id)))}
            activeOpacity={0.7}>
            <Text style={s.todos}>{todos ? 'Quitar a todos' : 'Elegir a todos'}</Text>
          </TouchableOpacity>
          <ScrollView style={s.lista}>
            {ladrones.map(l => {
              const on = marcados.has(l.id);
              return (
                <TouchableOpacity key={l.id} style={s.fila} onPress={() => alternar(l.id)} activeOpacity={0.7}>
                  <View style={[s.casilla, on && s.casillaOn]}>
                    {on && <Text style={s.tick}>✓</Text>}
                  </View>
                  <Text style={s.nombre} numberOfLines={1}>{l.nombre}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={[s.boton, marcados.size === 0 && s.botonOff]}
            disabled={marcados.size === 0}
            onPress={() => onContinuar(ladrones.filter(l => marcados.has(l.id)))}
            activeOpacity={0.8}>
            <Text style={s.botonTexto}>
              {marcados.size === 0 ? 'ELIGE A ALGUIEN' : `CONTINUAR (${marcados.size})`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onCancelar} style={s.cancelar} activeOpacity={0.7}>
            <Text style={s.cancelarTexto}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: spacing.md },
  tarjeta: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg ?? 16, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, maxHeight: '80%',
  },
  titulo: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  todos: { color: colors.orange, fontWeight: '800', textAlign: 'center', marginVertical: 10 },
  lista: { flexGrow: 0 },
  fila: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  casilla: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.textMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  casillaOn: { backgroundColor: colors.orange, borderColor: colors.orange },
  tick: { color: '#fff', fontWeight: '900', fontSize: 14 },
  nombre: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
  boton: { backgroundColor: colors.orange, borderRadius: 12, paddingVertical: 14, marginTop: 12, alignItems: 'center' },
  botonOff: { backgroundColor: colors.textMuted },
  botonTexto: { color: '#fff', fontWeight: '900', letterSpacing: 1 },
  cancelar: { paddingVertical: 12, alignItems: 'center' },
  cancelarTexto: { color: colors.textSecondary, fontWeight: '700' },
});
