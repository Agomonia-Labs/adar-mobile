import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Audio } from 'expo-av';
import { AxiosInstance } from 'axios';
import { transcribeVoice } from './eatsApi';

const BRAND = '#1b2430';

/** Mic button: record -> stop -> POST /api/voice/transcribe -> hand the
 *  transcribed text back to the caller. One-shot (record a clip, upload
 *  the whole file), not live streaming -- matches routes/voice.py. Ported
 *  from apps/docintel/src/VoiceRecorderButton.tsx, the same pattern
 *  already proven there; `sttHint` is the caller's current language's
 *  plain-language hint (i18n/languages.ts), so the diner doesn't have to
 *  be speaking English for this to transcribe well. */
export function VoiceRecorderButton({
  client,
  accessToken,
  sttHint,
  onTranscribed,
  disabled,
}: {
  client: AxiosInstance;
  accessToken: string;
  sttHint: string;
  onTranscribed: (text: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recordingRef = useRef<Audio.Recording | null>(null);

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone access needed', 'Allow microphone access to ask a question by voice.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setState('recording');
    } catch (err) {
      Alert.alert('Could not start recording', String((err as Error)?.message || err));
    }
  };

  const stopAndTranscribe = async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) {
      setState('idle');
      return;
    }
    setState('transcribing');
    try {
      try {
        await recording.stopAndUnloadAsync();
      } finally {
        // Always relinquish the recording audio-session category, even if
        // stopAndUnloadAsync() itself throws -- expo-av's audio mode is a
        // global/singleton setting, so leaving allowsRecordingIOS stuck
        // "true" can mute playback elsewhere in the app (same issue
        // DocIntel's VoiceRecorderButton documents).
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      }
      const uri = recording.getURI();
      if (!uri) throw new Error('Recording produced no audio file');
      // expo-av's HIGH_QUALITY preset records .m4a; iOS reports the
      // multipart Content-Type as 'audio/x-m4a' regardless of what's
      // declared here, which the backend already normalizes.
      const { text } = await transcribeVoice(
        client,
        accessToken,
        { uri, mimeType: 'audio/mp4', name: 'voice-input.m4a' },
        sttHint
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
