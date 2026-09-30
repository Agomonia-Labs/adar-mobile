import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { AxiosInstance } from 'axios';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@adar/shared-auth';
import { useLanguage } from './i18n/LanguageContext';
import { DocumentsScreen } from './DocumentsScreen';
import { ChatScreen } from './ChatScreen';
import { ToolsScreen } from './ToolsScreen';
import { WorkspacesScreen } from './WorkspacesScreen';
import { AcademyScreen } from './AcademyScreen';
import { CourseDetailScreen } from './CourseDetailScreen';
import { VideoScreen } from './VideoScreen';
import { VideoDetailScreen } from './VideoDetailScreen';
import { ConversationScreen } from './ConversationScreen';
import { ConversationDetailScreen } from './ConversationDetailScreen';
import { DocumentViewerScreen } from './DocumentViewerScreen';
import {
  AccountDeletionImpact,
  DocIntelDocument,
  deleteAccount,
  extractDocIntelError,
  getAccountDeletionImpact,
  listDocuments,
} from './docintelApi';
import { useWorkspace } from './WorkspaceContext';

const BRAND = '#2e7d4f';
// Same convention as ADAR Front Desk's own PRIVACY_URL
// (apps/frontdesk/src/FrontdeskHomeScreen.tsx) -- a dedicated page under
// labs.agomoniai.com, one per ADAR product.
const PRIVACY_URL = 'https://labs.agomoniai.com/docintel-privacy';
type Tab = 'documents' | 'video' | 'conversations' | 'tools' | 'academy' | 'workspaces' | 'profile';

// 'workspaces' and 'profile' stay valid Tab values (still rendered in the
// body below, still reachable via setTab) but are no longer bottom-tab
// buttons -- they're reached from the header instead (profile avatar on the
// left, workspace switcher pill on the right), so TAB_KEYS only lists the
// tabs that actually appear in the bottom bar.
const TAB_KEYS: { key: Tab; labelKey: 'tabDocuments' | 'tabVideo' | 'tabConversations' | 'tabTools' | 'tabAcademy' }[] = [
  { key: 'documents', labelKey: 'tabDocuments' },
  { key: 'video', labelKey: 'tabVideo' },
  { key: 'conversations', labelKey: 'tabConversations' },
  { key: 'tools', labelKey: 'tabTools' },
  { key: 'academy', labelKey: 'tabAcademy' },
];

export function DocIntelHomeScreen() {
  const { session, signOut } = useAuth();
  const { active } = useWorkspace();
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('documents');
  const [chatDocIds, setChatDocIds] = useState<string[] | null>(null);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [openVideo, setOpenVideo] = useState<{ id: string; name: string } | null>(null);
  const [openConversation, setOpenConversation] = useState<{ callId: string | null } | null>(null);
  const [viewDoc, setViewDoc] = useState<DocIntelDocument | null>(null);
  const [allDocs, setAllDocs] = useState<DocIntelDocument[]>([]);
  const { client } = useAuth();

  // Tools needs the current document list (to pick what to
  // summarize/compare) without re-fetching inside every tab switch.
  React.useEffect(() => {
    if (tab !== 'tools' || !session) return;
    listDocuments(client, session.accessToken, active?.id).then(setAllDocs).catch(() => {});
  }, [tab, session, active, client]);

  if (chatDocIds) {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <ChatScreen documentIds={chatDocIds} onBack={() => setChatDocIds(null)} />
      </SafeAreaView>
    );
  }

  if (openCourseId) {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <CourseDetailScreen courseId={openCourseId} onBack={() => setOpenCourseId(null)} />
      </SafeAreaView>
    );
  }

  if (openVideo) {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <VideoDetailScreen docId={openVideo.id} docName={openVideo.name} onBack={() => setOpenVideo(null)} />
      </SafeAreaView>
    );
  }

  if (openConversation) {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <ConversationDetailScreen callId={openConversation.callId} onBack={() => setOpenConversation(null)} />
      </SafeAreaView>
    );
  }

  if (viewDoc) {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <DocumentViewerScreen doc={viewDoc} onBack={() => setViewDoc(null)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.appHeader}>
        <Image source={require('../assets/icon.png')} style={styles.logoMark} />
        <Text style={styles.brandName} numberOfLines={1}>ADAR DocIntel</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.headerWorkspaceButton} onPress={() => setTab('workspaces')}>
          <Text style={styles.headerWorkspaceText} numberOfLines={1}>{active ? active.name : 'Personal'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerAvatar} onPress={() => setTab('profile')}>
          <Text style={styles.headerAvatarText}>
            {(session?.fullName || session?.email || '?').charAt(0).toUpperCase()}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.flex}>
        {tab === 'documents' ? <DocumentsScreen onOpenChat={setChatDocIds} onView={setViewDoc} /> : null}
        {tab === 'video' ? <VideoScreen onOpenVideo={(id, name) => setOpenVideo({ id, name })} /> : null}
        {tab === 'conversations' ? <ConversationScreen onOpenConversation={(callId) => setOpenConversation({ callId })} /> : null}
        {tab === 'tools' ? <ToolsScreen documents={allDocs} /> : null}
        {tab === 'academy' ? <AcademyScreen onOpenCourse={setOpenCourseId} /> : null}
        {tab === 'workspaces' ? <WorkspacesScreen /> : null}
        {tab === 'profile' ? <ProfileScreen onSignOut={signOut} /> : null}
      </View>
      <View style={styles.appFooter}>
        <Text style={styles.footerText}>{t('copyright')}</Text>
        <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
          <Text style={[styles.footerText, styles.footerLink]}>{t('privacyPolicy')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.tabBar}>
        {TAB_KEYS.map((tb) => (
          <TouchableOpacity key={tb.key} style={styles.tabButton} onPress={() => setTab(tb.key)}>
            <Text style={[styles.tabLabel, tab === tb.key && styles.tabLabelActive]}>{t(tb.labelKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

function ProfileScreen({ onSignOut }: { onSignOut: () => void }) {
  const { session, client, signOut } = useAuth();
  const { t, meta, languages, setLanguage } = useLanguage();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <View style={styles.profileContainer}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(session?.fullName || session?.email || '?').charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.profileName}>{session?.fullName || t('profileAccount')}</Text>
        <Text style={styles.profileEmail}>{session?.email}</Text>
        <Text style={styles.profileRole}>{session?.role}</Text>
      </View>

      <TouchableOpacity style={styles.languageRow} onPress={() => setPickerOpen(true)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.languageRowTitle}>{t('profileLanguageTitle')}</Text>
          <Text style={styles.languageRowHint}>{t('profileLanguageHint')}</Text>
        </View>
        <Text style={styles.languageRowValue}>{meta.nativeName}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={onSignOut}>
        <Text style={styles.signOutButtonText}>{t('signOut')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteAccountLink} onPress={() => setDeleteOpen(true)}>
        <Text style={styles.deleteAccountLinkText}>Delete my account</Text>
      </TouchableOpacity>

      <DeleteAccountModal
        visible={deleteOpen}
        client={client}
        accessToken={session?.accessToken || ''}
        onClose={() => setDeleteOpen(false)}
        onDeleted={async () => { await signOut(); }}
      />

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{t('languagePickerTitle')}</Text>
            {languages.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[styles.langOption, lang.code === meta.code && styles.langOptionActive]}
                onPress={() => { setLanguage(lang.code); setPickerOpen(false); }}
              >
                <Text style={[styles.langOptionText, lang.code === meta.code && styles.langOptionTextActive]}>
                  {lang.nativeName}
                </Text>
                <Text style={styles.langOptionSubText}>{lang.englishName}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalClose} onPress={() => setPickerOpen(false)}>
              <Text style={styles.modalCloseText}>{t('languagePickerClose')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

/** The mobile-facing counterpart to auth/router.py's self-service account
 *  deletion (App Store Review Guideline 5.1.1(v)). Password re-entry is the
 *  confirm step (not just a second tap) since this is irreversible; the
 *  "owned shared workspaces" warning exists because workspaces.owner_id is
 *  ON DELETE CASCADE (database/models.py) -- deleting your own account also
 *  deletes any shared workspace you own, for every member in it, not just
 *  you, and that's worth surfacing before someone taps confirm. */
function DeleteAccountModal({
  visible,
  client,
  accessToken,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  client: AxiosInstance;
  accessToken: string;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [impact, setImpact] = useState<AccountDeletionImpact | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (!visible || !accessToken) return;
    setImpact(null);
    setPassword('');
    setError(null);
    getAccountDeletionImpact(client, accessToken).then(setImpact).catch(() => {});
  }, [visible, client, accessToken]);

  const onConfirm = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(client, accessToken, password);
      onClose();
      await onDeleted();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not delete your account -- check your password and try again.'));
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={busy ? undefined : onClose}>
      <View style={[styles.modalBackdrop, { paddingBottom: keyboardHeight }]}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Delete your account</Text>
          <Text style={styles.deleteWarningText}>
            This permanently deletes your account, your personal documents, videos, and conversations, and cannot be undone.
          </Text>
          {impact && impact.owned_shared_workspaces.length > 0 ? (
            <View style={styles.deleteImpactBox}>
              <Text style={styles.deleteImpactTitle}>You own shared workspaces</Text>
              {impact.owned_shared_workspaces.map((w) => (
                <Text key={w.id} style={styles.deleteImpactLine}>
                  "{w.name}" will be deleted for all {w.member_count} members, not just you
                </Text>
              ))}
            </View>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TextInput
            style={styles.input}
            placeholder="Confirm your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            editable={!busy}
          />
          <TouchableOpacity
            style={[styles.dangerButton, { opacity: password && !busy ? 1 : 0.5 }]}
            disabled={!password || busy}
            onPress={onConfirm}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.dangerButtonText}>Yes, permanently delete my account</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={busy}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  appHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e5ea',
  },
  logoMark: { width: 28, height: 28, borderRadius: 7, marginRight: 8 },
  brandName: { fontSize: 15, fontWeight: '700', color: '#14181f', marginLeft: 2 },
  headerAvatar: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center',
    marginLeft: 10,
  },
  headerAvatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  headerWorkspaceButton: {
    backgroundColor: '#f0f2f4', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, maxWidth: 130,
  },
  headerWorkspaceText: { fontSize: 11.5, fontWeight: '600', color: '#3a4150' },
  appFooter: {
    alignItems: 'center', paddingVertical: 6, backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e5ea',
  },
  footerText: { fontSize: 10.5, color: '#9aa2ad', lineHeight: 14 },
  footerLink: { textDecorationLine: 'underline', marginTop: 2 },
  tabBar: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e2e5ea', backgroundColor: '#fff',
    paddingBottom: 4, paddingTop: 8,
  },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabLabel: { fontSize: 11, fontWeight: '600', color: '#9aa3b2' },
  tabLabelActive: { color: BRAND },
  profileContainer: { flex: 1, padding: 20, alignItems: 'center' },
  profileCard: { alignItems: 'center', marginTop: 30, marginBottom: 30 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  profileName: { fontSize: 18, fontWeight: '700', color: '#14181f' },
  profileEmail: { fontSize: 13, color: '#5b6472', marginTop: 2 },
  profileRole: { fontSize: 12, color: '#9aa3b2', marginTop: 6, textTransform: 'uppercase', fontWeight: '700' },
  signOutButton: { borderWidth: 1.5, borderColor: '#c0392b', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 30 },
  signOutButtonText: { color: '#c0392b', fontWeight: '700', fontSize: 14 },
  deleteAccountLink: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  deleteAccountLinkText: { color: '#9aa3b2', fontWeight: '600', fontSize: 12.5, textDecorationLine: 'underline' },
  deleteWarningText: { fontSize: 13, color: '#5b6472', lineHeight: 18, marginBottom: 12 },
  deleteImpactBox: { backgroundColor: '#fdecea', borderRadius: 10, padding: 12, marginBottom: 12 },
  deleteImpactTitle: { fontSize: 12.5, fontWeight: '700', color: '#c0392b', marginBottom: 4 },
  deleteImpactLine: { fontSize: 12.5, color: '#c0392b', marginTop: 2, lineHeight: 17 },
  input: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 15, marginBottom: 14,
  },
  dangerButton: { backgroundColor: '#c0392b', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  dangerButtonText: { color: '#fff', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  cancelButton: { alignItems: 'center', paddingVertical: 8 },
  cancelButtonText: { color: '#5b6472', fontWeight: '600', fontSize: 14 },
  errorText: {
    color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, marginBottom: 12,
    fontSize: 13, textAlign: 'center',
  },
  languageRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', maxWidth: 360,
    borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 12, padding: 14, marginBottom: 16, backgroundColor: '#fff',
  },
  languageRowTitle: { fontSize: 14, fontWeight: '700', color: '#14181f' },
  languageRowHint: { fontSize: 11.5, color: '#9aa3b2', marginTop: 2, lineHeight: 16 },
  languageRowValue: { fontSize: 13, fontWeight: '700', color: BRAND },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 30 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', marginBottom: 14 },
  langOption: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f0f1f4',
  },
  langOptionActive: { backgroundColor: 'rgba(46,125,79,0.06)' },
  langOptionText: { fontSize: 15, color: '#14181f', fontWeight: '600' },
  langOptionTextActive: { color: BRAND },
  langOptionSubText: { fontSize: 12, color: '#9aa3b2' },
  modalClose: { marginTop: 16, alignItems: 'center', paddingVertical: 12 },
  modalCloseText: { color: BRAND, fontWeight: '700', fontSize: 14 },
});
