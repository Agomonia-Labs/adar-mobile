import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { TelephonyCall, deleteTelephonyCall, extractDocIntelError, listTelephonyCalls } from './docintelApi';
import { SwipeableRow } from './SwipeableRow';
import { useWorkspace } from './WorkspaceContext';

const BRAND = '#2e7d4f';

const STATUS_LABELS: Record<string, string> = {
  awaiting_consent: 'Awaiting consent',
  active: 'Recording…',
  received: 'Processing…',
  in_review: 'Needs review',
  completed: 'Ready',
  error: 'Failed',
};

const IN_PROGRESS = new Set(['awaiting_consent', 'active', 'received']);

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** List of past conversations with the AI assistant, plus a way to start a
 *  new one -- mirrors adar-rag/frontend's ConversationPanel.jsx "Saved
 *  Conversations" sidebar, as its own tab (rather than a sidebar list)
 *  since Video/Documents already use that same "list screen -> detail
 *  screen" pattern on mobile. A finished conversation becomes a document
 *  (its transcript is searchable/chattable like any other document) and,
 *  once the background recording step finishes, a playable recording. */
export function ConversationScreen({ onOpenConversation }: { onOpenConversation: (callId: string | null) => void }) {
  const { client, session } = useAuth();
  const { active } = useWorkspace();
  const [calls, setCalls] = useState<TelephonyCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const rows = await listTelephonyCalls(client, session.accessToken, active?.id);
      setCalls(rows);
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not load conversations.'));
    } finally {
      setLoading(false);
    }
  }, [client, session, active]);

  useEffect(() => { refresh(); }, [refresh]);

  const onDelete = async (callId: string) => {
    if (!session) return;
    setDeletingId(callId);
    try {
      await deleteTelephonyCall(client, session.accessToken, callId);
      setCalls((prev) => prev.filter((c) => c.id !== callId));
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not delete this conversation.'));
    } finally {
      setDeletingId(null);
    }
  };

  // Matches the backend's own gate (routes/telephony.py's delete_call
  // requires at least "editor" for a workspace conversation via
  // _owned_call) -- Personal conversations are always yours to delete; a
  // shared workspace only lets its editors and owner delete, never a
  // plain viewer.
  const canDelete = !active || active.my_role !== 'viewer';

  // Poll while anything is still recording/processing -- same idea as
  // VideoScreen.tsx's own poll, so a conversation moving through
  // "Recording… -> Processing… -> Ready" updates without a manual pull.
  useEffect(() => {
    const pending = calls.some((c) => IN_PROGRESS.has(c.processing_status));
    if (!pending) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [calls, refresh]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.header}>Conversations</Text>
          <Text style={styles.subheader}>{active ? active.name : 'Personal'}</Text>
        </View>
        <TouchableOpacity style={styles.newButton} onPress={() => onOpenConversation(null)}>
          <Text style={styles.newButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading && calls.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} />
      ) : calls.length === 0 ? (
        <Text style={styles.empty}>
          No conversations yet. Tap "+ New" to talk with the AI assistant -- it listens, replies out loud, and
          saves a searchable transcript (and a playable recording) as a document when you're done.
        </Text>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(c) => c.id}
          onRefresh={refresh}
          refreshing={loading}
          renderItem={({ item }) => {
            const card = (
              <TouchableOpacity style={styles.card} onPress={() => onOpenConversation(item.id)} disabled={deletingId === item.id}>
                <Text style={styles.cardTitle}>{formatWhen(item.created_at)}</Text>
                <View style={styles.cardInfoRow}>
                  <Text style={styles.cardInfoText}>{item.language_code}</Text>
                  {item.duration_seconds ? (
                    <Text style={styles.cardInfoText}>{Math.round(item.duration_seconds)}s</Text>
                  ) : null}
                </View>
                <View style={styles.cardFooter}>
                  <Text
                    style={[
                      styles.statusText,
                      item.processing_status === 'completed' && styles.statusReady,
                      item.processing_status === 'error' && styles.statusError,
                      item.processing_status === 'in_review' && styles.statusReview,
                    ]}
                  >
                    {STATUS_LABELS[item.processing_status] || item.processing_status}
                  </Text>
                  {deletingId === item.id || IN_PROGRESS.has(item.processing_status) ? (
                    <ActivityIndicator size="small" color={BRAND} />
                  ) : null}
                </View>
                {item.error_message && item.processing_status === 'error' ? (
                  <Text style={styles.cardErrorText} numberOfLines={2}>{item.error_message}</Text>
                ) : null}
              </TouchableOpacity>
            );
            if (!canDelete) return <View style={{ marginBottom: 10 }}>{card}</View>;
            return (
              <SwipeableRow onDelete={() => onDelete(item.id)} disabled={deletingId === item.id}>
                {card}
              </SwipeableRow>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fa', padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  header: { fontSize: 22, fontWeight: '700', color: '#14181f' },
  subheader: { fontSize: 13, color: '#5b6472', marginTop: 2 },
  newButton: { backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  newButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  empty: { color: '#5b6472', fontSize: 14, textAlign: 'center', marginTop: 40, lineHeight: 20, paddingHorizontal: 10 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e5ea' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#14181f' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  cardInfoRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 10 },
  cardInfoText: { fontSize: 12, color: '#5b6472', textTransform: 'uppercase' },
  cardErrorText: { fontSize: 12, color: '#c0392b', marginTop: 6 },
  statusText: { fontSize: 12, fontWeight: '700', color: '#a06a00' },
  statusReady: { color: '#1e7e34' },
  statusError: { color: '#c0392b' },
  statusReview: { color: '#1d6fa5' },
  errorText: { color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 13, textAlign: 'center' },
});
