import React, { useEffect, useRef } from 'react';
import { Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuthTheme, useAuth } from '@adar/shared-auth';
import { ChatView, synthesizeGuestSpeech, transcribeGuestSpeech, useGuestChat } from '@adar/shared-chat';
import { useVoiceChat } from './useVoiceChat';
import { extractYouTubeVideoUrl } from './youtube';

const DOMAIN = 'geetabitan';
const PRIVACY_URL = 'https://labs.agomoniai.com/sursankalan-privacy';
// Rabindra Sangeet, Nazrul Geeti, Rajanikanta Sangeet, Atulprasad Sangeet, and
// Dwijendra Sangeet content is overwhelmingly Bengali -- matches adar-core/ui/src/tenant.js's
// own voice config for this tenant (lang: 'bn-IN'), so guest voice defaults
// to Bangla STT/TTS too.
const VOICE_LANG = 'bn-IN';

// Same example questions adar-core/api/routes/geetabitan_guest.py serves
// from GET /api/geetabitan/guest/examples -- kept as a static list here
// so the empty-state chips render instantly without an extra round trip.
const GEETABITAN_GUEST_QUESTIONS = [
  'আমার সোনার বাংলা গানটি খুঁজুন',
  'ভৈরবী রাগের গান দেখাও',
  'কারার ঐ লৌহকপাট গানটি খুঁজুন',
  'বাগিচায় বুলবুলি তুই নজরুলগীতি দেখাও',
  'রজনীকান্তের সূচনা গানটি খুঁজুন',
  'অতুলপ্রসাদের গান থেকে কিছু গান দেখাও',
  'ধনধান্য পুষ্পভরা দ্বিজেন্দ্রলালের গানটি খুঁজুন',
];

// Header title next to the logo -- "Ask Adar সুর সংকলন [something]",
// replacing the earlier English "Ask ADAR Geetabitan".
const GEETABITAN_HEADER_TITLE = 'আদর সুর সংকলনকে জিজ্ঞাসা করুন';

// Verbatim from adar-core/ui/src/tenant.js's own welcome bubble -- same
// wording the live web Geetabitan experience shows on load.
const GEETABITAN_WELCOME_MESSAGE =
  'স্বাগতম! আমি আদর — সুর সংকলনের সহায়ক। রবীন্দ্রনাথ ঠাকুর, কাজী নজরুল ইসলাম, ' +
  'রজনীকান্ত সেন, অতুলপ্রসাদ সেন বা দ্বিজেন্দ্রলাল রায়ের যেকোনো গান, রাগ, তাল, পর্যায়/সংকলন, বা গানের ' +
  'অর্থ সম্পর্কে প্রশ্ন করুন।';

/**
 * The no-login landing experience -- same guest flow ARCL's
 * GuestHomeScreen uses, backed by adar-core/api/routes/geetabitan_guest.py.
 * No email/password needed, and it's the only mode -- the app is open
 * to everyone with no sign-in/account flow.
 *
 * Built directly on useGuestChat + ChatView (rather than the generic
 * <GuestChatScreen>) so voice -- recording, guest STT/TTS, playback --
 * can be wired in via useVoiceChat, which is Geetabitan-only: it's the
 * one app in this monorepo that owns the expo-av/expo-file-system
 * dependency (see useVoiceChat.ts for why that's kept out of the shared
 * package).
 */
export function GuestHomeScreen() {
  const { tenant, client } = useAuth();
  const theme = getAuthTheme(tenant);
  const chat = useGuestChat(client, DOMAIN);
  // A song reply (adar-core/domains/geetabitan/tools/song_tools.py ->
  // get_youtube_url) links its top YouTube match -- auto-open it here, the
  // same way adar-core/ui/src/App.jsx's playYouTubeInsideApp does on web,
  // instead of leaving the user to find and tap the link themselves.
  //
  // This used to open an in-app <WebView> mini-player (see
  // YouTubeMiniPlayer.tsx / toYouTubeEmbedUrl in youtube.ts), but YouTube's
  // anti-embedding checks in a bare mobile WebView proved too unreliable to
  // chase: no Referer header -> "Error 153 (video player configuration
  // error)"; add one -> "Error 152-4 (video unavailable)" instead. This is
  // a known, still-unresolved class of problem with embedding YouTube in a
  // plain WebView on both Android and iOS (see
  // https://github.com/Cap-go/capacitor-youtube-player/issues/49), not
  // something specific to this app or the SDK 54 upgrade -- the only
  // documented workaround is hosting your own HTTPS page just to serve as
  // a valid embed origin, which is real infra for a marginal win over the
  // one line below. Opening the video in the YouTube app/browser instead
  // is 100% reliable (same as the player's "Open ↗" button already did)
  // and uses YouTube's own native playback instead of a WebView's.
  const lastVideoCheckedId = useRef<string | null>(null);
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1];
    if (!last || last.role !== 'assistant' || last.id === lastVideoCheckedId.current) return;
    lastVideoCheckedId.current = last.id;
    const videoUrl = extractYouTubeVideoUrl(last.text);
    if (videoUrl) Linking.openURL(videoUrl);
  }, [chat.messages]);
  const voiceChat = useVoiceChat({
    lang: VOICE_LANG,
    transcribe: async (audioBase64, mime, lang) => {
      const token = await chat.getAccessToken();
      const result = await transcribeGuestSpeech(client, DOMAIN, token, audioBase64, mime, lang);
      return result.text;
    },
    synthesize: async (text, lang, chunkIndex = 0) => {
      const token = await chat.getAccessToken();
      const result = await synthesizeGuestSpeech(client, DOMAIN, token, text, lang, chunkIndex);
      return {
        audio: result.audio,
        chunkIndex: result.chunk_index ?? chunkIndex,
        chunkCount: result.chunk_count ?? 1,
      };
    },
    send: chat.send,
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { borderColor: tenant.brandColor }]}>
        <View style={styles.brand}>
          <Image source={require('../assets/logo-mark.png')} style={styles.brandLogo} resizeMode="contain" />
          <Text style={[styles.brandName, { color: tenant.brandColor }]}>{GEETABITAN_HEADER_TITLE}</Text>
        </View>
      </View>
      <ChatView
        {...chat}
        theme={theme}
        placeholder={GEETABITAN_WELCOME_MESSAGE}
        suggestedQuestions={GEETABITAN_GUEST_QUESTIONS}
        voice={{
          recording: voiceChat.recording,
          busy: voiceChat.busy,
          error: voiceChat.error,
          onToggleRecord: voiceChat.toggleRecord,
          playingMessageId: voiceChat.playingMessageId,
          onPlayMessage: voiceChat.playMessage,
        }}
      />
      <View style={styles.footer}>
        <Text style={styles.footerText}>আদর সুর সংকলন দ্বারা পরিচালিত</Text>
        <Text style={styles.footerText}>© ২০২৬ Agomonia Labs। সর্বস্বত্ব সংরক্ষিত।</Text>
        <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
          <Text style={[styles.footerText, styles.footerLink]}>গোপনীয়তা নীতি</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Android 15+/edge-to-edge (now mandatory at targetSdk 36) ignores the
  // native <style>'s android:statusBarColor entirely, so the status-bar
  // inset is painted with whatever's actually behind it -- without an
  // explicit backgroundColor here, that inset (and the bottom nav-bar
  // inset) rendered as plain black instead of white, which is what made
  // the brand-red header text and light-gray footer text unreadable.
  // Matches the same fix already applied in docintel/eats's screens.
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    backgroundColor: '#fff',
  },
  brand: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  brandLogo: { width: 34, height: 34, borderRadius: 7, marginRight: 8 },
  brandName: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  footer: {
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  footerText: { fontSize: 10.5, color: '#9aa2ad', lineHeight: 14 },
  footerLink: { textDecorationLine: 'underline', marginTop: 2 },
});
