import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@adar/shared-auth';
import {
  VideoDocumentSummary,
  completeVideoUpload,
  createVideoUploadSession,
  deleteDocument,
  extractDocIntelError,
  getVideoStatus,
  listVideoDocuments,
  uploadVideoFile,
} from './docintelApi';
import { SwipeableRow } from './SwipeableRow';
import { useWorkspace } from './WorkspaceContext';

const BRAND = '#2e7d4f';

/** Same mm:ss / h:mm:ss formatting as VideoDetailScreen.tsx's formatTime(). */
function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

const STATUS_LABELS: Record<string, string> = {
  uploading: 'Uploading…',
  uploaded: 'Uploaded — tap to process',
  chunking: 'Processing…',
  chunked: 'Processing…',
  embedding: 'Indexing…',
  embedded: 'Ready',
  error: 'Failed',
  processing_stalled: 'Stalled — retry',
};

/** Video-specific ingestion (routes/video.py) -- architecturally separate
 *  from the generic document upload in DocumentsScreen.tsx because video
 *  files upload via a signed-GCS direct-PUT session rather than multipart
 *  through FastAPI. Lists only video documents; tap one to see its
 *  processing status, extracted timeline, and ask a timestamped question. */
export function VideoScreen({ onOpenVideo }: { onOpenVideo: (docId: string, name: string) => void }) {
  const { client, session } = useAuth();
  const { active } = useWorkspace();
  const [videos, setVideos] = useState<VideoDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      // The video-specific list endpoint (not the generic documents list)
      // -- it already carries duration/processing_status/progress per row
      // via a LEFT JOIN to video_documents, same as VideoPanel.jsx's own
      // video list, so each card below can show real info without an N+1
      // getVideoStatus() call per video.
      const docs = await listVideoDocuments(client, session.accessToken, active?.id);
      setVideos(docs);
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not load videos.'));
    } finally {
      setLoading(false);
    }
  }, [client, session, active]);

  useEffect(() => { refresh(); }, [refresh]);

  const onDelete = async (docId: string) => {
    if (!session) return;
    setDeletingId(docId);
    try {
      await deleteDocument(client, session.accessToken, docId);
      await refresh();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not delete this video.'));
    } finally {
      setDeletingId(null);
    }
  };

  const canDelete = !active || active.my_role !== 'viewer';

  // Poll while anything is still processing (not videos merely sitting
  // uploaded-but-unprocessed, waiting on the user to tap Process Video).
  useEffect(() => {
    const pending = videos.some((v) => !['embedded', 'error', 'uploaded'].includes(v.status));
    if (!pending) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [videos, refresh]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.header}>Video</Text>
          <Text style={styles.subheader}>{active ? active.name : 'Personal'}</Text>
        </View>
        <TouchableOpacity style={styles.newButton} onPress={() => setShowUpload(true)}>
          <Text style={styles.newButtonText}>+ Upload</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} />
      ) : videos.length === 0 ? (
        <Text style={styles.empty}>No videos yet. Tap "+ Upload" to add one — it'll be transcribed, segmented into a timeline, and made askable.</Text>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(v) => v.id}
          onRefresh={refresh}
          refreshing={loading}
          renderItem={({ item }) => {
            const card = (
              <TouchableOpacity
                style={styles.card}
                onPress={() => onOpenVideo(item.id, item.original_name)}
                disabled={item.status === 'uploading' || deletingId === item.id}
              >
                <Text style={styles.cardTitle} numberOfLines={1}>{item.original_name}</Text>
                <View style={styles.cardInfoRow}>
                  {formatDuration(item.duration_seconds) ? (
                    <Text style={styles.cardInfoText}>{formatDuration(item.duration_seconds)}</Text>
                  ) : null}
                  {typeof item.chunk_count === 'number' && item.chunk_count > 0 ? (
                    <Text style={styles.cardInfoText}>{item.chunk_count} chunk{item.chunk_count === 1 ? '' : 's'}</Text>
                  ) : null}
                  {typeof item.progress_pct === 'number' && !['embedded', 'error', 'uploaded'].includes(item.status) ? (
                    <Text style={styles.cardInfoText}>{Math.round(item.progress_pct)}%</Text>
                  ) : null}
                </View>
                <View style={styles.cardFooter}>
                  <Text
                    style={[
                      styles.statusText,
                      item.status === 'embedded' && styles.statusReady,
                      item.status === 'error' && styles.statusError,
                      item.status === 'uploaded' && styles.statusUploaded,
                    ]}
                  >
                    {STATUS_LABELS[item.status] || item.status}
                  </Text>
                  {deletingId === item.id || !['embedded', 'error', 'uploaded'].includes(item.status) ? (
                    <ActivityIndicator size="small" color={BRAND} />
                  ) : null}
                </View>
                {(item.error_message && item.status === 'error') ? (
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

      <UploadVideoModal
        visible={showUpload}
        workspaceId={active?.id}
        onClose={() => setShowUpload(false)}
        onUploaded={(docId, name) => {
          setShowUpload(false);
          refresh();
          onOpenVideo(docId, name);
        }}
      />
    </View>
  );
}

function UploadVideoModal({ visible, workspaceId, onClose, onUploaded }: {
  visible: boolean; workspaceId?: string; onClose: () => void; onUploaded: (docId: string, name: string) => void;
}) {
  const { client, session } = useAuth();
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setBusy(false); setProgress(0); setStage(''); setError(null); setRightsConfirmed(false); };

  const pickAndUpload = async () => {
    if (!session) return;
    if (!rightsConfirmed) {
      Alert.alert('Confirm rights', 'Please confirm you have the rights to upload and process this video.');
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const file = result.assets[0];
    setBusy(true);
    setError(null);
    try {
      setStage('Requesting upload session…');
      const session1 = await createVideoUploadSession(client, session.accessToken, {
        filename: file.name,
        contentType: file.mimeType || 'video/mp4',
        fileSize: file.size || 0,
        workspaceId,
      });
      setStage('Uploading video…');
      await uploadVideoFile(session1.upload_url, file.uri, file.mimeType || 'video/mp4', (pct) => setProgress(pct));
      setStage('Finishing upload…');
      await completeVideoUpload(client, session.accessToken, {
        docId: session1.doc_id,
        filename: file.name,
        contentType: file.mimeType || 'video/mp4',
        fileSize: file.size || 0,
        gcsSourcePath: session1.gcs_source_path,
        workspaceId,
        rightsConfirmed: true,
        // Two-step flow, matching the desktop app: upload only. The user
        // reviews processing options and taps "Process video" on the next
        // screen -- nothing starts automatically.
        processAfterUpload: false,
      });
      reset();
      onUploaded(session1.doc_id, file.name);
    } catch (err) {
      setBusy(false);
      setError(extractDocIntelError(err, 'Video upload failed.'));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Upload a video</Text>
          <Text style={styles.modalHint}>
            Upload first, then choose processing options and tap "Process video" on the next screen. ADAR will transcribe the audio, extract a timeline of segments and key frames, and make the video askable once processing finishes.
          </Text>
          {error ? <Text style={styles.errorTextSmall}>{error}</Text> : null}
          {busy ? (
            <View style={{ alignItems: 'center', marginVertical: 16 }}>
              <ActivityIndicator color={BRAND} />
              <Text style={styles.stageText}>{stage}</Text>
              {stage === 'Uploading video…' ? <Text style={styles.stageText}>{Math.round(progress * 100)}%</Text> : null}
            </View>
          ) : (
            <>
              <View style={styles.rightsRow}>
                <Switch value={rightsConfirmed} onValueChange={setRightsConfirmed} trackColor={{ true: BRAND }} />
                <Text style={styles.rightsText}>I have the rights to upload and process this video.</Text>
              </View>
              <TouchableOpacity style={[styles.primaryButton, { opacity: rightsConfirmed ? 1 : 0.5 }]} disabled={!rightsConfirmed} onPress={pickAndUpload}>
                <Text style={styles.primaryButtonText}>Choose video file</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.cancelButton} onPress={() => { reset(); onClose(); }} disabled={busy}>
            <Text style={styles.cancelButtonText}>{busy ? 'Uploading…' : 'Cancel'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
  cardInfoText: { fontSize: 12, color: '#5b6472' },
  cardErrorText: { fontSize: 12, color: '#c0392b', marginTop: 6 },
  statusText: { fontSize: 12, fontWeight: '700', color: '#a06a00' },
  statusReady: { color: '#1e7e34' },
  statusError: { color: '#c0392b' },
  statusUploaded: { color: '#1d6fa5' },
  errorText: { color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 13, textAlign: 'center' },
  errorTextSmall: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#14181f', marginBottom: 8 },
  modalHint: { fontSize: 13, color: '#5b6472', marginBottom: 16, lineHeight: 18 },
  rightsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  rightsText: { flex: 1, marginLeft: 10, fontSize: 13, color: '#374151' },
  stageText: { fontSize: 13, color: '#5b6472', marginTop: 8 },
  primaryButton: { backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelButton: { alignItems: 'center', paddingVertical: 8 },
  cancelButtonText: { color: '#5b6472', fontWeight: '600', fontSize: 14 },
});
