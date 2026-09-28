import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AxiosInstance } from 'axios';
import { useLanguage } from './LanguageContext';
import { GuestProvider, extractApiErrorMessage, listGuestProviders } from './frontdeskApi';
import type { GuestSession } from './useFrontdeskGuestSession';

export interface ProvidersScreenProps {
  client: AxiosInstance;
  practiceId: string;
  brandColor: string;
  ensureSession: () => Promise<GuestSession>;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatWorkingHours(hours: GuestProvider['working_hours']): string[] {
  return [...hours]
    .sort((a, b) => a.weekday - b.weekday)
    .map((wh) => `${WEEKDAY_LABELS[wh.weekday] || `Day ${wh.weekday}`} ${wh.start}–${wh.end}`);
}

/**
 * Full provider directory for the currently-selected practice -- name,
 * role, bio, and working hours -- reusing the exact same guest-scoped
 * /api/scheduling/guest/providers endpoint and GuestProvider dataset the
 * Book tab's provider picker already calls (see frontdeskApi.ts /
 * BookingWizard.tsx). A separate tab so a customer can browse who's
 * available at a practice without stepping into the booking flow.
 */
export function ProvidersScreen({ client, practiceId, brandColor, ensureSession }: ProvidersScreenProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<GuestProvider[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await ensureSession();
      const data = await listGuestProviders(client, session.access_token, practiceId);
      setProviders([...data].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setError(extractApiErrorMessage(err, t('errorGeneric')));
    } finally {
      setLoading(false);
    }
  }, [client, ensureSession, practiceId, t]);

  useEffect(() => {
    load();
  }, [load]);

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
      {!error && providers.length === 0 ? (
        <Text style={styles.emptyText}>{t('providersEmpty')}</Text>
      ) : (
        providers.map((p) => {
          const hours = formatWorkingHours(p.working_hours);
          return (
            <View key={p.id} style={styles.card}>
              <Text style={styles.cardTitle}>{p.name}</Text>
              {p.role ? <Text style={styles.cardSubtitle}>{p.role}</Text> : null}
              {p.bio ? <Text style={styles.cardBio}>{p.bio}</Text> : null}
              {hours.length > 0 ? (
                <View style={styles.hoursBlock}>
                  <Text style={styles.hoursLabel}>{t('providerHours')}</Text>
                  {hours.map((line) => (
                    <Text key={line} style={styles.hoursLine}>{line}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })
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
  cardSubtitle: { fontSize: 13, color: '#5b6472', marginBottom: 6 },
  cardBio: { fontSize: 13, color: '#333a44', marginBottom: 8, lineHeight: 18 },
  hoursBlock: { marginTop: 4 },
  hoursLabel: { fontSize: 12, fontWeight: '700', color: '#5b6472', marginBottom: 4 },
  hoursLine: { fontSize: 13, color: '#333a44', marginBottom: 1 },
});
