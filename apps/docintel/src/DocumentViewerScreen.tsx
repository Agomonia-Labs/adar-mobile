import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio, ResizeMode, Video } from 'expo-av';
import { WebView } from 'react-native-webview';
import { useAuth } from '@adar/shared-auth';
import { DocIntelDocument, extractDocIntelError, getDocumentViewUrl } from './docintelApi';

const BRAND = '#2e7d4f';

const OFFICE_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

/** Inline preview for the original file behind a document (routes/documents.py's
 *  /view-url returns a time-limited signed GCS URL) -- covers every file type
 *  DocumentsScreen accepts on upload: PDF (WebView renders it natively),
 *  Office docs (via Google's embeddable viewer, same trick most mobile apps
 *  use since there's no native Office renderer), audio and video (native
 *  players via expo-av, the same package VoiceRecorderButton already uses
 *  for recording), and images. Independent of chunking/embedding status --
 *  this is the ORIGINAL file, not the extracted/indexed text. */
export function DocumentViewerScreen({ doc, onBack }: { doc: DocIntelDocument; onBack: () => void }) {
  const { client, session } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!session) return;
    getDocumentViewUrl(client, session.accessToken, doc.id)
      .then((res) => { if (!cancelled) setUrl(res.url); })
      .catch((err) => { if (!cancelled) setError(extractDocIntelError(err, 'Could not open this file.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, session, doc.id]);

  const fileType = doc.file_type || '';

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{doc.original_name}</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : error || !url ? (
        <Text style={styles.errorText}>{error || 'This file could not be opened.'}</Text>
      ) : fileType.startsWith('video/') ? (
        <VideoPlayer url={url} />
      ) : fileType.startsWith('audio/') ? (
        <AudioPlayer url={url} name={doc.original_name} />
      ) : fileType === 'application/pdf' ? (
        <WebView source={{ uri: url }} style={styles.flex} startInLoadingState renderLoading={() => <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />} />
      ) : OFFICE_TYPES.includes(fileType) ? (
        <WebView
          source={{ uri: `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}` }}
          style={styles.flex}
          startInLoadingState
          renderLoading={() => <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />}
        />
      ) : fileType.startsWith('image/') ? (
        <Image source={{ uri: url }} style={styles.image} resizeMode="contain" />
      ) : (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>ADAR can't preview this file type ({fileType || 'unknown'}) inline yet.</Text>
          <TouchableOpacity style={styles.openButton} onPress={() => Linking.openURL(url)}>
            <Text style={styles.openButtonText}>Open in browser</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function VideoPlayer({ url }: { url: string }) {
  return (
    <View style={styles.videoWrap}>
      <Video
        source={{ uri: url }}
        style={styles.video}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay={false}
      />
    </View>
  );
}

function AudioPlayer({ url, name }: { url: string; name: string }) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
    Audio.Sound.createAsync({ uri: url }, { shouldPlay: false }, (status) => {
      if (cancelled || !status.isLoaded) return;
      setPositionMs(status.positionMillis || 0);
      setDurationMs(status.durationMillis || 0);
      setPlaying(status.isPlaying);
    })
      .then(({ sound }) => {
        if (cancelled) { sound.unloadAsync(); return; }
        soundRef.current = sound;
        setLoaded(true);
      })
      .catch((err) => setError(err?.message || 'Could not load audio.'));
    return () => {
      cancelled = true;
      soundRef.current?.unloadAsync();
    };
  }, [url]);

  const toggle = async () => {
    const sound = soundRef.current;
    if (!sound) return;
    if (playing) await sound.pauseAsync();
    else await sound.playAsync();
  };

  const format = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.audioWrap}>
      <View style={styles.audioIconCircle}>
        <Text style={styles.audioIcon}>🎵</Text>
      </View>
      <Text style={styles.audioName} numberOfLines={2}>{name}</Text>
      {error ? (
        <Text style={styles.errorTextSmall}>{error}</Text>
      ) : !loaded ? (
        <ActivityIndicator color={BRAND} style={{ marginTop: 16 }} />
      ) : (
        <>
          <TouchableOpacity style={styles.playButton} onPress={toggle}>
            <Text style={styles.playButtonText}>{playing ? '❚❚ Pause' : '▶ Play'}</Text>
          </TouchableOpacity>
          <Text style={styles.audioTime}>{format(positionMs)} / {format(durationMs)}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e2e5ea', backgroundColor: '#fff',
  },
  backButton: { marginRight: 10, paddingTop: 2 },
  backButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  // No numberOfLines cap -- the full file name must stay visible once a
  // content item is tapped and this viewer opens, not cut off at one line.
  headerTitle: { fontSize: 14, fontWeight: '600', color: '#14181f', flex: 1, flexWrap: 'wrap' },
  errorText: { color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, margin: 16, fontSize: 13, textAlign: 'center' },
  errorTextSmall: { color: '#c0392b', fontSize: 12, marginTop: 8 },
  videoWrap: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  video: { width: '100%', height: '100%' },
  image: { flex: 1, backgroundColor: '#000' },
  audioWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  audioIconCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: '#eaf5ee',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  audioIcon: { fontSize: 40 },
  audioName: { fontSize: 15, fontWeight: '600', color: '#14181f', textAlign: 'center', marginBottom: 20 },
  playButton: { backgroundColor: BRAND, borderRadius: 30, paddingHorizontal: 28, paddingVertical: 14 },
  playButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  audioTime: { color: '#5b6472', fontSize: 13, marginTop: 12 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  fallbackText: { color: '#5b6472', fontSize: 14, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  openButton: { backgroundColor: BRAND, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  openButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
