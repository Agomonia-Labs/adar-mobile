import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { EatsNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from './eatsApi';

const BRAND = '#1b2430';
const POLL_MS = 30000;

function timeAgo(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return '';
  }
}

/** Header bell -- "notification is in place...everywhere" from the user's
 *  spec. Polls GET /api/restaurant/notifications (new endpoint, reading
 *  the restaurant_notifications table every order transition already
 *  wrote into -- see eatsApi.ts) every 30s for an unread badge, and shows
 *  the list in a simple dropdown-style modal on tap. */
export function NotificationsBell() {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [items, setItems] = useState<EatsNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await listNotifications(client, accessToken);
      setItems(data.notifications);
      setUnreadCount(data.unread_count);
    } catch {
      // silent -- a failed poll shouldn't disrupt the app
    }
  }, [client, accessToken]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const openList = async () => {
    setOpen(true);
    setLoading(true);
    await refresh();
    setLoading(false);
  };

  const onTapItem = async (item: EatsNotification) => {
    if (item.status === 'unread') {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, status: 'read' } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await markNotificationRead(client, accessToken, item.id);
      } catch {
        refresh();
      }
    }
  };

  const onMarkAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, status: 'read' })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead(client, accessToken);
    } catch {
      refresh();
    }
  };

  return (
    <>
      <TouchableOpacity onPress={openList} style={styles.bellButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.bellIcon}>🔔</Text>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.panel}>
            <View style={styles.panelHead}>
              <Text style={styles.panelTitle}>Notifications</Text>
              {unreadCount > 0 && (
                <TouchableOpacity onPress={onMarkAll}>
                  <Text style={styles.markAllText}>Mark all read</Text>
                </TouchableOpacity>
              )}
            </View>
            {loading ? (
              <ActivityIndicator color={BRAND} style={{ marginVertical: 20 }} />
            ) : (
              <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 360 }}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.notifRow} onPress={() => onTapItem(item)}>
                    {item.status === 'unread' && <View style={styles.dot} />}
                    <View style={{ flex: 1, marginLeft: item.status === 'unread' ? 0 : 14 }}>
                      <Text style={styles.notifMessage}>{item.message}</Text>
                      <Text style={styles.notifTime}>{timeAgo(item.created_at)}</Text>
                    </View>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={styles.emptyText}>No notifications yet.</Text>}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellButton: { paddingHorizontal: 4 },
  bellIcon: { fontSize: 18 },
  badge: {
    position: 'absolute', top: -4, right: -4, backgroundColor: '#c0392b', borderRadius: 9, minWidth: 18, height: 18,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  panel: {
    position: 'absolute', top: 60, right: 12, left: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 6,
  },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  panelTitle: { fontSize: 15, fontWeight: '700', color: '#14181f' },
  markAllText: { fontSize: 12, color: BRAND, fontWeight: '600' },
  notifRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f1f3' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: BRAND, marginTop: 6, marginRight: 7 },
  notifMessage: { fontSize: 13, color: '#14181f' },
  notifTime: { fontSize: 11, color: '#8a93a3', marginTop: 2 },
  emptyText: { fontSize: 13, color: '#5b6472', textAlign: 'center', paddingVertical: 20 },
});
