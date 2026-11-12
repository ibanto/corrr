import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, ScrollView, ActivityIndicator, RefreshControl,
  AppState, TouchableOpacity, DeviceEventEmitter,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import { api, RankingObjeto, Reto, Proximamente } from '../services/api';

/**
 * RetosScreen — la LISTA DE RETOS, y si no hay ninguno, "Próximamente".
 *
 *  Salen los de todas las ciudades (Iban, 12-nov-2026: «todo el mundo puede
 *  ver los retos de todas las ciudades y se pueden apuntar a cualquier reto»):
 *  primero los de la mía, y cada uno dice dónde es. Los TERMINADOS van al
 *  final, con su sello de FINALIZADO, sin botón de apuntarse y con la lista de
 *  ganadores (los primeros de la clasificación; cuántos, lo dice el panel).
 *  Qué está terminado y quién gana lo decide el servidor.
 *
 *  Cada reto se escribe en el panel y sale entero del servidor (dibujo, fechas,
 *  título, texto, premio): un reto nuevo no pide versión nueva. Se entra en él y
 *  se pulsa ME APUNTO: sus logos solo los ve y los coge quien se apunta, para no
 *  llenar el mapa de tiendas que no le importan a nadie (Iban, 2-nov-2026). Lo
 *  que anuncia "Próximamente" también lo manda el servidor (`PROXIMAMENTE`). Si
 *  no manda nada, la imagen de siempre.
 *
 *  Los retos de verdad (semanales, mensuales, tienda de XP) siguen guardados
 *  en RetosScreen.legacy.tsx.
 */

/** Se emite (DeviceEventEmitter) al apuntarse o borrarse, para que el mapa, que
 *  sigue montado detrás, pinte o quite esos logos sin esperar a moverse. */
export const RETOS_CAMBIADOS_EVENT = 'corrr:retos-cambiados';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CALABAZA = require('../../assets/calabaza.png');
const PROXIMAMENTE = require('../../assets/proximamente.png');
/** Solo el grafiti de PROXIMAMENTE, sin el subtítulo: debajo va el anuncio. */
const PROXIMAMENTE_TITULO = require('../../assets/proximamente-titulo.png');

function LogoReto({ reto, estilo }: { reto: Reto; estilo: any }) {
  // Si el dibujo no se puede bajar se pinta la calabaza, no un hueco.
  const [sinDibujo, setSinDibujo] = useState(false);
  return (
    <Image
      source={reto.imagen && !sinDibujo ? { uri: reto.imagen } : CALABAZA}
      onError={() => setSinDibujo(true)}
      style={estilo}
      resizeMode="contain"
    />
  );
}

export default function RetosScreen() {
  const [cargando, setCargando] = useState(true);
  const [mias, setMias] = useState(0);
  const [ranking, setRanking] = useState<RankingObjeto[]>([]);
  const [retos, setRetos] = useState<Reto[]>([]);
  const [proximamente, setProximamente] = useState<Proximamente | null>(null);
  /** El reto en el que se ha entrado; null = la lista. */
  const [abierto, setAbierto] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(false);

  const reto = retos.find(r => r.tipo === abierto) ?? null;

  const cargar = useCallback(async () => {
    // Si no se ha podido preguntar (undefined), se deja lo que hubiera.
    const r = await api.getRetos();
    if (r) {
      setRetos(r.retos);
      setProximamente(r.proximamente);
    }
    setCargando(false);
  }, []);

  // Al arrancar y cada vez que se vuelve a la app. Un reto se enciende desde el
  // panel en cualquier momento y nadie reinicia la app para enterarse.
  useEffect(() => {
    cargar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') cargar();
    });
    return () => sub.remove();
  }, [cargar]);

  const cargarRanking = useCallback(async (tipo: string) => {
    const rk = await api.getRankingCalabazas(tipo);
    setMias(rk.mias);
    setRanking(rk.ranking);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    setMias(0);
    setRanking([]);
    setFallo(false);
    cargarRanking(abierto);
  }, [abierto, cargarRanking]);

  const cambiarApuntado = async (r: Reto) => {
    setEnviando(true);
    setFallo(false);
    const ok = await api.apuntarmeReto(r.tipo, !r.apuntado);
    if (ok) {
      await Promise.all([cargar(), cargarRanking(r.tipo)]);
      DeviceEventEmitter.emit(RETOS_CAMBIADOS_EVENT);
    } else {
      setFallo(true);
    }
    setEnviando(false);
  };

  if (cargando) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  if (reto) {
    const acabado = reto.finalizado === true;
    const ganadores = reto.ganadores ?? [];
    return (
      <ScrollView
        style={styles.fondo}
        contentContainerStyle={styles.contenido}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => { cargar(); cargarRanking(reto.tipo); }}
            tintColor={colors.orange}
          />
        }
      >
        <TouchableOpacity style={styles.volver} onPress={() => setAbierto(null)} hitSlop={12}>
          <Text style={styles.volverTexto}>‹ Retos</Text>
        </TouchableOpacity>
        <LogoReto reto={reto} estilo={styles.calabaza} />
        {acabado && (
          <View style={styles.finalizado}><Text style={styles.finalizadoTexto}>FINALIZADO</Text></View>
        )}
        {!!reto.fechas && <Text style={[styles.fechas, acabado && styles.pasado]}>{reto.fechas}</Text>}
        {!!reto.ciudad && <Text style={styles.donde}>{reto.ciudad.toUpperCase()}</Text>}
        <Text style={styles.titulo}>{reto.titulo || reto.nombre}</Text>
        {reto.apuntado && (
          <View style={styles.tuyas}>
            <Text style={styles.tuyasNumero}>{mias}</Text>
            <Text style={styles.tuyasTexto}>{mias === 1 ? 'cogido' : 'cogidos'}</Text>
          </View>
        )}
        {/* Terminado: en vez de cómo se juega, quién ha ganado. */}
        {!acabado && !!reto.texto && <Text style={styles.parrafo}>{reto.texto}</Text>}
        {acabado && ganadores.length > 0 && (
          <View style={[styles.tabla, styles.ganadores]}>
            <Text style={styles.premioTitulo}>{ganadores.length === 1 ? 'GANADOR' : 'GANADORES'}</Text>
            {ganadores.map((g, i) => (
              <View key={g.userId} style={[styles.fila, g.mine && styles.filaMia]}>
                <Text style={[styles.puesto, styles.puestoGanador]}>{i + 1}.º</Text>
                <Text style={[styles.nombre, g.mine && styles.textoMio]} numberOfLines={1}>
                  {g.name}
                </Text>
                <Text style={[styles.cuantas, g.mine && styles.textoMio]}>{g.cuantos}</Text>
              </View>
            ))}
            {ganadores.some(g => g.mine) && (
              <Text style={styles.enhorabuena}>¡Enhorabuena! Estás entre los ganadores.</Text>
            )}
          </View>
        )}
        {acabado && ganadores.length === 0 && (
          <Text style={styles.parrafo}>Nadie cogió ningún logo: este reto se queda sin ganadores.</Text>
        )}
        {!!reto.premio && (
          <View style={styles.premio}>
            <Text style={styles.premioTitulo}>EL PREMIO</Text>
            <Text style={styles.avisoTexto}>{reto.premio}</Text>
          </View>
        )}
        {!acabado && (
          <TouchableOpacity
            style={[styles.boton, reto.apuntado && styles.botonSalir, enviando && styles.botonEnviando]}
            onPress={() => cambiarApuntado(reto)}
            disabled={enviando}
          >
            <Text style={[styles.botonTexto, reto.apuntado && styles.botonSalirTexto]}>
              {reto.apuntado ? 'DESAPUNTARME' : 'ME APUNTO'}
            </Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.nota, acabado && styles.notaFinal]}>
          {acabado
            ? 'Este reto ha terminado. Ya no se puede apuntar nadie.'
            : fallo
              ? 'No ha salido. Prueba otra vez.'
              : reto.apuntado
                ? 'Ya estás dentro: sus logos salen en tu mapa.'
                : 'Sus logos solo salen en el mapa de quien se apunta.'}
        </Text>
        {/* La tabla entera solo aporta algo si hay más gente que ganadores. */}
        {ranking.length > 0 && (!acabado || ranking.length > ganadores.length) && (
          <View style={styles.tabla}>
            <Text style={styles.tablaTitulo}>{acabado ? 'CLASIFICACIÓN FINAL' : 'QUIÉN VA GANANDO'}</Text>
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

  if (retos.length > 0) {
    return (
      <ScrollView
        style={styles.fondo}
        contentContainerStyle={styles.lista}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={cargar} tintColor={colors.orange} />
        }
      >
        <Text style={styles.tituloLista}>RETOS</Text>
        {retos.map(r => (
          <TouchableOpacity key={r.tipo} style={styles.tarjeta} onPress={() => setAbierto(r.tipo)}>
            <LogoReto reto={r} estilo={[styles.tarjetaLogo, r.finalizado && styles.logoPasado]} />
            <View style={styles.tarjetaTextos}>
              <Text style={[styles.tarjetaTitulo, r.finalizado && styles.tituloPasado]} numberOfLines={2}>
                {r.titulo || r.nombre}
              </Text>
              {!!r.fechas && (
                <Text style={[styles.tarjetaFechas, r.finalizado && styles.pasado]} numberOfLines={1}>{r.fechas}</Text>
              )}
              <Text style={styles.tarjetaCifra} numberOfLines={1}>
                {r.apuntados === 1 ? '1 apuntado' : `${r.apuntados} apuntados`}
                {r.ciudad ? ` · ${r.ciudad}` : ''}
              </Text>
            </View>
            {r.finalizado ? (
              <View style={styles.selloFin}><Text style={styles.selloFinTexto}>FINALIZADO</Text></View>
            ) : r.apuntado && (
              <View style={styles.sello}><Text style={styles.selloTexto}>DENTRO</Text></View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }

  // Se puede deslizar hacia abajo para volver a preguntar si hay retos.
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

  lista: { paddingHorizontal: spacing.lg, paddingTop: SCREEN_H * 0.06, paddingBottom: 40 },
  tituloLista: {
    color: colors.textPrimary, fontSize: 30, fontWeight: '900', letterSpacing: 1,
    marginBottom: spacing.lg,
  },
  tarjeta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  tarjetaLogo: { width: 64, height: 64 },
  tarjetaTextos: { flex: 1 },
  tarjetaTitulo: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' },
  tarjetaFechas: {
    color: colors.orange, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 4,
  },
  tarjetaCifra: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  sello: {
    backgroundColor: colors.orange, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  selloTexto: { color: '#000', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  // Un reto terminado: sello gris, logo apagado y nada en naranja.
  selloFin: {
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.textSecondary,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  selloFinTexto: { color: colors.textSecondary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  logoPasado: { opacity: 0.45 },
  tituloPasado: { color: colors.textSecondary },
  pasado: { color: colors.textSecondary },
  volver: { alignSelf: 'flex-start', marginBottom: spacing.sm },
  volverTexto: { color: colors.orange, fontSize: 16, fontWeight: '800' },
  boton: {
    backgroundColor: colors.orange, borderRadius: radius.lg, alignSelf: 'stretch',
    paddingVertical: 16, alignItems: 'center', marginTop: spacing.lg,
  },
  botonSalir: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  botonEnviando: { opacity: 0.5 },
  botonTexto: { color: '#000', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  botonSalirTexto: { color: colors.textSecondary },
  nota: {
    color: colors.textMuted, fontSize: 13, textAlign: 'center',
    marginTop: spacing.sm, marginBottom: spacing.md,
  },
  notaFinal: { color: colors.textSecondary, marginTop: spacing.lg },
  finalizado: {
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.textPrimary,
    paddingHorizontal: spacing.md, paddingVertical: 6, marginTop: spacing.md,
  },
  finalizadoTexto: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', letterSpacing: 3 },
  donde: {
    color: colors.textSecondary, fontSize: 11, fontWeight: '800',
    letterSpacing: 2, marginTop: 4, textAlign: 'center',
  },
  ganadores: { borderColor: colors.orange, marginTop: 0, marginBottom: spacing.md },
  puestoGanador: { color: colors.orange, width: 30 },
  enhorabuena: {
    color: colors.orange, fontSize: 14, fontWeight: '800', textAlign: 'center', marginTop: spacing.md,
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
