import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AxiosInstance } from 'axios';
import * as Speech from 'expo-speech';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { EvalType, QuickScoreResult, quickScore, speakText, submitFeedback } from './docintelApi';
import { useLanguage } from './i18n/LanguageContext';

// Languages with a proven, higher-quality server-side voice (same ones
// adar-core's Geetabitan/Front Desk TTS use -- see routes/voice.py's
// TTS_VOICE_BY_LANGUAGE) go through /api/voice/speak instead of
// expo-speech's on-device synthesis. Bangla is the one this was actually
// requested for (expo-speech's on-device Bangla voice isn't the male
// Chirp3-HD-Fenrir voice Geetabitan uses, and has no real paragraph/line
// pausing); everything else keeps using on-device TTS unchanged.
const SERVER_TTS_LANGUAGES = new Set(['bn']);

const EVAL_META_KEYS: Record<string, { icon: string; labelKey: 'evalRelevance' | 'evalSpecificity' | 'evalConfidence' | 'evalCoherence' }> = {
  relevance: { icon: '\u{1F3AF}', labelKey: 'evalRelevance' },
  specificity: { icon: '\u{1F50D}', labelKey: 'evalSpecificity' },
  confidence: { icon: '⚖️', labelKey: 'evalConfidence' },
  coherence: { icon: '\u{1F9E9}', labelKey: 'evalCoherence' },
};

function gradeColor(score: number | null | undefined) {
  if (score == null) return '#6b7280';
  if (score >= 4) return '#2e7d4f';
  if (score >= 3) return '#b8860b';
  return '#c0392b';
}

const DEFAULT_EVAL_TYPES: EvalType[] = ['relevance', 'specificity', 'confidence'];

/** Thumbs up/down + auto-run relevance/specificity/confidence eval badges,
 *  shown under every AI-generated answer (chat replies, summaries,
 *  comparisons) -- mirrors the web app's ChatTab.jsx (Msg's feedback row +
 *  EvalBadges component), reusing the same backend endpoints
 *  (/api/feedback, /api/evals/quick-score) so scores and ratings from the
 *  mobile app land in the same admin feedback summary.
 *
 *  Tapping a badge expands an inline panel right below it showing WHY the
 *  model gave that score -- the quick-score endpoint already returns a
 *  `reasoning` string per eval type, this just surfaces it (previously
 *  fetched and discarded). Tap the same badge again, or a different one,
 *  to collapse/switch. */
export function AnswerFeedback({
  client,
  accessToken,
  messageId,
  question,
  answer,
  evalTypes = DEFAULT_EVAL_TYPES,
  active = true, // gate eval auto-run until the answer has finished streaming
}: {
  client: AxiosInstance;
  accessToken: string;
  messageId: string;
  question: string;
  answer: string;
  evalTypes?: EvalType[];
  active?: boolean;
}) {
  const { t, meta, language } = useLanguage();
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [scores, setScores] = useState<Record<string, QuickScoreResult> | null>(null);
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  // Only meaningful for the server-TTS path: true while waiting on
  // /api/voice/speak's network round-trip, before playback has actually
  // started (on-device expo-speech has no equivalent step -- it starts
  // talking immediately, so this stays false on that path).
  const [synthesizing, setSynthesizing] = useState(false);
  // Surfaced only for the server-TTS (Bangla) path -- a failed fetch or a
  // playback error used to just silently reset the button, which looked
  // identical to "I pressed Listen and nothing happened." Mirrors the
  // eval scoring row's scoreError pattern just below.
  const [speakError, setSpeakError] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const unloadSound = async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        // already unloaded/unmounted -- nothing to clean up
      }
    }
  };

  // Read the answer aloud in the same language the answer itself was
  // requested in (Profile's language picker -- see docintelApi.ts's
  // streamChat responseLanguage). Stopping on unmount avoids a message
  // still talking after the user has scrolled or navigated away.
  useEffect(() => {
    return () => {
      Speech.stop();
      unloadSound();
    };
  }, []);

  const toggleSpeak = async () => {
    if (speaking || synthesizing) {
      Speech.stop();
      await unloadSound();
      setSpeaking(false);
      setSynthesizing(false);
      return;
    }

    if (SERVER_TTS_LANGUAGES.has(language)) {
      setSynthesizing(true);
      setSpeakError(null);
      try {
        console.log('[AnswerFeedback] calling speakText', { language, answerLen: answer.length });
        const { audioBase64, mimeType } = await speakText(client, accessToken, answer, language);
        console.log('[AnswerFeedback] speakText resolved', { mimeType, audioBase64Len: audioBase64?.length });
        await unloadSound(); // in case a previous clip is still loaded
        console.log('[AnswerFeedback] calling Audio.setAudioModeAsync');
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        console.log('[AnswerFeedback] setAudioModeAsync resolved, calling Audio.Sound.createAsync');
        const { sound } = await Audio.Sound.createAsync(
          { uri: `data:${mimeType};base64,${audioBase64}` },
          { shouldPlay: true }
        );
        console.log('[AnswerFeedback] Sound.createAsync resolved');
        soundRef.current = sound;
        setSynthesizing(false);
        setSpeaking(true);
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (status.isLoaded && status.didJustFinish) {
            setSpeaking(false);
            unloadSound();
          }
        });
      } catch (err: any) {
        console.warn('[AnswerFeedback] speakText failed:', err?.response?.data?.detail || err?.message || err);
        setSynthesizing(false);
        setSpeaking(false);
        setSpeakError(t('speakFailed'));
      }
      return;
    }

    setSpeaking(true);
    Speech.speak(answer, {
      language: meta.ttsLocale,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  useEffect(() => {
    if (!active || !answer) return;
    let cancelled = false;
    setScoring(true);
    setScoreError(null);
    quickScore(client, accessToken, question, answer, evalTypes)
      .then((s) => { if (!cancelled) setScores(s); })
      .catch((err) => {
        if (cancelled) return;
        // Eval scoring is non-critical to the chat answer itself, so this
        // never blocks or errors the message -- but it used to fail totally
        // silently, which looked identical to "the badges just don't show
        // up". Surface a short reason instead (console for the full detail,
        // a small inline note so it's visible without opening dev tools),
        // and let the person retry rather than being stuck looking at a
        // dead-end warning (or, before this, an indefinite spinner if the
        // request timed out slowly rather than failing fast).
        const timedOut = err?.code === 'ECONNABORTED';
        const detail = timedOut
          ? t('evalScoringTimedOut')
          : err?.response?.data?.detail || err?.message || 'unknown error';
        console.warn('[AnswerFeedback] quick-score failed:', detail);
        setScoreError(typeof detail === 'string' ? detail : t('evalScoringFailed'));
      })
      .finally(() => { if (!cancelled) setScoring(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, answer, retryCount]);

  const rate = (value: 1 | -1) => {
    if (rating === value) return;
    const prev = rating;
    setRating(value);
    submitFeedback(client, accessToken, { messageId, rating: value, question, answer }).catch(() => {
      setRating(prev); // revert on failure
    });
  };

  if (!answer) return null;

  const activeDetail = expanded && scores ? scores[expanded] : null;
  const activeMetaRaw = expanded ? EVAL_META_KEYS[expanded] : null;
  const activeMeta = activeMetaRaw ? { icon: activeMetaRaw.icon, label: t(activeMetaRaw.labelKey) } : expanded ? { icon: '\u{1F4CA}', label: expanded } : null;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TouchableOpacity
          onPress={toggleSpeak}
          disabled={synthesizing}
          style={[styles.speakButton, (speaking || synthesizing) && styles.speakButtonActive]}
        >
          {synthesizing ? (
            <ActivityIndicator size="small" color="#5b6472" />
          ) : (
            <Text style={styles.speakButtonText}>{speaking ? `\u{1F507} ${t('stopListening')}` : `\u{1F50A} ${t('listen')}`}</Text>
          )}
        </TouchableOpacity>
        {speakError ? (
          <TouchableOpacity onPress={toggleSpeak} style={styles.speakErrorWrap}>
            <Text style={styles.evalErrorText} numberOfLines={1}>
              {'\u26A0\uFE0F'} {speakError}
            </Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.thumbsRow}>
          <TouchableOpacity
            onPress={() => rate(1)}
            style={[styles.thumbButton, rating === 1 && styles.thumbButtonUpActive, rating === -1 && styles.thumbButtonDim]}
          >
            <Text style={styles.thumbText}>{'\u{1F44D}'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => rate(-1)}
            style={[styles.thumbButton, rating === -1 && styles.thumbButtonDownActive, rating === 1 && styles.thumbButtonDim]}
          >
            <Text style={styles.thumbText}>{'\u{1F44E}'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.evalRow}>
          <Text style={styles.evalLabel}>{t('evalLabel')}</Text>
          {scoring ? (
            <ActivityIndicator testID="eval-spinner" size="small" color="#5b6472" />
          ) : scoreError ? (
            <TouchableOpacity onPress={() => setRetryCount((n) => n + 1)}>
              <Text style={styles.evalErrorText} numberOfLines={1}>
                {'\u26A0\uFE0F'} {scoreError}
              </Text>
            </TouchableOpacity>
          ) : (
            scores &&
            evalTypes.map((etype) => {
              const s = scores[etype];
              const metaRaw = EVAL_META_KEYS[etype];
              const evalMeta = metaRaw ? { icon: metaRaw.icon, label: t(metaRaw.labelKey) } : { icon: '\u{1F4CA}', label: etype };
              const color = gradeColor(s?.score);
              const isOpen = expanded === etype;
              return (
                <TouchableOpacity
                  key={etype}
                  onPress={() => setExpanded(isOpen ? null : etype)}
                  style={[styles.badge, { borderColor: color }, isOpen && { backgroundColor: `${color}1A` }]}
                >
                  <Text style={styles.badgeIcon}>{evalMeta.icon}</Text>
                  <Text style={[styles.badgeScore, { color }]}>{s?.score ?? '—'}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </View>

      {activeDetail && activeMeta ? (
        <View style={[styles.detailPanel, { borderColor: gradeColor(activeDetail.score) }]}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>
              {activeMeta.icon} {activeMeta.label} {'—'} {activeDetail.score ?? '—'}/5
              {activeDetail.verdict ? `  ·  ${activeDetail.verdict}` : ''}
            </Text>
            <TouchableOpacity onPress={() => setExpanded(null)}>
              <Text style={styles.detailClose}>{'✕'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.detailReasoning}>
            {activeDetail.reasoning || t('evalNoExplanation')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  thumbsRow: { flexDirection: 'row', gap: 4 },
  speakButton: {
    borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#fff',
  },
  speakButtonActive: { borderColor: '#2e7d4f', backgroundColor: 'rgba(46,125,79,0.1)' },
  speakButtonText: { fontSize: 11, fontWeight: '600', color: '#5b6472' },
  speakErrorWrap: { maxWidth: 180 },
  thumbButton: {
    borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#fff',
  },
  thumbButtonUpActive: { borderColor: '#2e7d4f', backgroundColor: 'rgba(46,125,79,0.1)' },
  thumbButtonDownActive: { borderColor: '#c0392b', backgroundColor: 'rgba(192,57,43,0.08)' },
  thumbButtonDim: { opacity: 0.4 },
  thumbText: { fontSize: 13 },
  evalRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  evalLabel: { fontSize: 9.5, fontWeight: '700', color: '#9aa1ab', letterSpacing: 0.4 },
  evalErrorText: { fontSize: 10.5, color: '#c0392b', flexShrink: 1 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 7, paddingVertical: 2, backgroundColor: '#fff',
  },
  badgeIcon: { fontSize: 10 },
  badgeScore: { fontSize: 10.5, fontWeight: '700' },
  detailPanel: {
    marginTop: 8, borderWidth: 1, borderRadius: 10, padding: 10, backgroundColor: '#fff',
  },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  detailTitle: { fontSize: 11.5, fontWeight: '700', color: '#14181f', flex: 1, marginRight: 8 },
  detailClose: { fontSize: 12, color: '#9aa1ab', paddingHorizontal: 4 },
  detailReasoning: { fontSize: 12.5, lineHeight: 18, color: '#5b6472' },
});
