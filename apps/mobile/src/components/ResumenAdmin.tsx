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

          {/* Los cuatro números de arriba dicen CUÁNTOS y ahí se acaban. Con el
              nombre se puede hacer algo: escribirle, picarle, o simplemente
              saber quién está jugando hoy. Es lo que pidió Iban. */}
          {datos.quienes && datos.quienes.corrieron.length > 0 && (
            <>
              <Text style={styles.seccion}>QUIÉN HA CORRIDO HOY</Text>
              {datos.quienes.corrieron.map(c => (
                <View key={c.nombre} style={styles.flojo}>
                  <Text style={styles.flojoNombre} numberOfLines={1}>{c.nombre}</Text>
                  <Text style={styles.flojoDato}>
                    {c.carreras} carrera{c.carreras === 1 ? '' : 's'} · {km(c.km)} km
                  </Text>
                </View>
              ))}
            </>
          )}

          {datos.quienes && datos.quienes.robos.length > 0 && (
            <>
              <Text style={styles.seccion}>QUIÉN HA ROBADO HOY</Text>
              {datos.quienes.robos.map((r, i) => (
                <View key={i} style={styles.flojo}>
                  <Text style={styles.flojoNombre} numberOfLines={1}>
                    {r.ladron} <Text style={styles.flecha}>→</Text> {r.victima}
                  </Text>
                  <Text style={styles.flojoDato}>
                    {r.veces} {r.veces === 1 ? 'vez' : 'veces'}
                  </Text>
                </View>
              ))}
            </>
          )}

          {datos.quienes && datos.quienes.altas.length > 0 && (
            <>
              <Text style={styles.seccion}>SE HAN DADO DE ALTA HOY</Text>
              {datos.quienes.altas.map((a, i) => (
                <View key={i} style={styles.flojo}>
                  <Text style={styles.flojoNombre} numberOfLines={1}>{a.nombre}</Text>
                  <Text style={styles.flojoDato}>{a.ciudad || 'sin ciudad'}</Text>
                </View>
              ))}
            </>
          )}

          {datos.quienes && datos.quienes.abrieron.length > 0 && (
            <>
              <Text style={styles.seccion}>HAN ABIERTO LA APP HOY</Text>
              <Text style={styles.suelto}>{datos.quienes.abrieron.join(' · ')}</Text>
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
            <View key={i} style={styles.flojo}>
              <Text style={styles.flojoNombre} numberOfLines={1}>{f.nombre}</Text>
              <Text style={styles.flojoDato}>
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
          <Text style={styles.suelto}>
            {datos.porPlataforma.map(p => `${p.plataforma}: ${p.n}`).join(' · ')}
          </Text>

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
