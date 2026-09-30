import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { AxiosInstance } from 'axios';
import { deleteAccount, extractErrorMessage, useAuth } from '@adar/shared-auth';
import { ChatScreen } from '@adar/shared-chat';

// Same wording/questions as the public guest experience (arcl.js /
// arcl_guest.py EXAMPLE_QUESTIONS) for consistency between the web's
// no-login demo and this signed-in app.
const ARCL_WELCOME_MESSAGE =
  'Welcome to the ADAR ARCL Cricket Assistant. Ask me about ARCL rules, teams, players, standings, schedules, results, or scorecards.';
const ARCL_SUGGESTED_QUESTIONS = [
  "What is the wide-ball rule in the men's ARCL league?",
  'Show the current Division H standings.',
  'Who are the top five batsmen in Division H?',
  "Show Agomoni Tigers' schedule.",
];

type Tab = 'home' | 'ask';

export function HomeScreen() {
  const { session, signOut, tenant, client } = useAuth();
  const [tab, setTab] = useState<Tab>('home');
  const [profileOpen, setProfileOpen] = useState(false);

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
          <Text style={[styles.tabText, tab === 'ask' && styles.tabTextActive]}>Ask ADAR ARCL</Text>
        </TouchableOpacity>
      </View>

      {tab === 'home' ? (
        <View style={styles.content}>
          <Text style={styles.title}>{tenant.displayName}</Text>
          <Text style={styles.subtitle}>Signed in as {session?.teamName}</Text>
          <Text style={styles.meta}>Role: {session?.role}</Text>
          <Text style={styles.placeholder}>
            Schedule, standings, roster, and scorecard screens are next — see ROADMAP.md.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: tenant.brandColor }]}
            onPress={() => setProfileOpen(true)}
          >
            <Text style={styles.buttonText}>Profile</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ChatScreen
          placeholder={ARCL_WELCOME_MESSAGE}
          suggestedQuestions={ARCL_SUGGESTED_QUESTIONS}
          logo={require('../assets/logo-mark.png')}
        />
      )}

      {/* Hidden on the Ask tab: ChatScreen renders shared-chat's ChatView
          as its own root, whose KeyboardAvoidingView pads *itself* up when
          the keyboard opens on the assumption nothing sits below it. This
          footer is a flex sibling, not a parent, of that KeyboardAvoidingView,
          so it can't be pushed up along with it -- left in place, it stays
          put while the input row rises to clear the keyboard, opening a
          blank gap between them (the same issue this bit ADAR Front Desk's
          Ask ADAR tab; see apps/frontdesk/src/FrontdeskHomeScreen.tsx for
          the identical fix). */}
      {tab !== 'ask' && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>Powered by ADAR</Text>
          <Text style={styles.footerText}>© 2026 Agomonia Labs. All rights reserved.</Text>
        </View>
      )}

      <ProfileModal
        visible={profileOpen}
        onClose={() => setProfileOpen(false)}
        teamName={session?.teamName || ''}
        client={client}
        accessToken={session?.accessToken || ''}
        brandColor={tenant.brandColor}
        onSignOut={() => {
          setProfileOpen(false);
          signOut();
        }}
        onDeleted={() => {
          setProfileOpen(false);
          signOut();
        }}
      />
    </SafeAreaView>
  );
}

/**
 * "Profile" button's modal -- shows who's signed in, and offers Sign out
 * together with self-service account deletion (required by App Store
 * Guideline 5.1.1(v) for any app that supports account creation, which
 * AccountGate's RegisterForm now does for ARCL). Mirrors ADAR Front
 * Desk's AccountModal (apps/frontdesk/src/FrontdeskHomeScreen.tsx) --
 * same password-confirmed delete flow, wired to the same team-shaped
 * deleteAccount() in @adar/shared-auth (ARCL has no bookings to cascade
 * the way Front Desk's scheduling domain does, so deleting here is just
 * the Firestore team profile -- see the DOMAIN == "scheduling" check in
 * adar-core/api/routes/auth.py's delete-account endpoint).
 */
function ProfileModal({
  visible,
  onClose,
  teamName,
  client,
  accessToken,
  brandColor,
  onSignOut,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  teamName: string;
  client: AxiosInstance;
  accessToken: string;
  brandColor: string;
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
      setError(extractErrorMessage(err, 'Could not delete your account -- check your password and try again.'));
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
              <Text style={styles.profileNameText}>{teamName || 'Signed in'}</Text>
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
                This permanently deletes your ADAR ARCL account and cannot be undone.
              </Text>
              {error ? <Text style={styles.errorInline}>{error}</Text> : null}
              <TextInput
                style={styles.input}
                placeholder="Current password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setConfirmOpen(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
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
  footer: { alignItems: 'center', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb', backgroundColor: '#f7f8fa' },
  footerText: { fontSize: 10.5, color: '#9aa2ad', lineHeight: 14 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, maxHeight: '70%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', marginBottom: 12 },
  profileNameText: { fontSize: 13, color: '#5b6472', marginBottom: 16 },
  profileRow: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb' },
  profileRowText: { fontSize: 14, fontWeight: '600', color: '#14181f' },
  deleteAccountLinkText: { color: '#b3261e', fontWeight: '600', fontSize: 14 },
  deleteWarningText: { fontSize: 13, color: '#5b6472', marginBottom: 14, lineHeight: 18 },
  errorInline: { color: '#b3261e', fontSize: 12, marginBottom: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d7dbe0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#14181f',
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  cancelButton: { paddingVertical: 8, paddingHorizontal: 14, marginRight: 8 },
  cancelButtonText: { fontSize: 13, fontWeight: '600', color: '#5b6472' },
  dangerButton: { backgroundColor: '#b3261e', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, minWidth: 90, alignItems: 'center' },
  dangerButtonText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
