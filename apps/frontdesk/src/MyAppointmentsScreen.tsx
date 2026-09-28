import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AxiosInstance } from 'axios';
import { useLanguage } from './LanguageContext';
import { GuestBooking, cancelGuestBooking, extractApiErrorMessage, listGuestBookings } from './frontdeskApi';

export interface MyAppointmentsScreenProps {
  client: AxiosInstance;
  practiceId: string;
  brandColor: string;
  /** The signed-in account's access token -- listing/cancelling a
   *  customer's own appointments now requires a real, signed-in account
   *  (see get_scheduling_customer in scheduling_guest.py), not the
   *  anonymous guest token used for browsing. */
  accessToken: string;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}

/**
 * Lists the guest session's own upcoming appointments for the selected
 * demo practice (GET /api/scheduling/guest/bookings already scopes results
 * to this guest_id or seeded demo rows -- see api/routes/scheduling_guest.py)
 * and lets the customer cancel one. Guest bookings are demo-only and
 * self-expire after 24h server-side (see ConsentScreen's product-preview
 * notice) -- results are scoped to the signed-in account's own bookings.
 */
export function MyAppointmentsScreen({ client, practiceId, brandColor, accessToken }: MyAppointmentsScreenProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<GuestBooking[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      const end = new Date();
      end.setDate(end.getDate() + 90);
      const data = await listGuestBookings(client, accessToken, practiceId, start.toISOString(), end.toISOString());
      setBookings(data.filter((b) => b.status === 'confirmed').sort((a, b) => a.start_time.localeCompare(b.start_time)));
    } catch (err) {
      setError(extractApiErrorMessage(err, t('errorGeneric')));
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, practiceId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = useCallback(
    (booking: GuestBooking) => {
      Alert.alert(t('cancelAppointment'), t('cancelConfirm'), [
        { text: t('back'), style: 'cancel' },
        {
          text: t('cancelAppointment'),
          style: 'destructive',
          onPress: async () => {
            setCancellingId(booking.id);
            try {
              await cancelGuestBooking(client, accessToken, booking.id);
              setBookings((prev) => prev.filter((b) => b.id !== booking.id));
            } catch (err) {
              setError(extractApiErrorMessage(err, t('errorGeneric')));
            } finally {
              setCancellingId(null);
            }
          },
        },
      ]);
    },
    [client, accessToken, t]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={brandColor} />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {bookings.length === 0 ? (
        <Text style={styles.emptyText}>{t('myAppointmentsEmpty')}</Text>
      ) : (
        bookings.map((b) => (
          <View key={b.id} style={styles.card}>
            <Text style={styles.cardTitle}>{b.appointment_type_name}</Text>
            <Text style={styles.cardSubtitle}>{b.provider_name}</Text>
            <Text style={styles.cardSubtitle}>{formatWhen(b.start_time)}</Text>
            <TouchableOpacity
              style={styles.cancelButton}
              disabled={cancellingId === b.id}
              onPress={() => cancel(b)}
            >
              <Text style={styles.cancelText}>
                {cancellingId === b.id ? t('confirming') : t('cancelAppointment')}
              </Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 8, color: '#5b6472' },
  content: { padding: 16 },
  errorText: { color: '#b3261e', fontSize: 13, marginBottom: 12 },
  emptyText: { color: '#9aa2ad', fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: '#f7f8fa', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#14181f', marginBottom: 2 },
  cardSubtitle: { fontSize: 13, color: '#5b6472', marginBottom: 2 },
  cancelButton: { marginTop: 10, alignSelf: 'flex-start' },
  cancelText: { color: '#b3261e', fontWeight: '600', fontSize: 13 },
});
