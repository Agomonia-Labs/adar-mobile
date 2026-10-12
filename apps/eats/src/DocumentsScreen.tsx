import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@adar/shared-auth';
import { useWorkspace } from './WorkspaceContext';
import {
  EatsDocument,
  fetchTranscriptText,
  getDocumentViewUrl,
  listRestaurantDocuments,
} from './eatsApi';

const BRAND = '#1b2430';

function statusLabel(status: string): string {
  switch (status) {
    case 'chunking':
      return 'Transcribing…';
    case 'pending_approval':
      return 'Ready to review';
    case 'embedded':
      return 'Approved · searchable';
    case 'error':
      return 'Failed';
    default:
      return status;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Documents tab: every document in the restaurant workspace -- same
 *  query adar-web's own Documents tab uses (list_workspace_documents,
 *  `workspace_id=X AND status!='deleted'`, no domain filter), so mobile
 *  and web always show the identical document set for the same
 *  workspace; restaurant_name is an extra label the backend adds per
 *  row, not a filter. Read-only: no upload here, recordings only come
 *  from the Owner tab's "Record new menu" flow. */
export function DocumentsScreen() {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const { workspaceId, error: workspaceError } = useWorkspace();
  const [docs, setDocs] = useState<EatsDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<EatsDocument | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    try {
      const list = await listRestaurantDocuments(client, accessToken, workspaceId);
      setDocs(list);
    } catch (err) {
      setError('Could not load documents. Pull down to try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while anything is still transcribing, same pattern DocIntel's
  // DocumentsScreen uses, so a just-submitted recording's status pill
  // moves from "Transcribing…" to "Ready to review" on its own.
  useEffect(() => {
    const stillWorking = docs.some((d) => !['embedded', 'error'].includes(d.status));
    if (!stillWorking) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [docs, refresh]);

  if (openDoc) {
    return <TranscriptViewerScreen doc={openDoc} onBack={() => setOpenDoc(null)} />;
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <View style={styles.listHeader}>
        <Text style={styles.listHeaderTitle}>Documents</Text>
        <Text style={styles.listHeaderHint}>
          Every menu recording you've submitted, with its saved transcript.
        </Text>
      </View>

      {!workspaceId && workspaceError && <Text style={styles.errorText}>{workspaceError}</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading && docs.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : (
        <FlatList
          style={styles.list}
          data={docs}
          keyExtractor={(item) => item.id}
          onRefresh={refresh}
          refreshing={loading}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => setOpenDoc(item)}>
              <Text style={styles.cardTitle}>{item.original_name}</Text>
              {item.restaurant_name ? (
                <Text style={styles.cardRestaurant}>{item.restaurant_name}</Text>
              ) : null}
              <View style={styles.cardRow}>
                <Text style={[styles.statusPill, item.status === 'error' && styles.statusPillError]}>
                  {statusLabel(item.status)}
                </Text>
                <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
              </View>
              {item.status === 'error' && item.error_message ? (
                <Text style={styles.cardError}>{item.error_message}</Text>
              ) : null}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.emptyText}>
                No menu recordings yet. Record one from the Owner tab to see its transcript here.
              </Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function TranscriptViewerScreen({ doc, onBack }: { doc: EatsDocument; onBack: () => void }) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { url } = await getDocumentViewUrl(client, accessToken, doc.id);
        const content = await fetchTranscriptText(url);
        if (!cancelled) setText(content);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load this transcript.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, accessToken, doc.id]);

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.headerBack}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {doc.original_name}
        </Text>
        <View style={{ width: 50 }} />
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.transcriptBody}>
          <Text style={styles.transcriptText}>{text}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: BRAND,
  },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, textAlign: 'center' },
  headerBack: { color: '#c9d2dc', fontSize: 13, fontWeight: '600', width: 50 },
  listHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  listHeaderTitle: { fontSize: 20, fontWeight: '700', color: '#14181f' },
  listHeaderHint: { fontSize: 13, color: '#5b6472', marginTop: 4 },
  list: { flex: 1, marginTop: 8, paddingHorizontal: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#14181f' },
  cardRestaurant: { fontSize: 12.5, color: '#5b6472', marginTop: 2, fontWeight: '600' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  statusPill: {
    fontSize: 11,
    fontWeight: '700',
    color: BRAND,
    backgroundColor: '#eef1f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    overflow: 'hidden',
  },
  statusPillError: { color: '#c0392b', backgroundColor: '#fdecea' },
  cardDate: { fontSize: 12, color: '#9aa3af' },
  cardError: { fontSize: 12, color: '#c0392b', marginTop: 6 },
  emptyText: { textAlign: 'center', color: '#5b6472', marginTop: 40, paddingHorizontal: 20, fontSize: 14 },
  errorText: {
    marginHorizontal: 16,
    marginTop: 10,
    color: '#c0392b',
    backgroundColor: '#fdecea',
    padding: 10,
    borderRadius: 10,
    fontSize: 13,
  },
  transcriptBody: { padding: 20 },
  transcriptText: { fontSize: 14, color: '#14181f', lineHeight: 21 },
});
