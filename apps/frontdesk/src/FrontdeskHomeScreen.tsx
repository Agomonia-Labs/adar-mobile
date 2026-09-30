import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AxiosInstance } from 'axios';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteAccount, getAuthTheme, useAuth } from '@adar/shared-auth';
import { AccountGate } from './AccountGate';
import { decodeJwtEmail } from './jwt';
import { ChatView, synthesizeGuestSpeech, transcribeGuestSpeech, useGuestChat } from '@adar/shared-chat';
import type { GuestCallerDetails } from '@adar/shared-chat';
import { useLanguage } from './LanguageContext';
import { SUPPORTED_LANGUAGES } from './i18n';
import { useFrontdeskGuestSession } from './useFrontdeskGuestSession';
import { useVoiceChat } from './useVoiceChat';
import { BookingWizard } from './BookingWizard';
import { MyAppointmentsScreen } from './MyAppointmentsScreen';
import { ProvidersScreen } from './ProvidersScreen';
import { GuestPractice, extractApiErrorMessage, listGuestPractices } from './frontdeskApi';

const DOMAIN = 'scheduling';
const PRIVACY_URL = 'https://labs.agomoniai.com/frontdesk-privacy';
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Tab = 'book' | 'ask' | 'appointments' | 'providers';

/**
 * The signed-in customer experience for ADAR Front Desk -- mirrors the
 * guided booking flow at https://labs.agomoniai.com/front-desk (see
 * adar-web/front-desk.js/front-desk-adapters.js), rebuilt as native
 * pickers/forms instead of a chat-log-with-chips UI (more appropriate for
 * a phone screen), plus a genuinely conversational "Ask ADAR" tab with
 * multilingual voice, which the web demo doesn't offer today.
 *
 * App.tsx's Gate() only ever renders this once a real account is signed
 * in -- there is no guest/no-login mode for Book, Ask ADAR, or My
 * Appointments. Provider- and practice-specific tooling (managing a real
 * practice's calendar, staff accounts, etc.) is explicitly out of scope
 * for this app and stays on the web admin console
 * (api/routes/scheduling_admin.py) -- this app is the end-to-end CUSTOMER
 * side only.
 */
export function FrontdeskHomeScreen() {
  const { tenant, client, session, signOut } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const { ensureSession } = useFrontdeskGuestSession(client);

  const [tab, setTab] = useState<Tab>('book');
  const [practices, setPractices] = useState<GuestPractice[]>([]);
  const [practiceId, setPracticeId] = useState<string>('');
  const [practicesError, setPracticesError] = useState<string | null>(null);
  const [practicesLoading, setPracticesLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState<'practice' | 'language' | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPracticesLoading(true);
      try {
        const session = await ensureSession();
        const list = await listGuestPractices(client, session.access_token);
        if (cancelled) return;
        setPractices(list);
        setPracticeId((prev) => prev || list[0]?.id || '');
      } catch (err) {
        if (!cancelled) setPracticesError(extractApiErrorMessage(err, t('errorGeneric')));
      } finally {
        if (!cancelled) setPracticesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePractice = useMemo(() => practices.find((p) => p.id === practiceId) || null, [practices, practiceId]);
  const brandColor = activePractice?.color || tenant.brandColor;
  const customerEmail = useMemo(() => decodeJwtEmail(session?.accessToken), [session]);

  // ── "Ask ADAR" tab: fill-in contact info, so ADAR can actually book ────
  // The scheduling agent's own instructions (agents_config.scheduling.json)
  // already expect the caller's name/phone/email up front, as a pre-chat
  // hint, before it will call hold_slot/confirm_booking -- this text-box
  // form is that pre-chat step, so a conversation can end in a real,
  // confirmed appointment instead of just talking about one. Prefilled
  // from the signed-in account's email (still editable) as a convenience;
  // name/phone have no equivalent to prefill from.
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSaved, setContactSaved] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const contactEmailTouchedRef = useRef(false);
  useEffect(() => {
    if (customerEmail && !contactEmailTouchedRef.current) setContactEmail(customerEmail);
  }, [customerEmail]);
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

  // Rendered INSIDE the Ask ADAR conversation itself (via ChatView's
  // leadingContent -- see shared-chat/ChatView.tsx), not as a separate bar
  // floating above the chat: the customer asked for the name/phone/email
  // boxes to show up as part of the conversation, not next to it.
  const contactFormContent = contactFormOpen ? (
    <View style={[styles.contactCard, { borderColor: brandColor }]}>
      <TextInput
        style={styles.contactInput}
        value={contactName}
        onChangeText={setContactName}
        placeholder={t('fullName')}
        placeholderTextColor="#9aa2ad"
      />
      <TextInput
        style={styles.contactInput}
        value={contactPhone}
        onChangeText={setContactPhone}
        placeholder={t('phone')}
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
        placeholder={t('email')}
        placeholderTextColor="#9aa2ad"
        keyboardType="email-address"
        autoCapitalize="none"
      />
      {contactEmail.trim().length > 0 && !EMAIL_SHAPE_RE.test(contactEmail.trim()) ? (
        <Text style={styles.contactError}>{t('invalidEmail')}</Text>
      ) : null}
      <View style={styles.contactActions}>
        <TouchableOpacity style={styles.contactCancelButton} onPress={() => setContactFormOpen(false)}>
          <Text style={styles.contactCancelText}>{t('cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.contactSaveButton, { backgroundColor: brandColor, opacity: contactValid ? 1 : 0.5 }]}
          onPress={saveContactDetails}
          disabled={!contactValid}
        >
          <Text style={styles.contactSaveText}>{t('saveDetails')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : (
    <TouchableOpacity
      style={[styles.contactSummaryBar, { borderColor: brandColor }]}
      onPress={() => setContactFormOpen(true)}
    >
      <Text style={styles.contactSummaryText} numberOfLines={1}>
        {contactSaved
          ? `${t('contactSavedAs')}: ${contactName.trim()} · ${contactEmail.trim()}`
          : t('contactPrompt')}
      </Text>
      <Text style={[styles.contactSummaryAction, { color: brandColor }]}>
        {contactSaved ? t('editDetails') : '+'}
      </Text>
    </TouchableOpacity>
  );

  // ── "Ask ADAR" tab: conversational guest chat + voice ──────────────────
  // Read fresh by useGuestChat on every send() -- see its own comment.
  // Keeping this as a ref (rather than passing practiceId straight through)
  // means switching practices in the header picker takes effect on the
  // very next message without needing to reset/recreate the chat session.
  const practiceIdRef = useRef<string | undefined>(practiceId || undefined);
  useEffect(() => {
    practiceIdRef.current = practiceId || undefined;
  }, [practiceId]);
  // Read fresh on every chat send() -- lets the agent's actual reply
  // follow the app's language picker (see LanguageContext) instead of
  // only auto-detecting from the typed message, and lets a booking made
  // from this conversation be tagged to the signed-in account so it shows
  // up in My Appointments, same as a Book-tab booking.
  const languageRef = useRef<string | undefined>(lang);
  useEffect(() => {
    languageRef.current = lang;
  }, [lang]);
  const customerAccessTokenRef = useRef<string | undefined>(session?.accessToken);
  useEffect(() => {
    customerAccessTokenRef.current = session?.accessToken;
  }, [session]);
  const chat = useGuestChat(
    client,
    DOMAIN,
    practiceIdRef,
    callerDetailsRef,
    languageRef,
    customerAccessTokenRef
  );

  // Switching practices mid-conversation shouldn't leave old replies (a
  // different practice's providers/hours) sitting above new ones that are
  // now correctly scoped -- start Ask ADAR over so the whole visible
  // conversation matches the practice currently selected up top. Skips the
  // very first assignment (practices loading in on mount) since there's
  // nothing to clear yet.
  const isFirstPracticeRef = useRef(true);
  useEffect(() => {
    if (isFirstPracticeRef.current) {
      isFirstPracticeRef.current = false;
      return;
    }
    chat.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceId]);
  const suggestedQuestions = useMemo(
    () => [
      'What services do you offer?',
      'Who are your providers?',
      'What are your hours?',
    ],
    []
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

  const currentLanguageLabel = SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.label || 'English';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View>
      <View style={[styles.header, { borderColor: brandColor }]}>
        <View style={styles.brandRow}>
          <Image source={require('../assets/icon.png')} style={styles.logoMark} />
          <Text style={styles.brandName} numberOfLines={1}>{tenant.displayName}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={[styles.headerButton, styles.headerButtonWide]} onPress={() => setPickerOpen('practice')}>
            <Text style={styles.headerButtonText} numberOfLines={1}>
              {activePractice ? activePractice.name : t('choosePractice')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={() => setPickerOpen('language')}>
            <Text style={styles.headerButtonText}>{currentLanguageLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={() => setAccountOpen(true)}>
            <Text style={styles.headerButtonText} numberOfLines={1}>Profile</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.tabBar, { borderColor: brandColor }]}>
        {(['book', 'ask', 'appointments', 'providers'] as Tab[]).map((key) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, tab === key && { backgroundColor: brandColor }]}
            onPress={() => setTab(key)}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]} numberOfLines={1}>
              {key === 'book'
                ? t('tabBook')
                : key === 'ask'
                ? t('tabAsk')
                : key === 'appointments'
                ? t('tabAppointments')
                : t('tabProviders')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      </View>

      {practicesLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={brandColor} />
          <Text style={styles.loadingText}>{t('loading')}</Text>
        </View>
      ) : practicesError || !practiceId ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{practicesError || t('errorGeneric')}</Text>
        </View>
      ) : (
        <>
          {tab === 'book' && (
            <BookingWizard
              client={client}
              practiceId={practiceId}
              practice={activePractice}
              brandColor={brandColor}
              ensureSession={ensureSession}
              customerAccessToken={session!.accessToken}
              customerEmail={customerEmail}
            />
          )}
          {tab === 'ask' && (
            <>
              <View style={[styles.askContextBar, { borderColor: brandColor }]}>
                <Text style={styles.askContextText} numberOfLines={1}>
                  {activePractice ? `${t('askAbout')}: ${activePractice.name}` : ''}
                </Text>
                <TouchableOpacity
                  onPress={() => chat.reset()}
                  disabled={chat.messages.length === 0}
                  accessibilityLabel={t('newChat')}
                >
                  <Text
                    style={[
                      styles.askContextAction,
                      { color: brandColor, opacity: chat.messages.length === 0 ? 0.4 : 1 },
                    ]}
                  >
                    {'↻'} {t('newChat')}
                  </Text>
                </TouchableOpacity>
              </View>
              <ChatView
                {...chat}
                theme={{ ...getAuthTheme(tenant), brandColor }}
                placeholder={t('askPlaceholder')}
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
            </>
          )}
          {tab === 'appointments' && (
            <MyAppointmentsScreen client={client} practiceId={practiceId} brandColor={brandColor} accessToken={session!.accessToken} />
          )}
          {tab === 'providers' && (
            <ProvidersScreen client={client} practiceId={practiceId} brandColor={brandColor} ensureSession={ensureSession} />
          )}
        </>
      )}

      {/* Hidden on the Ask tab: ChatView's KeyboardAvoidingView (see
          keyboardVerticalOffset above) pads *itself* up when the keyboard
          opens, on the assumption that nothing sits below it -- since
          it's a flex sibling, not a parent, of this footer, that padding
          can't also push the footer up. Left in place, the footer stayed
          put while the input row rose to clear the keyboard, opening a
          blank gap between them (and, before the keyboard was even
          involved, the same "extra stuff below ChatView" pattern is what
          made the empty/short-conversation state look gapped too). Simplest
          correct fix: there's nothing for the footer to coexist with once
          the keyboard can appear, so it doesn't render on this tab. */}
      {tab !== 'ask' && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>{t('poweredBy')}</Text>
          <Text style={styles.footerText}>{t('copyright')}</Text>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Text style={[styles.footerText, styles.footerLink]}>{t('privacyPolicy')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={pickerOpen === 'practice'} transparent animationType="fade" onRequestClose={() => setPickerOpen(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPickerOpen(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('choosePractice')}</Text>
            <ScrollView>
              {practices.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.modalRow}
                  onPress={() => {
                    setPracticeId(p.id);
                    setPickerOpen(null);
                  }}
                >
                  <Text style={styles.modalRowTitle}>{p.name}</Text>
                  <Text style={styles.modalRowSubtitle}>{p.tagline}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={pickerOpen === 'language'} transparent animationType="fade" onRequestClose={() => setPickerOpen(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPickerOpen(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('language')}</Text>
            {SUPPORTED_LANGUAGES.map((l) => (
              <TouchableOpacity
                key={l.code}
                style={styles.modalRow}
                onPress={() => {
                  setLang(l.code);
                  setPickerOpen(null);
                }}
              >
                <Text style={styles.modalRowTitle}>{l.label}</Text>
                {l.voiceOnly ? <Text style={styles.modalRowSubtitle}>{t('voiceOnlyNote')}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <AccountModal
        visible={accountOpen}
        onClose={() => setAccountOpen(false)}
        email={customerEmail}
        client={client}
        accessToken={session?.accessToken || ''}
        onSignOut={() => {
          setAccountOpen(false);
          signOut();
        }}
        onDeleted={() => {
          setAccountOpen(false);
          signOut();
        }}
      />
    </SafeAreaView>
  );
}

/**
 * "Account" header button's modal -- shows who's signed in and, since
 * AccountGate's RegisterForm lets a customer create an account, offers
 * self-service deletion (required by App Store Guideline 5.1.1(v)).
 * Mirrors apps/docintel/src/DocIntelHomeScreen.tsx's DeleteAccountModal
 * pattern: password re-entry as a confirmation step, wired here to the
 * team-shaped deleteAccount() in @adar/shared-auth (not docintel's
 * user-shaped one) since Front Desk logs in via the shared team login.
 * Deleting also removes the customer's own bookings server-side (see
 * DOMAIN == "scheduling" cascade in adar-core/api/routes/auth.py's
 * delete-account endpoint) -- there's no separate "cancel your
 * appointments first" step needed here.
 */
function AccountModal({
  visible,
  onClose,
  email,
  client,
  accessToken,
  onSignOut,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  email: string;
  client: AxiosInstance;
  accessToken: string;
  onSignOut: () => void;
  onDeleted: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setConfirmOpen(false);
    setPassword('');
    setError(null);
    onClose();
  };

  const onDelete = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(client, accessToken, password);
      setConfirmOpen(false);
      setPassword('');
      onDeleted();
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Could not delete your account -- check your password and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={close}>
        <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
          {!confirmOpen ? (
            <>
              <Text style={styles.modalTitle}>Profile</Text>
              <Text style={styles.accountEmailText}>{email || 'Signed in'}</Text>
              <TouchableOpacity style={styles.profileRow} onPress={onSignOut}>
                <Text style={styles.profileRowText}>Sign out</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.profileRow} onPress={() => setConfirmOpen(true)}>
                <Text style={styles.deleteAccountLinkText}>Delete my account</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.modalTitle}>Delete your account</Text>
              <Text style={styles.deleteWarningText}>
                This permanently deletes your account and any appointments you've booked, and cannot be undone.
              </Text>
              {error ? <Text style={styles.contactError}>{error}</Text> : null}
              <TextInput
                style={styles.contactInput}
                placeholder="Current password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <View style={styles.contactActions}>
                <TouchableOpacity style={styles.contactCancelButton} onPress={() => setConfirmOpen(false)}>
                  <Text style={styles.contactCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dangerButton, { opacity: password && !busy ? 1 : 0.5 }]}
                  disabled={!password || busy}
                  onPress={onDelete}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.dangerButtonText}>Yes, permanently delete</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  logoMark: { width: 30, height: 30, borderRadius: 7, marginRight: 8 },
  brandName: { fontSize: 15, fontWeight: '700', color: '#14181f', flexShrink: 1 },
  headerActions: { flexDirection: 'row' },
  headerButton: {
    flex: 1, backgroundColor: '#f0f2f4', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginRight: 8,
  },
  // Practice names run longer than the language/profile labels next to
  // them, so the practice picker gets twice the width -- avoids truncating
  // to a stub on anything but the widest phones.
  headerButtonWide: { flex: 2 },
  headerButtonText: { fontSize: 12, fontWeight: '600', color: '#3a4150', textAlign: 'center' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, backgroundColor: '#fff' },
  askContextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#fafbfc',
  },
  askContextText: { flex: 1, fontSize: 12, color: '#5b6472', marginRight: 8 },
  askContextAction: { fontSize: 12.5, fontWeight: '700' },
  contactSummaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#fff',
  },
  contactSummaryText: { flex: 1, fontSize: 12.5, color: '#3a4150', marginRight: 8 },
  contactSummaryAction: { fontSize: 13, fontWeight: '700' },
  contactCard: {
    borderBottomWidth: 1,
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
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontSize: 12.5, fontWeight: '600', color: '#5b6472' },
  tabTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 8, color: '#5b6472' },
  errorText: { color: '#b3261e', fontSize: 13, textAlign: 'center' },
  footer: {
    alignItems: 'center', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb',
  },
  footerText: { fontSize: 10.5, color: '#9aa2ad', lineHeight: 14 },
  footerLink: { textDecorationLine: 'underline', marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, maxHeight: '70%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', marginBottom: 12 },
  modalRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  modalRowTitle: { fontSize: 14, fontWeight: '600', color: '#14181f' },
  modalRowSubtitle: { fontSize: 12, color: '#9aa2ad', marginTop: 2 },
  accountEmailText: { fontSize: 13, color: '#5b6472', marginBottom: 16 },
  profileRow: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb' },
  profileRowText: { fontSize: 14, fontWeight: '600', color: '#14181f' },
  deleteAccountLinkText: { color: '#b3261e', fontWeight: '600', fontSize: 14 },
  deleteWarningText: { fontSize: 13, color: '#5b6472', marginBottom: 14, lineHeight: 18 },
  dangerButton: { backgroundColor: '#b3261e', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, minWidth: 90, alignItems: 'center' },
  dangerButtonText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
