import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, ScrollView, ActivityIndicator, RefreshControl,
  AppState,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import { api, RankingObjeto } from '../services/api';

/**
 * RetosScreen — hoy, el cartel de Halloween.
 *
 * Tiene dos caras y las decide el SERVIDOR, no la fecha del teléfono ni la
 * versión instalada: el panel enciende Halloween cuando toca.
 *
 *   · Apagado  → "prepárate": qué va a pasar y cuándo.
 *   · Encendido → el evento en marcha, con cuántas llevas y quién gana.
 *
 *  Se hace así porque la versión con las calabazas se sube a las tiendas
 *  semanas antes del 29 de octubre y Apple aprueba cuando le parece. Atar el
 *  evento a la fecha de publicación sería jugársela.
 *
 *  Los retos de verdad (semanales, mensuales, tienda de XP) siguen guardados
 *  en RetosScreen.legacy.tsx.
 */

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CALABAZA = require('../../assets/calabaza.png');

export default function RetosScreen() {
  const [cargando, setCargando] = useState(true);
  const [halloween, setHalloween] = useState(false);
  const [mias, setMias] = useState(0);
  const [ranking, setRanking] = useState<RankingObjeto[]>([]);

  const cargar = useCallback(async () => {
    // Si no se ha podido preguntar (null), se deja la pantalla como estaba en
    // vez de dar por hecho que el evento está apagado.
    const ajustes = await api.getAjustes();
    const encendido = ajustes ? ajustes.halloween : halloween;
    if (ajustes) setHalloween(ajustes.halloween);
    if (encendido) {
      const r = await api.getRankingCalabazas();
      setMias(r.mias);
      setRanking(r.ranking);
    }
    setCargando(false);
  }, [halloween]);

  // Al arrancar y cada vez que se vuelve a la app. El interruptor del panel
  // se puede dar en cualquier momento y nadie reinicia la app para enterarse.
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

  return (
    <ScrollView
      style={styles.fondo}
      contentContainerStyle={styles.contenido}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={cargar} tintColor={colors.orange} />
      }
    >
      <Image source={CALABAZA} style={styles.calabaza} resizeMode="contain" />

      {/* Las fechas van escritas AQUÍ, dentro de la app: para cambiarlas hace
          falta una versión nueva en las tiendas. El evento es del 23 de
          octubre al 1 de noviembre; si alguna vez se mueve, esto se mueve con
          él o la app contradice al cartel. */}
      <Text style={styles.fechas}>
        {halloween ? 'HASTA EL 1 DE NOVIEMBRE' : 'DEL 23 DE OCTUBRE AL 1 DE NOVIEMBRE'}
      </Text>
      <Text style={styles.titulo}>
        {halloween ? 'HAY CALABAZAS\nEN LA CALLE' : 'ESTE HALLOWEEN,\nPREPÁRATE'}
      </Text>

      {halloween ? (
        <>
          <View style={styles.tuyas}>
            <Text style={styles.tuyasNumero}>{mias}</Text>
            <Text style={styles.tuyasTexto}>
              {mias === 1 ? 'calabaza cogida' : 'calabazas cogidas'}
            </Text>
          </View>
          <Text style={styles.parrafo}>
            Sal a correr y píllalas. <Text style={styles.resalte}>200 puntos</Text> cada una, y cada
            una te abre un mensaje nuevo para picar a tus rivales.
          </Text>

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
        </>
      ) : (
        <>
          <Text style={styles.parrafo}>
            Van a salir calabazas repartidas por toda la ciudad, en cualquier calle de verdad —
            no hace falta que haya corrido nadie por ahí. Pisa una mientras corres y son{' '}
            <Text style={styles.resalte}>200 puntos</Text>.
          </Text>
          <Text style={styles.parrafo}>
            En cuanto alguien se come una, nace otra <Text style={styles.resalte}>en otro sitio</Text>.
            Así que ya puedes ir olvidándote de dar vueltas a la misma manzana.
          </Text>
          <Text style={styles.parrafo}>
            Cada calabaza que cojas te desbloquea{' '}
            <Text style={styles.resalte}>un mensaje nuevo</Text> para picar a tus rivales. Hay diez,
            y solo se consiguen así.
          </Text>
          <Text style={styles.parrafo}>
            Al que más coja le ponemos el nombre en la app. Al resto, que les quiten lo corrido.
          </Text>
          <Text style={styles.pie}>Ya te avisaremos. Ve calentando.</Text>
        </>
      )}
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

  calabaza: { width: SCREEN_W * 0.5, height: SCREEN_W * 0.5 },

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
  resalte: { color: colors.orange, fontWeight: '800' },
  pie: {
    color: colors.textMuted, fontSize: 13, fontStyle: 'italic',
    marginTop: spacing.sm, textAlign: 'center',
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
