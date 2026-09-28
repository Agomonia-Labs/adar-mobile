import React, { useEffect, useRef, useState } from 'react';
import { Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getAuthTheme, useAuth } from '@adar/shared-auth';
import { ChatView, synthesizeSpeech, transcribeSpeech, useChat } from '@adar/shared-chat';
import { useVoiceChat } from './useVoiceChat';
import { extractYouTubeVideoUrl, toYouTubeEmbedUrl } from './youtube';
import { YouTubeMiniPlayer } from './YouTubeMiniPlayer';

const VOICE_LANG = 'bn-IN';
const PRIVACY_URL = 'https://labs.agomoniai.com/geetabitan-privacy';

const GEETABITAN_SUGGESTED_QUESTIONS = [
  'Find a song about rain',
  'What raag is Ekla Chalo Re in?',
  'Explain the taal Dadra',
];

type Tab = 'home' | 'ask';

export function HomeScreen() {
  const { session, signOut, tenant, client } = useAuth();
  const [tab, setTab] = useState<Tab>('home');
  const theme = getAuthTheme(tenant);
  const chat = useChat();
  // Same auto-open-the-video behavior as GuestHomeScreen.tsx -- see the
  // comment there for why this mirrors adar-core/ui/src/App.jsx's web
  // playYouTubeInsideApp.
  const [videoPlayer, setVideoPlayer] = useState<{ url: string; embedUrl: string } | null>(null);
  const lastVideoCheckedId = useRef<string | null>(null);
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1];
    if (!last || last.role !== 'assistant' || last.id === lastVideoCheckedId.current) return;
    lastVideoCheckedId.current = last.id;
    const videoUrl = extractYouTubeVideoUrl(last.text);
    const embedUrl = videoUrl ? toYouTubeEmbedUrl(videoUrl) : '';
    if (embedUrl) setVideoPlayer({ url: videoUrl, embedUrl });
  }, [chat.messages]);
  const voiceChat = useVoiceChat({
    lang: VOICE_LANG,
    transcribe: async (audioBase64, mime, lang) => {
      const result = await transcribeSpeech(client, session?.accessToken || '', audioBase64, mime, lang);
      return result.text;
    },
    synthesize: async (text, lang) => {
      const result = await synthesizeSpeech(client, text, lang);
      return result.audio;
    },
    send: chat.send,
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#f7f8fa' }]}>
      <View style={[styles.tabBar, { borderColor: tenant.brandColor }]}>
        <TouchableOpacity
          style={[styles.tab, tab === 'home' && { backgroundColor: tenant.brandColor }]}
          onPress={() => setTab('home')}
        >
          <Text style={[styles.tabText, tab === 'home' && styles.tabTextActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'ask' && { backgroundColor: tenant.brandColor }]}
          onPress={() => setTab('ask')}
        >
          <Text style={[styles.tabText, tab === 'ask' && styles.tabTextActive]}>Ask ADAR</Text>
        </TouchableOpacity>
      </View>

      {tab === 'home' ? (
        <View style={styles.content}>
          <Text style={styles.title}>{tenant.displayName}</Text>
          <Text style={styles.subtitle}>Signed in as {session?.teamName}</Text>
          <Text style={styles.meta}>Role: {session?.role}</Text>
          <Text style={styles.placeholder}>
            Song search, lyrics, and notation screens are next — see ROADMAP.md.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: tenant.brandColor }]}
            onPress={() => signOut()}
          >
            <Text style={styles.buttonText}>Sign out</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)} style={styles.privacyLink}>
            <Text style={[styles.privacyLinkText, { color: tenant.brandColor }]}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ChatView
          {...chat}
          theme={theme}
          placeholder="Ask ADAR Geetabitan"
          suggestedQuestions={GEETABITAN_SUGGESTED_QUESTIONS}
          voice={{
            recording: voiceChat.recording,
            busy: voiceChat.busy,
            error: voiceChat.error,
            onToggleRecord: voiceChat.toggleRecord,
            playingMessageId: voiceChat.playingMessageId,
            onPlayMessage: voiceChat.playMessage,
          }}
          videoPlayer={
            videoPlayer ? (
              <YouTubeMiniPlayer
                embedUrl={videoPlayer.embedUrl}
                url={videoPlayer.url}
                theme={theme}
                onClose={() => setVideoPlayer(null)}
              />
            ) : undefined
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, backgroundColor: '#fff' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabText: { fontSize: 14, fontWeight: '600', color: '#5b6472' },
  tabTextActive: { color: '#fff' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#5b6472', marginBottom: 2 },
  meta: { fontSize: 13, color: '#5b6472', marginBottom: 16 },
  placeholder: {
    fontSize: 13,
    color: '#9aa2ad',
    marginBottom: 24,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  buttonText: { color: '#fff', fontWeight: '700' },
  privacyLink: { marginTop: 16 },
  privacyLinkText: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
