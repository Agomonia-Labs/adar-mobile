import { useCallback, useRef, useState } from 'react';
import { Audio, AVPlaybackStatus } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import type { ChatMessage } from '@adar/shared-chat';

// Lives in the app, not in @adar/shared-chat, same reasoning as
// apps/geetabitan/src/useVoiceChat.ts: keeps the expo-av/expo-file-system
// dependency out of apps that don't need voice (ARCL today).

export interface VoiceChatOptions {
  /** BCP-47 language tag sent to both STT and TTS, e.g. 'en-US'. */
  lang: string;
  /** Uploads a recorded clip and returns the transcript. */
  transcribe: (audioBase64: string, mime: string, lang: string) => Promise<string>;
  /** Requests spoken audio for a line of text; returns base64-encoded MP3. */
  synthesize: (text: string, lang: string) => Promise<string>;
  /** Sends the transcribed text into the conversation, same as typing it. */
  send: (text: string) => Promise<void>;
}

export interface VoiceChatResult {
  recording: boolean;
  busy: boolean;
  playingMessageId: string | null;
  error: string | null;
  toggleRecord: () => void;
  playMessage: (message: ChatMessage) => void;
}

// iOS's default HIGH_QUALITY preset records to .m4a (AAC) -- matches what
// adar-core/api/main.py's /stt already special-cases (mp4/aac -> flac via
// pydub) for exactly this reason.
const RECORDING_MIME = 'audio/mp4';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

// A Cloud Run service with no minimum instances scales to zero within
// minutes of no traffic, so almost any real-world gap between voice
// requests can trigger a fresh cold start on the next one. Retry up to
// twice more with growing backoff (2s, 4s) before giving up.
const COLD_START_RETRY_DELAYS_MS = [2000, 4000];

async function withColdStartRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (const delay of COLD_START_RETRY_DELAYS_MS) {
    try {
      return await fn();
    } catch (err) {
      const status = statusOf(err);
      if (status !== 502 && status !== 503 && status !== 504) throw err;
      await sleep(delay);
    }
  }
  return await fn();
}

export function useVoiceChat({ lang, transcribe, synthesize, send }: VoiceChatOptions): VoiceChatResult {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const playbackFileRef = useRef<string | null>(null);
  // Guards against overlapping "Listen" taps: each call to playMessage claims
  // a fresh request id and (synchronously) the message id it's working on,
  // so a stale async response from a superseded tap never starts playback --
  // two taps' audio can no longer play over each other.
  const requestIdRef = useRef(0);
  const loadingMessageIdRef = useRef<string | null>(null);

  const stopPlayback = useCallback(async () => {
    requestIdRef.current += 1;
    loadingMessageIdRef.current = null;
    const sound = soundRef.current;
    soundRef.current = null;
    setPlayingMessageId(null);
    if (sound) {
      try {
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch {
        // already stopped/unloaded -- nothing left to clean up
      }
    }
    const file = playbackFileRef.current;
    playbackFileRef.current = null;
    if (file) {
      FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {
        // best-effort cache cleanup -- a leftover temp file isn't worth surfacing
      });
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone permission is needed to ask by voice.');
        return;
      }
      await stopPlayback();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = rec;
      setRecording(true);
    } catch (err) {
      console.error('[frontdesk] failed to start recording:', err);
      setError('Could not start recording. Please try again.');
    }
  }, [stopPlayback]);

  const stopRecordingAndSend = useCallback(async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!rec) return;

    setBusy(true);
    setError(null);
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      if (!uri) throw new Error('Recording produced no file');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const text = await withColdStartRetry(() => transcribe(base64, RECORDING_MIME, lang));
      if (text.trim()) {
        await send(text.trim());
      } else {
        setError("Didn't catch that -- try again?");
      }
    } catch (err) {
      console.error('[frontdesk] voice input failed:', err);
      setError('Could not understand that. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [lang, transcribe, send]);

  const toggleRecord = useCallback(() => {
    if (recording) {
      stopRecordingAndSend();
    } else {
      startRecording();
    }
  }, [recording, startRecording, stopRecordingAndSend]);

  const playMessage = useCallback(
    async (message: ChatMessage) => {
      // Tapping the message that's already playing OR still loading
      // (synth/network in flight) stops/cancels it.
      if (playingMessageId === message.id || loadingMessageIdRef.current === message.id) {
        await stopPlayback();
        return;
      }
      // Stop whatever else is playing or loading, THEN claim this request --
      // synchronously, before any `await` -- so a rapid second tap is
      // guaranteed to see a request id that has already moved past this one.
      await stopPlayback();
      const myRequestId = ++requestIdRef.current;
      loadingMessageIdRef.current = message.id;
      setBusy(true);
      setError(null);
      try {
        const audioBase64 = await withColdStartRetry(() => synthesize(message.text, lang));
        if (requestIdRef.current !== myRequestId) return; // superseded while waiting on the network

        // iOS's AVURLAsset does not support "data:" URIs -- write the bytes
        // to a real file and play that file:// URI instead.
        const fileUri = `${FileSystem.cacheDirectory}adar-tts-${message.id}-${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(fileUri, audioBase64, { encoding: FileSystem.EncodingType.Base64 });
        if (requestIdRef.current !== myRequestId) {
          FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
          return;
        }
        playbackFileRef.current = fileUri;

        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync({ uri: fileUri }, { shouldPlay: true });
        if (requestIdRef.current !== myRequestId) {
          // Superseded while the sound was loading -- unload immediately
          // rather than letting a second, orphaned player start (this is
          // what previously caused two clips to audibly collide).
          try {
            await sound.unloadAsync();
          } catch {
            // ignore
          }
          return;
        }
        soundRef.current = sound;
        loadingMessageIdRef.current = null;
        setPlayingMessageId(message.id);
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (status.isLoaded && status.didJustFinish) {
            stopPlayback();
          }
        });
      } catch (err) {
        console.error('[frontdesk] voice playback failed:', err);
        if (requestIdRef.current === myRequestId) setError('Could not play that reply.');
      } finally {
        if (requestIdRef.current === myRequestId) setBusy(false);
      }
    },
    [lang, playingMessageId, stopPlayback, synthesize]
  );

  return { recording, busy, playingMessageId, error, toggleRecord, playMessage };
}
