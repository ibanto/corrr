import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, RunRecord } from '../services/api';
import { colors, spacing, radius } from '../theme';

const PAGE_SIZE = 30;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** Pantalla modal con TODAS las carreras del usuario (paginación incremental).
 *  Se abre desde Stats → "VER MÁS". Carga 30 carreras la primera vez y va
 *  pidiendo más a medida que el usuario llega al final del scroll. */
export default function AllRunsScreen({ visible, onClose }: Props) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    if (offset === 0 && !append) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const data = await api.getAllRuns(PAGE_SIZE, offset);
      setTotal(data.total);
      setRuns(prev => append ? [...prev, ...data.runs] : data.runs);
    } catch (e: any) {
      setError(e?.message ?? 'No se pudieron cargar las carreras');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Cargar primera página cada vez que el modal se abre.
  useEffect(() => {
    if (visible) loadPage(0, false);
    else { setRuns([]); setTotal(0); }
  }, [visible, loadPage]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadPage(0, false);
    setRefreshing(false);
  };

  const handleEndReached = () => {
    if (loadingMore || loading) return;
    if (runs.length >= total) return; // ya tenemos todas
    loadPage(runs.length, true);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Mis carreras</Text>
            {total > 0 && <Text style={styles.headerSub}>{total} {total === 1 ? 'carrera' : 'carreras'}</Text>}
          </View>
          <View style={{ width: 60 }} />
        </View>

        {loading && runs.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.orange} />
          </View>
        ) : error && runs.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.textSecondary} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => loadPage(0, false)}>
              <Text style={styles.retryBtnText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : runs.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="walk-outline" size={42} color={colors.textSecondary} />
            <Text style={styles.emptyText}>Aún no tienes carreras guardadas.{'\n'}¡Sal a correr y conquista tu primera zona!</Text>
          </View>
        ) : (
          <FlatList
            data={runs}
            keyExtractor={(item, idx) => item.id ?? String(idx)}
            renderItem={({ item }) => <RunRow run={item} />}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.orange} />}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footer}><ActivityIndicator color={colors.orange} /></View>
              ) : runs.length < total ? (
                <View style={styles.footer}><Text style={styles.footerHint}>Desliza para cargar más</Text></View>
              ) : null
            }
          />
        )}
      </View>
    </Modal>
  );
}

function RunRow({ run }: { run: RunRecord }) {
  const date = new Date(run.created_at);
  const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const paceSecs = run.distance_km > 0 ? Math.round(run.duration_secs / run.distance_km) : 0;
  const paceStr = paceSecs > 0 ? `${Math.floor(paceSecs / 60)}:${String(paceSecs % 60).padStart(2, '0')}` : '—:—';
  return (
    <View style={styles.row}>
      <View style={styles.iconBox}>
        <Ionicons name="walk" size={20} color={colors.orange} />
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.rowTitle}>
          {run.distance_km.toFixed(2)} km · {paceStr} /km
        </Text>
        <Text style={styles.rowSub}>
          {dateStr} · {timeStr}
          {run.zones_count > 0 ? ` · ${run.zones_count} ${run.zones_count === 1 ? 'zona' : 'zonas'}` : ''}
        </Text>
      </View>
      <View style={styles.rowEnd}>
        <Text style={styles.rowPoints}>+{run.points}</Text>
        <Text style={styles.rowPointsLabel}>pts</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 48, paddingBottom: spacing.md, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerBtn: { width: 60 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  headerSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  emptyText: { color: colors.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 22 },
  errorText: { color: colors.textSecondary, textAlign: 'center', fontSize: 14 },
  retryBtn: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.orange,
  },
  retryBtnText: { color: colors.orange, fontWeight: '700' },

  listContent: { paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  rowMeta: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  rowSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  rowEnd: { alignItems: 'flex-end' },
  rowPoints: { fontSize: 18, fontWeight: '900', color: colors.orange, letterSpacing: -0.5 },
  rowPointsLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },

  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
  footerHint: { color: colors.textSecondary, fontSize: 12 },
});
