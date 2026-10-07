import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, Notificacion } from '../services/api';

/**
 * La bandeja: lo que te ha pasado a ti.
 *
 * Robos y cercos salían antes a pantalla completa, uno por uno, nada más abrir
 * la app. Eso es machacón —el robo es cosa de todos los días— y además tapaba
 * los carteles de verdad, los que anuncian algo a todo el mundo. Aquí están
 * todos juntos y se miran cuando a uno le apetece.
 */

const CORTE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** El sello del cartel viene como "−28\nCELDAS": número arriba, unidad abajo.
 *  El signo decide el color, que es lo que se ve antes de leer nada: rojo si
 *  pierdes, verde si ganas. El menos es el de verdad (U+2212), no el guion. */
function sello(nota?: string | null): { cifra: string; unidad: string; malo: boolean } | null {
  if (!nota) return null;
  const [cifra, ...resto] = nota.split('\n');
  if (!cifra) return null;
  return { cifra: cifra.trim(), unidad: resto.join(' ').trim(), malo: /^[−-]/.test(cifra.trim()) };
}

/** "hace 2 horas", "ayer", "el 28 de sep". */
function cuando(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return min <= 1 ? 'ahora mismo' : `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return `hace ${d} días`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/** Cada tipo de nota con su dibujo y su frase de tres palabras. Lo que se lee
 *  de un vistazo es el icono, el nombre y el número: el párrafo sigue estando
 *  debajo, pero ya no hace falta leerlo para enterarse de lo que ha pasado. */
const TIPOS: Record<string, { icono: any; frase: string }> = {
  'Te han robado':           { icono: 'flash',        frase: 'te ha robado' },
  'Te han cercado':          { icono: 'lock-closed',  frase: 'te ha cercado' },
  'Cerco cobrado':           { icono: 'flag',         frase: 'cerco cobrado' },
  'Territorio devuelto':     { icono: 'arrow-undo',   frase: 'te lo han devuelto' },
  'Cerco demasiado grande':  { icono: 'hourglass',    frase: 'cerco pendiente' },
};
const tipoDe = (titulo: string) => TIPOS[titulo] ?? { icono: 'notifications', frase: titulo.toLowerCase() };

/** La inicial para el círculo. Si el nombre empieza por algo que no es una
 *  letra (un emoji, un número), mejor no poner círculo que poner un cuadro. */
const inicial = (n?: string | null) => {
  const c = (n ?? '').trim().charAt(0).toUpperCase();
  return CORTE.includes(c) ? c : null;
};

/** Los *asteriscos* del texto salen en naranja, como en los carteles. */
function conResaltes(texto: string) {
  return texto.split('*').map((trozo, i) =>
    i % 2 === 1
      ? <Text key={i} style={styles.resalte}>{trozo}</Text>
      : <Text key={i}>{trozo}</Text>);
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function Notificaciones({ visible, onClose }: Props) {
  const [lista, setLista] = useState<Notificacion[]>([]);
  const [cargando, setCargando] = useState(false);
  /** Cuáles están desplegadas. El texto entero sigue estando: se toca la nota
      y se abre. Lo que cambia es que ya no hay que leerlo para enterarse. */
  const [abiertas, setAbiertas] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setCargando(true);
    api.getNotificaciones()
      .then(r => setLista(r.notificaciones))
      .finally(() => setCargando(false));
    // Se dan por vistas al abrir: si has llegado hasta aquí, ya las has visto.
    api.marcarNotificacionesVistas();
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.cabecera}>
          <TouchableOpacity onPress={onClose} style={styles.cerrar}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.titulo}>LO QUE TE HA PASADO</Text>
          <View style={{ width: 40 }} />
        </View>

        {cargando ? (
          <View style={styles.centro}><ActivityIndicator size="large" color={colors.orange} /></View>
        ) : lista.length === 0 ? (
          <View style={styles.centro}>
            <Ionicons name="shield-checkmark-outline" size={48} color={colors.textMuted} />
            <Text style={styles.vacio}>Nadie te ha tocado el territorio.{'\n'}De momento.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.lista}>
            {lista.map(n => {
              const s = sello(n.nota);
              const t = tipoDe(n.titulo);
              const ini = inicial(n.quien);
              const abierta = abiertas.has(n.id);
              return (
                <TouchableOpacity
                  key={n.id}
                  style={[styles.nota, !n.vista && styles.notaNueva]}
                  activeOpacity={0.85}
                  onPress={() => setAbiertas(prev => {
                    const c = new Set(prev);
                    c.has(n.id) ? c.delete(n.id) : c.add(n.id);
                    return c;
                  })}
                >
                  <View style={styles.linea}>
                    {/* El dibujo dice QUÉ ha pasado y el color si es bueno o
                        malo, antes de leer una sola palabra. */}
                    <View style={[styles.icono,
                      !s ? styles.fondoSuelto : s.malo ? styles.fondoMalo : styles.fondoBueno]}>
                      <Ionicons
                        name={t.icono}
                        size={20}
                        color={!s ? colors.textSecondary : s.malo ? colors.danger : colors.success}
                      />
                      {ini && <View style={styles.inicial}><Text style={styles.inicialTexto}>{ini}</Text></View>}
                    </View>

                    <View style={styles.medio}>
                      <Text style={styles.quien} numberOfLines={1}>{n.quien ?? n.titulo}</Text>
                      <Text style={styles.frase} numberOfLines={1}>
                        {n.quien ? `${t.frase} · ${cuando(n.creado_at)}` : cuando(n.creado_at)}
                      </Text>
                    </View>

                    {s && (
                      <View style={styles.cifras}>
                        <Text
                          style={[styles.cifra, s.malo ? styles.textoMalo : styles.textoBueno]}
                          numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}
                        >{s.cifra}</Text>
                        <Text style={styles.unidad}>{s.unidad}</Text>
                      </View>
                    )}
                    <Ionicons
                      name={abierta ? 'chevron-up' : 'chevron-down'}
                      size={14} color={colors.textMuted}
                    />
                  </View>

                  {abierta && <Text style={styles.notaTexto}>{conResaltes(n.texto)}</Text>}
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
  fondo: { flex: 1, backgroundColor: colors.bg },
  cabecera: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 50, paddingBottom: spacing.sm, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  cerrar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titulo: { color: colors.textPrimary, fontSize: 15, fontWeight: '900', letterSpacing: 1.5 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  vacio: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  lista: { padding: spacing.md, gap: spacing.sm },
  nota: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
  },
  linea: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icono: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  fondoMalo: { backgroundColor: 'rgba(239, 68, 68, 0.10)', borderColor: 'rgba(239, 68, 68, 0.35)' },
  fondoBueno: { backgroundColor: 'rgba(34, 197, 94, 0.10)', borderColor: 'rgba(34, 197, 94, 0.35)' },
  fondoSuelto: { backgroundColor: colors.bgCardAlt, borderColor: colors.border },
  // La inicial de quien te lo ha hecho, colgada del icono. Pequeña: lo que
  // manda es el dibujo; esto solo dice de quién.
  inicial: {
    position: 'absolute', right: -3, bottom: -3,
    width: 19, height: 19, borderRadius: 10,
    backgroundColor: colors.bgCardAlt, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  inicialTexto: { color: colors.textPrimary, fontSize: 10, fontWeight: '900' },
  medio: { flex: 1 },
  quien: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  frase: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  cifras: { alignItems: 'flex-end', minWidth: 68 },
  cifra: { fontSize: 20, fontWeight: '900' },
  unidad: { color: colors.textSecondary, fontSize: 8, letterSpacing: 1 },
  textoMalo: { color: colors.danger },
  textoBueno: { color: colors.success },
  // Un filo naranja a la izquierda en las que aún no has visto. Sin globos ni
  // "NUEVO": se nota de un vistazo y no grita.
  notaNueva: { borderLeftWidth: 3, borderLeftColor: colors.orange },
  notaCabecera: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginBottom: 4, gap: spacing.sm,
  },
  notaTitulo: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  notaCuando: { color: colors.textMuted, fontSize: 12 },
  notaTexto: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  resalte: { color: colors.orange, fontWeight: '700' },
});
