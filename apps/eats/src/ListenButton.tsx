import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Speech from 'expo-speech';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { AxiosInstance } from 'axios';
import { speakText } from './eatsApi';
import { LanguageMeta, SERVER_TTS_LANGUAGES } from './i18n/languages';

/** Reads an assistant reply aloud, in whichever language it was answered
 *  in -- on-device via expo-speech for most languages, server-side Google
 *  TTS (routes/voice.py's /speak, same voices Geetabitan/Front Desk use)
 *  for the ones with a known better voice there (currently just Bengali).
 *  Ported from apps/docintel/src/AnswerFeedback.tsx's toggleSpeak, minus
 *  the eval-scoring/thumbs row that's specific to DocIntel's chat. */
export function ListenButton({
  client,
  accessToken,
  text,
  meta,
}: {
  client: AxiosInstance;
  accessToken: string;
  text: string;
  meta: LanguageMeta;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const unloadSound = async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        // already unloaded/unmounted
      }
    }
  };

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

    if (SERVER_TTS_LANGUAGES.has(meta.code)) {
      setSynthesizing(true);
      setError(null);
      try {
        const { audioBase64, mimeType } = await speakText(client, accessToken, text, meta.code);
        await unloadSound();
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        const { sound } = await Audio.Sound.createAsync(
          { uri: `data:${mimeType};base64,${audioBase64}` },
          { shouldPlay: true }
        );
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
        setSynthesizing(false);
        setSpeaking(false);
        setError(err?.response?.data?.detail || err?.message || 'Could not read this aloud.');
      }
      return;
    }

    setSpeaking(true);
    Speech.speak(text, {
      language: meta.ttsLocale,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  return (
    <TouchableOpacity
      onPress={toggleSpeak}
      disabled={synthesizing}
      style={[styles.button, (speaking || synthesizing) && styles.buttonActive]}
    >
      {synthesizing ? (
        <ActivityIndicator size="small" color="#5b6472" />
      ) : (
        <Text style={styles.text} numberOfLines={1}>
          {error ? `⚠️ ${error}` : speaking ? '\u{1F507} Stop' : '\u{1F50A} Listen'}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start', borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#fff', marginTop: 6,
  },
  buttonActive: { borderColor: '#1b2430', backgroundColor: 'rgba(27,36,48,0.06)' },
  text: { fontSize: 11, fontWeight: '600', color: '#5b6472', maxWidth: 220 },
});
