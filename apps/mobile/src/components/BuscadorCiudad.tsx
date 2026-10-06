import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, spacing, radius } from '../theme';
import { api } from '../services/api';

/**
 * Llevar el mapa a otra ciudad.
 *
 * Lo primero que se enseña NO es una caja de texto vacía, sino las ciudades
 * donde CORRR tiene gente: son las únicas donde hay algo que mirar, y así se
 * contesta de paso a "¿dónde se está jugando?". Escribir sirve para filtrarlas
 * y, si no está en la lista, para buscar cualquier otra.
 *
 * La búsqueda la hace el PROPIO MÓVIL (`expo-location`), no Google Maps: la
 * clave de Maps de CORRR está limitada a los SDK de mapa a propósito (§12 del
 * CLAUDE.md) y no puede llamar a Geocoding, que además se cobra. El buscador
 * del teléfono es gratis y no necesita clave.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Llevar el mapa ahí. El nombre es el que se enseña en el cartelito. */
  onIr: (ciudad: string, lat: number, lng: number) => void;
}

/** Sin acentos ni mayúsculas, para que "coruña" encuentre "A Coruña". */
const plano = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export default function BuscadorCiudad({ visible, onClose, onIr }: Props) {
  const [texto, setTexto] = useState('');
  const [ciudades, setCiudades] = useState<string[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTexto('');
    setError(null);
    if (ciudades.length > 0) return;
    api.getCitiesRanking()
      .then(filas => {
        // Una ciudad puede venir escrita de dos formas ("València" y
        // "Valencia"): se queda la primera y las demás se descartan al
        // compararlas sin acentos, igual que hace el servidor.
        const vistas = new Set<string>();
        const limpias: string[] = [];
        for (const f of filas) {
          const c = (f.city || '').trim();
          if (!c || vistas.has(plano(c))) continue;
          vistas.add(plano(c));
          limpias.push(c);
        }
        setCiudades(limpias.sort((a, b) => a.localeCompare(b, 'es')));
      })
      .catch(() => {});
  }, [visible]);

  const filtradas = useMemo(() => {
    const q = plano(texto);
    if (!q) return ciudades;
    return ciudades.filter(c => plano(c).includes(q));
  }, [texto, ciudades]);

  const ir = async (ciudad: string) => {
    Keyboard.dismiss();
    setBuscando(true);
    setError(null);
    try {
      // ", España" para que "Santiago" no acabe en Chile: la app solo pinta
      // territorio dentro de España.
      let sitios = await Location.geocodeAsync(`${ciudad}, España`);
      if (sitios.length === 0) sitios = await Location.geocodeAsync(ciudad);
      if (sitios.length === 0) {
        setError(`No se encuentra "${ciudad}".`);
        return;
      }
      onIr(ciudad, sitios[0].latitude, sitios[0].longitude);
      onClose();
    } catch {
      setError('El buscador del móvil no ha contestado. Inténtalo otra vez.');
    } finally {
      setBuscando(false);
    }
  };

  const escrito = texto.trim();
  const hayQueBuscarFuera = escrito.length >= 3
    && !filtradas.some(c => plano(c) === plano(escrito));

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.cabecera}>
          <TouchableOpacity onPress={onClose} style={styles.cerrar}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.titulo}>IR A UNA CIUDAD</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.cajaBusqueda}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.input}
            value={texto}
            onChangeText={t => { setTexto(t); setError(null); }}
            placeholder="Bilbao, Madrid, Vigo…"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => escrito.length >= 3 && ir(escrito)}
          />
          {texto.length > 0 && (
            <TouchableOpacity onPress={() => setTexto('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {buscando && (
          <View style={styles.centro}><ActivityIndicator size="large" color={colors.orange} /></View>
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}

        {!buscando && (
          <ScrollView contentContainerStyle={styles.lista} keyboardShouldPersistTaps="handled">
            {!texto && (
              <Text style={styles.ayuda}>Donde hay gente de CORRR</Text>
            )}
            {filtradas.map(c => (
              <TouchableOpacity key={c} style={styles.ciudad} onPress={() => ir(c)} activeOpacity={0.8}>
                <Ionicons name="location" size={16} color={colors.orange} />
                <Text style={styles.ciudadNombre} numberOfLines={1}>{c}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}

            {hayQueBuscarFuera && (
              <TouchableOpacity style={styles.ciudad} onPress={() => ir(escrito)} activeOpacity={0.8}>
                <Ionicons name="search" size={16} color={colors.textSecondary} />
                <Text style={styles.ciudadNombre} numberOfLines={1}>Buscar "{escrito}"</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {filtradas.length === 0 && !hayQueBuscarFuera && (
              <Text style={styles.ayuda}>Escribe al menos tres letras.</Text>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: colors.bg },
  cabecera: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 50, paddingBottom: spacing.sm, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  cerrar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titulo: { color: colors.textPrimary, fontSize: 15, fontWeight: '900', letterSpacing: 1.5 },
  cajaBusqueda: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    margin: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bgCard, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: 16, padding: 0 },
  centro: { paddingVertical: spacing.xl, alignItems: 'center' },
  error: {
    color: colors.danger, fontSize: 13, textAlign: 'center',
    paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  lista: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  ayuda: {
    color: colors.textSecondary, fontSize: 11, fontWeight: '800',
    letterSpacing: 1, marginBottom: spacing.xs, marginTop: spacing.xs,
  },
  ciudad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  ciudadNombre: { flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
});
