import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { colors, spacing, radius } from '../theme';
import { api, RankingEntry } from '../services/api';

type Tab = 'Nacional' | 'Ciudad' | 'Amigos';

interface Props {
  user: { id: string; username: string; email: string; city?: string } | null;
}

export default function RankingScreen({ user }: Props) {
  const [tab, setTab] = useState<Tab>('Nacional');
  const [data, setData] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false, currentTab = tab) => {
    if (!silent) setLoading(true);
    let res: RankingEntry[] = [];
    if (currentTab === 'Nacional') {
      res = await api.getRanking();
    } else if (currentTab === 'Ciudad') {
      const city = user?.city;
      if (city) {
        res = await api.getRankingByCity(city);
      } else {
        res = [];
      }
    }
    setData(res);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(false, tab); }, [tab]);

  const renderItem = ({ item }: { item: RankingEntry }) => {
    const isTop3 = item.position <= 3;
    const medals = ['🥇', '🥈', '🥉'];
    return (
      <View style={[styles.row, item.isCurrentUser && styles.rowHighlight]}>
        <View style={styles.positionCell}>
          {isTop3 && !item.isCurrentUser ? (
            <Text style={styles.medal}>{medals[item.position - 1]}</Text>
          ) : (
            <Text style={[styles.positionText, item.isCurrentUser && styles.positionTextHighlight]}>
              {item.position}
            </Text>
          )}
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.username.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={[styles.username, item.isCurrentUser && styles.usernameHighlight]}>{item.username}</Text>
          <Text style={styles.city}>{item.city}</Text>
        </View>
        <View style={styles.rightCell}>
          <Text style={[styles.points, item.isCurrentUser && styles.pointsHighlight]}>
            {item.points.toLocaleString('es-ES')}
          </Text>
          <Text style={styles.pointsLabel}>pts · {item.zones} zonas</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Ranking</Text>
        <Text style={styles.updated}>Actualizado hoy 9:00</Text>
      </View>

      <View style={styles.tabs}>
        {(['Nacional', 'Ciudad', 'Amigos'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'Amigos' ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Próximamente</Text>
          <Text style={styles.emptyText}>El ranking de amigos llegará pronto.</Text>
        </View>
      ) : tab === 'Ciudad' && !user?.city ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Sin ciudad</Text>
          <Text style={styles.emptyText}>Actualiza tu ciudad en el perfil para ver el ranking local.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.orange} size="large" />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Sin resultados</Text>
          <Text style={styles.emptyText}>Aún no hay corredores en {user?.city}.</Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={item => String(item.position)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(true); }}
              tintColor={colors.orange}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListFooterComponent={
            <View style={styles.footer}>
              <Text style={styles.footerText}>🔄 Actualiza cada hora</Text>
            </View>
          }
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md,
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  title: { fontSize: 28, fontWeight: '900', color: colors.textPrimary },
  updated: { fontSize: 12, color: colors.textSecondary },
  tabs: {
    flexDirection: 'row', marginHorizontal: spacing.md, backgroundColor: colors.bgCard,
    borderRadius: radius.full, padding: 4, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.full, alignItems: 'center' },
  tabActive: { backgroundColor: colors.orange },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },
  list: { paddingHorizontal: spacing.md, paddingBottom: 100 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm, borderRadius: radius.md, gap: spacing.sm,
  },
  rowHighlight: { backgroundColor: colors.orangeGlow, borderWidth: 1, borderColor: `${colors.orange}40` },
  positionCell: { width: 32, alignItems: 'center' },
  medal: { fontSize: 20 },
  positionText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  positionTextHighlight: { color: colors.orange },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgCardAlt,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  userInfo: { flex: 1 },
  username: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  usernameHighlight: { color: colors.orange },
  city: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  rightCell: { alignItems: 'flex-end' },
  points: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  pointsHighlight: { color: colors.orange },
  pointsLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  separator: { height: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
  footerText: { fontSize: 12, color: colors.textMuted },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.xl },
});
