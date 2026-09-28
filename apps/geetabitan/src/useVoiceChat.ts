import { useCallback, useRef, useState } from 'react';
import { Audio, AVPlaybackStatus } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import type { ChatMessage } from '@adar/shared-chat';

// This hook -- and its expo-av / expo-file-system imports -- deliberately
// lives in the app, not in @adar/shared-chat: shared-chat's api.ts already
// notes it keeps voice's HTTP calls generic on purpose "to avoid forcing
// an expo-av dependency on apps that don't need voice" (ARCL/FrontDesk
// don't, today). Geetabitan is voice-first, so it owns the native audio
// dependency and composes it with the shared chat hooks itself (see
// GuestHomeScreen.tsx / HomeScreen.tsx).

export interface VoiceChatOptions {
  /** BCP-47 language tag sent to both STT and TTS, e.g. 'bn-IN'. */
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
// pydub) for exactly this reason: a native recorder hands it AAC, not the
// webm/opus a browser MediaRecorder produces.
const RECORDING_MIME = 'audio/mp4';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

// adar-core's guest voice routes (and, more generally, any Cloud Run
// service that scales to zero) can return a transient 502/503/504 on the
// very first request after the container has been idle -- the gateway
// gives up waiting for a cold start, not because anything is actually
// broken. One quiet retry after a short pause clears this without
// bothering the user; a real, persistent failure still surfaces normally
// on the second attempt.
// A Cloud Run service with no minimum instances scales back to zero within
// minutes of no traffic, so almost any real-world gap between voice
// requests (reading a reply, thinking of the next question) can trigger a
// fresh cold start on the *next* one. A Python/ADK backend like this one
// commonly takes several seconds to come up -- a single quick retry isn't
// reliably enough. Retry up to twice more with growing backoff (2s, 4s)
// before giving up and surfacing an error.
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
  // a fresh request id and (synchronously) the message id it's working on.
  // Any earlier request whose async work (network synth, then sound loading)
  // finishes after it's been superseded checks this and discards its result
  // instead of starting playback -- which is what let two taps' audio play
  // over each other before (the previous guard only compared against
  // playingMessageId, which isn't set until AFTER synth+load complete, so a
  // second tap made while the first was still loading saw no conflict at all).
  const requestIdRef = useRef(0);
  const loadingMessageIdRef = useRef<string | null>(null);

  const stopPlayback = useCallback(async () => {
    // Invalidate any in-flight synth/playback request so it can't start
    // (or keep playing) after this call.
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
      console.error('[geetabitan] failed to start recording:', err);
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
      console.error('[geetabitan] voice input failed:', err);
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
      // Tapping the message that's already playing OR still being loaded
      // (synth/network in flight) stops/cancels it -- same "tap to stop"
      // behavior as before, just now also reachable during the loading phase.
      if (playingMessageId === message.id || loadingMessageIdRef.current === message.id) {
        await stopPlayback();
        return;
      }
      // Stop whatever else is playing or loading, THEN claim this request --
      // synchronously, before any `await` -- so a rapid second tap (on this
      // message or another) is guaranteed to see a request id that has
      // already moved past this one, rather than a race where two calls
      // both think they're the current request.
      await stopPlayback();
      const myRequestId = ++requestIdRef.current;
      loadingMessageIdRef.current = message.id;
      setBusy(true);
      setError(null);
      try {
        const audioBase64 = await withColdStartRetry(() => synthesize(message.text, lang));
        // Superseded (user tapped elsewhere, or stopped) while we were
        // waiting on the network -- discard this stale result instead of
        // starting playback for a tap that's no longer current.
        if (requestIdRef.current !== myRequestId) return;

        // iOS's AVURLAsset (which expo-av uses under the hood) does not
        // support "data:" URIs -- Audio.Sound.createAsync silently no-ops
        // on a data URI on iOS (works fine on Android/web, which is why
        // this can look like it "just doesn't do anything" rather than
        // erroring). Writing the bytes to a real file and playing that
        // file:// URI instead sidesteps the bug entirely.
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
          // Superseded while the sound was loading -- don't let a second,
          // now-orphaned player start (this is what caused two clips to
          // audibly collide). Unload it immediately instead.
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
        console.error('[geetabitan] voice playback failed:', err);
        if (requestIdRef.current === myRequestId) setError('Could not play that reply.');
      } finally {
        if (requestIdRef.current === myRequestId) setBusy(false);
      }
    },
    [lang, playingMessageId, stopPlayback, synthesize]
  );

  return { recording, busy, playingMessageId, error, toggleRecord, playMessage };
}
