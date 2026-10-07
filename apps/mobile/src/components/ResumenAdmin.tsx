import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, ResumenAdmin as Resumen } from '../services/api';

/**
 * El resumen que solo ve quien está marcado como administrador (se marca desde
 * el panel, no en el código: el repositorio es público).
 *
 * La pregunta que responde no es "cuántos usuarios hay" sino "¿esto se está
 * usando y quién se está descolgando?". Por eso lo primero es hoy, y lo último
 * la lista de quien lleva más tiempo sin correr: es la única parte accionable
 * — a esa gente se le puede escribir.
 */

const numero = (n: number | string) => Math.round(Number(n)).toLocaleString('es-ES');
/** Los kilómetros con un decimal: redondearlos a entero deja "0 km" en una
 *  carrera de 900 m, que parece un fallo. */
const km = (n: number | string) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 1 });

/** "hace 3 días", "hoy", "nunca". */
function desde(iso: string | null): string {
  if (!iso) return 'nunca';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  return `hace ${Math.floor(dias / 30)} meses`;
}

/** Las barras de los últimos siete días. Siete números en fila no dicen si la
 *  cosa sube o baja; siete barras sí, de un vistazo y sin leer. El día de hoy
 *  va en naranja y los demás en gris, y debajo la inicial del día. */
function Barras({ dias }: { dias: { dia: string; carreras: number; gente: number }[] }) {
  const tope = Math.max(1, ...dias.map(d => d.carreras));
  return (
    <View style={styles.barras}>
      {dias.map((d, i) => {
        const hoy = i === dias.length - 1;
        // La fecha se parte a mano en vez de con new Date(d.dia): un
        // "2026-10-06" lo lee como UTC y en España puede retroceder un día,
        // así que las letras saldrían corridas.
        const [a, m, dd] = d.dia.split('-').map(Number);
        const letra = ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(a, m - 1, dd).getDay()];
        return (
          <View key={d.dia} style={styles.barraCol}>
            <Text style={[styles.barraNum, hoy && styles.barraNumHoy]}>{d.carreras || ''}</Text>
            <View style={styles.barraHueco}>
              <View style={[
                styles.barra,
                { height: Math.max(3, Math.round((d.carreras / tope) * 56)) },
                hoy && styles.barraHoy,
              ]} />
            </View>
            <Text style={[styles.barraDia, hoy && styles.barraNumHoy]}>{letra}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Un círculo con la inicial. Cinco nombres en una línea de texto no se
 *  distinguen; cinco círculos sí. El color sale del propio nombre, así que
 *  cada persona tiene siempre el suyo. */
function Bolita({ nombre, grande }: { nombre: string; grande?: boolean }) {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) % 360;
  const d = grande ? 30 : 26;
  return (
    <View style={[styles.bolita, {
      width: d, height: d, borderRadius: d / 2,
      backgroundColor: `hsl(${h}, 45%, 24%)`, borderColor: `hsl(${h}, 60%, 45%)`,
    }]}>
      <Text style={[styles.bolitaTexto, grande && { fontSize: 13 }]}>
        {nombre.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

function Cifra({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <View style={styles.cifra}>
      <Text style={styles.cifraValor} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{valor}</Text>
      <Text style={styles.cifraEtiqueta}>{etiqueta}</Text>
    </View>
  );
}

export default function ResumenAdminPanel() {
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);

  const cargar = () => {
    setCargando(true);
    api.getResumenAdmin().then(setDatos).finally(() => setCargando(false));
  };
  useEffect(() => { if (abierto && !datos) cargar(); }, [abierto]);

  return (
    <View style={styles.caja}>
      <TouchableOpacity style={styles.cabecera} onPress={() => setAbierto(a => !a)} activeOpacity={0.8}>
        <Ionicons name="shield-checkmark" size={18} color={colors.orange} />
        <Text style={styles.titulo}>CÓMO VA LA COSA</Text>
        <View style={{ flex: 1 }} />
        {cargando && <ActivityIndicator size="small" color={colors.orange} />}
        <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      {abierto && datos && (
        <View style={styles.cuerpo}>
          <Text style={styles.seccion}>HOY</Text>
          <View style={styles.fila}>
            <Cifra valor={numero(datos.hoy.corredores)} etiqueta="HAN CORRIDO" />
            <Cifra valor={numero(datos.hoy.carreras)} etiqueta="CARRERAS" />
            <Cifra valor={numero(datos.hoy.han_abierto)} etiqueta="HAN ABIERTO" />
            <Cifra valor={numero(datos.hoy.altas)} etiqueta="ALTAS" />
          </View>

          {datos.dias && datos.dias.length > 0 && (
            <>
              <Text style={styles.seccion}>CARRERAS DE LA SEMANA</Text>
              <Barras dias={datos.dias} />
            </>
          )}

          {/* Los cuatro números de arriba dicen CUÁNTOS y ahí se acaban. Con el
              nombre se puede hacer algo: escribirle, picarle, o simplemente
              saber quién está jugando hoy. Y con la barra se ve quién ha
              apretado hoy sin comparar números a mano. */}
          {datos.quienes && datos.quienes.corrieron.length > 0 && (
            <>
              <Text style={styles.seccion}>QUIÉN HA CORRIDO HOY</Text>
              {(() => {
                const tope = Math.max(...datos.quienes!.corrieron.map(c => Number(c.km) || 0), 0.1);
                return datos.quienes!.corrieron.map(c => (
                  <View key={c.nombre} style={styles.persona}>
                    <Bolita nombre={c.nombre} />
                    <View style={styles.personaMedio}>
                      <View style={styles.personaLinea}>
                        <Text style={styles.personaNombre} numberOfLines={1}>{c.nombre}</Text>
                        <Text style={styles.personaDato}>{km(c.km)} km</Text>
                      </View>
                      <View style={styles.pistaHueco}>
                        <View style={[styles.pista, { width: `${Math.max(3, (Number(c.km) / tope) * 100)}%` }]} />
                      </View>
                    </View>
                    <View style={styles.chapa}><Text style={styles.chapaTexto}>{c.carreras}</Text></View>
                  </View>
                ));
              })()}
            </>
          )}

          {datos.quienes && datos.quienes.robos.length > 0 && (
            <>
              <Text style={styles.seccion}>QUIÉN HA ROBADO HOY</Text>
              {datos.quienes.robos.map((r, i) => (
                <View key={i} style={styles.robo}>
                  <Bolita nombre={r.ladron} grande />
                  <Ionicons name="arrow-forward" size={15} color={colors.orange} />
                  <Bolita nombre={r.victima} grande />
                  <Text style={styles.roboNombres} numberOfLines={1}>
                    {r.ladron} <Text style={styles.roboA}>a</Text> {r.victima}
                  </Text>
                  <View style={styles.chapaRoja}>
                    <Text style={styles.chapaRojaTexto}>×{r.veces}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {datos.quienes && datos.quienes.altas.length > 0 && (
            <>
              <Text style={styles.seccion}>SE HAN DADO DE ALTA HOY</Text>
              {datos.quienes.altas.map((a, i) => (
                <View key={i} style={styles.persona}>
                  <Bolita nombre={a.nombre} />
                  <Text style={[styles.personaNombre, { flex: 1 }]} numberOfLines={1}>{a.nombre}</Text>
                  <Text style={styles.personaDato}>{a.ciudad || 'sin ciudad'}</Text>
                </View>
              ))}
            </>
          )}

          {/* Aquí sí interesa el conjunto, no cada uno: en bolitas se ve de un
              golpe cuánta gente ha entrado hoy. El nombre, debajo y pequeño. */}
          {datos.quienes && datos.quienes.abrieron.length > 0 && (
            <>
              <Text style={styles.seccion}>HAN ABIERTO LA APP HOY</Text>
              <View style={styles.rejilla}>
                {datos.quienes.abrieron.map((nombre, i) => (
                  <View key={i} style={styles.rejillaUno}>
                    <Bolita nombre={nombre} />
                    <Text style={styles.rejillaNombre} numberOfLines={1}>{nombre}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.seccion}>ESTA SEMANA</Text>
          <View style={styles.fila}>
            <Cifra valor={numero(datos.semana.altas)} etiqueta="ALTAS" />
            <Cifra valor={numero(datos.semana.carreras)} etiqueta="CARRERAS" />
            <Cifra valor={numero(datos.semana.km)} etiqueta="KM" />
            <Cifra valor={numero(datos.semana.celdas)} etiqueta="CELDAS" />
          </View>

          <Text style={styles.seccion}>LA GENTE</Text>
          <View style={styles.fila}>
            <Cifra valor={numero(datos.gente.total)} etiqueta="EN TOTAL" />
            <Cifra valor={numero(datos.gente.activos_semana)} etiqueta="ENTRAN" />
            <Cifra valor={numero(datos.gente.sin_estrenar)} etiqueta="SIN ESTRENAR" />
            <Cifra valor={numero(datos.gente.dormidos)} etiqueta="DORMIDOS" />
          </View>
          {/* Los primeros días "cuántos entran" se queda corto, porque el dato
              se empezó a guardar hace nada. Mejor decirlo que dar un número
              que parece malo y no lo es. */}
          {datos.accesosDesde && Date.now() - new Date(datos.accesosDesde).getTime() < 7 * 86_400_000 && (
            <Text style={styles.suelto}>
              "Entran" cuenta desde {desde(datos.accesosDesde)}, que es cuando se empezó a guardar.
            </Text>
          )}

          <Text style={styles.seccion}>QUIÉN SE ESTÁ DESCOLGANDO</Text>
          {datos.flojos.length === 0 && (
            <Text style={styles.suelto}>Nadie: todos los que han corrido alguna vez lo han hecho esta semana.</Text>
          )}
          {datos.flojos.slice(0, 8).map((f, i) => (
            <View key={i} style={styles.persona}>
              <Bolita nombre={f.nombre} />
              <Text style={[styles.personaNombre, { flex: 1 }]} numberOfLines={1}>{f.nombre}</Text>
              <Text style={styles.personaDato}>
                corrió {desde(f.ultimaCarrera)} · entró {desde(f.ultimoAcceso)}
              </Text>
            </View>
          ))}

          <Text style={styles.seccion}>LO DEMÁS</Text>
          <Text style={styles.suelto}>
            {datos.avisosActivos} aviso{datos.avisosActivos === 1 ? '' : 's'} en marcha ·{' '}
            {datos.carrerasMarcadas} carrera{datos.carrerasMarcadas === 1 ? '' : 's'} marcada
            {datos.carrerasMarcadas === 1 ? '' : 's'} por el antitrampas (30 días)
          </Text>
          {datos.correos.map(c => (
            <Text key={c.campana} style={styles.suelto}>
              Correo "{c.campana}": {c.enviados} enviados, {c.salieron} salieron a correr después
            </Text>
          ))}
          {/* Una barra partida en vez de "ios: 25 · android: 21": lo que
              interesa es la PROPORCIÓN, y eso con dos números hay que
              calcularlo mentalmente cada vez. */}
          {datos.porPlataforma.length > 0 && (() => {
            const total = datos.porPlataforma.reduce((a, p) => a + p.n, 0) || 1;
            const TONO: Record<string, string> = { ios: colors.orange, android: colors.purpleLight };
            return (
              <>
                <View style={styles.tarta}>
                  {datos.porPlataforma.map(p => (
                    <View key={p.plataforma} style={{
                      flex: p.n, backgroundColor: TONO[p.plataforma] ?? colors.textMuted,
                    }} />
                  ))}
                </View>
                <View style={styles.leyenda}>
                  {datos.porPlataforma.map(p => (
                    <View key={p.plataforma} style={styles.leyendaUno}>
                      <View style={[styles.leyendaPunto, {
                        backgroundColor: TONO[p.plataforma] ?? colors.textMuted,
                      }]} />
                      <Text style={styles.leyendaTexto}>
                        {p.plataforma} {Math.round((p.n / total) * 100)}%
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            );
          })()}

          <TouchableOpacity style={styles.refrescar} onPress={cargar} activeOpacity={0.8}>
            <Ionicons name="refresh" size={16} color={colors.orange} />
            <Text style={styles.refrescarTexto}>Actualizar</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  caja: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    marginTop: spacing.md, overflow: 'hidden',
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  titulo: { color: colors.orange, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  cuerpo: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  seccion: {
    color: colors.textSecondary, fontSize: 11, fontWeight: '800',
    letterSpacing: 1, marginTop: spacing.md, marginBottom: spacing.xs,
  },
  fila: { flexDirection: 'row' },
  cifra: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  cifraValor: { color: colors.textPrimary, fontSize: 22, fontWeight: '900' },
  cifraEtiqueta: { color: colors.textSecondary, fontSize: 9, letterSpacing: 0.5, marginTop: 2 },

  // Las barras de la semana.
  barras: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: spacing.xs },
  barraCol: { flex: 1, alignItems: 'center' },
  barraNum: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', height: 13 },
  barraNumHoy: { color: colors.orange },
  // El hueco con altura fija es lo que hace que las barras crezcan desde abajo
  // y queden alineadas por el pie; sin él, cada columna empieza donde le toca.
  barraHueco: { height: 64, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  // Estrecha a propósito: al 78% salían bloques más anchos que altos y no se
  // leían como una barra.
  barra: { width: '46%', backgroundColor: colors.border, borderRadius: 3 },
  barraHoy: { backgroundColor: colors.orange },
  barraDia: { color: colors.textMuted, fontSize: 10, fontWeight: '700', marginTop: 3 },

  bolita: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  bolitaTexto: { color: colors.textPrimary, fontSize: 11, fontWeight: '900' },

  persona: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 6,
  },
  personaMedio: { flex: 1, gap: 3 },
  personaLinea: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  personaNombre: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  personaDato: { color: colors.textSecondary, fontSize: 12 },
  pistaHueco: { height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  pista: { height: 5, borderRadius: 3, backgroundColor: colors.orange },
  chapa: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5,
    backgroundColor: colors.bgCardAlt, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  chapaTexto: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },

  robo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  roboNombres: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '700', marginLeft: 2 },
  roboA: { color: colors.textSecondary, fontWeight: '400' },
  chapaRoja: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm,
    backgroundColor: 'rgba(239, 68, 68, 0.12)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  chapaRojaTexto: { color: colors.danger, fontSize: 11, fontWeight: '900' },

  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  rejillaUno: { alignItems: 'center', width: 54, gap: 3 },
  rejillaNombre: { color: colors.textSecondary, fontSize: 9, textAlign: 'center' },
  tarta: {
    flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden',
    marginTop: spacing.sm, backgroundColor: colors.border,
  },
  leyenda: { flexDirection: 'row', gap: spacing.md, marginTop: 6 },
  leyendaUno: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  leyendaPunto: { width: 8, height: 8, borderRadius: 4 },
  leyendaTexto: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },

  flojo: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm,
  },
  flojoNombre: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  flojoDato: { color: colors.textSecondary, fontSize: 12 },
  flecha: { color: colors.orange, fontWeight: '900' },

  suelto: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },

  refrescar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  refrescarTexto: { color: colors.orange, fontSize: 13, fontWeight: '700' },
});
