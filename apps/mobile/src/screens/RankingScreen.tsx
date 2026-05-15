import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Animated,
  PanResponder,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { api, RankingEntry, FriendRequest, Friend } from '../services/api';

type Tab = 'Nacional' | 'Ciudad' | 'Amigos';

interface Props {
  user: { id: string; username: string; email: string; city?: string } | null;
  pendingCount?: number;
  onPendingCountChange?: (count: number) => void;
}

function SwipeableFriendRow({ item, index, onDelete }: { item: Friend; index: number; onDelete: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) translateX.setValue(g.dx); // Solo swipe izquierda
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -80) {
          // Mostrar botón eliminar
          Animated.spring(translateX, { toValue: -80, useNativeDriver: true }).start();
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  return (
    <View style={{ overflow: 'hidden' }}>
      {/* Botón eliminar detrás */}
      <TouchableOpacity
        style={swipeStyles.deleteBtn}
        onPress={() => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          onDelete();
        }}
      >
        <Ionicons name="trash" size={20} color="#fff" />
        <Text style={swipeStyles.deleteBtnText}>Eliminar</Text>
      </TouchableOpacity>

      {/* Row con swipe */}
      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        <View style={[rowStyles.row, { backgroundColor: colors.bg }]}>
          <View style={rowStyles.positionCell}>
            <Text style={rowStyles.positionText}>{index + 1}</Text>
          </View>
          <View style={rowStyles.avatar}>
            <Text style={rowStyles.avatarText}>{(item.display_name ?? '?').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={rowStyles.userInfo}>
            <Text style={rowStyles.username}>{item.display_name}</Text>
            <Text style={rowStyles.city}>{item.city}</Text>
          </View>
          <View style={rowStyles.rightCell}>
            <Text style={rowStyles.points}>{item.total_points.toLocaleString('es-ES')}</Text>
            <Text style={rowStyles.pointsLabel}>pts · {item.total_zones} zonas</Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const swipeStyles = StyleSheet.create({
  deleteBtn: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 80,
    backgroundColor: '#FB0E01', alignItems: 'center', justifyContent: 'center', gap: 2,
    borderRadius: radius.md,
  },
  deleteBtnText: { fontSize: 11, fontWeight: '700', color: '#fff' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm, borderRadius: radius.md, gap: spacing.sm,
  },
  positionCell: { width: 32, alignItems: 'center' },
  positionText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgCardAlt,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  userInfo: { flex: 1 },
  username: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  city: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  rightCell: { alignItems: 'flex-end' },
  points: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  pointsLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
});

export default function RankingScreen({ user, pendingCount = 0, onPendingCountChange }: Props) {
  const [tab, setTab] = useState<Tab>('Nacional');
  const [data, setData] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [trend, setTrend] = useState(0);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

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

    // Calcular trend comparando con posición guardada
    const me = res.find(r => r.isCurrentUser);
    if (me) {
      const key = `rank_prev_${currentTab}`;
      try {
        const prev = await AsyncStorage.getItem(key);
        if (prev) {
          const prevPos = parseInt(prev, 10);
          setTrend(prevPos - me.position); // positivo = has subido
        } else {
          setTrend(0);
        }
        await AsyncStorage.setItem(key, String(me.position));
      } catch {
        setTrend(0);
      }
    }

    setLoading(false);
    setRefreshing(false);
  };

  const loadFriends = async () => {
    setFriendsLoading(true);
    try {
      const [f, p] = await Promise.all([
        api.getFriends(),
        api.getPendingFriendRequests(),
      ]);
      setFriends(f);
      setPendingRequests(p);
      onPendingCountChange?.(p.length);
    } catch {}
    setFriendsLoading(false);
  };

  const handleFriendAction = async (id: string, action: 'accept' | 'reject') => {
    try {
      await api.respondFriendRequest(id, action);
      loadFriends();
    } catch {
      Alert.alert('Error', 'No se pudo procesar la solicitud');
    }
  };

  const removeFriend = async (userId: string, name: string) => {
    Alert.alert(
      'Eliminar amigo',
      `¿Seguro que quieres eliminar a ${name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            try {
              await api.removeFriend(userId);
              loadFriends();
            } catch {
              Alert.alert('Error', 'No se pudo eliminar');
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    if (tab === 'Amigos') loadFriends();
    else load(false, tab);
  }, [tab]);

  const renderItem = ({ item }: { item: RankingEntry }) => {
    const isTop3 = item.position <= 3;
    const medals = ['🥇', '🥈', '🥉'];
    return (
      <TouchableOpacity
        style={[styles.row, item.isCurrentUser && styles.rowHighlight]}
        activeOpacity={item.isCurrentUser ? 1 : 0.6}
        onPress={() => {
          if (!item.isCurrentUser && item.userId) {
            Alert.alert(
              item.username,
              `${item.points.toLocaleString('es-ES')} pts · ${item.zones} zonas`,
              [
                { text: 'Cerrar', style: 'cancel' },
                {
                  text: '👥 Agregar amigo',
                  onPress: async () => {
                    try {
                      await api.sendFriendRequest(item.userId!);
                      Alert.alert('👥 Solicitud enviada', `Has enviado solicitud a ${item.username}`);
                    } catch {
                      Alert.alert('👥 Solicitud enviada', `Solicitud enviada a ${item.username}`);
                    }
                  },
                },
              ]
            );
          }
        }}
      >
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
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Ranking</Text>
        <Text style={styles.updated}>Actualizado {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</Text>
      </View>

      <View style={styles.tabs}>
        {(['Nacional', 'Ciudad', 'Amigos'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
              {t === 'Amigos' && pendingCount > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{pendingCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'Amigos' ? (
        friendsLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.orange} size="large" />
          </View>
        ) : (
          <FlatList
            data={friends}
            keyExtractor={item => item.user_id}
            contentContainerStyle={[styles.list, friends.length === 0 && pendingRequests.length === 0 && { flex: 1 }]}
            ListHeaderComponent={() => (
              <View>
                {/* Solicitudes pendientes */}
                {pendingRequests.length > 0 && (
                  <View style={styles.pendingSection}>
                    <Text style={styles.pendingSectionTitle}>SOLICITUDES ({pendingRequests.length})</Text>
                    {pendingRequests.map(req => (
                      <View key={req.id} style={styles.pendingRow}>
                        <View style={styles.pendingAvatar}>
                          <Text style={styles.pendingAvatarText}>{(req.sender_name ?? '?').charAt(0).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pendingName}>{req.sender_name}</Text>
                          <Text style={styles.pendingDate}>
                            {new Date(req.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.acceptBtn}
                          onPress={() => handleFriendAction(req.id, 'accept')}
                        >
                          <Ionicons name="checkmark" size={18} color="#fff" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.rejectBtn}
                          onPress={() => handleFriendAction(req.id, 'reject')}
                        >
                          <Ionicons name="close" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {friends.length > 0 && (
                  <Text style={styles.friendsSectionTitle}>RANKING AMIGOS</Text>
                )}
              </View>
            )}
            renderItem={({ item, index }) => (
              <SwipeableFriendRow
                item={item}
                index={index}
                onDelete={() => removeFriend(item.user_id, item.display_name)}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              pendingRequests.length === 0 ? (
                <View style={styles.centered}>
                  <Ionicons name="people-outline" size={48} color={colors.textMuted} />
                  <Text style={styles.emptyTitle}>Sin amigos aún</Text>
                  <Text style={styles.emptyText}>Toca en una zona rival en el mapa para agregar amigos.</Text>
                </View>
              ) : null
            }
          />
        )
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
          ListHeaderComponent={() => {
            const me = data.find(d => d.isCurrentUser);
            if (!me) return null;
            return (
              <View style={styles.myRankCard}>
                <View style={styles.myRankLeft}>
                  <Text style={styles.myRankLabel}>TU POSICIÓN</Text>
                  <View style={styles.myRankRow}>
                    <Text style={styles.myRankPosition}>#{me.position}</Text>
                    {trend !== 0 && (
                      <View style={[styles.myRankTrend, trend > 0 ? styles.myRankTrendUp : styles.myRankTrendDown]}>
                        <Ionicons
                          name={trend > 0 ? 'arrow-up' : 'arrow-down'}
                          size={14}
                          color={trend > 0 ? '#22C55E' : '#FB0E01'}
                        />
                        <Text style={[styles.myRankTrendText, { color: trend > 0 ? '#22C55E' : '#FB0E01' }]}>
                          {Math.abs(trend)}
                        </Text>
                      </View>
                    )}
                    {trend === 0 && (
                      <View style={styles.myRankTrendNeutral}>
                        <Ionicons name="remove" size={14} color={colors.textSecondary} />
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.myRankRight}>
                  <Text style={styles.myRankPoints}>{me.points.toLocaleString('es-ES')}</Text>
                  <Text style={styles.myRankPointsLabel}>puntos</Text>
                </View>
              </View>
            );
          }}
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
  // My rank card
  myRankCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    borderWidth: 1, borderColor: `${colors.orange}40`,
    padding: spacing.md, marginBottom: spacing.md,
  },
  myRankLeft: {},
  myRankLabel: {
    fontSize: 11, fontWeight: '700', color: colors.textSecondary,
    letterSpacing: 1, marginBottom: 4,
  },
  myRankRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  myRankPosition: { fontSize: 40, fontWeight: '900', color: colors.orange },
  myRankTrend: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full,
  },
  myRankTrendUp: { backgroundColor: 'rgba(34,197,94,0.15)' },
  myRankTrendDown: { backgroundColor: 'rgba(251,14,1,0.15)' },
  myRankTrendText: { fontSize: 13, fontWeight: '700' },
  myRankTrendNeutral: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.05)',
  },
  myRankRight: { alignItems: 'flex-end' },
  myRankPoints: { fontSize: 24, fontWeight: '900', color: colors.textPrimary },
  myRankPointsLabel: { fontSize: 12, color: colors.textSecondary },
  // Friends tab
  pendingSection: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: `${colors.orange}40`,
  },
  pendingSectionTitle: {
    fontSize: 12, fontWeight: '800', color: colors.orange,
    letterSpacing: 1, marginBottom: spacing.sm,
  },
  pendingRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pendingAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgCardAlt,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  pendingAvatarText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  pendingName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  pendingDate: { fontSize: 11, color: colors.textSecondary },
  acceptBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center',
  },
  rejectBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.bgCardAlt, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  friendsSectionTitle: {
    fontSize: 12, fontWeight: '800', color: colors.textSecondary,
    letterSpacing: 1, marginBottom: spacing.sm, marginTop: spacing.sm,
  },
  tabBadge: {
    backgroundColor: '#FB0E01', borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
});
