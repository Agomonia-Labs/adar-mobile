import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosInstance } from 'axios';
import {
  EatsDineInAvailability,
  EatsMyDineInReservation,
  cancelDineInReservation,
  checkDineInAvailability,
  listMyDineInReservations,
  rescheduleDineInReservation,
} from './eatsApi';

const BRAND = '#1b2430';
const MAX_ADVANCE_DAYS = 7; // mirrors backend's DINE_IN_MAX_ADVANCE_DAYS -- see DineInScreen.tsx's own copy of this constant.

/** FastAPI's own validation errors (HTTP 422) put `detail` as a LIST of
 *  {loc, msg, type} objects, not a string -- same helper as
 *  DineInBookingsScreen.tsx, duplicated here rather than shared since
 *  neither file exports it. */
function formatErrorDetail(detail: unknown): string {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as any).msg) : String(d)))
      .join('; ');
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

// Day-picker helpers for the reschedule flow -- same approach as
// DineInScreen.tsx (restaurant's own time zone, not the device's), kept
// local to this file since those helpers aren't exported from there.
function todayInZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function dayLabel(offsetDays: number, tz: string): { key: string; short: string; dateIso: string } {
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

function formatSlotTime(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  } catch {
    return iso;
  }
}

/** Reschedule sub-view: pick a new day + open slot for an existing
 *  reservation, keeping the same party size. Books the new slot and only
 *  then releases the old one (see the backend's reschedule_dine_in_booking
 *  docstring) -- from the customer's side that just means a slot that's no
 *  longer available simply doesn't get picked; their existing reservation
 *  is never at risk while this screen is open. */
function RescheduleDineInView({
  client,
  accessToken,
  restaurantId,
  restaurantName,
  reservation,
  onDone,
  onCancel,
}: {
  client: AxiosInstance;
  accessToken: string;
  restaurantId: string;
  restaurantName: string;
  reservation: EatsMyDineInReservation;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [dayOffset, setDayOffset] = useState(0);
  const [availability, setAvailability] = useState<EatsDineInAvailability | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ seats: number; iso: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: MAX_ADVANCE_DAYS }, (_, i) => dayLabel(i, timezone)), [timezone]);

  const loadAvailability = useCallback(async () => {
    setLoadingAvailability(true);
    setSelectedSlot(null);
    setError(null);
    try {
      const data = await checkDineInAvailability(client, accessToken, restaurantId, days[dayOffset].dateIso, reservation.party_size);
      setAvailability(data);
      if (data.timezone) setTimezone(data.timezone);
    } catch (err: any) {
      setAvailability(null);
      setError(formatErrorDetail(err?.response?.data?.detail) || 'Could not load availability for that day.');
    } finally {
      setLoadingAvailability(false);
    }
  }, [client, accessToken, restaurantId, dayOffset, reservation.party_size, days]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  async function handleConfirm() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      await rescheduleDineInReservation(client, accessToken, restaurantId, reservation.booking_id, {
        startTime: selectedSlot.iso,
        seats: selectedSlot.seats,
      });
      onDone();
    } catch (err: any) {
      setError(formatErrorDetail(err?.response?.data?.detail) || 'That time just got booked — pick another and try again.');
      loadAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Reschedule — {restaurantName}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Currently</Text>
        <Text style={styles.cardDetail}>
          {reservation.start_time_formatted} — {reservation.table_name}, party of {reservation.party_size}
        </Text>

        <Text style={styles.label}>New day</Text>
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

        <Text style={styles.label}>New time</Text>
        {loadingAvailability ? (
          <ActivityIndicator color={BRAND} />
        ) : !availability || availability.tiers.length === 0 ? (
          <Text style={styles.emptyText}>
            No tables for {reservation.party_size} on {days[dayOffset].short.toLowerCase()}. Try another day.
          </Text>
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
                        {formatSlotTime(slot, availability?.timezone || timezone)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
        <TouchableOpacity style={styles.primaryButton} disabled={!selectedSlot || submitting} onPress={handleConfirm}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Confirm new time</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Customer-facing "My Reservations" for a single restaurant -- lists
 *  confirmed/cancelled dine-in reservations the signed-in customer made
 *  there, with Cancel and Reschedule actions driven by the backend's own
 *  can_cancel/can_reschedule flags (GET .../dine-in/my-reservations).
 *  Opened from DineInScreen.tsx once a restaurant is selected, the same
 *  screen-swap pattern used for "Use the assistant instead". */
export function MyDineInReservationsScreen({
  client,
  accessToken,
  restaurantId,
  restaurantName,
  onBack,
}: {
  client: AxiosInstance;
  accessToken: string;
  restaurantId: string;
  restaurantName: string;
  onBack: () => void;
}) {
  const [reservations, setReservations] = useState<EatsMyDineInReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const res = await listMyDineInReservations(client, accessToken, restaurantId);
        setReservations(res.reservations);
      } catch (err: any) {
        const status = err?.response?.status;
        const detail = formatErrorDetail(err?.response?.data?.detail);
        if (status) {
          setError(`Could not load your reservations (${status}${detail ? `: ${detail}` : ''}). Pull down to try again.`);
        } else {
          setError('Could not load your reservations — check your connection. Pull down to try again.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client, accessToken, restaurantId]
  );

  useEffect(() => {
    load();
  }, [load]);

  function handleCancel(bookingId: string) {
    Alert.alert('Cancel reservation?', 'This cannot be undone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel reservation',
        style: 'destructive',
        onPress: async () => {
          setBusyId(bookingId);
          try {
            await cancelDineInReservation(client, accessToken, restaurantId, bookingId);
            await load();
          } catch (err: any) {
            Alert.alert('Could not cancel', formatErrorDetail(err?.response?.data?.detail) || 'Please try again.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  if (reschedulingId) {
    const target = reservations.find((r) => r.booking_id === reschedulingId);
    if (target) {
      return (
        <RescheduleDineInView
          client={client}
          accessToken={accessToken}
          restaurantId={restaurantId}
          restaurantName={restaurantName}
          reservation={target}
          onDone={() => {
            setReschedulingId(null);
            load();
          }}
          onCancel={() => setReschedulingId(null)}
        />
      );
    }
    setReschedulingId(null);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>My reservations — {restaurantName}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : reservations.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>You don't have any reservations here yet.</Text>
        </View>
      ) : (
        <FlatList
          data={reservations}
          keyExtractor={(r) => r.booking_id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={BRAND} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTime}>{item.start_time_formatted}</Text>
                <View style={[styles.statusPill, item.status === 'cancelled' && styles.statusPillCancelled]}>
                  <Text style={[styles.statusPillText, item.status === 'cancelled' && styles.statusPillTextCancelled]}>
                    {item.status === 'cancelled' ? 'Cancelled' : 'Confirmed'}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardDetail}>
                {item.table_name} — party of {item.party_size}
              </Text>
              {(item.can_cancel || item.can_reschedule) && (
                <View style={styles.actionRow}>
                  {item.can_reschedule && (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      disabled={busyId === item.booking_id}
                      onPress={() => setReschedulingId(item.booking_id)}
                    >
                      <Text style={styles.secondaryButtonText}>Reschedule</Text>
                    </TouchableOpacity>
                  )}
                  {item.can_cancel && (
                    <TouchableOpacity
                      style={styles.dangerButton}
                      disabled={busyId === item.booking_id}
                      onPress={() => handleCancel(item.booking_id)}
                    >
                      {busyId === item.booking_id ? (
                        <ActivityIndicator color="#b3261e" />
                      ) : (
                        <Text style={styles.dangerButtonText}>Cancel</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eef1f0',
  },
  backLink: { fontSize: 13, color: BRAND, fontWeight: '600', width: 40 },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: BRAND, textAlign: 'center', marginHorizontal: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: '#b3261e', fontSize: 13, textAlign: 'center', fontWeight: '600' },
  emptyText: { color: '#6b7280', fontSize: 13, textAlign: 'center' },
  listContent: { padding: 16, gap: 12 },
  card: {
    gap: 6,
    padding: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    backgroundColor: '#fafbfc',
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTime: { fontSize: 14, fontWeight: '700', color: BRAND },
  cardDetail: { fontSize: 13, color: '#5b6472' },
  statusPill: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: '#e3f3ea' },
  statusPillCancelled: { backgroundColor: '#fbe8e6' },
  statusPillText: { fontSize: 11, fontWeight: '700', color: '#1f7a46' },
  statusPillTextCancelled: { color: '#b3261e' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  secondaryButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#eef1f0' },
  secondaryButtonText: { fontSize: 12.5, fontWeight: '700', color: BRAND },
  dangerButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#fbe8e6', minWidth: 68, alignItems: 'center' },
  dangerButtonText: { fontSize: 12.5, fontWeight: '700', color: '#b3261e' },
  label: { fontSize: 12, fontWeight: '700', color: '#5b6472', textTransform: 'uppercase', letterSpacing: 0.3 },
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
  primaryButton: { backgroundColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
