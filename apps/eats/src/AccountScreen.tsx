import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosInstance } from 'axios';
import { extractErrorMessage, useAuth } from '@adar/shared-auth';
import {
  AccountDeletionImpact,
  EatsOwnerRestaurant,
  deleteAccount,
  getAccountDeletionImpact,
  listMyRestaurants,
} from './eatsApi';

const BRAND = '#1b2430';

/** Account tab: who you're signed in as, Sign Out, and self-service
 *  account deletion. App Store Review Guideline 5.1.1(v): an app that
 *  lets people create an account (EatsAccountGate's sign-up form does)
 *  must also let them delete it from within the app -- same requirement
 *  ADAR DocIntel's own ProfileScreen/DeleteAccountModal (in
 *  DocIntelHomeScreen.tsx) already satisfies, since Eats shares that same
 *  backend and DELETE /api/auth/account endpoint. */
export function AccountScreen() {
  const { session, client, signOut } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(session?.fullName || session?.email || '?').charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{session?.fullName || 'Your account'}</Text>
        <Text style={styles.email}>{session?.email}</Text>
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutButtonText}>Sign out</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteLink} onPress={() => setDeleteOpen(true)}>
        <Text style={styles.deleteLinkText}>Delete my account</Text>
      </TouchableOpacity>

      <DeleteAccountModal
        visible={deleteOpen}
        client={client}
        accessToken={session?.accessToken || ''}
        onClose={() => setDeleteOpen(false)}
        onDeleted={async () => { await signOut(); }}
      />
    </SafeAreaView>
  );
}

/** Password re-entry is the confirm step (irreversible action, matching
 *  the equivalent flow across the other ADAR apps -- see
 *  docintel/src/DocIntelHomeScreen.tsx's DeleteAccountModal), not just a
 *  second tap. Two separate impact warnings, fetched in parallel:
 *  - owned_shared_workspaces (from the shared backend's generic
 *    deletion-impact endpoint) -- rarely populated for an Eats account,
 *    but harmless and free to check since the endpoint is shared with
 *    DocIntel.
 *  - restaurants this account owns on the marketplace (Eats-specific,
 *    the backend's deletion-impact endpoint doesn't know about these) --
 *    deleting the account removes that restaurant from the marketplace
 *    for every diner, not just the owner, so it's worth surfacing before
 *    the final confirm the same way a shared workspace is for DocIntel. */
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
  const [ownedRestaurants, setOwnedRestaurants] = useState<EatsOwnerRestaurant[]>([]);
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
    setOwnedRestaurants([]);
    setPassword('');
    setError(null);
    getAccountDeletionImpact(client, accessToken).then(setImpact).catch(() => {});
    listMyRestaurants(client, accessToken).then(setOwnedRestaurants).catch(() => {});
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
      setError(extractErrorMessage(err, 'Could not delete your account -- check your password and try again.'));
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={busy ? undefined : onClose}>
      <View style={[styles.modalBackdrop, { paddingBottom: keyboardHeight }]}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Delete your account</Text>
          <Text style={styles.warningText}>
            This permanently deletes your account, your cart, orders, and conversation history, and cannot
            be undone.
          </Text>
          {ownedRestaurants.length > 0 ? (
            <View style={styles.impactBox}>
              <Text style={styles.impactTitle}>You own a restaurant on ADAR Eats</Text>
              {ownedRestaurants.map((r) => (
                <Text key={r.id} style={styles.impactLine}>
                  "{r.name}" will be removed from the marketplace for every diner, not just you
                </Text>
              ))}
            </View>
          ) : null}
          {impact && impact.owned_shared_workspaces.length > 0 ? (
            <View style={styles.impactBox}>
              <Text style={styles.impactTitle}>You own shared workspaces</Text>
              {impact.owned_shared_workspaces.map((w) => (
                <Text key={w.id} style={styles.impactLine}>
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
  card: {
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 14,
    paddingVertical: 24,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  avatarText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  name: { fontSize: 17, fontWeight: '700', color: '#14181f' },
  email: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  signOutButton: {
    marginHorizontal: 16, marginTop: 24, backgroundColor: BRAND,
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  signOutButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  deleteLink: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  deleteLinkText: { color: '#9aa3b2', fontWeight: '600', fontSize: 12.5, textDecorationLine: 'underline' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#14181f', marginBottom: 8 },
  warningText: { fontSize: 13.5, lineHeight: 19, color: '#3a4150', marginBottom: 12 },
  impactBox: { backgroundColor: '#fff4e5', borderRadius: 10, padding: 12, marginBottom: 12 },
  impactTitle: { fontSize: 13, fontWeight: '700', color: '#92400e', marginBottom: 4 },
  impactLine: { fontSize: 12.5, color: '#92400e', marginBottom: 2 },
  errorText: { color: '#d33', fontSize: 13, marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: '#e1e4ea', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 14,
  },
  dangerButton: { backgroundColor: '#d33', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  dangerButtonText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  cancelButton: { alignItems: 'center', paddingVertical: 14 },
  cancelButtonText: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
});
