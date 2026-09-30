import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { AxiosInstance } from 'axios';
import { DocumentChunkMeta, extractDocIntelError, getDocumentChunkContent, getDocumentChunks } from './docintelApi';

const BRAND = '#2e7d4f';

/** Mirrors the desktop app's ChunksViewer.jsx: a chunk-index list (index +
 *  word count) on one side, the selected chunk's full text on the other,
 *  with a PII-redaction toggle. Summarize-per-chunk (desktop's
 *  SummaryPanel integration) isn't ported here -- this covers what was
 *  actually asked for: being able to see what's in a document's chunks. */
export function DocumentChunksModal({
  visible,
  client,
  accessToken,
  docId,
  docName,
  onClose,
}: {
  visible: boolean;
  client: AxiosInstance;
  accessToken: string;
  docId: string | null;
  docName: string;
  onClose: () => void;
}) {
  const [chunks, setChunks] = useState<DocumentChunkMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [redactPii, setRedactPii] = useState(false);

  useEffect(() => {
    if (!visible || !docId) return;
    setLoading(true);
    setError(null);
    setChunks([]);
    setActiveIndex(null);
    setContent('');
    getDocumentChunks(client, accessToken, docId)
      .then((d) => setChunks(d.chunks || []))
      .catch((err) => setError(extractDocIntelError(err, 'Could not load chunks.')))
      .finally(() => setLoading(false));
  }, [visible, docId, client, accessToken]);

  const selectChunk = async (index: number) => {
    if (!docId) return;
    setActiveIndex(index);
    setContentLoading(true);
    try {
      const d = await getDocumentChunkContent(client, accessToken, docId, index, redactPii);
      setContent(d.content);
    } catch (err) {
      setContent(`Error: ${extractDocIntelError(err, 'Could not load this chunk.')}`);
    } finally {
      setContentLoading(false);
    }
  };

  // Re-fetch the currently open chunk when the PII toggle changes, same as
  // the desktop viewer's redactPii-dependent re-fetch.
  useEffect(() => {
    if (activeIndex !== null) selectChunk(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redactPii]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{docName}</Text>
            <Text style={styles.subtitle}>{chunks.length} chunk{chunks.length === 1 ? '' : 's'}</Text>
          </View>
          <View style={styles.piiRow}>
            <Text style={styles.piiLabel}>PII</Text>
            <Switch value={redactPii} onValueChange={setRedactPii} trackColor={{ true: BRAND }} />
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <View style={styles.body}>
            <ScrollView style={styles.chunkList} contentContainerStyle={{ padding: 10 }}>
              {chunks.map((c) => (
                <TouchableOpacity
                  key={c.index}
                  style={[styles.chunkButton, activeIndex === c.index && styles.chunkButtonActive]}
                  onPress={() => selectChunk(c.index)}
                >
                  <Text style={[styles.chunkButtonText, activeIndex === c.index && styles.chunkButtonTextActive]}>
                    #{c.index + 1}
                  </Text>
                  <Text style={styles.chunkButtonMeta}>{c.word_count}w</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView style={styles.contentPane} contentContainerStyle={{ padding: 14 }}>
              {activeIndex === null ? (
                <Text style={styles.hint}>← Select a chunk to view</Text>
              ) : contentLoading ? (
                <ActivityIndicator color={BRAND} />
              ) : (
                <>
                  <Text style={styles.chunkHeading}>Chunk #{activeIndex + 1} of {chunks.length}</Text>
                  <Text style={styles.chunkText}>{content}</Text>
                </>
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#e2e5ea',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#14181f' },
  subtitle: { fontSize: 12, color: '#5b6472', marginTop: 2 },
  piiRow: { flexDirection: 'row', alignItems: 'center', marginRight: 14 },
  piiLabel: { fontSize: 12, fontWeight: '600', color: '#5b6472', marginRight: 6 },
  closeButton: { padding: 4 },
  closeButtonText: { fontSize: 18, color: '#5b6472' },
  errorText: { color: '#c0392b', padding: 16, fontSize: 13 },
  body: { flex: 1, flexDirection: 'row' },
  chunkList: { width: 110, borderRightWidth: 1, borderRightColor: '#e2e5ea', backgroundColor: '#f7f8fa' },
  chunkButton: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, marginBottom: 6, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e2e5ea',
  },
  chunkButtonActive: { borderColor: BRAND, backgroundColor: '#eaf5ee' },
  chunkButtonText: { fontSize: 12, fontWeight: '700', color: '#14181f' },
  chunkButtonTextActive: { color: BRAND },
  chunkButtonMeta: { fontSize: 10, color: '#9aa3b2', marginTop: 2 },
  contentPane: { flex: 1 },
  hint: { color: '#9aa3b2', fontSize: 13, marginTop: 20, textAlign: 'center' },
  chunkHeading: { fontSize: 13, fontWeight: '700', color: '#14181f', marginBottom: 10 },
  chunkText: { fontSize: 13, lineHeight: 19, color: '#3b414c' },
});
