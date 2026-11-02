import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, ScrollView, ActivityIndicator, RefreshControl,
  AppState,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import { api, RankingObjeto, Evento, Proximamente } from '../services/api';

/**
 * RetosScreen — la CAMPAÑA DE MARCA si el panel tiene una encendida para esta
 * persona, y si no, "Próximamente".
 *
 *  La campaña sale entera del servidor (dibujo, fechas, título, texto, premio):
 *  una campaña nueva no pide versión nueva. Lo que anuncia "Próximamente"
 *  (el gran reto de Navidad, en noviembre de 2026) también: es `PROXIMAMENTE`
 *  en el servidor. Si no manda nada, la imagen de siempre.
 *
 *  Hasta la 1.11.12 aquí estaba el cartel de Halloween, escrito dentro de la
 *  app. Se quitó al acabar el evento (Iban, 2-nov-2026): con las fechas y los
 *  textos metidos en la app, cada evento obligaba a sacar versión, y pasado el
 *  1 de noviembre solo podía decir cosas viejas.
 *
 *  Los retos de verdad (semanales, mensuales, tienda de XP) siguen guardados
 *  en RetosScreen.legacy.tsx.
 */

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CALABAZA = require('../../assets/calabaza.png');
const PROXIMAMENTE = require('../../assets/proximamente.png');
/** Solo el grafiti de PROXIMAMENTE, sin el subtítulo: debajo va el anuncio. */
const PROXIMAMENTE_TITULO = require('../../assets/proximamente-titulo.png');

export default function RetosScreen() {
  const [cargando, setCargando] = useState(true);
  const [mias, setMias] = useState(0);
  const [ranking, setRanking] = useState<RankingObjeto[]>([]);
  const [evento, setEvento] = useState<Evento | null>(null);
  const [proximamente, setProximamente] = useState<Proximamente | null>(null);
  /** El dibujo de la campaña no se ha podido bajar: se pinta la calabaza en
   *  vez de dejar un hueco. */
  const [sinDibujo, setSinDibujo] = useState(false);

  const cargar = useCallback(async () => {
    // Si no se ha podido preguntar (undefined), se deja lo que hubiera.
    const r = await api.getRetos();
    if (r) {
      setEvento(r.evento);
      setProximamente(r.proximamente);
      if (r.evento) {
        const rk = await api.getRankingCalabazas(r.evento.tipo);
        setMias(rk.mias);
        setRanking(rk.ranking);
      }
    }
    setCargando(false);
  }, []);

  // Al arrancar y cada vez que se vuelve a la app. La campaña se enciende
  // desde el panel en cualquier momento y nadie reinicia la app para enterarse.
  useEffect(() => {
    cargar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') cargar();
    });
    return () => sub.remove();
  }, [cargar]);

  if (cargando) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  if (evento) {
    return (
      <ScrollView
        style={styles.fondo}
        contentContainerStyle={styles.contenido}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={cargar} tintColor={colors.orange} />
        }
      >
        <Image
          source={evento.imagen && !sinDibujo ? { uri: evento.imagen } : CALABAZA}
          onError={() => setSinDibujo(true)}
          style={styles.calabaza}
          resizeMode="contain"
        />
        {!!evento.fechas && <Text style={styles.fechas}>{evento.fechas}</Text>}
        <Text style={styles.titulo}>{evento.titulo || evento.nombre}</Text>
        <View style={styles.tuyas}>
          <Text style={styles.tuyasNumero}>{mias}</Text>
          <Text style={styles.tuyasTexto}>{mias === 1 ? 'cogido' : 'cogidos'}</Text>
        </View>
        {!!evento.texto && <Text style={styles.parrafo}>{evento.texto}</Text>}
        {!!evento.premio && (
          <View style={styles.premio}>
            <Text style={styles.premioTitulo}>EL PREMIO</Text>
            <Text style={styles.avisoTexto}>{evento.premio}</Text>
          </View>
        )}
        {ranking.length > 0 && (
          <View style={styles.tabla}>
            <Text style={styles.tablaTitulo}>QUIÉN VA GANANDO</Text>
            {ranking.slice(0, 8).map((r, i) => (
              <View key={r.userId} style={[styles.fila, r.mine && styles.filaMia]}>
                <Text style={[styles.puesto, r.mine && styles.textoMio]}>{i + 1}</Text>
                <Text style={[styles.nombre, r.mine && styles.textoMio]} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={[styles.cuantas, r.mine && styles.textoMio]}>{r.cuantos}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    );
  }

  // Se puede deslizar hacia abajo para volver a preguntar si hay campaña.
  const recargar = (
    <RefreshControl refreshing={false} onRefresh={cargar} tintColor={colors.orange} />
  );

  if (proximamente) {
    return (
      <ScrollView
        style={styles.fondoNegro}
        contentContainerStyle={styles.proximo}
        refreshControl={recargar}
      >
        <Image source={PROXIMAMENTE_TITULO} style={styles.proximamenteTitulo} resizeMode="contain" />
        <View style={styles.anuncio}>
          <Text style={styles.titulo}>{proximamente.titulo}</Text>
          {!!proximamente.destacado && (
            <View style={styles.cinta}>
              <Text style={styles.cintaTexto}>{proximamente.destacado}</Text>
            </View>
          )}
          {!!proximamente.texto && <Text style={styles.parrafo}>{proximamente.texto}</Text>}
        </View>
      </ScrollView>
    );
  }

  // La misma imagen que había antes de Halloween: lleva dentro el icono,
  // "PRÓXIMAMENTE" y el subtítulo.
  return (
    <ScrollView style={styles.fondo} contentContainerStyle={styles.proximo} refreshControl={recargar}>
      <Image source={PROXIMAMENTE} style={styles.proximamente} resizeMode="contain" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: colors.bg },
  centro: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  contenido: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: SCREEN_H * 0.06,
    paddingBottom: 40,
  },

  proximo: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  proximamente: {
    width: SCREEN_W,
    height: SCREEN_H * 0.85, // deja un pequeño margen vertical para la barra de pestañas
  },
  // Negro puro como el fondo de la imagen, para que no se le vea el borde.
  fondoNegro: { flex: 1, backgroundColor: '#000' },
  proximamenteTitulo: { width: SCREEN_W, height: SCREEN_W * (570 / 853) },
  anuncio: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: 40 },
  cinta: {
    backgroundColor: colors.orange, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    marginBottom: spacing.lg, transform: [{ rotate: '-2deg' }],
  },
  cintaTexto: { color: '#000', fontSize: 20, fontWeight: '900', letterSpacing: 1 },

  calabaza: { width: SCREEN_W * 0.5, height: SCREEN_W * 0.5 },

  premio: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.orange,
    padding: spacing.md, marginTop: spacing.sm, width: '100%',
  },
  premioTitulo: {
    color: colors.orange, fontSize: 13, fontWeight: '900',
    letterSpacing: 1, marginBottom: 4,
  },
  avisoTexto: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 2 },
  fechas: {
    color: colors.orange, fontSize: 12, fontWeight: '800',
    letterSpacing: 2, marginTop: spacing.sm,
  },
  titulo: {
    color: colors.textPrimary, fontSize: 30, fontWeight: '900',
    letterSpacing: 1, textAlign: 'center', lineHeight: 35,
    marginTop: spacing.xs, marginBottom: spacing.lg,
  },

  parrafo: {
    color: colors.textSecondary, fontSize: 15, lineHeight: 23,
    textAlign: 'center', marginBottom: spacing.md,
  },

  tuyas: {
    flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tuyasNumero: { color: colors.orange, fontSize: 44, fontWeight: '900' },
  tuyasTexto: { color: colors.textSecondary, fontSize: 15 },

  tabla: {
    alignSelf: 'stretch', marginTop: spacing.md,
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  tablaTitulo: {
    color: colors.textSecondary, fontSize: 11, fontWeight: '800',
    letterSpacing: 1, marginBottom: spacing.sm,
  },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  filaMia: { backgroundColor: colors.orangeGlow, borderRadius: radius.sm },
  puesto: { color: colors.textMuted, fontSize: 13, fontWeight: '800', width: 22 },
  nombre: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 },
  cuantas: { color: colors.textSecondary, fontSize: 15, fontWeight: '800' },
  textoMio: { color: colors.orange },
});
