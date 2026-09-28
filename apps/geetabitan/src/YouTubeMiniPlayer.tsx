import React from 'react';
import { Linking, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';

export interface YouTubeMiniPlayerTheme {
  border: string;
  surface: string;
  textPrimary: string;
  brandColor: string;
}

export interface YouTubeMiniPlayerProps {
  /** youtube.com/embed/... URL (see toYouTubeEmbedUrl in ./youtube.ts). */
  embedUrl: string;
  /** Original youtube.com/watch or youtu.be URL, for "open in YouTube". */
  url: string;
  theme: YouTubeMiniPlayerTheme;
  onClose: () => void;
}

/**
 * Embedded YouTube playback for Geetabitan mobile, mirroring
 * adar-core/ui/src/App.jsx's YouTubeMiniPlayer (an <iframe> there --
 * WebView is the RN equivalent). Shown as a centered overlay on top of the
 * chat screen (with a dim backdrop, tap-outside-to-close) whenever the
 * assistant's latest reply links to a song's YouTube video, so "play a
 * song" plays inside the app instead of just leaving a link to tap.
 */
export function YouTubeMiniPlayer({ embedUrl, url, theme, onClose }: YouTubeMiniPlayerProps) {
  if (!embedUrl) return null;
  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable
        style={[styles.container, { borderColor: theme.border, backgroundColor: theme.surface }]}
        onPress={() => {}}
      >
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Text style={[styles.headerText, { color: theme.textPrimary }]}>YouTube</Text>
          <TouchableOpacity onPress={() => Linking.openURL(url)} style={styles.headerButton}>
            <Text style={[styles.headerButtonText, { color: theme.brandColor }]}>Open ↗</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.headerButton} accessibilityLabel="Close video">
            <Text style={[styles.headerButtonText, { color: theme.brandColor }]}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.playerWrap}>
          <WebView
            source={{ uri: embedUrl }}
            style={styles.player}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
          />
        </View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 50,
    elevation: 50,
  },
  container: { width: '100%', maxWidth: 480, borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  headerText: { flex: 1, fontWeight: '700', fontSize: 12 },
  headerButton: { marginLeft: 12 },
  headerButtonText: { fontSize: 12, fontWeight: '600' },
  playerWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  player: { flex: 1, backgroundColor: '#000' },
});
