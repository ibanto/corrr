import React, { useState, useEffect } from 'react';
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

export default function StatsScreen({ user }: Props) {
  const [period, setPeriod] = useState<Period>('Mes');
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

  // Agrupar km de esta semana para el gráfico
  const weeklyKm = (() => {
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7; // lunes=0
    runs.forEach(r => {
      const d = new Date(r.created_at);
      const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
      if (diff <= dayOfWeek) {
        const idx = dayOfWeek - diff;
        if (idx >= 0 && idx < 7) buckets[idx] += r.distance_km;
      }
    });
    return buckets.map(v => Math.round(v * 10) / 10);
  })();
  const maxKm = Math.max(...weeklyKm, 1);

  const totalKm = stats?.total_km ?? 0;
  const totalZones = stats?.total_zones ?? 0;
  const totalRuns = stats?.total_runs ?? 0;

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
              { icon: 'walk' as const, value: totalKm.toFixed(1), unit: 'km', label: 'km totales' },
              { icon: 'map' as const, value: String(totalZones), unit: '', label: 'zonas capturadas' },
              { icon: 'flash' as const, value: String(totalRuns), unit: '', label: 'carreras' },
              { icon: 'flame' as const, value: String(stats?.total_points ?? 0), unit: 'pts', label: 'puntos totales' },
            ].map((s, i) => (
              <View key={i} style={styles.statCard}>
                <Ionicons name={s.icon} size={22} color={colors.orange} style={{ marginBottom: 4 }} />
                <View style={styles.statValueRow}>
                  <Text style={styles.statBigValue}>{s.value}</Text>
                  {s.unit ? <Text style={styles.statUnit}>{s.unit}</Text> : null}
                </View>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Kilómetros esta semana</Text>
            <View style={styles.bars}>
              {weeklyKm.map((km, i) => {
                const barH = km === 0 ? 4 : Math.max(8, (km / maxKm) * 120);
                return (
                  <View key={i} style={styles.barGroup}>
                    <Text style={styles.barValue}>{km > 0 ? km : ''}</Text>
                    <View style={[styles.bar, { height: barH, opacity: km === 0 ? 0.2 : 1 }]} />
                    <Text style={styles.barDay}>{DAYS[i]}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Últimas carreras</Text>
            </View>
            {runs.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>Aún no tienes carreras guardadas.</Text>
                <Text style={styles.emptyText}>¡Sal a correr y conquista tu primera zona!</Text>
              </View>
            ) : (
              runs.map((run) => (
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
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2,
  },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statBigValue: { fontSize: 28, fontWeight: '900', color: colors.textPrimary },
  statUnit: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  statLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  chartCard: {
    marginHorizontal: spacing.md, backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  chartTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 150 },
  barGroup: { alignItems: 'center', gap: 4, flex: 1 },
  barValue: { fontSize: 10, color: colors.textSecondary, height: 14 },
  bar: { width: '60%', backgroundColor: colors.orange, borderRadius: 4, minWidth: 8 },
  barDay: { fontSize: 11, color: colors.textSecondary },
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
