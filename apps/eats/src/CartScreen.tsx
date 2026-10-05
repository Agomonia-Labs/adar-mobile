import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { useCart } from './CartContext';
import { EatsOrderResponse, checkoutOrder, createOrderDraft, getOrder } from './eatsApi';

const BRAND = '#1b2430';

function formatMoney(value: number, currency = 'USD') {
  return `${currency === 'USD' ? '$' : currency + ' '}${value.toFixed(2)}`;
}

/** Carryout cart tab -- mirrors RestaurantPanel.jsx's CarryoutCart: review
 *  items from one restaurant, fill in pickup details, "Review order"
 *  persists a draft (createOrderDraft), then "Pay & Place Order" opens
 *  Stripe Checkout in the system browser (same Stripe integration the web
 *  app already uses -- POST /orders/{id}/checkout, see eatsApi.ts). */
export function CartScreen({ onViewOrders }: { onViewOrders?: () => void }) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const cart = useCart();

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [pickupTime, setPickupTime] = useState('');
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<EatsOrderResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewOrder = async () => {
    if (!cart.items.length || !cart.restaurantId) {
      setError('Add menu items to the cart first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await createOrderDraft(client, accessToken, {
        restaurantId: cart.restaurantId,
        restaurantName: cart.restaurantName,
        workspaceId: cart.workspaceId,
        items: cart.items.map((i) => ({
          menu_item_id: i.menu_item_id,
          item_name: i.item_name,
          category: i.category,
          unit_price: i.unit_price,
          currency: i.currency,
          quantity: i.quantity,
          instructions: i.instructions,
        })),
        customerName,
        customerPhone,
        customerEmail,
        pickupTimeRequest: pickupTime,
        specialInstructions: notes,
      });
      setDraft(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not create carryout order.');
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
      // adareats://checkout-complete -- the app's own registered scheme
      // (app.json) -- NOT the backend's default success_url/cancel_url,
      // which point at APP_URL (the DocIntel *web app*). Without passing
      // these, finishing or cancelling payment on Stripe's hosted page
      // redirected the diner to the web app's login screen instead of
      // back into this app. openAuthSessionAsync watches for a redirect
      // to this scheme and returns control to the app automatically --
      // no manual "close browser" step needed either.
      const redirectUrl = Linking.createURL('checkout-complete');
      const successUrl = `${redirectUrl}?result=success&order_id=${orderId}`;
      const cancelUrl = `${redirectUrl}?result=cancelled&order_id=${orderId}`;
      const result = await checkoutOrder(client, accessToken, orderId, cart.workspaceId, successUrl, cancelUrl);
      if (result.checkout_url) {
        await WebBrowser.openAuthSessionAsync(result.checkout_url, redirectUrl);
        // Whether Stripe redirected back with "success", "cancelled", or
        // the diner dismissed the browser some other way, refresh from
        // the order itself rather than trusting the redirect outcome --
        // the webhook is the source of truth for whether it actually got
        // paid, and may still be landing server-side at this exact
        // moment.
        try {
          const refreshed = await getOrder(client, accessToken, orderId, cart.workspaceId);
          setDraft(refreshed);
          // The order's card is only AUTHORIZED at this point, not
          // charged -- the restaurant captures payment when they accept
          // (backend: _capture_restaurant_order_payment). Clear the cart
          // once the order has actually reached the restaurant
          // ('submitted' or further), not on payment_status === 'paid',
          // which may not happen until the owner acts on it, possibly
          // much later.
          if (!['draft', 'payment_pending'].includes(refreshed.order.status)) {
            cart.clearCart();
          }
        } catch {
          // ignore -- Orders tab will show the latest status regardless
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
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Carryout Cart</Text>
        <Text style={styles.subtitle}>
          {cart.restaurantName || 'Add items from one restaurant to start an order.'}
        </Text>

        {cart.items.length === 0 ? (
          <Text style={styles.empty}>No items in cart. Add dishes from Discover or the chat assistant.</Text>
        ) : (
          cart.items.map((item) => (
            <View key={item.key} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.item_name}</Text>
                <Text style={styles.itemPrice}>
                  {item.unit_price != null ? formatMoney(item.unit_price, item.currency) : 'Price not set'}
                </Text>
                <TextInput
                  style={styles.notesInput}
                  placeholder="Item notes (optional)"
                  value={item.instructions}
                  onChangeText={(text) => cart.updateInstructions(item.key, text)}
                />
              </View>
              <View style={styles.qtyCol}>
                <View style={styles.qtyStepper}>
                  <TouchableOpacity
                    style={styles.qtyButton}
                    onPress={() => cart.updateQuantity(item.key, item.quantity - 1)}
                  >
                    <Text style={styles.qtyButtonText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.qtyValue}>{item.quantity}</Text>
                  <TouchableOpacity
                    style={styles.qtyButton}
                    onPress={() => cart.updateQuantity(item.key, item.quantity + 1)}
                  >
                    <Text style={styles.qtyButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={() => cart.removeItem(item.key)}>
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {cart.items.length > 0 && (
          <>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Estimated subtotal</Text>
              <Text style={styles.totalValue}>{formatMoney(cart.subtotal)}</Text>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Your name</Text>
              <TextInput style={styles.input} value={customerName} onChangeText={setCustomerName} />
              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput style={styles.input} value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" />
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput style={styles.input} value={customerEmail} onChangeText={setCustomerEmail} keyboardType="email-address" autoCapitalize="none" />
              <Text style={styles.fieldLabel}>Pickup time request</Text>
              <TextInput style={styles.input} value={pickupTime} onChangeText={setPickupTime} placeholder="ASAP or 6:30 PM" />
              <Text style={styles.fieldLabel}>Order notes</Text>
              <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline />
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            {order && (
              <View style={styles.statusBox}>
                <Text style={styles.statusText}>
                  Order {order.status === 'draft' ? 'draft ready' : order.status}: {order.restaurant_name} ·{' '}
                  {formatMoney(Number(order.subtotal || 0), order.currency)}
                  {order.payment_status ? ` · payment ${order.payment_status}` : ''}
                </Text>
                {onViewOrders && ['submitted', 'accepted', 'ready_for_pickup', 'completed'].includes(order.status) && (
                  <TouchableOpacity onPress={onViewOrders}>
                    <Text style={styles.viewOrdersLink}>View in Orders →</Text>
                  </TouchableOpacity>
                )}
              </View>
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
            <Text style={styles.footNote}>Carryout only. Payment is collected before the restaurant receives the order.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '700', color: '#14181f' },
  subtitle: { fontSize: 13, color: '#5b6472', marginTop: 4, marginBottom: 16 },
  empty: { color: '#5b6472', fontSize: 14, textAlign: 'center', marginTop: 40 },
  itemRow: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#e2e5ea', alignItems: 'flex-start', gap: 10,
  },
  itemName: { fontSize: 15, fontWeight: '700', color: '#14181f' },
  itemPrice: { fontSize: 13, color: '#5b6472', marginTop: 2 },
  notesInput: {
    marginTop: 8, borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 8, paddingHorizontal: 10,
    paddingVertical: 6, fontSize: 13,
  },
  qtyCol: { alignItems: 'flex-end', gap: 8 },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  qtyButton: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#eef1f0', alignItems: 'center', justifyContent: 'center',
  },
  qtyButtonText: { fontSize: 16, fontWeight: '700', color: BRAND },
  qtyValue: { minWidth: 24, textAlign: 'center', fontSize: 14, fontWeight: '700', color: '#14181f' },
  removeText: { fontSize: 12, color: '#c0392b', fontWeight: '600' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: '#e2e5ea', paddingVertical: 10, marginVertical: 12,
  },
  totalLabel: { fontSize: 14, color: '#5b6472' },
  totalValue: { fontSize: 16, fontWeight: '700', color: '#14181f' },
  formSection: { marginBottom: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#5b6472', marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, backgroundColor: '#fff',
  },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  errorText: {
    color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, fontSize: 13, marginTop: 12,
  },
  statusBox: { backgroundColor: '#eef4ff', borderRadius: 10, padding: 12, marginTop: 14 },
  statusText: { fontSize: 13, color: '#1b2430', fontWeight: '600' },
  viewOrdersLink: { fontSize: 13, color: BRAND, fontWeight: '700', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryButton: {
    flex: 1, borderWidth: 1, borderColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  secondaryButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  primaryButton: { flex: 1, backgroundColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  buttonDisabled: { opacity: 0.4 },
  footNote: { fontSize: 11, color: '#8a93a3', marginTop: 10, textAlign: 'center' },
});
