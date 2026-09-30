import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { useAuth } from '@adar/shared-auth';
import {
  ProcessVideoOptions,
  VideoFrame,
  VideoSegment,
  VideoStatus,
  askVideo,
  extractDocIntelError,
  getDocumentViewUrl,
  getVideoFrameUrl,
  getVideoStatus,
  getVideoTimeline,
  isVideoReady,
  processVideoDocument,
} from './docintelApi';
import { VoiceRecorderButton } from './VoiceRecorderButton';
import { MarkdownMessage } from './MarkdownMessage';

const BRAND = '#2e7d4f';
const BLUE = '#1d6fa5';
const AMBER = '#a06a00';
const RED = '#c0392b';

/** Same 6 options VideoPanel.jsx's "Transcript language" <select> offers,
 *  in the same order -- codes match routes/video.py's accepted values. */
const TRANSCRIPT_LANGUAGES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'en-US', label: 'English' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'bn-IN', label: 'Bangla' },
  { value: 'ar-XA', label: 'Arabic' },
  { value: 'es-ES', label: 'Spanish' },
];

const PROCESSING_ACTIVE = new Set(['running', 'processing', 'queued']);
const CHECKPOINT_COUNT_LABELS: [string, string][] = [
  ['completed', 'done'],
  ['running', 'running'],
  ['failed', 'failed'],
  ['pending', 'pending'],
];

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Mirrors VideoPanel.jsx's formatStep() exactly: generic underscore/case
 *  transform, no hardcoded label map, so any new backend stage name shows
 *  up sensibly with zero mobile changes. */
function formatStep(value?: string | null): string {
  return String(value || 'Not started')
    .split('_')
    .join(' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Mirrors VideoPanel.jsx's formatAge(). */
function formatAge(value?: string | null): string {
  if (!value) return 'not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'not available';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

/** Mirrors VideoPanel.jsx's formatCheckpointCounts(). */
function formatCheckpointCounts(counts: Record<string, number> = {}): string {
  const parts = CHECKPOINT_COUNT_LABELS.filter(([key]) => Number(counts[key] || 0) > 0).map(
    ([key, label]) => `${counts[key]} ${label}`
  );
  return parts.join(' · ') || 'No items';
}

/** Mirrors VideoPanel.jsx's isProgressStale(): only flagged while a job is
 *  actively running/queued AND its last update is more than 10 minutes old. */
function isProgressStale(updatedAt?: string | null, status?: string | null): boolean {
  const active = PROCESSING_ACTIVE.has(String(status || '').toLowerCase());
  if (!active || !updatedAt) return false;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() > 10 * 60 * 1000;
}

/** Mirrors VideoPanel.jsx's buildProgress(). */
function buildProgress(status: VideoStatus | null) {
  const pct = Number(status?.progress_pct ?? 0);
  const updatedAt = status?.progress_updated_at || null;
  return {
    step: status?.progress_step || status?.processing_status || 'not_started',
    progressPct: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0,
    message: status?.progress_message || '',
    updatedAt,
    isStale: isProgressStale(updatedAt, status?.processing_status),
  };
}

interface AskEntry {
  id: string;
  question: string;
  answer?: string;
  sources?: any[];
  busy?: boolean;
  error?: string;
}

/** Video status + Process Video form + detailed progress/checkpoint UI +
 *  extracted timeline + sampled frames + "ask about this video" -- built
 *  to mirror the desktop web app's VideoPanel.jsx as closely as a native
 *  screen reasonably can: same two-step upload-then-process flow, same
 *  metrics/progress/checkpoint fields, same 5s poll interval, same
 *  transcript-language options, same "re-click Process Video to retry"
 *  behavior (there is no separate retry control on either client). */
export function VideoDetailScreen({ docId, docName, onBack }: { docId: string; docName: string; onBack: () => void }) {
  const { client, session } = useAuth();
  const [status, setStatus] = useState<VideoStatus | null>(null);
  const [timeline, setTimeline] = useState<{ segments: VideoSegment[]; frames: VideoFrame[] } | null>(null);
  const [frameUrls, setFrameUrls] = useState<Record<number, string>>({});
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [entries, setEntries] = useState<AskEntry[]>([]);

  // The "Ask about this video" box is a fixed footer (like ChatScreen.tsx's
  // own input row), so push it above the keyboard the same way ChatScreen
  // does: track keyboard height and pad the root container by it.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const [rightsConfirmed, setRightsConfirmed] = useState(true);
  const [embedAfterProcessing, setEmbedAfterProcessing] = useState(true);
  const [transcriptLanguage, setTranscriptLanguage] = useState('auto');
  const [maxFrames, setMaxFrames] = useState('12');
  const [segmentSeconds, setSegmentSeconds] = useState('60');
  const [processing, setProcessing] = useState(false);
  const [processMessage, setProcessMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadFrameUrls = useCallback(
    async (frames: VideoFrame[]) => {
      if (!session || !frames.length) return;
      const first = frames.slice(0, 6);
      const results = await Promise.all(
        first.map(async (f) => {
          try {
            const url = await getVideoFrameUrl(client, session.accessToken, docId, f.frame_index);
            return [f.frame_index, url] as const;
          } catch {
            return null;
          }
        })
      );
      setFrameUrls((prev) => {
        const next = { ...prev };
        for (const r of results) if (r) next[r[0]] = r[1];
        return next;
      });
    },
    [client, session, docId]
  );

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const s = await getVideoStatus(client, session.accessToken, docId);
      setStatus(s);
      setError(null);
      if (isVideoReady(s)) {
        const [t, view] = await Promise.all([
          getVideoTimeline(client, session.accessToken, docId),
          getDocumentViewUrl(client, session.accessToken, docId),
        ]);
        setTimeline(t);
        setPlaybackUrl(view.url);
        loadFrameUrls(t.frames || []);
      }
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not load video status.'));
    } finally {
      setLoading(false);
    }
  }, [client, session, docId, loadFrameUrls]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // Poll every 5s while a job is actively running -- same interval and same
  // "which states count as active" set as the desktop app. Videos that were
  // uploaded but not yet processed (or that finished/errored) don't poll.
  useEffect(() => {
    const active = PROCESSING_ACTIVE.has(String(status?.processing_status || '').toLowerCase());
    if (!active) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [status?.processing_status, refresh]);

  const handleProcess = async () => {
    if (!session) return;
    setProcessing(true);
    setProcessMessage(null);
    try {
      const options: ProcessVideoOptions = {
        rightsConfirmed,
        embedAfterProcessing,
        transcriptLanguage,
        maxFrames: Number(maxFrames) || 12,
        segmentSeconds: Number(segmentSeconds) || 60,
      };
      await processVideoDocument(client, session.accessToken, docId, options);
      setProcessMessage('Video processing started.');
      setTimeline(null);
      setFrameUrls({});
      await refresh();
    } catch (err) {
      setProcessMessage(extractDocIntelError(err, 'Could not start video processing.'));
    } finally {
      setProcessing(false);
    }
  };

  const onAsk = async () => {
    const q = question.trim();
    if (!q || !session) return;
    setQuestion('');
    const id = `q-${Date.now()}`;
    setEntries((prev) => [{ id, question: q, busy: true }, ...prev]);
    try {
      const { answer, sources } = await askVideo(client, session.accessToken, docId, q);
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, answer, sources, busy: false } : e)));
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, busy: false, error: extractDocIntelError(err, 'Could not answer that question.') } : e))
      );
    }
  };

  const ready = isVideoReady(status);
  const progress = buildProgress(status);
  const hasCheckpoints = !!status?.checkpoint_summary?.stages?.length;
  const statusErrorText = status?.error_message || status?.document_error;

  return (
    <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Video</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{docName}</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <>
        <ScrollView
          style={styles.flex}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleManualRefresh} tintColor={BRAND} colors={[BRAND]} />
          }
          keyboardShouldPersistTaps="handled"
        >
          {ready && playbackUrl ? (
            <View style={styles.playerWrap}>
              <Video
                source={{ uri: playbackUrl }}
                style={styles.player}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay={false}
              />
            </View>
          ) : null}

          <View style={{ padding: 16 }}>
            {/* Processing status: metrics, progress bar, checkpoints -- mirrors
                VideoPanel.jsx's "Processing Status" band, including its
                explicit "Refresh status" button (not just pull-to-refresh --
                that button was the piece actually missing here). */}
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Processing status</Text>
              <TouchableOpacity
                style={[styles.refreshBtn, refreshing && styles.refreshBtnDisabled]}
                onPress={handleManualRefresh}
                disabled={refreshing}
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color={BRAND} />
                ) : (
                  <Text style={styles.refreshBtnText}>Refresh status</Text>
                )}
              </TouchableOpacity>
            </View>
            <View style={styles.metricsRow}>
              <Metric label="Document" value={status?.document_status || '-'} />
              <Metric label="Video" value={status?.processing_status || 'not processed'} />
              <Metric label="Progress" value={`${progress.progressPct}%`} />
              <Metric label="Chunks" value={String(status?.chunk_count ?? 0)} />
              <Metric label="Duration" value={status?.duration_seconds ? formatTime(status.duration_seconds) : '-'} />
              <Metric label="Segments" value={String(timeline?.segments?.length ?? 0)} />
              <Metric label="Frames" value={String(timeline?.frames?.length ?? 0)} />
            </View>

            <View style={styles.progressBox}>
              <View style={styles.progressTopRow}>
                <Text style={styles.progressStepText}>{formatStep(progress.step)}</Text>
                <Text style={progress.isStale ? styles.progressStaleText : styles.progressAgeText}>
                  {progress.updatedAt ? `Last updated ${formatAge(progress.updatedAt)}` : 'Waiting for first update'}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress.progressPct}%` }]} />
              </View>
              <Text style={styles.progressMessage}>
                {progress.message || 'Processing status will appear here after the job starts.'}
              </Text>
              {progress.isStale ? (
                <Text style={styles.progressWarning}>
                  Processing may be stalled. Pull to refresh, or tap Process Video again to resume.
                </Text>
              ) : null}
            </View>

            {hasCheckpoints ? (
              <View style={styles.checkpointBox}>
                <View style={styles.checkpointHeadRow}>
                  <Text style={styles.checkpointHeadText}>Durable recovery checkpoints</Text>
                  <Text style={styles.checkpointHeadSub}>
                    {status?.processing_stalled ? 'Worker lease expired' : 'Resume protection active'}
                  </Text>
                </View>
                {status!.checkpoint_summary!.stages.map((stage) => (
                  <View key={stage.stage} style={styles.checkpointRow}>
                    <Text style={styles.checkpointStageText}>{formatStep(stage.stage)}</Text>
                    <Text style={styles.checkpointCountsText}>
                      {formatCheckpointCounts(stage.counts)} · {stage.attempts || 0} attempt{stage.attempts === 1 ? '' : 's'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {statusErrorText ? <Text style={styles.statusErrorText}>{statusErrorText}</Text> : null}

            {/* Process Video: always available, same defaults as desktop.
                There is no separate retry button -- tapping this again after
                a failure resumes from the last checkpoint on the backend,
                exactly like re-clicking "Process Video" on desktop. */}
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Process video</Text>
            <View style={styles.processCard}>
              <View style={styles.checkRow}>
                <Switch value={rightsConfirmed} onValueChange={setRightsConfirmed} trackColor={{ true: BRAND }} />
                <Text style={styles.checkLabel}>Rights confirmed</Text>
              </View>
              <View style={styles.checkRow}>
                <Switch value={embedAfterProcessing} onValueChange={setEmbedAfterProcessing} trackColor={{ true: BRAND }} />
                <Text style={styles.checkLabel}>Embed after processing</Text>
              </View>

              <Text style={styles.fieldLabel}>Transcript language</Text>
              <View style={styles.languageChipsRow}>
                {TRANSCRIPT_LANGUAGES.map((lang) => (
                  <TouchableOpacity
                    key={lang.value}
                    style={[styles.languageChip, transcriptLanguage === lang.value && styles.languageChipActive]}
                    onPress={() => setTranscriptLanguage(lang.value)}
                  >
                    <Text style={[styles.languageChipText, transcriptLanguage === lang.value && styles.languageChipTextActive]}>
                      {lang.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.numberRow}>
                <View style={styles.numberField}>
                  <Text style={styles.fieldLabel}>Max sampled frames</Text>
                  <TextInput
                    style={styles.numberInput}
                    value={maxFrames}
                    onChangeText={setMaxFrames}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.numberField}>
                  <Text style={styles.fieldLabel}>Segment seconds</Text>
                  <TextInput
                    style={styles.numberInput}
                    value={segmentSeconds}
                    onChangeText={setSegmentSeconds}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              {processMessage ? <Text style={styles.processMessageText}>{processMessage}</Text> : null}

              <TouchableOpacity
                style={[styles.processButton, { opacity: processing ? 0.6 : 1 }]}
                disabled={processing}
                onPress={handleProcess}
              >
                {processing ? <ActivityIndicator color="#fff" /> : <Text style={styles.processButtonText}>Process video</Text>}
              </TouchableOpacity>
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Timeline</Text>
            {timeline?.segments?.length ? (
              timeline.segments.map((seg) => (
                <View key={seg.id} style={styles.segmentCard}>
                  <View style={styles.segmentHeader}>
                    <Text style={styles.segmentTime}>{formatTime(seg.start_seconds)} – {formatTime(seg.end_seconds)}</Text>
                    {seg.segment_type ? <Text style={styles.segmentType}>{seg.segment_type}</Text> : null}
                  </View>
                  {seg.title ? <Text style={styles.segmentTitle}>{seg.title}</Text> : null}
                  {seg.summary ? <Text style={styles.segmentSummary}>{seg.summary}</Text> : null}
                </View>
              ))
            ) : (
              <Text style={styles.empty}>
                {ready
                  ? 'No timeline segments were returned yet. Pull to refresh to reload timeline data.'
                  : 'Timeline segments will appear automatically after video processing finishes.'}
              </Text>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Sampled frames</Text>
            {timeline?.frames?.length ? (
              <View style={styles.frameGrid}>
                {timeline.frames.slice(0, 6).map((frame) => (
                  <View key={frame.id} style={styles.frameCard}>
                    {frameUrls[frame.frame_index] ? (
                      <Image source={{ uri: frameUrls[frame.frame_index] }} style={styles.frameImage} />
                    ) : (
                      <View style={styles.framePlaceholder}>
                        <Text style={styles.framePlaceholderText}>Frame {frame.frame_index + 1}</Text>
                      </View>
                    )}
                    <Text style={styles.frameTime}>{formatTime(frame.timestamp_seconds)}</Text>
                    <Text style={styles.frameCaption} numberOfLines={3}>{frame.caption || 'No caption available.'}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.empty}>
                {ready
                  ? 'No sampled frames were returned yet. Pull to refresh to reload frame previews.'
                  : 'Sampled frame previews will appear automatically after processing finishes.'}
              </Text>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Ask about this video</Text>

            {entries.map((entry) => (
              <View key={entry.id} style={styles.answerCard}>
                <Text style={styles.answerQuestion}>{entry.question}</Text>
                {entry.busy ? (
                  <ActivityIndicator color={BRAND} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
                ) : entry.error ? (
                  <Text style={styles.errorTextSmall}>{entry.error}</Text>
                ) : (
                  <>
                    <View style={{ marginTop: 6 }}><MarkdownMessage>{entry.answer || ''}</MarkdownMessage></View>
                    {entry.sources?.length ? (
                      <View style={styles.sourcesBox}>
                        {entry.sources.map((src, i) => (
                          <Text key={i} style={styles.sourceText}>
                            {src.doc_name || src.source} {src.start_time != null ? `(${formatTime(src.start_time)}–${formatTime(src.end_time)})` : ''}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ))}
          </View>
        </ScrollView>

          <View style={styles.askRow}>
            <VoiceRecorderButton onTranscribed={(t) => setQuestion((prev) => (prev ? `${prev} ${t}` : t))} />
            <TextInput
              style={styles.askInput}
              placeholder="e.g. What happens around the 2 minute mark?"
              value={question}
              onChangeText={setQuestion}
              multiline
            />
            <TouchableOpacity style={[styles.askSend, { opacity: question.trim() ? 1 : 0.5 }]} disabled={!question.trim()} onPress={onAsk}>
              <Text style={styles.askSendText}>Ask</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e2e5ea', backgroundColor: '#fff',
  },
  backButton: { marginRight: 10 },
  backButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  headerTitle: { fontSize: 14, fontWeight: '600', color: '#14181f', flex: 1 },
  playerWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  player: { width: '100%', height: '100%' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', marginBottom: 10 },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refreshBtn: { borderWidth: 1, borderColor: '#d7dbe2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  refreshBtnDisabled: { opacity: 0.6 },
  refreshBtnText: { fontSize: 12, fontWeight: '600', color: '#5b6472' },
  empty: { color: '#5b6472', fontSize: 13 },

  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 14 },
  metricCard: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e5ea',
    paddingVertical: 8, paddingHorizontal: 10, margin: 4, minWidth: '30%', flexGrow: 1,
  },
  metricLabel: { fontSize: 10, color: '#9aa3b2', textTransform: 'uppercase', fontWeight: '700' },
  metricValue: { fontSize: 13, color: '#14181f', fontWeight: '700', marginTop: 2 },

  progressBox: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e5ea', padding: 14, marginBottom: 12 },
  progressTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progressStepText: { fontSize: 14, fontWeight: '700', color: '#14181f' },
  progressAgeText: { fontSize: 11, color: '#9aa3b2' },
  progressStaleText: { fontSize: 11, color: AMBER, fontWeight: '700' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: '#eef0f3', overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: BRAND },
  progressMessage: { fontSize: 12, color: '#5b6472', marginTop: 8, lineHeight: 17 },
  progressWarning: { fontSize: 12, color: AMBER, marginTop: 6, fontWeight: '600' },

  checkpointBox: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e5ea', padding: 14, marginBottom: 12 },
  checkpointHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  checkpointHeadText: { fontSize: 13, fontWeight: '700', color: '#14181f' },
  checkpointHeadSub: { fontSize: 11, color: BLUE, fontWeight: '600' },
  checkpointRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#f0f1f3' },
  checkpointStageText: { fontSize: 12, color: '#14181f', fontWeight: '600' },
  checkpointCountsText: { fontSize: 11, color: '#5b6472' },

  statusErrorText: { color: RED, backgroundColor: '#fdecea', padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 12 },

  processCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e5ea', padding: 14 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  checkLabel: { marginLeft: 10, fontSize: 13, color: '#374151' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#5b6472', marginBottom: 6, marginTop: 4 },
  languageChipsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  languageChip: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
    marginRight: 8, marginBottom: 8, backgroundColor: '#f7f8fa',
  },
  languageChipActive: { backgroundColor: BRAND, borderColor: BRAND },
  languageChipText: { fontSize: 12, color: '#374151', fontWeight: '600' },
  languageChipTextActive: { color: '#fff' },
  numberRow: { flexDirection: 'row', marginTop: 4 },
  numberField: { flex: 1, marginRight: 10 },
  numberInput: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 14, backgroundColor: '#fff',
  },
  processMessageText: { fontSize: 12, color: BLUE, marginTop: 12 },
  processButton: { backgroundColor: BRAND, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  processButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  segmentCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e2e5ea' },
  segmentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  segmentTime: { fontSize: 12, fontWeight: '700', color: BRAND },
  segmentType: { fontSize: 11, color: '#9aa3b2', textTransform: 'uppercase', fontWeight: '700' },
  segmentTitle: { fontSize: 14, fontWeight: '700', color: '#14181f', marginTop: 6 },
  segmentSummary: { fontSize: 13, color: '#374151', marginTop: 4, lineHeight: 18 },

  frameGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  frameCard: { width: '33.33%', paddingHorizontal: 4, marginBottom: 12 },
  frameImage: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: '#e2e5ea' },
  framePlaceholder: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: '#e2e5ea', alignItems: 'center', justifyContent: 'center' },
  framePlaceholderText: { fontSize: 11, color: '#9aa3b2', fontWeight: '600' },
  frameTime: { fontSize: 11, fontWeight: '700', color: BRAND, marginTop: 4 },
  frameCaption: { fontSize: 10, color: '#5b6472', marginTop: 2, lineHeight: 13 },

  // Fixed footer now (mirrors ChatScreen.tsx's inputRow) instead of inline
  // scroll content -- needs its own background/border to read as a bar.
  askRow: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 12,
    borderTopWidth: 1, borderTopColor: '#e2e5ea', backgroundColor: '#fff',
  },
  askInput: {
    flex: 1, borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 14, maxHeight: 90, marginRight: 8, backgroundColor: '#fff',
  },
  askSend: { backgroundColor: BRAND, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  askSendText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  answerCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#e2e5ea' },
  answerQuestion: { fontSize: 13, fontWeight: '700', color: '#14181f' },
  sourcesBox: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#f0f1f3', paddingTop: 6 },
  sourceText: { fontSize: 11, color: '#5b6472', marginTop: 2 },
  errorText: { color: RED, backgroundColor: '#fdecea', padding: 10, borderRadius: 10, margin: 16, fontSize: 13, textAlign: 'center' },
  errorTextSmall: { color: RED, fontSize: 12, marginTop: 6 },
});
