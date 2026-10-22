import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuth } from '@adar/shared-auth';
import {
  EatsEvent,
  EatsEventDetail,
  EatsEventPublicMenuItem,
  EatsEventStall,
  EatsEventStallMenuPublic,
  EatsOrderResponse,
  checkoutOrder,
  createEventOrderDraft,
  getEvent,
  getOrder,
  getStallMenuPublic,
  listLiveEvents,
} from './eatsApi';
import { EventAssistantScreen } from './EventAssistantScreen';
import { useEventCart } from './EventCartContext';
import { PickupTimePicker, PickupTimeValue } from './PickupTimePicker';

const BRAND = '#1b2430';

function formatMoney(value: number | null, currency = 'USD') {
  if (value == null) return '';
  return `${currency === 'USD' ? '$' : currency + ' '}${value.toFixed(2)}`;
}

function formatRange(startAt: string, endAt: string): string {
  try {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const startStr = start.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const endStr = end.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `${startStr} - ${endStr}`;
  } catch {
    return '';
  }
}

type Screen = 'events' | 'stalls' | 'menu' | 'cart';

/** Events tab: browse live events, pick a stall, order from its (possibly
 *  event-only) menu -- the mobile counterpart to the web app's
 *  EventsPage.jsx. A plain useState stack (events -> stalls -> menu ->
 *  cart), same convention as DineInScreen.tsx/OwnerDashboardScreen.tsx --
 *  this codebase has no navigation library. Uses its own EventCartContext
 *  (NOT the carryout CartContext) since an event order is a fully
 *  separate pipeline, just reusing the same checkout/payment endpoints
 *  once a draft exists (see eatsApi.ts's createEventOrderDraft). */
export function EventsScreen() {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const cart = useEventCart();

  const [screen, setScreen] = useState<Screen>('events');
  const [events, setEvents] = useState<EatsEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<EatsEventDetail | null>(null);
  const [eventEnded, setEventEnded] = useState<string | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(false);

  const [selectedStall, setSelectedStall] = useState<EatsEventStall | null>(null);
  const [stallMenu, setStallMenu] = useState<EatsEventStallMenuPublic | null>(null);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAssistant, setShowAssistant] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    setEventsError(null);
    try {
      const list = await listLiveEvents(client, accessToken);
      setEvents(list);
    } catch {
      setEventsError('Could not load events. Pull down to try again.');
    } finally {
      setLoadingEvents(false);
    }
  }, [client, accessToken]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const openEvent = useCallback(
    async (ev: EatsEvent) => {
      setLoadingEvent(true);
      setError(null);
      setEventEnded(null);
      try {
        const detail = await getEvent(client, accessToken, ev.id);
        if ('ended' in detail && detail.ended) {
          setEventEnded(detail.message || 'This event has ended.');
          setSelectedEvent({ ...ev, stalls: [] });
        } else {
          setSelectedEvent(detail as EatsEventDetail);
        }
        setScreen('stalls');
      } catch {
        setError('Could not open this event. Please try again.');
      } finally {
        setLoadingEvent(false);
      }
    },
    [client, accessToken]
  );

  const openStall = useCallback(
    async (stall: EatsEventStall) => {
      setSelectedStall(stall);
      setLoadingMenu(true);
      setError(null);
      try {
        const menu = await getStallMenuPublic(client, accessToken, stall.event_id, stall.id);
        setStallMenu(menu);
        // menu.stall carries restaurant_timezone (a JOIN the event's own
        // stalls listing doesn't have) -- refresh selectedStall with it so
        // EventCartScreen's pickup-time picker knows the right timezone.
        setSelectedStall(menu.stall);
        setScreen('menu');
      } catch {
        setError('Could not load this stall\'s menu. Please try again.');
      } finally {
        setLoadingMenu(false);
      }
    },
    [client, accessToken]
  );

  const addToCart = useCallback(
    (item: EatsEventPublicMenuItem) => {
      if (!selectedEvent || !selectedStall) return;
      cart.addItem({
        eventMenuItemId: item.id,
        itemName: item.item_name,
        category: item.category,
        unitPrice: item.price,
        currency: item.currency || 'USD',
        eventId: selectedEvent.id,
        eventName: selectedEvent.name,
        stallId: selectedStall.id,
        stallName: selectedStall.stall_name,
        imageUrl: item.image_url,
      });
      setAdded(item.id);
      setTimeout(() => setAdded(null), 1200);
    },
    [cart, selectedEvent, selectedStall]
  );

  // The assistant screen can add to cart from the top-level 'stalls'
  // view, before any stall's menu has been opened -- selectedStall may
  // not match cart.stallId there, or may still be null. Resolve the
  // stall the cart actually belongs to from the already-loaded event
  // detail's own stalls list instead of assuming selectedStall is it.
  const goToCart = () => {
    if (!selectedEvent || !cart.stallId) return;
    const stallForCart = selectedEvent.stalls.find((st) => st.id === cart.stallId) || selectedStall;
    if (!stallForCart) return;
    setSelectedStall(stallForCart);
    setScreen('cart');
  };

  const backToEvents = () => {
    setSelectedEvent(null);
    setEventEnded(null);
    setScreen('events');
  };
  const backToStalls = () => {
    setSelectedStall(null);
    setStallMenu(null);
    setScreen('stalls');
  };

  if (showAssistant && selectedEvent) {
    return <EventAssistantScreen event={selectedEvent} onBack={() => setShowAssistant(false)} />;
  }

  if (screen === 'cart' && selectedEvent && selectedStall) {
    return (
      <EventCartScreen
        event={selectedEvent}
        stall={selectedStall}
        onBack={() => setScreen('menu')}
        onOrderPlaced={() => setScreen('menu')}
      />
    );
  }

  if (screen === 'menu' && selectedStall && stallMenu) {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={backToStalls}>
            <Text style={styles.backLink}>← {selectedEvent?.name}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>{stallMenu.stall.stall_name}</Text>
        {!stallMenu.stall.accepting_orders && (
          <Text style={styles.pauseNotice}>This stall has paused new orders right now -- try again shortly.</Text>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          {stallMenu.menu_items.map((item) => (
            <View key={item.id} style={styles.menuRow}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.menuImg} />
              ) : (
                <View style={[styles.menuImg, styles.menuImgPlaceholder]}>
                  <Text style={styles.menuImgPlaceholderText}>🍽</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={styles.menuRowTop}>
                  <Text style={styles.menuItemName}>{item.item_name}</Text>
                  {item.price != null && <Text style={styles.menuItemPrice}>{formatMoney(item.price, item.currency)}</Text>}
                </View>
                {item.description ? <Text style={styles.menuItemDesc}>{item.description}</Text> : null}
                <TouchableOpacity
                  style={[styles.addButton, !stallMenu.stall.accepting_orders && styles.buttonDisabled]}
                  disabled={!stallMenu.stall.accepting_orders}
                  onPress={() => addToCart(item)}
                >
                  <Text style={styles.addButtonText}>{added === item.id ? 'Added ✓' : '+ Add to cart'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {stallMenu.menu_items.length === 0 && (
            <Text style={styles.emptyText}>This stall hasn't posted its menu yet.</Text>
          )}
        </ScrollView>
        {cart.items.length > 0 && (
          <TouchableOpacity style={styles.cartBar} onPress={goToCart}>
            <Text style={styles.cartBarText}>
              View cart · {cart.itemCount} item{cart.itemCount === 1 ? '' : 's'} · {formatMoney(cart.subtotal)}
            </Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    );
  }

  if (screen === 'stalls' && selectedEvent) {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={backToEvents}>
            <Text style={styles.backLink}>← Events</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>{selectedEvent.name}</Text>
        <Text style={styles.subtitle}>
          {selectedEvent.venue}{selectedEvent.venue ? ' · ' : ''}
          {formatRange(selectedEvent.start_at, selectedEvent.end_at)}
        </Text>
        {selectedEvent.description ? <Text style={styles.description}>{selectedEvent.description}</Text> : null}
        {!eventEnded && (
          <TouchableOpacity style={styles.assistantLink} onPress={() => setShowAssistant(true)}>
            <Text style={styles.assistantLinkText}>Ask the event assistant →</Text>
          </TouchableOpacity>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
        {eventEnded ? (
          <Text style={styles.emptyText}>{eventEnded}</Text>
        ) : loadingEvent ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={BRAND} />
        ) : (
          <FlatList
            data={selectedEvent.stalls}
            keyExtractor={(s) => s.id}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: cart.items.length > 0 ? 90 : 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.stallCard} onPress={() => openStall(item)}>
                <Text style={styles.stallName}>{item.stall_name}</Text>
                {item.location_zone ? <Text style={styles.stallMeta}>Zone: {item.location_zone}</Text> : null}
                {!item.accepting_orders && <Text style={styles.stallPaused}>Paused -- not taking new orders</Text>}
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No stalls are open yet at this event.</Text>}
          />
        )}
        {loadingMenu && <ActivityIndicator style={{ marginTop: 12 }} color={BRAND} />}
        {cart.items.length > 0 && (
          <TouchableOpacity style={styles.cartBar} onPress={goToCart}>
            <Text style={styles.cartBarText}>
              View cart · {cart.itemCount} item{cart.itemCount === 1 ? '' : 's'} · {formatMoney(cart.subtotal)}
            </Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <Text style={styles.title}>Events</Text>
      <Text style={styles.subtitle}>Order food from stalls at a live event near you.</Text>
      {eventsError && <Text style={styles.errorText}>{eventsError}</Text>}
      {loadingEvents && events.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          onRefresh={loadEvents}
          refreshing={loadingEvents}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.eventCard} onPress={() => openEvent(item)}>
              <Text style={styles.stallName}>{item.name}</Text>
              <Text style={styles.stallMeta}>
                {item.venue}{item.venue ? ' · ' : ''}
                {formatRange(item.start_at, item.end_at)}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !loadingEvents ? <Text style={styles.emptyText}>No live events right now. Check back soon.</Text> : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// ── Cart / checkout ──────────────────────────────────────────────────────
function EventCartScreen({
  event,
  stall,
  onBack,
  onOrderPlaced,
}: {
  event: EatsEventDetail;
  stall: EatsEventStall;
  onBack: () => void;
  onOrderPlaced: () => void;
}) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const cart = useEventCart();

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [pickup, setPickup] = useState<PickupTimeValue>({ mode: 'asap', date: '', time: '' });
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<EatsOrderResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewOrder = async () => {
    if (!cart.items.length) {
      setError('Add items to the cart first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await createEventOrderDraft(client, accessToken, event.id, stall.id, {
        items: cart.items.map((i) => ({
          event_menu_item_id: i.eventMenuItemId,
          quantity: i.quantity,
          instructions: i.instructions,
        })),
        customerName,
        customerPhone,
        customerEmail,
        pickupTimeRequest: pickup.mode === 'asap' ? 'ASAP' : '',
        pickupDate: pickup.mode === 'scheduled' ? pickup.date : null,
        pickupTime: pickup.mode === 'scheduled' ? pickup.time : null,
        specialInstructions: notes,
      });
      setDraft(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not create this order.');
    } finally {
      setBusy(false);
    }
  };

  const payAndPlace = async () => {
    const orderId = draft?.order?.id;
    if (!orderId) return;
    setBusy(true);
    setError(null);
    try {
      const redirectUrl = Linking.createURL('checkout-complete');
      const successUrl = `${redirectUrl}?result=success&order_id=${orderId}`;
      const cancelUrl = `${redirectUrl}?result=cancelled&order_id=${orderId}`;
      const result = await checkoutOrder(client, accessToken, orderId, null, successUrl, cancelUrl);
      if (result.checkout_url) {
        await WebBrowser.openAuthSessionAsync(result.checkout_url, redirectUrl);
        try {
          const refreshed = await getOrder(client, accessToken, orderId, null);
          setDraft(refreshed);
          if (!['draft', 'payment_pending'].includes(refreshed.order.status)) {
            cart.clearCart();
            onOrderPlaced();
          }
        } catch {
          // Orders tab shows the latest status regardless
        }
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not start payment checkout.');
    } finally {
      setBusy(false);
    }
  };

  const order = draft?.order;
  const canPay = !!order && ['draft', 'payment_pending'].includes(order.status);

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backLink}>← {stall.stall_name}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.title}>Event Cart</Text>
        <Text style={styles.subtitle}>{stall.stall_name} · {event.name}</Text>

        {cart.items.length === 0 ? (
          <Text style={styles.emptyText}>Your event cart is empty.</Text>
        ) : (
          cart.items.map((item) => (
            <View key={item.key} style={styles.cartItemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuItemName}>{item.itemName}</Text>
                <Text style={styles.menuItemDesc}>
                  {item.unitPrice != null ? formatMoney(item.unitPrice, item.currency) : 'Price not set'}
                </Text>
              </View>
              <View style={styles.qtyStepper}>
                <TouchableOpacity style={styles.qtyButton} onPress={() => cart.updateQuantity(item.key, item.quantity - 1)}>
                  <Text style={styles.qtyButtonText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyValue}>{item.quantity}</Text>
                <TouchableOpacity style={styles.qtyButton} onPress={() => cart.updateQuantity(item.key, item.quantity + 1)}>
                  <Text style={styles.qtyButtonText}>+</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => cart.removeItem(item.key)}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        {cart.items.length > 0 && (
          <>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Estimated subtotal</Text>
              <Text style={styles.totalValue}>{formatMoney(cart.subtotal)}</Text>
            </View>

            <Text style={styles.fieldLabel}>Your name</Text>
            <TextInput style={styles.input} value={customerName} onChangeText={setCustomerName} />
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput style={styles.input} value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" />
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput style={styles.input} value={customerEmail} onChangeText={setCustomerEmail} keyboardType="email-address" autoCapitalize="none" />
            <Text style={styles.fieldLabel}>Pickup time</Text>
            <PickupTimePicker timezone={stall.restaurant_timezone} value={pickup} onChange={setPickup} />
            <Text style={styles.fieldLabel}>Order notes</Text>
            <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline />

            {error && <Text style={styles.errorText}>{error}</Text>}

            {order && (
              <Text style={styles.statusText}>
                Order {order.status === 'draft' ? 'draft ready' : order.status} ·{' '}
                {formatMoney(Number(order.subtotal || 0), order.currency)}
                {order.payment_status ? ` · payment ${order.payment_status}` : ''}
              </Text>
            )}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryButton} disabled={busy} onPress={reviewOrder}>
                {busy && !order ? <ActivityIndicator color={BRAND} /> : <Text style={styles.secondaryButtonText}>Review order</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, !canPay && styles.buttonDisabled]}
                disabled={busy || !canPay}
                onPress={payAndPlace}
              >
                {busy && order ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Pay & Place Order</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  backLink: { fontSize: 13, color: BRAND, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '800', color: BRAND, paddingHorizontal: 16, paddingTop: 4 },
  subtitle: { fontSize: 13, color: '#5b6472', paddingHorizontal: 16, paddingTop: 4 },
  description: { fontSize: 13, color: '#374151', paddingHorizontal: 16, paddingTop: 8 },
  assistantLink: { paddingHorizontal: 16, paddingTop: 10 },
  assistantLinkText: { fontSize: 13, color: '#1b6bd4', fontWeight: '600' },
  pauseNotice: { marginHorizontal: 16, marginTop: 8, fontSize: 12.5, color: '#9a6b00', backgroundColor: '#fff6e5', padding: 8, borderRadius: 8 },
  emptyText: { textAlign: 'center', color: '#5b6472', marginTop: 30, paddingHorizontal: 20, fontSize: 14 },
  errorText: { marginHorizontal: 16, marginTop: 10, color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, fontSize: 13 },
  stallCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e5ea' },
  stallName: { fontSize: 15, fontWeight: '700', color: BRAND },
  stallMeta: { fontSize: 12.5, color: '#5b6472', marginTop: 2 },
  stallPaused: { fontSize: 12, color: '#9a6b00', marginTop: 4, fontWeight: '600' },
  eventCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e5ea' },
  menuRow: { flexDirection: 'row', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e5ea' },
  menuImg: { width: 72, height: 72, borderRadius: 10 },
  menuImgPlaceholder: { backgroundColor: '#eef1f0', alignItems: 'center', justifyContent: 'center' },
  menuImgPlaceholderText: { fontSize: 24 },
  menuRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  menuItemName: { fontSize: 15, fontWeight: '700', color: '#14181f', flexShrink: 1 },
  menuItemPrice: { fontSize: 14, fontWeight: '700', color: BRAND },
  menuItemDesc: { fontSize: 12.5, color: '#5b6472', marginTop: 2 },
  addButton: { alignSelf: 'flex-start', backgroundColor: '#eef1f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 8 },
  addButtonText: { color: BRAND, fontWeight: '700', fontSize: 12.5 },
  buttonDisabled: { opacity: 0.4 },
  cartBar: { position: 'absolute', bottom: 16, left: 16, right: 16, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cartBarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cartItemRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#e2e5ea', gap: 10,
  },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  qtyButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#eef1f0', alignItems: 'center', justifyContent: 'center' },
  qtyButtonText: { fontSize: 16, fontWeight: '700', color: BRAND },
  qtyValue: { minWidth: 24, textAlign: 'center', fontSize: 14, fontWeight: '700', color: '#14181f' },
  removeText: { fontSize: 12, color: '#c0392b', fontWeight: '600' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: '#e2e5ea', paddingVertical: 10, marginVertical: 12,
  },
  totalLabel: { fontSize: 14, color: '#5b6472' },
  totalValue: { fontSize: 16, fontWeight: '700', color: '#14181f' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#5b6472', marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, backgroundColor: '#fff',
  },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  statusText: { fontSize: 13, color: '#1b2430', fontWeight: '600', marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  primaryButton: { flex: 1, backgroundColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
