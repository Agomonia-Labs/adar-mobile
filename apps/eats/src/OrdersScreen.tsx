import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@adar/shared-auth';
import { useWorkspace } from './WorkspaceContext';
import {
  EatsFeedback,
  EatsOrder,
  EatsOrderItem,
  acceptOrder,
  completeOrder,
  listMyOrders,
  listOwnerFeedback,
  listOwnerOrders,
  readyOrder,
  rejectOrder,
  updateFeedbackStatus,
} from './eatsApi';
import { FeedbackModal, FeedbackTarget } from './FeedbackModal';

const BRAND = '#1b2430';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  payment_pending: 'Payment pending',
  payment_failed: 'Payment failed',
  submitted: 'Submitted',
  accepted: 'Accepted',
  rejected: 'Rejected',
  ready_for_pickup: 'Ready for pickup',
  completed: 'Completed',
};

function formatMoney(value: number, currency = 'USD') {
  return `${currency === 'USD' ? '$' : currency + ' '}${Number(value || 0).toFixed(2)}`;
}

function OrderItemsList({ items }: { items?: EatsOrderItem[] }) {
  const rows = items || [];
  if (!rows.length) return <Text style={styles.muted}>No item details available.</Text>;
  return (
    <View style={{ marginTop: 6 }}>
      {rows.map((item, i) => (
        <View key={item.id || `${item.item_name}-${i}`} style={styles.itemLine}>
          <Text style={styles.itemLineText} numberOfLines={2}>
            {item.quantity} × {item.item_name}
            {item.category ? ` (${item.category})` : ''}
          </Text>
          {item.line_total != null && <Text style={styles.itemLinePrice}>{formatMoney(item.line_total, item.currency)}</Text>}
        </View>
      ))}
    </View>
  );
}

function OrderCard({
  order,
  mode,
  busy,
  onAction,
  onFeedback,
}: {
  order: EatsOrder;
  mode: 'customer' | 'owner';
  busy: boolean;
  onAction?: (action: 'accept' | 'reject' | 'ready' | 'complete') => void;
  onFeedback?: (item: EatsOrderItem) => void;
}) {
  const canFeedback = mode === 'customer' && ['submitted', 'accepted', 'ready_for_pickup', 'completed'].includes(order.status);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{order.restaurant_name}</Text>
          <Text style={styles.muted}>
            {order.item_count ?? order.order_items?.length ?? 0} item(s) · {formatMoney(order.subtotal, order.currency)}
          </Text>
        </View>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>{STATUS_LABELS[order.status] || order.status}</Text>
        </View>
      </View>
      {mode === 'owner' && (
        <Text style={styles.muted}>
          Customer: {order.customer_name || 'Not provided'}{order.customer_phone ? ` · ${order.customer_phone}` : ''}
        </Text>
      )}
      {order.pickup_time_request ? <Text style={styles.muted}>Pickup: {order.pickup_time_request}</Text> : null}
      <OrderItemsList items={order.order_items} />

      {mode === 'owner' && (
        <View style={styles.actionsRow}>
          {order.status === 'submitted' && (
            <>
              <TouchableOpacity style={styles.primaryBtn} disabled={busy} onPress={() => onAction?.('accept')}>
                <Text style={styles.primaryBtnText}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dangerBtn} disabled={busy} onPress={() => onAction?.('reject')}>
                <Text style={styles.dangerBtnText}>Reject</Text>
              </TouchableOpacity>
            </>
          )}
          {order.status === 'accepted' && (
            <TouchableOpacity style={styles.primaryBtn} disabled={busy} onPress={() => onAction?.('ready')}>
              <Text style={styles.primaryBtnText}>Mark ready</Text>
            </TouchableOpacity>
          )}
          {order.status === 'ready_for_pickup' && (
            <TouchableOpacity style={styles.secondaryBtn} disabled={busy} onPress={() => onAction?.('complete')}>
              <Text style={styles.secondaryBtnText}>Complete</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {canFeedback && (order.order_items || []).length > 0 && (
        <View style={styles.actionsRow}>
          {(order.order_items || []).map((item) => (
            <TouchableOpacity
              key={item.id || item.item_name}
              style={styles.feedbackChip}
              onPress={() => onFeedback?.(item)}
            >
              <Text style={styles.feedbackChipText}>★ Rate {item.item_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

/** Carryout Orders tab -- customer order history/status (listMyOrders) plus,
 *  for a restaurant owner, outstanding + all orders placed to their
 *  restaurant with accept/reject/ready/complete actions (listOwnerOrders +
 *  the owner transition endpoints). Mirrors RestaurantPanel.jsx's two
 *  OrderList panels, as a switchable view instead of side-by-side (mobile
 *  width). */
export function OrdersScreen() {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const { workspaceId } = useWorkspace();
  const [view, setView] = useState<'mine' | 'managing' | 'feedback'>('mine');
  const [feedback, setFeedback] = useState<EatsFeedback[]>([]);
  const [feedbackBusyId, setFeedbackBusyId] = useState<string | null>(null);
  const [myOrders, setMyOrders] = useState<EatsOrder[]>([]);
  const [ownerOrders, setOwnerOrders] = useState<EatsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mine, owner, ownerFeedback] = await Promise.all([
        listMyOrders(client, accessToken),
        listOwnerOrders(client, accessToken, { workspaceId }).catch(() => []),
        listOwnerFeedback(client, accessToken, undefined, workspaceId).catch(() => []),
      ]);
      setMyOrders(mine);
      setOwnerOrders(owner);
      setFeedback(ownerFeedback);
    } catch {
      setError('Could not load orders. Pull down to try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runOwnerAction = async (order: EatsOrder, action: 'accept' | 'reject' | 'ready' | 'complete') => {
    setBusyId(order.id);
    try {
      const fn = action === 'accept' ? acceptOrder : action === 'reject' ? rejectOrder : action === 'ready' ? readyOrder : completeOrder;
      await fn(client, accessToken, order.id, order.workspace_id);
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.detail || `Could not ${action} order.`);
    } finally {
      setBusyId(null);
    }
  };

  const acknowledgeFeedback = async (item: EatsFeedback) => {
    setFeedbackBusyId(item.id);
    try {
      await updateFeedbackStatus(client, accessToken, item.id, 'acknowledged', undefined, workspaceId);
      await refresh();
    } catch {
      setError('Could not update feedback.');
    } finally {
      setFeedbackBusyId(null);
    }
  };

  const data = view === 'mine' ? myOrders : view === 'managing' ? ownerOrders : [];

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabButton, view === 'mine' && styles.tabButtonActive]}
          onPress={() => setView('mine')}
        >
          <Text style={[styles.tabText, view === 'mine' && styles.tabTextActive]}>My Orders</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, view === 'managing' && styles.tabButtonActive]}
          onPress={() => setView('managing')}
        >
          <Text style={[styles.tabText, view === 'managing' && styles.tabTextActive]}>Manage Orders</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, view === 'feedback' && styles.tabButtonActive]}
          onPress={() => setView('feedback')}
        >
          <Text style={[styles.tabText, view === 'feedback' && styles.tabTextActive]}>Feedback</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading && data.length === 0 && feedback.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : view === 'feedback' ? (
        <FlatList
          style={styles.list}
          data={feedback}
          keyExtractor={(item) => item.id}
          onRefresh={refresh}
          refreshing={loading}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.menu_item_name || item.restaurant_name}</Text>
                  <Text style={styles.muted}>
                    {'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)} {item.verified_order ? '· verified order' : ''}
                  </Text>
                </View>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>{item.status}</Text>
                </View>
              </View>
              {item.feedback_text ? <Text style={styles.muted}>{item.feedback_text}</Text> : null}
              {item.status === 'submitted' && (
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    disabled={feedbackBusyId === item.id}
                    onPress={() => acknowledgeFeedback(item)}
                  >
                    <Text style={styles.secondaryBtnText}>Acknowledge</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={!loading ? <Text style={styles.emptyText}>No feedback yet on a restaurant you manage.</Text> : null}
        />
      ) : (
        <FlatList
          style={styles.list}
          data={data}
          keyExtractor={(item) => item.id}
          onRefresh={refresh}
          refreshing={loading}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              mode={view === 'mine' ? 'customer' : 'owner'}
              busy={busyId === item.id}
              onAction={(action) => runOwnerAction(item, action)}
              onFeedback={(orderItem) =>
                setFeedbackTarget({
                  restaurant_id: item.restaurant_id,
                  restaurant_name: item.restaurant_name,
                  menu_item_id: orderItem.menu_item_id,
                  menu_item_name: orderItem.item_name,
                  order_id: item.id,
                })
              }
            />
          )}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.emptyText}>
                {view === 'mine'
                  ? "You haven't placed any carryout orders yet."
                  : 'No orders have been placed to a restaurant you manage yet.'}
              </Text>
            ) : null
          }
        />
      )}

      <FeedbackModal
        visible={!!feedbackTarget}
        target={feedbackTarget}
        onClose={() => setFeedbackTarget(null)}
        onSubmitted={refresh}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  tabRow: { flexDirection: 'row', padding: 12, gap: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e5ea' },
  tabButton: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: '#eef1f0' },
  tabButtonActive: { backgroundColor: BRAND },
  tabText: { fontSize: 13, fontWeight: '700', color: '#5b6472' },
  tabTextActive: { color: '#fff' },
  list: { flex: 1 },
  errorText: { color: '#c0392b', backgroundColor: '#fdecea', margin: 16, marginBottom: 0, padding: 10, borderRadius: 10, fontSize: 13 },
  emptyText: { textAlign: 'center', color: '#5b6472', marginTop: 40, paddingHorizontal: 24, fontSize: 14 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e5ea',
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#14181f' },
  muted: { fontSize: 12.5, color: '#5b6472', marginTop: 2 },
  statusPill: { backgroundColor: '#eef1f0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: 11, fontWeight: '700', color: BRAND },
  itemLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  itemLineText: { fontSize: 12.5, color: '#374151', flex: 1, marginRight: 8 },
  itemLinePrice: { fontSize: 12.5, color: '#374151', fontWeight: '600' },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  primaryBtn: { backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  secondaryBtn: { borderWidth: 1, borderColor: BRAND, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryBtnText: { color: BRAND, fontWeight: '700', fontSize: 12.5 },
  dangerBtn: { backgroundColor: '#fdecea', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  dangerBtnText: { color: '#c0392b', fontWeight: '700', fontSize: 12.5 },
  feedbackChip: { backgroundColor: '#fff6e0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  feedbackChipText: { color: '#8a6d1f', fontWeight: '700', fontSize: 12 },
});
