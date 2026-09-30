import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Audio } from 'expo-av';
import { useAuth } from '@adar/shared-auth';
import { transcribeVoice } from './docintelApi';
import { useLanguage } from './i18n/LanguageContext';

const BRAND = '#2e7d4f';

/** Mic button: record -> stop -> POST /api/voice/transcribe -> hand the
 *  transcribed text back to the caller. One-shot (record a clip, upload
 *  the whole file), not live streaming -- matches routes/voice.py.
 *  Reused by ChatScreen's input row, the video "ask about this video" box,
 *  and Academy's ask-a-question box. */
export function VoiceRecorderButton({
  onTranscribed,
  disabled,
}: {
  onTranscribed: (text: string) => void;
  disabled?: boolean;
}) {
  const { client, session } = useAuth();
  const { meta, t } = useLanguage();
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recordingRef = useRef<Audio.Recording | null>(null);

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('voiceMicPermission'), t('voiceMicPermissionBody'));
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setState('recording');
    } catch (err) {
      Alert.alert(t('voiceRecordingFailed'), String((err as Error)?.message || err));
    }
  };

  const stopAndTranscribe = async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording || !session) {
      setState('idle');
      return;
    }
    setState('transcribing');
    try {
      try {
        await recording.stopAndUnloadAsync();
      } finally {
        // Always relinquish the recording audio-session category, even if
        // stopAndUnloadAsync() itself throws. expo-av's audio mode is a
        // GLOBAL/singleton setting (see VideoDetailScreen.tsx) -- if this
        // never runs, allowsRecordingIOS stays stuck "true" for the rest
        // of the app session, which is what was actually silencing video
        // playback in the Video tab (confirmed: same file played fine in
        // a separate browser tab, which has its own isolated audio
        // session, so the video file itself was never the problem).
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      }
      const uri = recording.getURI();
      if (!uri) throw new Error('Recording produced no audio file');
      // expo-av's HIGH_QUALITY preset records .m4a. We declare the part's
      // type as 'audio/mp4' below, but on-device iOS ignores that and
      // reports the multipart Content-Type as 'audio/x-m4a' (an
      // Apple-specific MIME alias) regardless of what JS asks for -- the
      // backend normalizes that alias (and a couple of others) back to
      // 'audio/mp4' before validating, so don't rely on this declared
      // type matching what the server actually sees.
      // Tell the backend's Gemini-based transcription what language to
      // expect (see docintelApi.ts's transcribeVoice comment) -- without
      // this it has to guess, which gets noticeably worse for Hindi/
      // Bengali audio once English is also a plausible guess.
      const { text } = await transcribeVoice(
        client,
        session.accessToken,
        { uri, mimeType: 'audio/mp4', name: 'voice-input.m4a' },
        meta.sttHint
      );
      if (text && text.trim()) {
        onTranscribed(text.trim());
      } else {
        Alert.alert('No speech detected', 'Try recording again, a little closer to the microphone.');
      }
    } catch (err: any) {
      Alert.alert('Transcription failed', err?.response?.data?.detail || err?.message || 'Please try again.');
    } finally {
      setState('idle');
    }
  };

  if (state === 'transcribing') {
    return (
      <TouchableOpacity style={[styles.button, styles.buttonBusy]} disabled>
        <ActivityIndicator size="small" color="#fff" />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.button, state === 'recording' && styles.buttonRecording, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={state === 'recording' ? stopAndTranscribe : startRecording}
    >
      <Text style={[styles.icon, state === 'recording' && styles.iconRecording]}>{state === 'recording' ? '■' : '🎤'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#eef1f0',
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  buttonRecording: { backgroundColor: '#c0392b' },
  buttonBusy: { backgroundColor: BRAND },
  buttonDisabled: { opacity: 0.5 },
  icon: { fontSize: 18, color: '#14181f' },
  iconRecording: { color: '#fff' },
});
