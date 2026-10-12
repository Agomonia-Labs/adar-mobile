import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createAuthClient, getAuthTheme, useAuth } from '@adar/shared-auth';
import type { AuthTenantConfig } from '@adar/shared-auth';
import { ChatView, synthesizeGuestSpeech, transcribeGuestSpeech, useGuestChat } from '@adar/shared-chat';
import type { GuestCallerDetails } from '@adar/shared-chat';
import { EatsRestaurant } from './eatsApi';
import { useVoiceChat } from './useVoiceChat';

const DOMAIN = 'scheduling';
const BRAND = '#1b2430';
// Same shape check Front Desk's "Ask ADAR" contact form uses (see
// apps/frontdesk/src/FrontdeskHomeScreen.tsx) -- just a sanity check, the
// backend is the real validator.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Front Desk's `tenant`/`client` (useAuth()) already point at adar-core's
// scheduling deployment, since that whole app IS the scheduling product --
// see apps/frontdesk/App.tsx. Eats' own useAuth() client points at
// adar-rag instead (the restaurant marketplace backend), so this screen
// builds its OWN client pointed at adar-core's scheduling deployment,
// exactly like Front Desk's tenant config, just scoped to a single
// restaurant's practice_id instead of a practice picker.
const SCHEDULING_TENANT: AuthTenantConfig = {
  apiUrl: 'https://api.scheduling.adar.agomoniai.com',
  apiKey: process.env.EXPO_PUBLIC_EATS_SCHEDULING_API_KEY || '',
  domain: DOMAIN,
  displayName: 'ADAR Front Desk',
  logoText: 'FD',
  brandColor: BRAND,
};

// Same BCP-47 codes Front Desk supports (see apps/frontdesk/src/i18n.ts) --
// it's the same adar-core scheduling backend/STT/TTS underneath, so the
// same languages work here. Eats has no on-screen translation (unlike
// Front Desk's full i18n dictionary) -- the UI chrome stays in English for
// every language; only the conversational language and voice STT/TTS
// language change. Arabic has no RTL layout support yet so, as in Front
// Desk, it's voice-only.
interface DineInLanguageOption {
  code: string;
  label: string;
  voiceOnly?: boolean;
}

const SUPPORTED_LANGUAGES: DineInLanguageOption[] = [
  { code: 'en-US', label: 'English' },
  { code: 'es-US', label: 'Español' },
  { code: 'bn-BD', label: 'বাংলা' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'ar-XA', label: 'العربية', voiceOnly: true },
];

/** "Use the assistant instead" path for dine-in booking -- reuses the same
 *  guest-chat assistant ADAR Front Desk's "Ask ADAR" tab talks to
 *  (useGuestChat('scheduling', ...) against adar-core), scoped to this one
 *  restaurant's practice_id so the agent only ever discusses/books tables
 *  for the restaurant the customer picked, never a practice list. The
 *  signed-in Eats customer's own access token rides along as
 *  customerAccessTokenRef so a booking made here shows up like any other
 *  dine-in reservation tied to their account. Voice input/output and a
 *  language picker mirror Front Desk's own "Ask ADAR" tab exactly (same
 *  useVoiceChat hook, same transcribe/synthesize calls, same five
 *  languages) -- see apps/frontdesk/src/FrontdeskHomeScreen.tsx. */
export function DineInAssistantScreen({
  restaurant,
  onBack,
}: {
  restaurant: EatsRestaurant;
  onBack: () => void;
}) {
  const { session } = useAuth();
  const client = useMemo(() => createAuthClient(SCHEDULING_TENANT), []);

  const [lang, setLang] = useState('en-US');
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);

  // Read fresh on every chat send() -- see useGuestChat's own comments on
  // why these are refs rather than plain values.
  const practiceIdRef = useRef<string | undefined>(restaurant.scheduling_practice_id);
  useEffect(() => {
    practiceIdRef.current = restaurant.scheduling_practice_id;
  }, [restaurant.scheduling_practice_id]);

  const customerAccessTokenRef = useRef<string | undefined>(session?.accessToken);
  useEffect(() => {
    customerAccessTokenRef.current = session?.accessToken;
  }, [session]);

  // Lets the agent's actual reply follow the language picker below
  // instead of only auto-detecting from the typed/transcribed message.
  const languageRef = useRef<string | undefined>(lang);
  useEffect(() => {
    languageRef.current = lang;
  }, [lang]);

  // ── Contact info, collapsible -- same pattern as Front Desk's "Ask
  // ADAR" tab (apps/frontdesk/src/FrontdeskHomeScreen.tsx), so the
  // assistant has name/phone/email up front and can actually call
  // hold_slot/confirm_booking instead of only talking about a table.
  // Prefilled from the signed-in Eats account's name/email (still
  // editable) -- Eats' own session already carries these directly
  // (unlike Front Desk, which has to decode them out of the JWT), phone
  // has no equivalent to prefill from. Collapses to a one-line summary
  // once saved; tapping it reopens the form to edit.
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSaved, setContactSaved] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const contactNameTouchedRef = useRef(false);
  const contactEmailTouchedRef = useRef(false);
  useEffect(() => {
    if (session?.fullName && !contactNameTouchedRef.current) setContactName(session.fullName);
  }, [session?.fullName]);
  useEffect(() => {
    if (session?.email && !contactEmailTouchedRef.current) setContactEmail(session.email);
  }, [session?.email]);
  const contactValid =
    !!contactName.trim() && !!contactPhone.trim() && EMAIL_SHAPE_RE.test(contactEmail.trim());
  const callerDetailsRef = useRef<GuestCallerDetails | undefined>(undefined);
  const saveContactDetails = () => {
    if (!contactValid) return;
    callerDetailsRef.current = {
      name: contactName.trim(),
      phone: contactPhone.trim(),
      email: contactEmail.trim(),
    };
    setContactSaved(true);
    setContactFormOpen(false);
  };

  // Rendered INSIDE the conversation itself (via ChatView's
  // leadingContent), same placement Front Desk uses, so it reads as part
  // of the conversation rather than a separate bar floating above it.
  const contactFormContent = contactFormOpen ? (
    <View style={[styles.contactCard, { borderColor: BRAND }]}>
      <TextInput
        style={styles.contactInput}
        value={contactName}
        onChangeText={(v) => {
          contactNameTouchedRef.current = true;
          setContactName(v);
        }}
        placeholder="Full name"
        placeholderTextColor="#9aa2ad"
      />
      <TextInput
        style={styles.contactInput}
        value={contactPhone}
        onChangeText={setContactPhone}
        placeholder="Phone"
        placeholderTextColor="#9aa2ad"
        keyboardType="phone-pad"
      />
      <TextInput
        style={styles.contactInput}
        value={contactEmail}
        onChangeText={(v) => {
          contactEmailTouchedRef.current = true;
          setContactEmail(v);
        }}
        placeholder="Email"
        placeholderTextColor="#9aa2ad"
        keyboardType="email-address"
        autoCapitalize="none"
      />
      {contactEmail.trim().length > 0 && !EMAIL_SHAPE_RE.test(contactEmail.trim()) ? (
        <Text style={styles.contactError}>That email doesn't look right.</Text>
      ) : null}
      <View style={styles.contactActions}>
        <TouchableOpacity style={styles.contactCancelButton} onPress={() => setContactFormOpen(false)}>
          <Text style={styles.contactCancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.contactSaveButton, { backgroundColor: BRAND, opacity: contactValid ? 1 : 0.5 }]}
          onPress={saveContactDetails}
          disabled={!contactValid}
        >
          <Text style={styles.contactSaveText}>Save details</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : (
    <TouchableOpacity
      style={[styles.contactSummaryBar, { borderColor: BRAND }]}
      onPress={() => setContactFormOpen(true)}
    >
      <Text style={styles.contactSummaryText} numberOfLines={1}>
        {contactSaved
          ? `Contact saved: ${contactName.trim()} \u00b7 ${contactEmail.trim()}`
          : 'Add your name, email & phone so the assistant can book for you'}
      </Text>
      <Text style={[styles.contactSummaryAction, { color: BRAND }]}>
        {contactSaved ? 'Edit' : '+'}
      </Text>
    </TouchableOpacity>
  );

  // scopeGuestTokenToPractice=true: this restaurant's scheduling_practice_id
  // is never going to be in adar-core's Front Desk demo practice allowlist
  // (it's a practice Eats itself created via the dine-in enable flow, not
  // a configured Front Desk demo), so the guest token has to be minted
  // scoped to just this one practice instead -- see useGuestChat's own
  // comment on this param. Without it, every guest/chat call 403s once
  // get_scheduling_guest checks the token's practice_ids against that
  // allowlist.
  const chat = useGuestChat(
    client,
    DOMAIN,
    practiceIdRef,
    callerDetailsRef,
    languageRef,
    customerAccessTokenRef,
    true
  );

  const voiceChat = useVoiceChat({
    lang,
    transcribe: async (audioBase64, mime, voiceLang) => {
      const token = await chat.getAccessToken();
      const result = await transcribeGuestSpeech(client, DOMAIN, token, audioBase64, mime, voiceLang);
      return result.text;
    },
    synthesize: async (text, voiceLang) => {
      const token = await chat.getAccessToken();
      const result = await synthesizeGuestSpeech(client, DOMAIN, token, text, voiceLang);
      return result.audio;
    },
    send: chat.send,
  });

  const suggestedQuestions = useMemo(
    () => [
      'Do you have a table for 2 tonight?',
      'What times are open this weekend?',
      'Book a table for 4 tomorrow at 7pm',
    ],
    []
  );

  const currentLanguageLabel = SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.label || 'English';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backLink}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{restaurant.name}</Text>
        <TouchableOpacity onPress={() => setLanguagePickerOpen(true)}>
          <Text style={styles.languageLink} numberOfLines={1}>{currentLanguageLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => chat.reset()} disabled={chat.messages.length === 0}>
          <Text style={[styles.newChatLink, chat.messages.length === 0 && styles.newChatLinkDisabled]}>
            ↻ New chat
        </Text>
        </TouchableOpacity>
      </View>
      <ChatView
        {...chat}
        theme={getAuthTheme(SCHEDULING_TENANT)}
        placeholder={`Ask about a table at ${restaurant.name}`}
        suggestedQuestions={suggestedQuestions}
        leadingContent={contactFormContent}
        voice={{
          recording: voiceChat.recording,
          busy: voiceChat.busy,
          error: voiceChat.error,
          onToggleRecord: voiceChat.toggleRecord,
          playingMessageId: voiceChat.playingMessageId,
          onPlayMessage: voiceChat.playMessage,
        }}
      />

      <Modal visible={languagePickerOpen} transparent animationType="fade" onRequestClose={() => setLanguagePickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setLanguagePickerOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Language</Text>
            {SUPPORTED_LANGUAGES.map((l) => (
              <TouchableOpacity
                key={l.code}
                style={styles.modalRow}
                onPress={() => {
                  setLang(l.code);
                  setLanguagePickerOpen(false);
                }}
              >
                <Text style={styles.modalRowTitle}>{l.label}</Text>
                {l.voiceOnly ? (
                  <Text style={styles.modalRowSubtitle}>Voice only -- on-screen text stays in English.</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eef1f0',
  },
  backLink: { fontSize: 13, color: BRAND, fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: BRAND, textAlign: 'center', marginHorizontal: 8 },
  languageLink: { fontSize: 12.5, fontWeight: '700', color: BRAND, marginRight: 14 },
  newChatLink: { fontSize: 12.5, fontWeight: '700', color: BRAND },
  newChatLinkDisabled: { opacity: 0.4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, maxHeight: '70%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', marginBottom: 12 },
  modalRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  modalRowTitle: { fontSize: 14, fontWeight: '600', color: '#14181f' },
  modalRowSubtitle: { fontSize: 12, color: '#9aa2ad', marginTop: 2 },
  contactSummaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  contactSummaryText: { flex: 1, fontSize: 12.5, color: '#3a4150', marginRight: 8 },
  contactSummaryAction: { fontSize: 13, fontWeight: '700' },
  contactCard: {
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#fafbfc',
    padding: 12,
  },
  contactInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d7dbe0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#14181f',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  contactError: { color: '#b3261e', fontSize: 12, marginBottom: 8 },
  contactActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  contactCancelButton: { paddingVertical: 8, paddingHorizontal: 14, marginRight: 8 },
  contactCancelText: { fontSize: 13, fontWeight: '600', color: '#5b6472' },
  contactSaveButton: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  contactSaveText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
