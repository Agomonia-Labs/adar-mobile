import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Audio } from 'expo-av';
import { useAuth } from '@adar/shared-auth';
import {
  TelephonyCall,
  addConversationTurn,
  approveConversationTranscript,
  deleteTelephonyCall,
  extractDocIntelError,
  finalizeConversationSession,
  getConversationRecordingUrl,
  getTelephonyCall,
  retryTelephonyCall,
  setConversationConsent,
  speakText,
  startConversationSession,
} from './docintelApi';
import { useWorkspace } from './WorkspaceContext';

const BRAND = '#2e7d4f';
const BLUE = '#1d6fa5';
const RED = '#c0392b';

/** Same 6 languages ConversationPanel.jsx's "Language" <select> offers, in
 *  the same order. `tts` is the 2-letter code /api/voice/speak expects
 *  (see docintelApi.ts's speakText) -- a different format than the BCP-47
 *  `value` the telephony session itself is created with. */
const LANGUAGES: { value: string; label: string; tts: string }[] = [
  { value: 'en-US', label: 'English', tts: 'en' },
  { value: 'bn-BD', label: 'Bangla', tts: 'bn' },
  { value: 'hi-IN', label: 'Hindi', tts: 'hi' },
  { value: 'es-US', label: 'Spanish', tts: 'es' },
  { value: 'ar-SA', label: 'Arabic', tts: 'ar' },
  { value: 'ur-PK', label: 'Urdu', tts: 'ur' },
];

const SILENCE_MS = 1300;
const MAX_TURN_MS = 60000;
// dBFS threshold separating "speaking" from "silence/background noise" --
// same role as ConversationPanel.jsx's SPEECH_RMS, but expo-av's Recording
// metering reports decibels (roughly -160 silence .. 0 max) rather than a
// raw waveform RMS, so this isn't the same number on the same scale.
// Picked as a reasonable starting point for a phone held at normal
// speaking distance; mic sensitivity varies by device, so this may need
// on-device tuning later.
const SPEECH_DB_THRESHOLD = -35;
const METERING_INTERVAL_MS = 200;

function clock(seconds: number | null | undefined): string {
  const total = Math.floor(seconds || 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Live voice conversation with the AI assistant, plus the finished
 *  review/approve view -- mirrors adar-rag/frontend's ConversationPanel.jsx
 *  turn-for-turn: record a turn (voice-activity detection decides when the
 *  participant has stopped talking), the backend transcribes it and
 *  replies, the reply is spoken back, and the loop repeats until the
 *  assistant signals it has what it needs or the user taps "Finish and
 *  save" -- then the transcript is reviewed/edited and approved, which
 *  chunks and embeds it as a searchable document (same as any other
 *  document). A `callId` of null means "set up a brand new conversation";
 *  otherwise this reopens an existing one (mid-conversation or finished). */
export function ConversationDetailScreen({
  callId: initialCallId,
  onBack,
}: {
  callId: string | null;
  onBack: () => void;
}) {
  const { client, session } = useAuth();
  const { active } = useWorkspace();
  const [callId, setCallId] = useState<string | null>(initialCallId);
  const [call, setCall] = useState<TelephonyCall | null>(null);
  const [loading, setLoading] = useState(!!initialCallId);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'live' | 'review'>('live');
  const [language, setLanguage] = useState('en-US');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [typedTurn, setTypedTurn] = useState('');
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [playingRecording, setPlayingRecording] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const speechSoundRef = useRef<Audio.Sound | null>(null);
  const playbackSoundRef = useRef<Audio.Sound | null>(null);
  const listeningSessionRef = useRef('');
  const speechStartedRef = useRef(false);
  const silentSinceRef = useRef(0);
  const startedAtRef = useRef(0);

  // Fixed footer keyboard handling -- same proven pattern as ChatScreen.tsx
  // / VideoDetailScreen.tsx (see that file's own comment for why: the
  // typed-turn box is a fixed footer, not buried in the scroll, so padding
  // the root by keyboardHeight is enough to keep it above the keyboard).
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const reviewScrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const load = useCallback(async (id: string) => {
    if (!session) return;
    try {
      const data = await getTelephonyCall(client, session.accessToken, id);
      setCall(data);
    } catch (err) {
      setMessage(extractDocIntelError(err, 'Could not load this conversation.'));
    }
  }, [client, session]);

  // Initial load for an existing conversation; a brand-new one (callId
  // null) just shows the setup form below until createSession() runs.
  useEffect(() => {
    if (!initialCallId) return;
    setLoading(true);
    load(initialCallId).finally(() => setLoading(false));
  }, [initialCallId, load]);

  // Once loaded, land on "live" only if the conversation is genuinely
  // still active (e.g. the user backed out mid-conversation and came
  // back) -- anything past that (processing, in review, done, errored)
  // belongs in the review view, same as desktop only ever showing "live"
  // for a session it just created itself.
  useEffect(() => {
    if (call && call.processing_status !== 'active') setView('review');
  }, [call?.id]);

  // Keep the editable transcript textbox in sync with the latest turns,
  // same guard as ConversationPanel.jsx's own effect: don't clobber
  // something already approved.
  useEffect(() => {
    if (!call?.turns?.length || call.review_status === 'approved') return;
    setTranscriptDraft(call.turns.map((t) => `${t.speaker}: ${t.transcript}`).join('\n'));
  }, [call?.id, call?.review_status, call?.turns?.length]);

  // Poll while the backend is still chunking/embedding the approved
  // transcript -- same condition as ConversationPanel.jsx's own timer.
  useEffect(() => {
    if (!callId || ['completed', 'error', 'active'].includes(call?.processing_status || '')) return;
    const id = setInterval(() => load(callId), 4000);
    return () => clearInterval(id);
  }, [callId, call?.processing_status, load]);

  // Poll for the combined recording's playback URL once there's a chance
  // it exists -- the background concat step (see docintelApi.ts's
  // getConversationRecordingUrl) usually finishes within a few seconds of
  // finalize, but there's no push signal for "it's ready now".
  useEffect(() => {
    if (!callId || recordingUrl || !session) return;
    if (!call || call.processing_status === 'active' || call.processing_status === 'awaiting_consent') return;
    let cancelled = false;
    const check = async () => {
      try {
        const result = await getConversationRecordingUrl(client, session.accessToken, callId);
        if (!cancelled && result.url) setRecordingUrl(result.url);
      } catch { /* not ready / not available -- keep polling */ }
    };
    check();
    const id = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [callId, call?.processing_status, recordingUrl, client, session]);

  // Release the mic/sound objects on unmount -- same cleanup
  // ConversationPanel.jsx does on its own unmount.
  useEffect(() => () => {
    recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    speechSoundRef.current?.unloadAsync().catch(() => {});
    playbackSoundRef.current?.unloadAsync().catch(() => {});
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!callId) return;
    setRefreshing(true);
    try { await load(callId); } finally { setRefreshing(false); }
  }, [callId, load]);

  function ttsCodeFor(bcp47: string): string {
    return LANGUAGES.find((l) => l.value === bcp47)?.tts || 'en';
  }

  async function speak(text: string, onEnd?: () => void) {
    if (!text || !session) { onEnd?.(); return; }
    try {
      const { audioBase64, mimeType } = await speakText(client, session.accessToken, text, ttsCodeFor(language));
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: `data:${mimeType};base64,${audioBase64}` },
        { shouldPlay: true }
      );
      speechSoundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          if (speechSoundRef.current === sound) speechSoundRef.current = null;
          onEnd?.();
        }
      });
    } catch {
      // Speech playback is a convenience, not a requirement -- the turn
      // text is already visible either way, so don't block the flow.
      onEnd?.();
    }
  }

  async function createSession() {
    if (!consent) { setMessage('Confirm participant recording consent before starting.'); return; }
    if (!session) return;
    setBusy(true);
    setMessage('');
    try {
      const created = await startConversationSession(client, session.accessToken, {
        workspace_id: active?.id || null,
        template_id: 'customer-knowledge-capture',
        language_code: language,
        title: 'Conversation Recording',
        redact_pii: true,
      });
      const confirmation = await setConversationConsent(client, session.accessToken, created.session_id, true);
      setCallId(created.session_id);
      await load(created.session_id);
      setView('live');
      speak(confirmation.greeting, () => recordTurn(created.session_id));
    } catch (err) {
      setMessage(extractDocIntelError(err, 'Could not start the conversation.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitTurn(
    payload: { transcript?: string; audioUri?: string },
    sessionId: string | undefined = callId || undefined,
    resumeListening = false
  ) {
    if (!sessionId || !session) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await addConversationTurn(client, session.accessToken, sessionId, {
        transcript: payload.transcript || '',
        audio: payload.audioUri
          ? { uri: payload.audioUri, mimeType: 'audio/mp4', name: 'conversation-turn.m4a' }
          : undefined,
      });
      setTypedTurn('');
      await load(sessionId);
      if (result.assistant?.save_conversation) {
        listeningSessionRef.current = '';
        speak(result.assistant.response, () => finish(sessionId));
      } else {
        speak(result.assistant?.response, resumeListening ? () => recordTurn(sessionId) : undefined);
      }
    } catch (err) {
      setMessage(extractDocIntelError(err, 'Could not process that turn.'));
    } finally {
      setBusy(false);
    }
  }

  function onRecordingStatus(status: Audio.RecordingStatus) {
    if (!status.isRecording) return;
    const now = Date.now();
    const db = typeof status.metering === 'number' ? status.metering : -160;
    if (db >= SPEECH_DB_THRESHOLD) {
      speechStartedRef.current = true;
      silentSinceRef.current = 0;
    } else if (speechStartedRef.current) {
      if (!silentSinceRef.current) silentSinceRef.current = now;
      if (now - silentSinceRef.current >= SILENCE_MS) {
        stopRecording();
        return;
      }
    }
    if (now - startedAtRef.current >= MAX_TURN_MS) stopRecording();
  }

  async function stopRecording() {
    const activeRecording = recordingRef.current;
    if (!activeRecording) return;
    recordingRef.current = null;
    setRecording(false);
    const sessionIdAtStart = listeningSessionRef.current;
    try {
      await activeRecording.stopAndUnloadAsync();
    } catch { /* already stopped */ }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    const uri = activeRecording.getURI();
    const resumeListening = listeningSessionRef.current === sessionIdAtStart && !!sessionIdAtStart;
    if (uri) await submitTurn({ audioUri: uri }, sessionIdAtStart || undefined, resumeListening);
  }

  async function recordTurn(sessionId: string | undefined = callId || undefined) {
    if (recordingRef.current) {
      listeningSessionRef.current = '';
      await stopRecording();
      return;
    }
    if (!sessionId) return;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { setMessage('Microphone permission is required to record.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      speechStartedRef.current = false;
      silentSinceRef.current = 0;
      startedAtRef.current = Date.now();
      listeningSessionRef.current = sessionId;
      const { recording: rec } = await Audio.Recording.createAsync(
        { ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true },
        onRecordingStatus,
        METERING_INTERVAL_MS
      );
      recordingRef.current = rec;
      setRecording(true);
    } catch (err) {
      setMessage((err as Error)?.message || 'Microphone access was not granted.');
    }
  }

  async function finish(sessionId: string | undefined = callId || undefined) {
    if (!sessionId || !session) return;
    setBusy(true);
    setMessage('');
    try {
      listeningSessionRef.current = '';
      speechSoundRef.current?.stopAsync().catch(() => {});
      await finalizeConversationSession(client, session.accessToken, sessionId);
      await load(sessionId);
      setMessage('Recording finished. Review and approve the transcript below to publish it to the workspace.');
      setView('review');
    } catch (err) {
      setMessage(extractDocIntelError(err, 'Could not finish the conversation.'));
    } finally {
      setBusy(false);
    }
  }

  async function approveTranscript() {
    if (!callId || !transcriptDraft.trim() || !session) return;
    setBusy(true);
    setMessage('');
    try {
      await approveConversationTranscript(client, session.accessToken, callId, transcriptDraft.trim());
      await load(callId);
      setMessage('Transcript approved. Chunking and embedding have started.');
    } catch (err) {
      setMessage(extractDocIntelError(err, 'Could not approve the transcript.'));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!callId || !session) return;
    setBusy(true);
    try {
      await retryTelephonyCall(client, session.accessToken, callId);
      await load(callId);
    } catch (err) {
      setMessage(extractDocIntelError(err, 'Could not retry.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!callId || !session) return;
    setBusy(true);
    try {
      await deleteTelephonyCall(client, session.accessToken, callId);
      onBack();
    } catch (err) {
      setMessage(extractDocIntelError(err, 'Could not delete this conversation.'));
      setBusy(false);
    }
  }

  async function togglePlayRecording() {
    if (!recordingUrl) return;
    if (playbackSoundRef.current) {
      if (playingRecording) {
        await playbackSoundRef.current.pauseAsync();
        setPlayingRecording(false);
      } else {
        await playbackSoundRef.current.playAsync();
        setPlayingRecording(true);
      }
      return;
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: recordingUrl }, { shouldPlay: true });
      playbackSoundRef.current = sound;
      setPlayingRecording(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) setPlayingRecording(false);
      });
    } catch (err) {
      setMessage(extractDocIntelError(err, 'Could not play the recording.'));
    }
  }

  // ── Setup: no conversation yet ────────────────────────────────────────
  if (!callId) {
    return (
      <View style={styles.flex}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Conversations</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New conversation</Text>
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={{ padding: 16 }}>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <Text style={styles.sectionTitle}>Language</Text>
          <View style={styles.languageChipsRow}>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.value}
                style={[styles.languageChip, language === lang.value && styles.languageChipActive]}
                onPress={() => setLanguage(lang.value)}
              >
                <Text style={[styles.languageChipText, language === lang.value && styles.languageChipTextActive]}>
                  {lang.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.consentRow}>
            <Switch value={consent} onValueChange={setConsent} trackColor={{ true: BRAND }} />
            <Text style={styles.consentText}>The participant consented to recording and AI processing.</Text>
          </View>
          <TouchableOpacity
            style={[styles.primaryButton, { opacity: busy || !consent ? 0.5 : 1 }]}
            disabled={busy || !consent}
            onPress={createSession}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Start recording</Text>}
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (loading || !call) {
    return (
      <View style={styles.flex}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Conversations</Text>
          </TouchableOpacity>
        </View>
        <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} />
      </View>
    );
  }

  const state = call.session_state || {};
  const summary = call.summary || {};

  // ── Live view ────────────────────────────────────────────────────────
  if (view === 'live') {
    return (
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Conversations</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Conversation</Text>
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <ScrollView
          style={styles.flex}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={BRAND} colors={[BRAND]} />}
        >
          <View style={{ padding: 16 }}>
            <View style={styles.metricsRow}>
              <Metric label="State" value={call.processing_step} />
              <Metric label="Progress" value={`${call.progress_pct || 0}%`} />
              <Metric label="Missing" value={String((state.missing_required_fields || []).length)} />
            </View>
            <View style={styles.track}><View style={[styles.trackFill, { width: `${call.progress_pct || 0}%` }]} /></View>

            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Live conversation</Text>
            {(call.turns || []).map((turn) => (
              <View
                key={turn.id}
                style={[styles.turnCard, { borderLeftColor: turn.role === 'assistant' ? BLUE : BRAND }]}
              >
                <View style={styles.turnMetaRow}>
                  <Text style={styles.turnSpeaker}>{turn.speaker}</Text>
                  <Text style={styles.turnRole}>{turn.role}</Text>
                </View>
                <Text style={styles.turnText}>{turn.transcript}</Text>
                {turn.citations?.length ? (
                  <Text style={styles.turnCitation}>
                    {turn.citations.length} workspace source{turn.citations.length === 1 ? '' : 's'} used
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </ScrollView>

        {call.processing_status === 'active' ? (
          <View style={styles.footer}>
            <TextInput
              style={styles.footerInput}
              placeholder="Type a response or use hands-free conversation"
              value={typedTurn}
              onChangeText={setTypedTurn}
              multiline
            />
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[styles.footerButton, recording ? styles.footerButtonStop : styles.footerButtonPrimary]}
                disabled={busy}
                onPress={() => recordTurn()}
              >
                <Text style={styles.footerButtonText}>{recording ? 'Pause listening' : 'Start listening'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerButton, styles.footerButtonSecondary, { opacity: busy || !typedTurn.trim() ? 0.5 : 1 }]}
                disabled={busy || !typedTurn.trim()}
                onPress={() => submitTurn({ transcript: typedTurn })}
              >
                <Text style={styles.footerButtonSecondaryText}>Send text</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerButton, styles.footerButtonFinish, { opacity: busy || recording || !call.turns?.length ? 0.5 : 1 }]}
                disabled={busy || recording || !call.turns?.length}
                onPress={() => finish()}
              >
                <Text style={styles.footerButtonText}>Finish</Text>
              </TouchableOpacity>
            </View>
            {recording ? (
              <Text style={styles.listeningHint}>Listening now. Your turn is submitted automatically after a short pause.</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  // ── Review view ──────────────────────────────────────────────────────
  return (
    <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Conversations</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Conversation</Text>
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <ScrollView
        ref={reviewScrollRef}
        style={styles.flex}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={BRAND} colors={[BRAND]} />}
      >
        <View style={{ padding: 16 }}>
          <View style={styles.metricsRow}>
            <Metric label="Status" value={call.processing_status} />
            <Metric label="Progress" value={`${call.progress_pct || 0}%`} />
            <Metric label="Duration" value={clock(call.duration_seconds)} />
          </View>
          {call.error_message ? <Text style={styles.errorText}>{call.error_message}</Text> : null}

          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Summary</Text>
          <Text style={styles.paragraph}>{summary.overview || 'Summary will appear after final processing.'}</Text>
          {(summary.key_points || []).map((point, i) => (
            <Text key={i} style={styles.point}>{point}</Text>
          ))}

          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Recording</Text>
          </View>
          {recordingUrl ? (
            <TouchableOpacity style={styles.playButton} onPress={togglePlayRecording}>
              <Text style={styles.playButtonText}>{playingRecording ? '⏸ Pause' : '▶ Play conversation recording'}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.muted}>
              {['active', 'awaiting_consent'].includes(call.processing_status)
                ? 'The recording will be available once the conversation is finished.'
                : 'Preparing the playable recording…'}
            </Text>
          )}

          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Transcript review</Text>
          {call.review_status === 'approved' ? (
            <>
              <Text style={[styles.point, { color: '#1e7e34' }]}>Approved and submitted to the workspace.</Text>
              {!call.segments?.length ? (
                <Text style={styles.muted}>Chunking and embedding are in progress.</Text>
              ) : (
                call.segments.map((seg) => (
                  <View key={seg.id} style={styles.turnCard}>
                    <View style={styles.turnMetaRow}>
                      <Text style={styles.turnSpeaker}>{seg.speaker}</Text>
                      <Text style={styles.turnRole}>{clock(seg.start_seconds)} - {clock(seg.end_seconds)}</Text>
                    </View>
                    <Text style={styles.turnText}>{seg.transcript}</Text>
                  </View>
                ))
              )}
            </>
          ) : (
            <>
              <Text style={styles.muted}>Correct the transcript below, then approve it to start chunking and embedding.</Text>
              <TextInput
                style={styles.transcriptInput}
                value={transcriptDraft}
                onChangeText={setTranscriptDraft}
                onFocus={() => setTimeout(() => reviewScrollRef.current?.scrollToEnd({ animated: true }), 80)}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.primaryButton, { opacity: busy || !transcriptDraft.trim() ? 0.5 : 1 }]}
                disabled={busy || !transcriptDraft.trim()}
                onPress={approveTranscript}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Approve and publish</Text>}
              </TouchableOpacity>
            </>
          )}

          <View style={styles.dangerRow}>
            <TouchableOpacity style={styles.secondaryButton} disabled={busy} onPress={retry}>
              <Text style={styles.secondaryButtonText}>Retry</Text>
            </TouchableOpacity>
            {confirmDelete ? (
              <TouchableOpacity style={styles.dangerButton} disabled={busy} onPress={remove}>
                <Text style={styles.dangerButtonText}>Yes, delete everything</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.dangerButton} disabled={busy} onPress={() => setConfirmDelete(true)}>
                <Text style={styles.dangerButtonText}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value ?? '-'}</Text>
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
  message: { padding: 10, margin: 12, marginBottom: 0, backgroundColor: '#fff7e6', color: '#a06a00', borderRadius: 10, fontSize: 12.5 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#14181f', marginBottom: 10 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 },
  languageChipsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  languageChip: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
    marginRight: 8, marginBottom: 8, backgroundColor: '#fff',
  },
  languageChipActive: { backgroundColor: BRAND, borderColor: BRAND },
  languageChipText: { fontSize: 12, color: '#374151', fontWeight: '600' },
  languageChipTextActive: { color: '#fff' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 20 },
  consentText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 18 },
  primaryButton: { backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryButton: { borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#fff' },
  secondaryButtonText: { color: '#374151', fontWeight: '700', fontSize: 13 },
  dangerRow: { flexDirection: 'row', gap: 10, marginTop: 24, marginBottom: 10 },
  dangerButton: { borderWidth: 1, borderColor: '#f1c0c0', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#fdecea' },
  dangerButtonText: { color: RED, fontWeight: '700', fontSize: 13 },
  metricsRow: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#e2e5ea' },
  metricLabel: { fontSize: 10, color: '#9aa3b2', fontWeight: '700', textTransform: 'uppercase' },
  metricValue: { fontSize: 14, fontWeight: '700', color: '#14181f', marginTop: 4 },
  track: { height: 7, marginTop: 10, borderRadius: 4, backgroundColor: '#e2e5ea', overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: BRAND },
  turnCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 3, borderWidth: 1, borderColor: '#e2e5ea' },
  turnMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  turnSpeaker: { fontSize: 12, fontWeight: '700', color: '#14181f' },
  turnRole: { fontSize: 11, color: '#9aa3b2' },
  turnText: { fontSize: 13.5, color: '#374151', lineHeight: 19 },
  turnCitation: { fontSize: 11, color: BLUE, marginTop: 6 },
  paragraph: { fontSize: 13.5, color: '#374151', lineHeight: 20 },
  point: { fontSize: 13, color: '#374151', backgroundColor: '#fff', padding: 10, borderRadius: 8, marginTop: 6 },
  muted: { fontSize: 12.5, color: '#9aa3b2', marginBottom: 10 },
  errorText: { fontSize: 12.5, color: RED, marginTop: 8 },
  transcriptInput: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 12, padding: 12, minHeight: 220, fontSize: 13.5,
    color: '#14181f', backgroundColor: '#fff', marginBottom: 12, lineHeight: 19,
  },
  playButton: { backgroundColor: BLUE, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  playButtonText: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  footer: {
    padding: 12, borderTopWidth: 1, borderTopColor: '#e2e5ea', backgroundColor: '#fff',
  },
  footerInput: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, maxHeight: 90, marginBottom: 10, color: '#14181f',
  },
  footerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  footerButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  footerButtonPrimary: { backgroundColor: BRAND },
  footerButtonStop: { backgroundColor: RED },
  footerButtonFinish: { backgroundColor: BLUE },
  footerButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  footerButtonSecondary: { backgroundColor: '#f0f1f4' },
  footerButtonSecondaryText: { color: '#374151', fontWeight: '700', fontSize: 13 },
  listeningHint: { fontSize: 12, color: BRAND, marginTop: 8 },
});
