import pathlib

# ── 1. docintelApi.ts: add listVideoDocuments() + its response type ────────
api = pathlib.Path.home() / "mnt/project/adar-mobile/apps/docintel/src/docintelApi.ts"
s = api.read_text()

old = """export interface VideoUploadSession {
  doc_id: string;
  upload_url: string;
  gcs_source_path: string;
  expires_in_seconds: number;
  method: string;
  headers: Record<string, string>;
}"""
assert s.count(old) == 1
new = """export interface VideoUploadSession {
  doc_id: string;
  upload_url: string;
  gcs_source_path: string;
  expires_in_seconds: number;
  method: string;
  headers: Record<string, string>;
}

/** GET /api/video/documents's per-row shape -- a LEFT JOIN of documents +
 *  video_documents (plus the same progress-from-metadata merge as
 *  getVideoStatus's _with_video_progress), purpose-built for a video list
 *  so the list can show real duration/progress/chunk info per row without
 *  an N+1 getVideoStatus() call per video. Distinct from VideoStatus below
 *  (that one is the single-video detail shape, keyed document_status not
 *  status, and includes fields like checkpoint_summary this list doesn't). */
export interface VideoDocumentSummary {
  id: string;
  original_name: string;
  file_type: string;
  status: string; // generic ingestion status: uploading | uploaded | chunking | chunked | embedding | embedded | error
  chunk_count: number | null;
  error_message: string | null;
  doc_type: string | null;
  doc_domain: string | null;
  workspace_id: string | null;
  video_id: string | null;
  processing_status: string | null; // video-specific: running | ready | error | not_processed | ...
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  frame_count: number | null;
  progress_step: string | null;
  progress_pct: number | null;
  progress_message: string | null;
  progress_updated_at: string | null;
}

/** GET /api/video/documents -- the video-specific list endpoint (mirrors
 *  VideoPanel.jsx's own video list load). Prefer this over the generic
 *  listDocuments()+filter for anywhere that needs to show video progress/
 *  duration/chunk info per row -- listDocuments() only returns the plain
 *  documents table columns, so duration/processing_status/progress were
 *  never there to show no matter how the list UI rendered them. */
export async function listVideoDocuments(
  client: AxiosInstance,
  accessToken: string,
  workspaceId?: string
): Promise<VideoDocumentSummary[]> {
  const { data } = await client.get('/api/video/documents', {
    params: { workspace_id: workspaceId },
    headers: authHeaders(accessToken),
  });
  return data;
}"""
s = s.replace(old, new)
api.write_text(s)
print("docintelApi.ts patched")

# ── 2. VideoScreen.tsx: use the new endpoint + show real info per card ─────
vs = pathlib.Path.home() / "mnt/project/adar-mobile/apps/docintel/src/VideoScreen.tsx"
t = vs.read_text()

old_import = """import {
  DocIntelDocument,
  completeVideoUpload,
  createVideoUploadSession,
  extractDocIntelError,
  getVideoStatus,
  listDocuments,
  uploadVideoFile,
} from './docintelApi';"""
assert t.count(old_import) == 1
new_import = """import {
  VideoDocumentSummary,
  completeVideoUpload,
  createVideoUploadSession,
  extractDocIntelError,
  getVideoStatus,
  listVideoDocuments,
  uploadVideoFile,
} from './docintelApi';"""
t = t.replace(old_import, new_import)

old_formatTime_anchor = """const STATUS_LABELS: Record<string, string> = {"""
assert t.count(old_formatTime_anchor) == 1
new_formatTime_anchor = """/** Same mm:ss / h:mm:ss formatting as VideoDetailScreen.tsx's formatTime(). */
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

const STATUS_LABELS: Record<string, string> = {"""
t = t.replace(old_formatTime_anchor, new_formatTime_anchor)

old_state = """  const [videos, setVideos] = useState<DocIntelDocument[]>([]);"""
assert t.count(old_state) == 1
new_state = """  const [videos, setVideos] = useState<VideoDocumentSummary[]>([]);"""
t = t.replace(old_state, new_state)

old_refresh = """  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const docs = await listDocuments(client, session.accessToken, active?.id);
      setVideos(docs.filter((d) => d.file_type?.startsWith('video/')));
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not load videos.'));
    } finally {
      setLoading(false);
    }
  }, [client, session, active, client]);"""
assert t.count(old_refresh) == 1
new_refresh = """  const refresh = useCallback(async () => {
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
  }, [client, session, active]);"""
t = t.replace(old_refresh, new_refresh)

old_pending = """    const pending = videos.some((v) => !['embedded', 'error', 'uploaded'].includes(v.status));"""
assert t.count(old_pending) == 1
# unchanged -- v.status still exists on VideoDocumentSummary, just leaving this assert as a structural checkpoint

old_card = """            <TouchableOpacity
              style={styles.card}
              onPress={() => onOpenVideo(item.id, item.original_name)}
              disabled={item.status === 'uploading'}
            >
              <Text style={styles.cardTitle} numberOfLines={1}>{item.original_name}</Text>
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
                {!['embedded', 'error', 'uploaded'].includes(item.status) ? <ActivityIndicator size="small" color={BRAND} /> : null}
              </View>
            </TouchableOpacity>"""
assert t.count(old_card) == 1
new_card = """            <TouchableOpacity
              style={styles.card}
              onPress={() => onOpenVideo(item.id, item.original_name)}
              disabled={item.status === 'uploading'}
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
                {!['embedded', 'error', 'uploaded'].includes(item.status) ? <ActivityIndicator size="small" color={BRAND} /> : null}
              </View>
              {(item.error_message && item.status === 'error') ? (
                <Text style={styles.cardErrorText} numberOfLines={2}>{item.error_message}</Text>
              ) : null}
            </TouchableOpacity>"""
t = t.replace(old_card, new_card)

# Styles for the new info row + error text.
old_style_anchor = """  statusText: { fontSize: 12, fontWeight: '700', color: '#a06a00' },"""
assert t.count(old_style_anchor) == 1
new_style_anchor = """  cardInfoRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 10 },
  cardInfoText: { fontSize: 12, color: '#5b6472' },
  cardErrorText: { fontSize: 12, color: '#c0392b', marginTop: 6 },
  statusText: { fontSize: 12, fontWeight: '700', color: '#a06a00' },"""
t = t.replace(old_style_anchor, new_style_anchor)

vs.write_text(t)
print("VideoScreen.tsx patched")
