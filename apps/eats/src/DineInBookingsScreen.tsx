import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosInstance } from 'axios';
import { EatsDineInBookingDay, getOwnerDineInBookings } from './eatsApi';

const BRAND = '#1b2430';
/** FastAPI's own validation errors (HTTP 422) put `detail` as a LIST of
 *  {loc, msg, type} objects, not a string -- template-interpolating that
 *  directly (the bug that shipped here first) renders as "[object Object]"
 *  instead of the actual reason. A plain string detail (the shape every
 *  other error in this app uses) passes through unchanged. */
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

const DAYS_AHEAD = 7; // mirrors backend's DINE_IN_MAX_ADVANCE_DAYS (routes/restaurant.py) --
// a booking can never be made further out than that, so requesting more than
// 7 days ahead here just fails the backend's own query validation (422).

/** Owner-side: confirmed dine-in reservations, grouped by day, for the next
 *  DAYS_AHEAD days. Before this screen existed, a confirmed booking was
 *  visible to the owner for exactly one moment -- the in-app/push
 *  notification fired the instant it was made (see
 *  create_dine_in_reservation in adar-rag's routes/restaurant.py) -- with
 *  nothing to look back at afterward. Opened from DineInManageScreen's
 *  header, same screen-swap pattern DineInScreen.tsx uses for "Use the
 *  assistant instead". */
export function DineInBookingsScreen({
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
  const [days, setDays] = useState<EatsDineInBookingDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const res = await getOwnerDineInBookings(client, accessToken, restaurantId, DAYS_AHEAD);
        setDays(res.days);
      } catch (err: any) {
        // Surface the real reason (network vs. 404/500/etc. with the
        // server's own detail) instead of one generic message for every
        // failure -- a silent catch here is exactly what made the first
        // report of this just say "could not load bookings" with no way
        // to tell what actually went wrong.
        const status = err?.response?.status;
        const detail = formatErrorDetail(err?.response?.data?.detail);
        if (status) {
          setError(`Could not load bookings (${status}${detail ? `: ${detail}` : ''}). Pull down to try again.`);
        } else {
          setError('Could not load bookings -- check your connection. Pull down to try again.');
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

  const totalBookings = days.reduce((sum, d) => sum + d.bookings.length, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Bookings — {restaurantName}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : totalBookings === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No upcoming reservations in the next {DAYS_AHEAD} days.</Text>
        </View>
      ) : (
        <FlatList
          data={days}
          keyExtractor={(d) => d.date}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={BRAND} />}
          renderItem={({ item }) => (
            <View style={styles.dayGroup}>
              <Text style={styles.dayLabel}>{item.label}</Text>
              {item.bookings.map((b) => (
                <View key={b.id} style={styles.bookingRow}>
                  <Text style={styles.bookingTime}>{b.start_label}</Text>
                  <View style={styles.bookingDetails}>
                    <Text style={styles.bookingTable} numberOfLines={1}>
                      {b.table_name}
                      {b.seats ? ` (seats ${b.seats})` : ''}
                    </Text>
                    <Text style={styles.bookingCaller} numberOfLines={1}>
                      {b.caller_name}
                      {b.caller_phone ? ` · ${b.caller_phone}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
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
  errorText: { color: '#b3261e', fontSize: 13, textAlign: 'center' },
  emptyText: { color: '#6b7280', fontSize: 13, textAlign: 'center' },
  listContent: { padding: 16, gap: 18 },
  dayGroup: { gap: 8 },
  dayLabel: { fontSize: 14, fontWeight: '700', color: '#14181f', marginBottom: 2 },
  bookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    backgroundColor: '#fafbfc',
  },
  bookingTime: { fontSize: 13, fontWeight: '700', color: BRAND, width: 72 },
  bookingDetails: { flex: 1 },
  bookingTable: { fontSize: 13.5, fontWeight: '600', color: '#14181f' },
  bookingCaller: { fontSize: 12, color: '#6b7280', marginTop: 2 },
});
