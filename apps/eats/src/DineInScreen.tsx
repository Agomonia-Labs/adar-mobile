import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@adar/shared-auth';
import {
  EatsDineInAvailability,
  EatsDineInReservation,
  EatsRestaurant,
  checkDineInAvailability,
  confirmDineIn,
  getDineInConfig,
  listMarketplaceRestaurants,
} from './eatsApi';
import { DineInAssistantScreen } from './DineInAssistantScreen';
import { MyDineInReservationsScreen } from './MyDineInReservationsScreen';
import { useEatsLocation } from './LocationContext';

const BRAND = '#1b2430';
const MAX_ADVANCE_DAYS = 7; // mirrors backend's DINE_IN_MAX_ADVANCE_DAYS -- a
// date picker that quietly agrees with the server's own cap, rather than
// letting the customer pick a day the confirm call will just reject.

/** "Today" as a YYYY-MM-DD string IN THE RESTAURANT'S OWN TIME ZONE, not the
 *  customer device's -- a customer browsing late at night from a different
 *  part of the world could otherwise land on the wrong calendar day (the
 *  device's "today" and the restaurant's "today" can differ near midnight
 *  across a large time-zone gap). `en-CA` is just a convenient locale that
 *  formats as YYYY-MM-DD. */
function todayInZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function dayLabel(offsetDays: number, tz: string): { key: string; short: string; dateIso: string } {
  // Pure calendar-day arithmetic on the Y-M-D string above -- the Date
  // object below is only ever used to add/read whole days, never read back
  // as a moment in time, so the device's own time zone can't skew it.
  const base = new Date(`${todayInZone(tz)}T00:00:00`);
  base.setDate(base.getDate() + offsetDays);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  const dateIso = `${y}-${m}-${d}`;
  const short =
    offsetDays === 0
      ? 'Today'
      : offsetDays === 1
      ? 'Tomorrow'
      : base.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return { key: dateIso, short, dateIso };
}

/** Formats a slot's ISO timestamp in the RESTAURANT'S time zone (as set on
 *  Manage Dine-In), so "7:00 PM" means 7pm at the restaurant for every
 *  customer, regardless of what time zone their own phone is in -- the way
 *  the owner entered their hours is the way customers should see them. */
function formatSlotTime(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  } catch {
    return iso;
  }
}

/** Dine-in tab: pick a restaurant that has reservations turned on, then
 *  party size + a day within the next 7 days + an open time slot, and
 *  confirm. Booking engine is adar-core's scheduling domain (reused from
 *  ADAR Front Desk) -- see backend's services/scheduling_client.py; this
 *  screen only ever talks to our own /api/restaurant/.../dine-in/* routes,
 *  never adar-core directly. "Use the assistant instead" hands off to the
 *  same chat the Front Desk app uses, scoped to this restaurant. */
export function DineInScreen(_props: { onUseAssistant?: (restaurant: EatsRestaurant) => void } = {}) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const { location, radiusMiles } = useEatsLocation();

  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  const [restaurants, setRestaurants] = useState<EatsRestaurant[]>([]);
  const [selected, setSelected] = useState<EatsRestaurant | null>(null);
  const [assistantRestaurant, setAssistantRestaurant] = useState<EatsRestaurant | null>(null);
  const [myReservationsRestaurant, setMyReservationsRestaurant] = useState<EatsRestaurant | null>(null);

  const [partySize, setPartySize] = useState(2);
  const [dayOffset, setDayOffset] = useState(0);
  const [availability, setAvailability] = useState<EatsDineInAvailability | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  // The restaurant's own time zone (set by the owner on Manage Dine-In),
  // fetched as soon as a restaurant is picked so the day picker's "today"
  // and every slot time below are computed in THAT zone, not the
  // customer's device zone. Defaults to the device's zone only as a
  // placeholder for the brief moment before /dine-in/config responds.
  const [restaurantTimezone, setRestaurantTimezone] = useState<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  // Tracks WHICH TIER's slot was tapped, not just the time -- the same
  // time string can be an open slot in more than one tier (e.g. both a
  // 2-top and a 4-top are free at 7pm), so comparing by iso alone made
  // every tier's matching chip light up together instead of just the one
  // the customer actually tapped.
  const [selectedSlot, setSelectedSlot] = useState<{ seats: number; iso: string } | null>(null);

  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [callerEmail, setCallerEmail] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EatsDineInReservation | null>(null);

  const days = useMemo(
    () => Array.from({ length: MAX_ADVANCE_DAYS }, (_, i) => dayLabel(i, restaurantTimezone)),
    [restaurantTimezone]
  );

  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      setLoadingRestaurants(true);
      try {
        // Same location scoping as the Discover tab, so "near me" means the
        // same set of restaurants in both places -- see LocationContext.tsx.
        const all = await listMarketplaceRestaurants(client, accessToken, {
          lat: location?.latitude,
          lng: location?.longitude,
          city: location?.city,
          state: location?.state,
          radiusMiles,
        });
        setRestaurants(all.restaurants.filter((r) => r.dine_in_enabled));
      } catch {
        setRestaurants([]);
      } finally {
        setLoadingRestaurants(false);
      }
    })();
  }, [client, accessToken, location, radiusMiles]);

  useEffect(() => {
    if (!selected || !accessToken) return;
    setDayOffset(0);
    (async () => {
      try {
        const config = await getDineInConfig(client, accessToken, selected.id);
        if (config.timezone) {
          setRestaurantTimezone(config.timezone);
        }
      } catch {
        // Availability itself also returns a timezone (see loadAvailability)
        // -- this is just to get the day picker right from the very first
        // render, so a failure here isn't fatal.
      }
    })();
  }, [selected, accessToken, client]);

  const loadAvailability = useCallback(async () => {
    if (!selected || !accessToken) return;
    setLoadingAvailability(true);
    setSelectedSlot(null);
    setError(null);
    try {
      const data = await checkDineInAvailability(client, accessToken, selected.id, days[dayOffset].dateIso, partySize);
      setAvailability(data);
      if (data.timezone) {
        setRestaurantTimezone(data.timezone);
      }
    } catch (err: any) {
      setAvailability(null);
      setError(err?.response?.data?.detail || 'Could not load availability for that day.');
    } finally {
      setLoadingAvailability(false);
    }
  }, [selected, accessToken, client, dayOffset, partySize, days]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  async function handleConfirm() {
    if (!selected || !selectedSlot) return;
    if (!callerName.trim()) {
      setError('Your name is required.');
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      const res = await confirmDineIn(client, accessToken, selected.id, {
        seats: selectedSlot.seats,
        partySize,
        startTime: selectedSlot.iso,
        callerName: callerName.trim(),
        callerPhone: callerPhone.trim(),
        callerEmail: callerEmail.trim(),
      });
      setResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'That time just got booked — pick another and try again.');
      loadAvailability();
    } finally {
      setConfirming(false);
    }
  }

  function reset() {
    setSelected(null);
    setAvailability(null);
    setSelectedSlot(null);
    setResult(null);
    setError(null);
    setCallerName('');
    setCallerPhone('');
    setCallerEmail('');
    setDayOffset(0);
    setPartySize(2);
  }

  // ── My reservations ─────────────────────────────────────────────────────────
  if (myReservationsRestaurant) {
    return (
      <MyDineInReservationsScreen
        client={client}
        accessToken={accessToken}
        restaurantId={myReservationsRestaurant.id}
        restaurantName={myReservationsRestaurant.name}
        onBack={() => setMyReservationsRestaurant(null)}
      />
    );
  }

  // ── Use the assistant instead ───────────────────────────────────────────────
  if (assistantRestaurant) {
    return <DineInAssistantScreen restaurant={assistantRestaurant} onBack={() => setAssistantRestaurant(null)} />;
  }

  // ── Confirmed ──────────────────────────────────────────────────────────────
  if (result) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.confirmedBox}>
          <Text style={styles.confirmedTitle}>Table reserved!</Text>
          <Text style={styles.confirmedLine}>{selected?.name}</Text>
          <Text style={styles.confirmedLine}>{result.table.name} — party of {partySize}</Text>
          <Text style={styles.confirmedLine}>
            {new Date(result.reservation.start_time).toLocaleString(undefined, {
              weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              timeZone: availability?.timezone || restaurantTimezone,
            })}
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={reset}>
            <Text style={styles.primaryButtonText}>Book another table</Text>
          </TouchableOpacity>
          {selected && (
            <TouchableOpacity onPress={() => setMyReservationsRestaurant(selected)}>
              <Text style={styles.assistantLinkText}>View my reservations →</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── Pick a restaurant ───────────────────────────────────────────────────────
  if (!selected) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.header}>Dine-In</Text>
        <Text style={styles.subheader}>Reserve a table up to {MAX_ADVANCE_DAYS} days ahead.</Text>
        {loadingRestaurants ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={BRAND} />
        ) : restaurants.length === 0 ? (
          <Text style={styles.emptyText}>No restaurants currently take dine-in reservations.</Text>
        ) : (
          <FlatList
            data={restaurants}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.restaurantCard} onPress={() => setSelected(item)}>
                <Text style={styles.restaurantName}>{item.name}</Text>
                <Text style={styles.restaurantMeta}>{item.cuisine_type || 'Restaurant'}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── Book a table ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={reset}>
          <Text style={styles.backLink}>← Choose a different restaurant</Text>
        </TouchableOpacity>
        <Text style={styles.header}>{selected.name}</Text>

        <View style={styles.linkRow}>
          <TouchableOpacity style={styles.assistantLink} onPress={() => setAssistantRestaurant(selected)}>
            <Text style={styles.assistantLinkText}>Use the assistant instead →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.assistantLink} onPress={() => setMyReservationsRestaurant(selected)}>
            <Text style={styles.assistantLinkText}>My reservations →</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Party size</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.stepperButton} onPress={() => setPartySize((n) => Math.max(1, n - 1))}>
            <Text style={styles.stepperButtonText}>-</Text>
          </TouchableOpacity>
          <Text style={styles.stepperValue}>{partySize}</Text>
          <TouchableOpacity style={styles.stepperButton} onPress={() => setPartySize((n) => Math.min(20, n + 1))}>
            <Text style={styles.stepperButtonText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Day</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map((d, i) => (
            <TouchableOpacity
              key={d.key}
              style={[styles.dayChip, dayOffset === i && styles.dayChipActive]}
              onPress={() => setDayOffset(i)}
            >
              <Text style={[styles.dayChipText, dayOffset === i && styles.dayChipTextActive]}>{d.short}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.label}>Available times</Text>
        {loadingAvailability ? (
          <ActivityIndicator color={BRAND} />
        ) : !availability || availability.tiers.length === 0 ? (
          <Text style={styles.emptyText}>No tables for {partySize} on {days[dayOffset].short.toLowerCase()}. Try another day or party size.</Text>
        ) : (
          availability.tiers.map((tier) => (
            <View key={tier.seats} style={styles.tierBlock}>
              <Text style={styles.tierLabel}>
                Tables for {tier.seats} ({tier.tables_available} available)
              </Text>
              <View style={styles.slotRow}>
                {(tier.slots || []).map((slot) => {
                  const isActive = selectedSlot?.seats === tier.seats && selectedSlot?.iso === slot;
                  return (
                    <TouchableOpacity
                      key={slot}
                      style={[styles.slotChip, isActive && styles.slotChipActive]}
                      onPress={() => setSelectedSlot({ seats: tier.seats, iso: slot })}
                    >
                      <Text style={[styles.slotChipText, isActive && styles.slotChipTextActive]}>
                        {formatSlotTime(slot, availability?.timezone || restaurantTimezone)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))
        )}

        {selectedSlot && (
          <View style={styles.formBlock}>
            <Text style={styles.label}>Your name</Text>
            <TextInput style={styles.input} value={callerName} onChangeText={setCallerName} placeholder="Name" />
            <Text style={styles.label}>Phone</Text>
            <TextInput style={styles.input} value={callerPhone} onChangeText={setCallerPhone} placeholder="Phone (optional)" keyboardType="phone-pad" />
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} value={callerEmail} onChangeText={setCallerEmail} placeholder="Email (optional)" keyboardType="email-address" autoCapitalize="none" />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <TouchableOpacity style={styles.primaryButton} onPress={handleConfirm} disabled={confirming}>
              {confirming ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Reserve table</Text>}
            </TouchableOpacity>
          </View>
        )}
        {!selectedSlot && error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { fontSize: 20, fontWeight: '800', color: BRAND, paddingHorizontal: 16, paddingTop: 12 },
  subheader: { fontSize: 13, color: '#5b6472', paddingHorizontal: 16, paddingTop: 4 },
  emptyText: { fontSize: 13, color: '#5b6472', padding: 16 },
  backLink: { fontSize: 13, color: BRAND, fontWeight: '600' },
  restaurantCard: { padding: 14, borderRadius: 10, backgroundColor: '#f4f6f5', gap: 2 },
  restaurantName: { fontSize: 15, fontWeight: '700', color: BRAND },
  restaurantMeta: { fontSize: 12, color: '#5b6472' },
  linkRow: { flexDirection: 'row', gap: 16 },
  assistantLink: { alignSelf: 'flex-start' },
  assistantLinkText: { fontSize: 13, color: '#1b6bd4', fontWeight: '600' },
  label: { fontSize: 12, fontWeight: '700', color: '#5b6472', textTransform: 'uppercase', letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepperButton: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#eef1f0', alignItems: 'center', justifyContent: 'center' },
  stepperButtonText: { fontSize: 18, fontWeight: '800', color: BRAND },
  stepperValue: { fontSize: 16, fontWeight: '700', color: BRAND, minWidth: 24, textAlign: 'center' },
  dayChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#eef1f0' },
  dayChipActive: { backgroundColor: BRAND },
  dayChipText: { fontSize: 12, fontWeight: '700', color: '#5b6472' },
  dayChipTextActive: { color: '#fff' },
  tierBlock: { gap: 8 },
  tierLabel: { fontSize: 13, fontWeight: '700', color: BRAND },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#eef1f0' },
  slotChipActive: { backgroundColor: BRAND },
  slotChipText: { fontSize: 12, fontWeight: '700', color: '#5b6472' },
  slotChipTextActive: { color: '#fff' },
  formBlock: { gap: 8, paddingTop: 8 },
  input: { borderWidth: 1, borderColor: '#dde2e0', borderRadius: 8, padding: 10, fontSize: 14 },
  errorText: { fontSize: 12, color: '#c0392b', fontWeight: '600' },
  primaryButton: { backgroundColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  confirmedBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 24 },
  confirmedTitle: { fontSize: 20, fontWeight: '800', color: BRAND },
  confirmedLine: { fontSize: 14, color: '#5b6472' },
});
