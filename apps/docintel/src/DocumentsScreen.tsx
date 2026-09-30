import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@adar/shared-auth';
import {
  DocIntelDocument,
  classifyDocument,
  deleteDocument,
  extractDocIntelError,
  listDocuments,
  triggerEmbed,
  uploadDocuments,
} from './docintelApi';
import { DocumentChunksModal } from './DocumentChunksModal';
import { SwipeableRow } from './SwipeableRow';
import { useWorkspace } from './WorkspaceContext';

const BRAND = '#2e7d4f';

const STATUS_COLORS: Record<string, string> = {
  uploading: '#a06a00',
  chunking: '#a06a00',
  chunked: '#a06a00',
  embedding: '#a06a00',
  embedded: '#1e7e34',
  error: '#c0392b',
};

const STATUS_LABELS: Record<string, string> = {
  uploading: 'Uploading…',
  chunking: 'Processing…',
  chunked: 'Processing…',
  embedding: 'Indexing…',
  embedded: 'Ready',
  error: 'Failed',
};

export function DocumentsScreen({ onOpenChat, onView }: { onOpenChat: (docIds: string[]) => void; onView: (doc: DocIntelDocument) => void }) {
  const { client, session } = useAuth();
  const { active } = useWorkspace();
  const [docs, setDocs] = useState<DocIntelDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [embeddingId, setEmbeddingId] = useState<string | null>(null);
  const [chunksDoc, setChunksDoc] = useState<DocIntelDocument | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const list = await listDocuments(client, session.accessToken, active?.id);
      setDocs(list);
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not load documents.'));
    } finally {
      setLoading(false);
    }
  }, [client, session, active]);

  useEffect(() => {
    setLoading(true);
    setSelected(new Set());
    refresh();
  }, [refresh]);

  // Poll while anything is still processing, so status pills move from
  // "Processing…" to "Ready" without the user pulling to refresh.
  useEffect(() => {
    const stillWorking = docs.some((d) => !['embedded', 'error'].includes(d.status));
    if (!stillWorking) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [docs, refresh]);

  const onPickAndUpload = async () => {
    // Accepts any type -- PDFs, Office docs, images, audio and video all
    // go through this one endpoint; the backend's detect_type() routes
    // each to the right ingestion pipeline server-side.
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    if (result.canceled || !session) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDocuments(
        client,
        session.accessToken,
        result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType })),
        { workspaceId: active?.id }
      );
      await refresh();
    } catch (err) {
      setError(extractDocIntelError(err, 'Upload failed.'));
    } finally {
      setUploading(false);
    }
  };

  const onClassify = async (docId: string) => {
    if (!session) return;
    try {
      const updated = await classifyDocument(client, session.accessToken, docId);
      setDocs((prev) => prev.map((d) => (d.id === docId ? updated : d)));
    } catch (err) {
      setError(extractDocIntelError(err, 'Classification failed.'));
    }
  };

  // Same triggerEmbed() call for both "Embed" (status chunked) and
  // "Re-embed" (status embedded) -- matches desktop's single handleEmbed.
  const onEmbed = async (docId: string) => {
    if (!session) return;
    setEmbeddingId(docId);
    try {
      await triggerEmbed(client, session.accessToken, docId);
      await refresh();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not start embedding.'));
    } finally {
      setEmbeddingId(null);
    }
  };

  const onDelete = async (docId: string) => {
    if (!session) return;
    setDeletingId(docId);
    try {
      await deleteDocument(client, session.accessToken, docId);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
      await refresh();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not delete this document.'));
    } finally {
      setDeletingId(null);
    }
  };

  // Matches the backend's own gate (routes/documents.py's delete_document
  // requires at least "editor" for a workspace doc via _require_role) --
  // Personal docs are always yours to delete; a shared workspace only
  // lets its editors and owner delete, never a plain viewer.
  const canDelete = !active || active.my_role !== 'viewer';

  const toggleSelect = (docId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.header}>Documents</Text>
          <Text style={styles.subheader}>{active ? active.name : 'Personal'}</Text>
        </View>
        <TouchableOpacity style={styles.uploadButton} onPress={onPickAndUpload} disabled={uploading}>
          {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadButtonText}>+ Upload</Text>}
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} />
      ) : docs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No documents yet. Upload a PDF, image, audio or video file to get started.</Text>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(d) => d.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
          renderItem={({ item }) => {
            const card = (
              <>
                <TouchableOpacity
                  style={[styles.docRow, selected.has(item.id) && styles.docRowSelected]}
                  onPress={() => item.status === 'embedded' && toggleSelect(item.id)}
                  disabled={item.status !== 'embedded' || deletingId === item.id}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docName} numberOfLines={1}>{item.original_name}</Text>
                    <View style={styles.metaRow}>
                      <Text style={[styles.statusPill, { color: STATUS_COLORS[item.status] || '#5b6472' }]}>
                        {STATUS_LABELS[item.status] || item.status}
                      </Text>
                      {item.doc_type ? <Text style={styles.metaText}>· {item.doc_type}</Text> : null}
                      {item.chunk_count ? <Text style={styles.metaText}>· {item.chunk_count} chunks</Text> : null}
                    </View>
                    {item.tags.length > 0 ? (
                      <View style={styles.tagRow}>
                        {item.tags.map((t) => (
                          <View key={t.id} style={[styles.tagChip, { backgroundColor: t.color }]}>
                            <Text style={styles.tagChipText}>{t.name}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  {item.status !== 'uploading' && item.status !== 'error' ? (
                    <TouchableOpacity style={styles.viewButton} onPress={() => onView(item)}>
                      <Text style={styles.viewButtonText}>View</Text>
                    </TouchableOpacity>
                  ) : null}
                  {item.status === 'embedded' && !item.doc_type ? (
                    <TouchableOpacity style={styles.classifyButton} onPress={() => onClassify(item.id)}>
                      <Text style={styles.classifyButtonText}>Classify</Text>
                    </TouchableOpacity>
                  ) : null}
                  {deletingId === item.id ? (
                    <ActivityIndicator color={BRAND} style={{ marginLeft: 8 }} />
                  ) : selected.has(item.id) ? (
                    <Text style={styles.checkmark}>✓</Text>
                  ) : null}
                </TouchableOpacity>
                <View style={styles.actionRow}>
                  {['chunked', 'embedding', 'embedded'].includes(item.status) ? (
                    <TouchableOpacity style={styles.actionButton} onPress={() => setChunksDoc(item)}>
                      <Text style={styles.actionButtonText}>📋 Chunks</Text>
                    </TouchableOpacity>
                  ) : null}
                  {item.status === 'chunked' || item.status === 'embedded' ? (
                    <TouchableOpacity
                      style={[styles.actionButton, item.status === 'chunked' && styles.actionButtonPrimary]}
                      onPress={() => onEmbed(item.id)}
                      disabled={embeddingId === item.id}
                    >
                      {embeddingId === item.id ? (
                        <ActivityIndicator size="small" color={item.status === 'chunked' ? '#fff' : BRAND} />
                      ) : (
                        <Text style={[styles.actionButtonText, item.status === 'chunked' && styles.actionButtonTextPrimary]}>
                          {item.status === 'chunked' ? '⚡ Embed' : '↩ Re-embed'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
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

      <DocumentChunksModal
        visible={!!chunksDoc}
        client={client}
        accessToken={session?.accessToken || ''}
        docId={chunksDoc?.id || null}
        docName={chunksDoc?.original_name || ''}
        onClose={() => setChunksDoc(null)}
      />

      {selected.size > 0 ? (
        <TouchableOpacity style={styles.chatFab} onPress={() => onOpenChat(Array.from(selected))}>
          <Text style={styles.chatFabText}>Ask ADAR about {selected.size} document{selected.size === 1 ? '' : 's'} →</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fa', padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  header: { fontSize: 22, fontWeight: '700', color: '#14181f' },
  subheader: { fontSize: 13, color: '#5b6472', marginTop: 2 },
  uploadButton: { backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  uploadButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyText: { color: '#5b6472', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  docRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12,
    borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
    padding: 14, borderWidth: 1, borderColor: '#e2e5ea', borderBottomWidth: 0,
  },
  actionRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ea',
    borderTopWidth: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, paddingHorizontal: 14, paddingBottom: 12,
    paddingTop: 2,
  },
  actionButton: { borderWidth: 1, borderColor: '#d7dbe2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  actionButtonPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  actionButtonText: { fontSize: 12, fontWeight: '600', color: '#5b6472' },
  actionButtonTextPrimary: { color: '#fff' },
  actionButtonDanger: { backgroundColor: '#fdecea', borderColor: '#c0392b' },
  actionButtonDangerText: { fontSize: 12, fontWeight: '600', color: '#c0392b' },
  docRowSelected: { borderColor: BRAND, backgroundColor: '#eaf5ee' },
  docName: { fontSize: 15, fontWeight: '600', color: '#14181f' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  statusPill: { fontSize: 12, fontWeight: '700' },
  metaText: { fontSize: 12, color: '#5b6472', marginLeft: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 6 },
  tagChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  tagChipText: { fontSize: 11, fontWeight: '700', color: '#14181f' },
  viewButton: { borderWidth: 1, borderColor: '#9aa3b2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginRight: 6 },
  viewButtonText: { color: '#5b6472', fontWeight: '700', fontSize: 12 },
  classifyButton: { borderWidth: 1, borderColor: BRAND, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  classifyButtonText: { color: BRAND, fontWeight: '700', fontSize: 12 },
  checkmark: { color: BRAND, fontWeight: '700', fontSize: 18, marginLeft: 8 },
  chatFab: {
    position: 'absolute', left: 16, right: 16, bottom: 16, backgroundColor: BRAND, borderRadius: 14,
    paddingVertical: 15, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  chatFabText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  errorText: {
    color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, marginBottom: 12,
    fontSize: 13, textAlign: 'center',
  },
});
