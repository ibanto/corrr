import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, RunRecord, UserStats } from '../services/api';

const { width } = Dimensions.get('window');
type Period = 'Semana' | 'Mes' | 'Año' | 'Todo';

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  user: { id: string; username: string; email: string } | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 86400000 && now.getDate() === d.getDate()) return 'Hoy';
  if (diffMs < 172800000) return 'Ayer';
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d.getDate()} ${months[d.getMonth()]}.`;
}

function formatPace(durationSecs: number, distanceKm: number): string {
  if (distanceKm < 0.01) return '--';
  const ppm = durationSecs / 60 / distanceKm;
  const min = Math.floor(ppm);
  const sec = Math.round((ppm - min) * 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

// Helpers para filtrar carreras por periodo
function getWeekStart(): Date {
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getYearStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
}

export default function StatsScreen({ user }: Props) {
  const [period, setPeriod] = useState<Period>('Semana');
  const [stats, setStats] = useState<UserStats | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.getMyStats();
      setStats(data.stats);
      setRuns(data.runs);
    } catch {
      // sin token o sin conexión — mantenemos valores vacíos
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Filtrar carreras según periodo
  const filteredRuns = useMemo(() => {
    if (period === 'Todo') return runs;
    let start: Date;
    if (period === 'Semana') start = getWeekStart();
    else if (period === 'Mes') start = getMonthStart();
    else start = getYearStart();
    return runs.filter(r => new Date(r.created_at) >= start);
  }, [runs, period]);

  // Stats filtradas
  const periodStats = useMemo(() => {
    const km = filteredRuns.reduce((a, r) => a + r.distance_km, 0);
    const zones = filteredRuns.reduce((a, r) => a + r.zones_count, 0);
    const points = filteredRuns.reduce((a, r) => a + r.points, 0);
    return { km, zones, runs: filteredRuns.length, points };
  }, [filteredRuns]);

  // Calcular fechas de la semana actual (lunes a domingo)
  const weekDates = useMemo(() => {
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7;
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - dayOfWeek + i);
      dates.push(d);
    }
    return dates;
  }, []);

  // --- DATOS DEL GRAFICO SEGUN PERIODO ---

  // Semana: barras por dia (L-D)
  const weeklyKm = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    runs.forEach(r => {
      const d = new Date(r.created_at);
      const runDate = d.getDate();
      const runMonth = d.getMonth();
      const runYear = d.getFullYear();
      for (let i = 0; i < 7; i++) {
        if (weekDates[i].getDate() === runDate &&
            weekDates[i].getMonth() === runMonth &&
            weekDates[i].getFullYear() === runYear) {
          buckets[i] += r.distance_km;
          break;
        }
      }
    });
    return buckets.map(v => Math.round(v * 10) / 10);
  }, [runs, weekDates]);

  // Mes: barras por semana (S1, S2, S3, S4, S5)
  const monthlyKm = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const numWeeks = Math.ceil(daysInMonth / 7);
    const buckets = Array(numWeeks).fill(0);
    runs.forEach(r => {
      const d = new Date(r.created_at);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        const weekIdx = Math.floor((d.getDate() - 1) / 7);
        if (weekIdx < numWeeks) buckets[weekIdx] += r.distance_km;
      }
    });
    return buckets.map(v => Math.round(v * 10) / 10);
  }, [runs]);

  // Año: barras por mes (Ene-Dic)
  const yearlyKm = useMemo(() => {
    const now = new Date();
    const buckets = Array(12).fill(0);
    runs.forEach(r => {
      const d = new Date(r.created_at);
      if (d.getFullYear() === now.getFullYear()) {
        buckets[d.getMonth()] += r.distance_km;
      }
    });
    return buckets.map(v => Math.round(v * 10) / 10);
  }, [runs]);

  // Todo: barras por los ultimos 6 meses
  const allTimeKm = useMemo(() => {
    const now = new Date();
    const buckets = Array(6).fill(0);
    const labels: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(MONTHS_SHORT[m.getMonth()]);
    }
    runs.forEach(r => {
      const d = new Date(r.created_at);
      for (let i = 5; i >= 0; i--) {
        const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
        if (d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear()) {
          buckets[5 - i] += r.distance_km;
          break;
        }
      }
    });
    return { values: buckets.map(v => Math.round(v * 10) / 10), labels };
  }, [runs]);

  // Determinar datos del chart segun periodo
  const chartData = useMemo(() => {
    if (period === 'Semana') {
      return {
        title: 'Kilómetros esta semana',
        values: weeklyKm,
        labels: DAYS.map((d, i) => d),
        subLabels: weekDates.map(d => String(d.getDate())),
        highlightIdx: weekDates.findIndex(d => {
          const now = new Date();
          return d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
        }),
      };
    } else if (period === 'Mes') {
      const now = new Date();
      const numWeeks = monthlyKm.length;
      const labels = Array.from({ length: numWeeks }, (_, i) => `S${i + 1}`);
      const currentWeek = Math.floor((now.getDate() - 1) / 7);
      // Sub-labels: rango de dias
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const subLabels = labels.map((_, i) => {
        const from = i * 7 + 1;
        const to = Math.min((i + 1) * 7, daysInMonth);
        return `${from}-${to}`;
      });
      return {
        title: 'Kilómetros este mes',
        values: monthlyKm,
        labels,
        subLabels,
        highlightIdx: currentWeek,
      };
    } else if (period === 'Año') {
      const now = new Date();
      return {
        title: 'Kilómetros este año',
        values: yearlyKm,
        labels: MONTHS_SHORT,
        subLabels: undefined,
        highlightIdx: now.getMonth(),
      };
    } else {
      return {
        title: 'Kilómetros (últimos 6 meses)',
        values: allTimeKm.values,
        labels: allTimeKm.labels,
        subLabels: undefined,
        highlightIdx: 5, // ultimo = actual
      };
    }
  }, [period, weeklyKm, monthlyKm, yearlyKm, allTimeKm, weekDates]);

  const maxKm = Math.max(...chartData.values, 1);

  // Stats totales (para "Todo" mostramos stats del servidor)
  const displayStats = period === 'Todo' ? {
    km: stats?.total_km ?? 0,
    zones: stats?.total_zones ?? 0,
    runs: stats?.total_runs ?? 0,
    points: stats?.total_points ?? 0,
  } : periodStats;

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.orange} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Estadísticas</Text>
        <TouchableOpacity onPress={() => setShowCalendar(true)}><Ionicons name="calendar-outline" size={24} color={colors.textSecondary} /></TouchableOpacity>
      </View>

      <View style={styles.periodRow}>
        {(['Semana', 'Mes', 'Año', 'Todo'] as Period[]).map(p => (
          <TouchableOpacity key={p} style={[styles.periodBtn, period === p && styles.periodBtnActive]} onPress={() => setPeriod(p)}>
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.orange} size="large" />
        </View>
      ) : (
        <>
          <View style={styles.bigStatsGrid}>
            {[
              { icon: 'walk' as const, value: displayStats.km.toFixed(1), unit: 'km', label: period === 'Todo' ? 'km totales' : `km ${period.toLowerCase()}` },
              { icon: 'flag' as const, value: String(displayStats.zones), unit: '', label: period === 'Todo' ? 'zonas capturadas' : 'zonas' },
              { icon: 'flash' as const, value: String(displayStats.runs), unit: '', label: 'carreras' },
              { icon: 'flame' as const, value: String(displayStats.points), unit: 'pts', label: 'puntos' },
            ].map((s, i) => (
              <View key={i} style={styles.statCard}>
                <Ionicons name={s.icon} size={18} color={colors.orange} style={{ marginBottom: 2 }} />
                <View style={styles.statValueRow}>
                  <Text style={styles.statBigValue}>{s.value}</Text>
                  {s.unit ? <Text style={styles.statUnit}>{s.unit}</Text> : null}
                </View>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{chartData.title}</Text>
            <View style={[styles.bars, period === 'Año' && styles.barsYear]}>
              {chartData.values.map((km, i) => {
                const barH = km === 0 ? 4 : Math.max(8, (km / maxKm) * 120);
                const isHighlight = i === chartData.highlightIdx;
                return (
                  <View key={i} style={styles.barGroup}>
                    <Text style={styles.barValue}>{km > 0 ? km : ''}</Text>
                    <View style={[styles.bar, { height: barH, opacity: km === 0 ? 0.2 : 1 }]} />
                    <Text style={[styles.barDay, isHighlight && styles.barDayToday]}>
                      {chartData.labels[i]}
                    </Text>
                    {chartData.subLabels && (
                      <Text style={[styles.barDate, isHighlight && styles.barDateToday]}>
                        {chartData.subLabels[i]}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {period === 'Todo' ? 'Todas las carreras' : `Carreras · ${period}`}
              </Text>
            </View>
            {filteredRuns.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>
                  {runs.length === 0
                    ? 'Aún no tienes carreras guardadas.\n¡Sal a correr y conquista tu primera zona!'
                    : `Sin carreras en este periodo.`}
                </Text>
              </View>
            ) : (
              filteredRuns.map((run) => (
                <View key={run.id} style={styles.runRow}>
                  <View style={styles.runIconBox}>
                    <Ionicons name="walk" size={18} color={colors.orange} />
                  </View>
                  <View style={styles.runMeta}>
                    <Text style={styles.runPlace}>{run.zones_count > 0 ? `${run.zones_count} zona${run.zones_count > 1 ? 's' : ''}` : 'Carrera'}</Text>
                    <Text style={styles.runDate}>{formatDate(run.created_at)}</Text>
                  </View>
                  <View style={styles.runNums}>
                    <Text style={styles.runKm}>{run.distance_km.toFixed(2)} km</Text>
                    <Text style={styles.runPace}>{formatPace(run.duration_secs, run.distance_km)} /km · {run.points} pts</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>

    {/* Calendario modal */}
    <Modal visible={showCalendar} transparent animationType="slide" statusBarTranslucent>
      <View style={styles.calOverlay}>
        <View style={styles.calContainer}>
          {/* Header */}
          <View style={styles.calHeader}>
            <TouchableOpacity onPress={() => {
              if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
              else setCalMonth(m => m - 1);
            }}>
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.calTitle}>
              {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][calMonth]} {calYear}
            </Text>
            <TouchableOpacity onPress={() => {
              if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
              else setCalMonth(m => m + 1);
            }}>
              <Ionicons name="chevron-forward" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Días de la semana */}
          <View style={styles.calWeekRow}>
            {['L','M','X','J','V','S','D'].map(d => (
              <Text key={d} style={styles.calWeekDay}>{d}</Text>
            ))}
          </View>

          {/* Días del mes */}
          {(() => {
            const firstDay = new Date(calYear, calMonth, 1);
            const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
            let startIdx = (firstDay.getDay() + 6) % 7; // lunes=0
            const runDates = new Set(runs.map(r => {
              const d = new Date(r.created_at);
              return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            }));
            const today = new Date();
            const cells = [];
            // Espacios vacíos
            for (let i = 0; i < startIdx; i++) cells.push(<View key={`e${i}`} style={styles.calDayCell} />);
            for (let d = 1; d <= daysInMonth; d++) {
              const key = `${calYear}-${calMonth}-${d}`;
              const ran = runDates.has(key);
              const isToday = d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
              cells.push(
                <View key={d} style={styles.calDayCell}>
                  <View style={[
                    styles.calDay,
                    ran && styles.calDayRan,
                    isToday && styles.calDayToday,
                  ]}>
                    <Text style={[
                      styles.calDayText,
                      ran && styles.calDayTextRan,
                      isToday && !ran && styles.calDayTextToday,
                    ]}>{d}</Text>
                  </View>
                  {ran && <View style={styles.calDot} />}
                </View>
              );
            }
            // Filas de 7
            const rows = [];
            for (let i = 0; i < cells.length; i += 7) {
              rows.push(
                <View key={i} style={styles.calWeekRow}>
                  {cells.slice(i, i + 7)}
                </View>
              );
            }
            return rows;
          })()}

          {/* Leyenda */}
          <View style={styles.calLegend}>
            <View style={styles.calLegendItem}>
              <View style={[styles.calLegendDot, { backgroundColor: colors.orange }]} />
              <Text style={styles.calLegendText}>Día que corriste</Text>
            </View>
            <View style={styles.calLegendItem}>
              <View style={[styles.calLegendDot, { borderWidth: 1, borderColor: colors.orange }]} />
              <Text style={styles.calLegendText}>Hoy</Text>
            </View>
          </View>

          {/* Stats del mes */}
          {(() => {
            const monthRuns = runs.filter(r => {
              const d = new Date(r.created_at);
              return d.getMonth() === calMonth && d.getFullYear() === calYear;
            });
            const monthKm = monthRuns.reduce((a, r) => a + r.distance_km, 0);
            const monthDays = new Set(monthRuns.map(r => new Date(r.created_at).getDate())).size;
            return (
              <View style={styles.calStats}>
                <View style={styles.calStat}>
                  <Text style={styles.calStatValue}>{monthRuns.length}</Text>
                  <Text style={styles.calStatLabel}>carreras</Text>
                </View>
                <View style={styles.calStat}>
                  <Text style={styles.calStatValue}>{monthKm.toFixed(1)}</Text>
                  <Text style={styles.calStatLabel}>km</Text>
                </View>
                <View style={styles.calStat}>
                  <Text style={styles.calStatValue}>{monthDays}</Text>
                  <Text style={styles.calStatLabel}>días activo</Text>
                </View>
              </View>
            );
          })()}

          <TouchableOpacity style={styles.calCloseBtn} onPress={() => setShowCalendar(false)}>
            <Text style={styles.calCloseBtnText}>CERRAR</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 100 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  title: { fontSize: 28, fontWeight: '900', color: colors.textPrimary },
  periodRow: {
    flexDirection: 'row', marginHorizontal: spacing.md, backgroundColor: colors.bgCard,
    borderRadius: radius.full, padding: 4, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  periodBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.full, alignItems: 'center' },
  periodBtnActive: { backgroundColor: colors.orange },
  periodText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  periodTextActive: { color: '#fff' },
  centered: { flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center' },
  bigStatsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, gap: spacing.sm, marginBottom: spacing.md,
  },
  statCard: {
    width: (width - spacing.md * 2 - spacing.sm) / 2, backgroundColor: colors.bgCard,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 0,
  },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statBigValue: { fontSize: 24, fontWeight: '900', color: colors.textPrimary },
  statUnit: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  statLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  chartCard: {
    marginHorizontal: spacing.md, backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  chartTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 165 },
  barsYear: { height: 180 },
  barGroup: { alignItems: 'center', gap: 3, flex: 1 },
  barValue: { fontSize: 10, color: colors.textSecondary, height: 14 },
  bar: { width: '60%', backgroundColor: colors.orange, borderRadius: 4, minWidth: 8 },
  barDay: { fontSize: 11, color: colors.textSecondary },
  barDayToday: { color: colors.orange, fontWeight: '700' },
  barDate: { fontSize: 9, color: colors.textSecondary, marginTop: 1 },
  barDateToday: { color: colors.orange, fontWeight: '700' },
  section: { paddingHorizontal: spacing.md, marginBottom: spacing.md },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  emptyBox: { paddingVertical: spacing.lg, alignItems: 'center', gap: 4 },
  emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  runRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm,
  },
  runIconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  runMeta: { flex: 1 },
  runPlace: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  runDate: { fontSize: 12, color: colors.textSecondary },
  runNums: { alignItems: 'flex-end' },
  runKm: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  runPace: { fontSize: 11, color: colors.textSecondary },
  // Calendar
  calOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', paddingHorizontal: spacing.md,
  },
  calContainer: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  calHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.md,
  },
  calTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  calWeekRow: { flexDirection: 'row' },
  calWeekDay: {
    flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700',
    color: colors.textSecondary, marginBottom: 8,
  },
  calDayCell: { flex: 1, alignItems: 'center', marginBottom: 6 },
  calDay: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  calDayRan: { backgroundColor: colors.orange },
  calDayToday: { borderWidth: 2, borderColor: colors.orange },
  calDayText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  calDayTextRan: { color: '#000', fontWeight: '800' },
  calDayTextToday: { color: colors.orange },
  calDot: {
    width: 4, height: 4, borderRadius: 2, backgroundColor: colors.orange, marginTop: 2,
  },
  calLegend: {
    flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, marginBottom: spacing.sm,
    justifyContent: 'center',
  },
  calLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calLegendDot: { width: 10, height: 10, borderRadius: 5 },
  calLegendText: { fontSize: 11, color: colors.textSecondary },
  calStats: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: spacing.sm, marginTop: spacing.xs,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  calStat: { alignItems: 'center' },
  calStatValue: { fontSize: 22, fontWeight: '900', color: colors.textPrimary },
  calStatLabel: { fontSize: 11, color: colors.textSecondary },
  calCloseBtn: {
    marginTop: spacing.md, backgroundColor: colors.orange,
    paddingVertical: 14, borderRadius: radius.full, alignItems: 'center',
  },
  calCloseBtnText: { fontSize: 15, fontWeight: '800', color: '#000', letterSpacing: 1 },
});
