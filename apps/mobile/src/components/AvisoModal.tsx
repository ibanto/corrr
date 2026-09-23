import React from 'react';
import {
  View, Text, StyleSheet, Modal, Image, TouchableOpacity, Linking, Platform,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import type { Aviso } from '../services/api';

/**
 * El aviso que manda el servidor: sale al abrir la app y se escribe desde el
 * panel, sin sacar versión nueva. Sirve para anunciar una novedad, lanzar un
 * reto o avisar de algo puntual.
 *
 * A propósito es tonto: enseña lo que le dan (título, texto, foto opcional y
 * un botón) y no sabe nada de a quién le toca ni de cuándo — eso lo decide el
 * servidor. Así un aviso nuevo nunca necesita tocar la app.
 *
 * El aspecto es el de la marca: cartel de calle, tipografía estrecha y
 * pesada, naranja sobre negro, marco con la esquina cortada y rayas de obra.
 * Lo único que pone quien escribe el aviso es el texto: los adornos salen
 * solos, así que un aviso escrito con prisa sigue teniendo buena pinta.
 */

interface Props {
  visible: boolean;
  aviso: Aviso;
  onClose: () => void;
}

const CONDENSADA = Platform.select({ ios: 'AvenirNextCondensed-Heavy', android: 'sans-serif-condensed' });

/** Palabras entre asteriscos → en naranja. Es toda la "negrita" que hace
 *  falta para resaltar lo importante desde el panel, sin complicar a quien
 *  escribe: "Sal, *prueba el territorio* y cuéntanos". */
function textoConResaltes(texto: string) {
  return texto.split(/\*([^*]+)\*/g).map((trozo, i) => (
    i % 2 === 1
      ? <Text key={i} style={styles.resalte}>{trozo}</Text>
      : <Text key={i}>{trozo}</Text>
  ));
}

/** El título se parte en dos: lo de delante en blanco y la última palabra
 *  sobre el bloque naranja, como un subrayado de rotulador. Con una sola
 *  palabra, toda va en el bloque. */
function partirTitulo(titulo: string): { arriba: string | null; abajo: string } {
  const limpio = titulo.trim().replace(/\s+/g, ' ');
  const corte = limpio.lastIndexOf(' ');
  if (corte === -1) return { arriba: null, abajo: limpio };
  return { arriba: limpio.slice(0, corte), abajo: limpio.slice(corte + 1) };
}

/** Retícula de fondo, muy floja: el motivo de las celdas del mapa, que es de
 *  lo que va el juego. Se dibuja con líneas, no con una imagen, para que no
 *  pese nada ni haya que subir ningún archivo. */
function Textura() {
  return (
    <View style={styles.textura} pointerEvents="none">
      {Array.from({ length: 7 }).map((_, f) => (
        <View key={f} style={[styles.texturaFila, { top: 26 * f }]}>
          {Array.from({ length: 9 }).map((__, c) => (
            <View key={c} style={[styles.ladrillo, { left: 48 * c + (f % 2 ? 24 : 0) }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** El marco naranja, dibujado a mano en vez de con `borderWidth`, porque las
 *  dos esquinas van cortadas en diagonal (arriba a la izquierda y abajo a la
 *  derecha) y un borde normal no sabe hacer eso. Como el cartel y lo que hay
 *  detrás son casi negros, basta con que la LÍNEA siga el corte para que la
 *  esquina se lea cortada. */
const CORTE = 34;
const DIAGONAL = Math.round(CORTE * Math.SQRT2);
function Marco() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.lado, { top: 0, left: CORTE, right: 0, height: 2 }]} />
      <View style={[styles.lado, { top: 0, bottom: CORTE, right: 0, width: 2 }]} />
      <View style={[styles.lado, { bottom: 0, right: CORTE, left: 0, height: 2 }]} />
      <View style={[styles.lado, { bottom: 0, top: CORTE, left: 0, width: 2 }]} />
      <View style={[styles.lado, styles.diagonal, { left: CORTE / 2 - DIAGONAL / 2, top: CORTE / 2 - 1 }]} />
      <View style={[styles.lado, styles.diagonal, { right: CORTE / 2 - DIAGONAL / 2, bottom: CORTE / 2 - 1 }]} />
    </View>
  );
}

/** Rayas de obra de la esquina. Decoración: no dice nada, solo marca el tono. */
function RayasDeObra() {
  return (
    <View style={styles.rayas}>
      {Array.from({ length: 9 }).map((_, i) => <View key={i} style={styles.raya} />)}
    </View>
  );
}

export default function AvisoModal({ visible, aviso, onClose }: Props) {
  const { arriba, abajo } = partirTitulo(aviso.titulo);
  const boton = ((aviso.boton ?? '').trim() || 'VALE').toUpperCase();
  const nota = (aviso.nota ?? '').trim();

  const pulsar = () => {
    // Si el aviso lleva enlace, el botón lo abre y cierra. Si el enlace falla
    // (una dirección mal escrita en el panel), el aviso se cierra igual: no se
    // deja a nadie atrapado en un pop-up por una errata.
    const enlace = (aviso.enlace ?? '').trim();
    if (enlace) Linking.openURL(enlace).catch(() => {});
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.marco}>
          <Textura />
          {/* Fondo del cartel: trazos en diagonal, como el asfalto marcado. */}
          <View style={styles.trazos} pointerEvents="none">
            <View style={[styles.trazo, { top: 26, left: -60, width: 300 }]} />
            <View style={[styles.trazo, { top: 120, left: -30, width: 420, opacity: 0.12 }]} />
            <View style={[styles.trazo, { top: 236, left: 60, width: 280, opacity: 0.1 }]} />
            <View style={[styles.punto, { top: 84, right: 96 }]} />
            <View style={[styles.punto, { bottom: 92, right: 40 }]} />
          </View>

          <RayasDeObra />
          {!!aviso.sello && <Text style={styles.sello}>{aviso.sello.toUpperCase()}</Text>}
          {!!aviso.etiqueta && <Text style={styles.etiqueta}>{aviso.etiqueta.toUpperCase()}</Text>}

          {!!aviso.imagen && (
            <Image source={{ uri: aviso.imagen }} style={styles.imagen} resizeMode="cover" />
          )}

          <View style={styles.titulo}>
            {!!arriba && (
              <View>
                <Text style={styles.tituloArriba}>{arriba.toUpperCase()}</Text>
                <View style={styles.subrayado} />
              </View>
            )}
            <View style={styles.bloque}>
              <Text style={styles.tituloAbajo}>{abajo.toUpperCase()}</Text>
            </View>
          </View>

          <Text style={styles.texto}>{textoConResaltes(aviso.texto)}</Text>

          <View style={styles.pie}>
            <TouchableOpacity style={styles.boton} onPress={pulsar} accessibilityRole="button" activeOpacity={0.85}>
              <View style={styles.botonDentro}>
                <View style={styles.triangulo} />
                <Text style={styles.botonTexto}>{boton}</Text>
              </View>
            </TouchableOpacity>
            {!!nota && (
              <View style={styles.nota}>
                {nota.split('\n').slice(0, 2).map((linea, i) => (
                  <Text key={i} style={styles.notaTexto}>{linea.toUpperCase()}</Text>
                ))}
              </View>
            )}
          </View>

          {/* La esquina cortada del marco: un cuadrado girado 45°, cuyo borde
              de arriba queda justo sobre el corte. */}
          <Marco />
        </View>
      </View>
    </Modal>
  );
}

const NEGRO = '#080808';

const styles = StyleSheet.create({
  fondo: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.93)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.md,
  },
  marco: {
    width: '100%', maxWidth: 420, backgroundColor: NEGRO,
    paddingTop: spacing.lg, paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg, overflow: 'hidden',
    // El resplandor naranja del cartel, como el del botón de empezar carrera.
    shadowColor: colors.orange, shadowOpacity: 0.45, shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 }, elevation: 12,
  },
  lado: { position: 'absolute', backgroundColor: colors.orange },
  diagonal: { width: DIAGONAL, height: 2, transform: [{ rotate: '-45deg' }] },
  trazos: { ...StyleSheet.absoluteFillObject },
  trazo: {
    position: 'absolute', height: 2, backgroundColor: colors.orange,
    opacity: 0.16, transform: [{ rotate: '-34deg' }],
  },
  punto: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff', opacity: 0.45 },
  textura: { ...StyleSheet.absoluteFillObject, opacity: 0.07 },
  texturaFila: { position: 'absolute', left: 0, right: 0, height: 26, borderTopWidth: 1, borderTopColor: '#fff' },
  ladrillo: { position: 'absolute', top: 0, width: 1, height: 26, backgroundColor: '#fff' },

  // Rayas de obra, arriba a la derecha.
  rayas: {
    position: 'absolute', top: 0, right: 0, height: 30, width: 132,
    flexDirection: 'row', overflow: 'hidden',
  },
  raya: {
    width: 6, height: 64, marginRight: 6, backgroundColor: colors.orange,
    transform: [{ skewX: '-20deg' }, { translateY: -14 }],
  },
  sello: {
    position: 'absolute', top: 38, right: spacing.lg,
    color: '#fff', fontSize: 13, fontFamily: CONDENSADA, fontWeight: '700', letterSpacing: 1.2,
  },
  etiqueta: {
    color: '#fff', fontSize: 11, fontWeight: '800',
    letterSpacing: 2, marginBottom: 2,
  },

  imagen: {
    width: '100%', height: 120, borderRadius: radius.sm,
    marginBottom: spacing.md, backgroundColor: '#111',
  },

  titulo: { alignItems: 'flex-start' },
  tituloArriba: {
    color: '#fff', fontSize: 44, lineHeight: 46, fontFamily: CONDENSADA,
    fontWeight: '900', letterSpacing: 0.5,
  },
  subrayado: {
    height: 5, backgroundColor: colors.orange, marginTop: -6, marginBottom: 2,
  },
  bloque: { backgroundColor: colors.orange, paddingHorizontal: 10, paddingVertical: 2 },
  tituloAbajo: {
    color: NEGRO, fontSize: 44, lineHeight: 48, fontFamily: CONDENSADA,
    fontWeight: '900', letterSpacing: 0.5,
  },

  texto: {
    color: '#fff', fontSize: 19, lineHeight: 23, marginTop: spacing.md,
    fontFamily: CONDENSADA, fontWeight: '700',
  },
  resalte: { color: colors.orange },

  pie: { flexDirection: 'row', alignItems: 'stretch', marginTop: spacing.lg, gap: spacing.sm },
  boton: {
    flex: 1, backgroundColor: colors.orange,
    transform: [{ skewX: '-12deg' }], justifyContent: 'center',
  },
  botonDentro: {
    paddingVertical: 12, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', transform: [{ skewX: '12deg' }],
  },
  triangulo: {
    width: 0, height: 0, marginRight: 10,
    borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 15,
    borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: NEGRO,
  },
  botonTexto: {
    color: NEGRO, fontSize: 23, fontFamily: CONDENSADA, fontWeight: '900', letterSpacing: 1,
  },
  nota: {
    borderWidth: 1, borderColor: colors.orange, paddingHorizontal: 10,
    justifyContent: 'center', maxWidth: 130,
  },
  notaTexto: {
    color: colors.orange, fontSize: 12, fontFamily: CONDENSADA,
    fontWeight: '700', letterSpacing: 0.5,
  },

  // Esquina cortada: un cuadrado girado que tapa la esquina, con su línea.
});
