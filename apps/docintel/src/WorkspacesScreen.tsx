import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { DocIntelWorkspace, createWorkspace, deleteWorkspace, extractDocIntelError } from './docintelApi';
import { SwipeableRow } from './SwipeableRow';
import { useWorkspace } from './WorkspaceContext';

const BRAND = '#2e7d4f';
const RED = '#c0392b';

export function WorkspacesScreen() {
  const { client, session } = useAuth();
  const { workspaces, active, setActive, loading, refresh } = useWorkspace();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const onCreate = async () => {
    if (!name.trim() || !session) return;
    setBusy(true);
    setError(null);
    try {
      const ws = await createWorkspace(client, session.accessToken, name.trim());
      setName('');
      setShowCreate(false);
      await refresh();
      setActive(ws);
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not create workspace.'));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (ws: DocIntelWorkspace) => {
    if (!session) return;
    setDeletingId(ws.id);
    setError(null);
    try {
      await deleteWorkspace(client, session.accessToken, ws.id);
      // WorkspaceContext's refresh() already falls back `active` to
      // Personal if it no longer finds the currently-active workspace in
      // the refreshed list -- exactly the case when you delete the one
      // you're in, so no extra bookkeeping is needed here.
      await refresh();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not delete this workspace.'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Workspaces</Text>
      <Text style={styles.subheader}>
        Each workspace keeps its own documents, chats, and Knowledge Academy courses isolated from the
        others -- the same boundary the web app uses.
      </Text>
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.row, !active && styles.rowActive]}
        onPress={() => setActive(null)}
      >
        <View style={styles.rowIcon}><Text style={styles.rowIconText}>P</Text></View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Personal</Text>
          <Text style={styles.rowMeta}>Only visible to you</Text>
        </View>
        {!active ? <Text style={styles.checkmark}>✓</Text> : null}
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} color={BRAND} />
      ) : (
        <FlatList
          data={workspaces}
          keyExtractor={(w) => w.id}
          renderItem={({ item }) => {
            const rowContent = (
              <TouchableOpacity
                style={[styles.row, styles.rowInSwipe, active?.id === item.id && styles.rowActive]}
                onPress={() => setActive(item)}
                disabled={deletingId === item.id}
              >
                <View style={styles.rowIcon}><Text style={styles.rowIconText}>{item.name.charAt(0).toUpperCase()}</Text></View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.rowMeta}>
                    {item.doc_count} doc{item.doc_count === 1 ? '' : 's'} · {item.member_count} member
                    {item.member_count === 1 ? '' : 's'} · {item.my_role}
                  </Text>
                </View>
                {deletingId === item.id ? (
                  <ActivityIndicator color={BRAND} />
                ) : active?.id === item.id ? (
                  <Text style={styles.checkmark}>✓</Text>
                ) : null}
              </TouchableOpacity>
            );
            // Only the owner can delete (routes/workspaces.py's
            // delete_workspace endpoint 403s anyone else), so only an
            // owner's row gets the swipe-to-delete affordance at all --
            // other members just get the plain, non-swipeable row.
            if (item.my_role !== 'owner') return rowContent;
            return (
              <SwipeableRow onDelete={() => onDelete(item)} disabled={deletingId === item.id}>
                {rowContent}
              </SwipeableRow>
            );
          }}
        />
      )}

      <TouchableOpacity style={styles.createButton} onPress={() => setShowCreate(true)}>
        <Text style={styles.createButtonText}>+ New workspace</Text>
      </TouchableOpacity>

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <View style={[styles.modalOverlay, { paddingBottom: keyboardHeight }]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New workspace</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TextInput
              style={styles.input}
              placeholder="e.g. Finance Team"
              value={name}
              onChangeText={setName}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.primaryButton, { opacity: name.trim() && !busy ? 1 : 0.5 }]}
              disabled={!name.trim() || busy}
              onPress={onCreate}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Create</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => { setShowCreate(false); setError(null); }}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fa', padding: 16 },
  header: { fontSize: 22, fontWeight: '700', color: '#14181f', marginBottom: 4 },
  subheader: { fontSize: 13, color: '#5b6472', marginBottom: 16, lineHeight: 18 },
  errorBanner: {
    color: RED, backgroundColor: '#fdecea', padding: 10, borderRadius: 10, marginBottom: 12,
    fontSize: 13, textAlign: 'center',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12,
    padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e5ea',
  },
  rowInSwipe: { marginBottom: 0 },
  rowActive: { borderColor: BRAND, backgroundColor: '#eaf5ee' },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: BRAND, alignItems: 'center',
    justifyContent: 'center', marginRight: 12,
  },
  rowIconText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#14181f' },
  rowMeta: { fontSize: 12, color: '#5b6472', marginTop: 2 },
  checkmark: { color: BRAND, fontWeight: '700', fontSize: 16 },
  createButton: {
    marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: BRAND, borderStyle: 'dashed',
  },
  createButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#14181f', marginBottom: 14 },
  input: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 15, marginBottom: 14,
  },
  primaryButton: { backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelButton: { alignItems: 'center', paddingVertical: 8 },
  cancelButtonText: { color: '#5b6472', fontWeight: '600', fontSize: 14 },
  errorText: {
    color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, marginBottom: 12,
    fontSize: 13, textAlign: 'center',
  },
});
