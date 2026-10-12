import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@adar/shared-auth';
import { useWorkspace } from './WorkspaceContext';
import {
  EatsAgentRun,
  EatsMenuPacket,
  EatsMenuPacketItem,
  EatsOwnerMenuItem,
  EatsOwnerRestaurant,
  EatsPendingRestaurantRun,
  EatsRestaurantTranscript,
  MENU_CATEGORY_ORDER,
  approveRestaurantScribe,
  deleteMenuItemPhoto,
  extractMenuPacket,
  getAgentRun,
  getRestaurantDetail,
  EatsTranscriptChunkSummary,
  getRestaurantTranscript,
  getRestaurantTranscriptChunkContent,
  getRestaurantTranscriptChunks,
  listMyRestaurants,
  listPendingRestaurantRuns,
  menuCategoryBucket,
  setMarketplaceVisibility,
  submitRestaurantScribe,
  updateMenuItem,
  updateRestaurantTranscript,
  uploadMenuItemPhoto,
} from './eatsApi';
import { MenuItemDetailModal } from './MenuItemDetailModal';
import { DineInManageScreen } from './DineInManageScreen';

const BRAND = '#1b2430';

function formatPrice(price: number | null, currency: string) {
  if (price == null) return '';
  return `${currency === 'USD' ? '$' : currency + ' '}${price.toFixed(2)}`;
}

type Screen = 'list' | 'recorder' | 'review' | 'photos' | 'transcript' | 'dineIn';

/** Restaurant owner side of ADAR Eats: list your restaurants, toggle
 *  marketplace visibility, record a spoken menu walkthrough that the
 *  backend transcribes + AI-extracts into a menu (the same
 *  restaurant-menu-scribe workflow adar-rag/frontend's RestaurantPanel.jsx
 *  uses), review/edit/approve it, then add a photo per menu item.
 *  A plain useState stack (list -> recorder -> review -> photos) --
 *  this codebase doesn't use a navigation library (see HomeScreen.tsx's
 *  own tab pattern and DocIntelHomeScreen.tsx's `Tab` state). */
export function OwnerDashboardScreen() {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const { workspaceId, workspaceName, error: workspaceError } = useWorkspace();

  const [screen, setScreen] = useState<Screen>('list');
  const [restaurants, setRestaurants] = useState<EatsOwnerRestaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(null);
  const [pendingRuns, setPendingRuns] = useState<EatsPendingRestaurantRun[]>([]);

  const loadRestaurants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listMyRestaurants(client, accessToken, workspaceId);
      setRestaurants(rows);
    } catch (err) {
      setError('Could not load your restaurants. Pull down to try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, workspaceId]);

  // A scribe recording that finished (or is still transcribing) in a
  // session the owner has since left -- app backgrounded, navigated away,
  // or closed before the review screen appeared -- has no run_id left on
  // the client to resume it. Without this, that recording and its
  // transcript exist on the server but are permanently unreachable from
  // here. Best-effort: a failure here shouldn't block the restaurant list
  // itself from loading, so it fails silently rather than via setError.
  const loadPendingRuns = useCallback(async () => {
    try {
      const runs = await listPendingRestaurantRuns(client, accessToken, workspaceId);
      setPendingRuns(runs);
    } catch {
      // leave whatever was last successfully loaded in place
    }
  }, [client, accessToken, workspaceId]);

  useEffect(() => {
    if (screen === 'list') {
      loadRestaurants();
      loadPendingRuns();
    }
  }, [screen, loadRestaurants, loadPendingRuns]);

  const toggleMarketplace = useCallback(
    async (restaurant: EatsOwnerRestaurant, value: boolean) => {
      setRestaurants((prev) =>
        prev.map((r) => (r.id === restaurant.id ? { ...r, marketplace_visible: value } : r))
      );
      try {
        await setMarketplaceVisibility(client, accessToken, restaurant.id, value);
      } catch (err) {
        Alert.alert('Could not update', 'Please try again.');
        setRestaurants((prev) =>
          prev.map((r) => (r.id === restaurant.id ? { ...r, marketplace_visible: !value } : r))
        );
      }
    },
    [client, accessToken]
  );

  if (screen === 'recorder') {
    return (
      <ScribeRecorderScreen
        workspaceId={workspaceId}
        onCancel={() => setScreen('list')}
        onSubmitted={(runId) => {
          setActiveRunId(runId);
          setScreen('review');
        }}
      />
    );
  }

  if (screen === 'review' && activeRunId) {
    return (
      <ScribeReviewScreen
        runId={activeRunId}
        onCancel={() => setScreen('list')}
        onApproved={(restaurantId) => {
          setActiveRestaurantId(restaurantId);
          setScreen('photos');
        }}
      />
    );
  }

  if (screen === 'photos' && activeRestaurantId) {
    return (
      <MenuPhotosScreen
        restaurantId={activeRestaurantId}
        onDone={() => setScreen('list')}
      />
    );
  }

  if (screen === 'transcript' && activeRestaurantId) {
    return (
      <TranscriptScreen
        restaurantId={activeRestaurantId}
        onDone={() => setScreen('list')}
      />
    );
  }

  if (screen === 'dineIn' && activeRestaurantId) {
    const activeRestaurant = restaurants.find((r) => r.id === activeRestaurantId);
    if (activeRestaurant) {
      return (
        <DineInManageScreen
          client={client}
          accessToken={accessToken}
          restaurant={activeRestaurant}
          onDone={() => setScreen('list')}
        />
      );
    }
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <View style={styles.listHeader}>
        <Text style={styles.listHeaderTitle}>My Restaurants</Text>
        <TouchableOpacity style={styles.recordButton} onPress={() => setScreen('recorder')}>
          <Text style={styles.recordButtonText}>🎙 Record new menu</Text>
        </TouchableOpacity>
      </View>

      {/* adar-eats mobile always operates inside the one shared restaurant
          workspace -- there is no personal mode and no picker here (see
          WorkspaceContext.tsx). This only shows up in the rare bootstrap
          case where that workspace doesn't exist yet. */}
      {!workspaceId && workspaceError && (
        <Text style={styles.errorText}>{workspaceError}</Text>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading && restaurants.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : (
        <FlatList
          style={styles.list}
          data={restaurants}
          keyExtractor={(item) => item.id}
          onRefresh={() => {
            loadRestaurants();
            loadPendingRuns();
          }}
          refreshing={loading}
          ListHeaderComponent={
            pendingRuns.length > 0 ? (
              <View style={styles.pendingRunsSection}>
                <Text style={styles.pendingRunsTitle}>
                  {pendingRuns.length === 1 ? 'Menu recording awaiting review' : `${pendingRuns.length} menu recordings awaiting review`}
                </Text>
                {pendingRuns.map((run) => (
                  <TouchableOpacity
                    key={run.run_id}
                    style={styles.pendingRunCard}
                    onPress={() => {
                      setActiveRunId(run.run_id);
                      setScreen('review');
                    }}
                  >
                    <Text style={styles.pendingRunName} numberOfLines={1}>
                      {run.restaurant_name || 'Untitled recording'}
                    </Text>
                    <Text style={styles.pendingRunMeta}>
                      {run.status === 'pending_approval'
                        ? `Ready to review${run.menu_item_count ? ` · ${run.menu_item_count} items extracted` : ''}`
                        : 'Still transcribing…'}
                    </Text>
                    <Text style={styles.pendingRunAction}>
                      {run.status === 'pending_approval' ? 'Edit & approve →' : 'Check progress →'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSubtitle}>
                {item.cuisine_type || 'Restaurant'} · {item.menu_count} menu {item.menu_count === 1 ? 'item' : 'items'}
              </Text>
              <View style={styles.marketplaceRow}>
                <Text style={styles.marketplaceLabel}>
                  {item.marketplace_visible ? 'Visible in ADAR Eats marketplace' : 'Not listed in marketplace yet'}
                </Text>
                <Switch
                  value={item.marketplace_visible}
                  onValueChange={(value) => toggleMarketplace(item, value)}
                  trackColor={{ true: BRAND }}
                />
              </View>
              <View style={styles.cardButtonRow}>
                <TouchableOpacity
                  style={styles.manageButton}
                  onPress={() => {
                    setActiveRestaurantId(item.id);
                    setScreen('photos');
                  }}
                >
                  <Text style={styles.manageButtonText}>Menu</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.manageButton}
                  onPress={() => {
                    setActiveRestaurantId(item.id);
                    setScreen('transcript');
                  }}
                >
                  <Text style={styles.manageButtonText}>Transcript</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.manageButton}
                  onPress={() => {
                    setActiveRestaurantId(item.id);
                    setScreen('dineIn');
                  }}
                >
                  <Text style={styles.manageButtonText}>
                    {item.dine_in_enabled ? 'Dine-In' : 'Set up Dine-In'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.emptyText}>
                No restaurants yet. Record a quick walkthrough of your menu to create one.
              </Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// ── Step 1: record ──────────────────────────────────────────────────────

function ScribeRecorderScreen({
  workspaceId,
  onCancel,
  onSubmitted,
}: {
  workspaceId: string | null;
  onCancel: () => void;
  onSubmitted: (runId: string) => void;
}) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'recorded' | 'submitting'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [title, setTitle] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordedUriRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone permission needed', 'Allow microphone access to record your menu walkthrough.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setRecordingState('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err: any) {
      Alert.alert('Could not start recording', err?.message || 'Please try again.');
    }
  };

  const stopRecording = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) {
      setRecordingState('idle');
      return;
    }
    try {
      await recording.stopAndUnloadAsync();
    } finally {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    }
    const uri = recording.getURI();
    recordedUriRef.current = uri;
    setRecordingState(uri ? 'recorded' : 'idle');
  };

  const reRecord = () => {
    recordedUriRef.current = null;
    setSeconds(0);
    setRecordingState('idle');
  };

  const submit = async () => {
    const uri = recordedUriRef.current;
    if (!uri) return;
    if (!authorized) {
      Alert.alert('Confirm authorization', 'Please confirm you are authorized to publish or update this restaurant menu.');
      return;
    }
    setRecordingState('submitting');
    try {
      const run = await submitRestaurantScribe(
        client,
        accessToken,
        { uri, mimeType: 'audio/mp4', name: 'restaurant-menu-walkthrough.m4a' },
        { intakeTitle: title.trim(), workspaceId }
      );
      onSubmitted(run.run_id);
    } catch (err: any) {
      Alert.alert('Upload failed', err?.response?.data?.detail || err?.message || 'Please try again.');
      setRecordingState('recorded');
    }
  };

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      {/* Without this, the title TextInput below (shown once a recording
          is captured) gets covered by the keyboard on iOS -- a bare
          ScrollView doesn't shift its content up on its own, so the user
          can see the keyboard but not what they're typing. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}
      >
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.headerBack}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Record your menu</Text>
        <View style={{ width: 50 }} />
      </View>
      <ScrollView contentContainerStyle={styles.recorderBody} keyboardShouldPersistTaps="handled">
        <Text style={styles.recorderHint}>
          Walk through your restaurant and menu out loud -- name, address, and each dish with its price and
          description. We'll transcribe it and pull out a structured menu for you to review.
        </Text>

        <View style={styles.recorderCircleWrap}>
          <TouchableOpacity
            style={[styles.recorderCircle, recordingState === 'recording' && styles.recorderCircleActive]}
            onPress={recordingState === 'recording' ? stopRecording : startRecording}
            disabled={recordingState === 'submitting'}
          >
            <Text style={styles.recorderIcon}>{recordingState === 'recording' ? '■' : '🎙'}</Text>
          </TouchableOpacity>
          <Text style={styles.recorderTimer}>
            {recordingState === 'idle' && 'Tap to start recording'}
            {recordingState === 'recording' && `Recording… ${seconds}s`}
            {(recordingState === 'recorded' || recordingState === 'submitting') && `Recorded ${seconds}s`}
          </Text>
        </View>

        {recordingState === 'recorded' && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Menu title (optional, e.g. Spring 2026 menu)"
              value={title}
              onChangeText={setTitle}
            />
            <TouchableOpacity style={styles.checkboxRow} onPress={() => setAuthorized((v) => !v)}>
              <View style={[styles.checkbox, authorized && styles.checkboxChecked]}>
                {authorized && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>
                I'm authorized to publish or update this restaurant's menu.
              </Text>
            </TouchableOpacity>
            <View style={styles.recorderActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={reRecord}>
                <Text style={styles.secondaryButtonText}>Re-record</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={submit}>
                <Text style={styles.primaryButtonText}>Submit for review</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {recordingState === 'submitting' && <ActivityIndicator style={{ marginTop: 16 }} color={BRAND} />}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Step 2: poll + review + approve ─────────────────────────────────────

function ScribeReviewScreen({
  runId,
  onCancel,
  onApproved,
}: {
  runId: string;
  onCancel: () => void;
  onApproved: (restaurantId: string) => void;
}) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [run, setRun] = useState<EatsAgentRun | null>(null);
  const [packet, setPacket] = useState<EatsMenuPacket | null>(null);
  const [approving, setApproving] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveErrors = 0;
    // A real failure (expired session, dropped network, server error) must
    // not look identical to "still transcribing" -- retrying silently
    // forever on every poll error left the owner staring at "Transcribing
    // your recording..." with no way to tell a genuine failure from normal
    // processing time. After several straight failures, surface it instead.
    const MAX_CONSECUTIVE_ERRORS = 5;

    const poll = async () => {
      try {
        const latest = await getAgentRun(client, accessToken, runId);
        if (cancelled) return;
        consecutiveErrors = 0;
        setRun(latest);
        if (latest.status === 'error') {
          setPollError(latest.error_message || 'Something went wrong while processing your recording.');
          return;
        }
        const extracted = extractMenuPacket(latest);
        if (extracted) {
          setPacket((prev) => prev || extracted);
          return;
        }
        timer = setTimeout(poll, 3000);
      } catch (err: any) {
        if (cancelled) return;
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          const status = err?.response?.status;
          setPollError(
            status
              ? `Could not check on your recording (${status}). Pull to refresh or try again.`
              : 'Could not check on your recording -- check your connection and try again.'
          );
          return;
        }
        timer = setTimeout(poll, 4000);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, accessToken, runId]);

  const updateProfile = (field: string, value: string) => {
    setPacket((prev) => (prev ? { ...prev, restaurant_profile: { ...prev.restaurant_profile, [field]: value } } : prev));
  };

  const updateItem = (index: number, field: keyof EatsMenuPacketItem, value: string) => {
    setPacket((prev) => {
      if (!prev) return prev;
      const items = [...prev.menu_items];
      const current = { ...items[index] } as any;
      current[field] = field === 'price' ? (value ? Number(value) : null) : value;
      items[index] = current;
      return { ...prev, menu_items: items };
    });
  };

  const removeItem = (index: number) => {
    setPacket((prev) => {
      if (!prev) return prev;
      const items = prev.menu_items.filter((_, i) => i !== index);
      return { ...prev, menu_items: items };
    });
  };

  const addItem = () => {
    setPacket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        menu_items: [...prev.menu_items, { item_name: '', category: '', price: null, currency: 'USD', description: '' }],
      };
    });
  };

  const approve = async () => {
    if (!packet) return;
    if (!packet.restaurant_profile?.name?.trim()) {
      Alert.alert('Restaurant name required', 'Please add a restaurant name before approving.');
      return;
    }
    setApproving(true);
    try {
      const { restaurant_id } = await approveRestaurantScribe(client, accessToken, runId, packet);
      if (!restaurant_id) throw new Error('Approval succeeded but no restaurant id was returned.');
      onApproved(restaurant_id);
    } catch (err: any) {
      Alert.alert('Could not save', err?.response?.data?.detail || err?.message || 'Please try again.');
    } finally {
      setApproving(false);
    }
  };

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      {/* Same keyboard-covers-the-input problem as ScribeRecorderScreen,
          worse here since this screen is almost all TextInputs (restaurant
          profile + every menu item). */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}
      >
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.headerBack}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review your menu</Text>
        <View style={{ width: 50 }} />
      </View>

      {!packet && !pollError && (
        <View style={styles.centerFill}>
          <ActivityIndicator color={BRAND} />
          <Text style={styles.recorderHint}>
            Transcribing your recording and extracting the menu. This can take a minute…
          </Text>
        </View>
      )}

      {pollError && (
        <View style={styles.centerFill}>
          <Text style={styles.errorText}>{pollError}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onCancel}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {packet && (
        <ScrollView contentContainerStyle={styles.reviewBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>Restaurant</Text>
          <TextInput
            style={styles.input}
            placeholder="Restaurant name"
            value={packet.restaurant_profile?.name || ''}
            onChangeText={(v) => updateProfile('name', v)}
          />
          <TextInput
            style={styles.input}
            placeholder="Cuisine type"
            value={packet.restaurant_profile?.cuisine_type || ''}
            onChangeText={(v) => updateProfile('cuisine_type', v)}
          />
          <TextInput
            style={styles.input}
            placeholder="Address"
            value={packet.restaurant_profile?.address || ''}
            onChangeText={(v) => updateProfile('address', v)}
          />
          <TextInput
            style={styles.input}
            placeholder="Phone"
            value={packet.restaurant_profile?.phone || ''}
            onChangeText={(v) => updateProfile('phone', v)}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={packet.restaurant_profile?.email || ''}
            onChangeText={(v) => updateProfile('email', v)}
            autoCapitalize="none"
          />

          <Text style={styles.sectionTitle}>Menu items ({packet.menu_items.length})</Text>
          {packet.menu_items.map((item, index) => (
            <View key={index} style={styles.itemEditCard}>
              <TextInput
                style={styles.input}
                placeholder="Item name"
                value={item.item_name}
                onChangeText={(v) => updateItem(index, 'item_name', v)}
              />
              <View style={styles.itemEditRow}>
                <TextInput
                  style={[styles.input, styles.itemEditField]}
                  placeholder="Category"
                  value={item.category || ''}
                  onChangeText={(v) => updateItem(index, 'category', v)}
                />
                <TextInput
                  style={[styles.input, styles.itemEditField]}
                  placeholder="Price"
                  value={item.price != null ? String(item.price) : ''}
                  onChangeText={(v) => updateItem(index, 'price', v)}
                  keyboardType="decimal-pad"
                />
              </View>
              <TextInput
                style={styles.input}
                placeholder="Description"
                value={item.description || ''}
                onChangeText={(v) => updateItem(index, 'description', v)}
                multiline
              />
              <TouchableOpacity onPress={() => removeItem(index)}>
                <Text style={styles.removeItemText}>Remove item</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.secondaryButton} onPress={addItem}>
            <Text style={styles.secondaryButtonText}>+ Add item</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.primaryButton, { marginTop: 20 }]} onPress={approve} disabled={approving}>
            {approving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Approve & save</Text>}
          </TouchableOpacity>
          <Text style={styles.recorderHint}>
            Approving saves this menu and makes it searchable. You'll add photos for each item next.
          </Text>
        </ScrollView>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Step 3: per-item photo upload ───────────────────────────────────────

function MenuPhotosScreen({ restaurantId, onDone }: { restaurantId: string; onDone: () => void }) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [restaurantName, setRestaurantName] = useState('');
  const [items, setItems] = useState<EatsOwnerMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<EatsOwnerMenuItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await getRestaurantDetail(client, accessToken, restaurantId);
      setRestaurantName(detail.restaurant.name);
      setItems(detail.menu_items);
    } catch (err) {
      Alert.alert('Could not load menu', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, restaurantId]);

  useEffect(() => {
    load();
  }, [load]);

  const pickAndUpload = (item: EatsOwnerMenuItem) => {
    Alert.alert('Add photo', `Photo for "${item.item_name}"`, [
      { text: 'Take photo', onPress: () => captureAndUpload(item, 'camera') },
      { text: 'Choose from library', onPress: () => captureAndUpload(item, 'library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const captureAndUpload = async (item: EatsOwnerMenuItem, source: 'camera' | 'library') => {
    try {
      let permission;
      let result;
      if (source === 'camera') {
        permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access to take a photo.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [4, 3] });
      } else {
        permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Photo library permission needed', 'Allow photo library access to choose a photo.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [4, 3] });
      }
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setUploadingId(item.id);
      const uriParts = asset.uri.split('.');
      const ext = (uriParts[uriParts.length - 1] || 'jpg').toLowerCase();
      const mimeType = asset.mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg');
      const { image_url } = await uploadMenuItemPhoto(client, accessToken, restaurantId, item.id, {
        uri: asset.uri,
        mimeType,
        name: `menu-item-${item.id}.${ext}`,
      });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, image_url } : i)));
    } catch (err: any) {
      Alert.alert('Upload failed', err?.response?.data?.detail || err?.message || 'Please try again.');
    } finally {
      setUploadingId(null);
    }
  };

  const removePhoto = async (item: EatsOwnerMenuItem) => {
    setUploadingId(item.id);
    try {
      await deleteMenuItemPhoto(client, accessToken, restaurantId, item.id);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, image_url: null } : i)));
    } catch (err) {
      Alert.alert('Could not remove photo', 'Please try again.');
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={{ width: 50 }} />
        <Text style={styles.headerTitle}>Menu photos</Text>
        <TouchableOpacity onPress={onDone}>
          <Text style={styles.headerBack}>Done</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.recorderHint}>
        Add a photo for each item on {restaurantName || 'your menu'}. Customers see these when browsing in ADAR Eats.
      </Text>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : (
        <SectionList
          style={styles.list}
          sections={groupItemsByCategory(items)}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>
              {section.title} ({section.data.length})
            </Text>
          )}
          renderItem={({ item }) => (
            <View style={styles.photoCard}>
              <View style={styles.photoRow}>
                <TouchableOpacity style={styles.photoRowTappable} onPress={() => setDetailItem(item)} activeOpacity={0.7}>
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={styles.photoThumb} />
                  ) : (
                    <View style={[styles.photoThumb, styles.photoThumbPlaceholder]}>
                      <Text style={styles.photoThumbPlaceholderText}>No photo</Text>
                    </View>
                  )}
                  <View style={styles.photoRowInfo}>
                    <View style={styles.photoRowTitleLine}>
                      <Text style={styles.cardTitle}>{item.item_name || 'Untitled item'}</Text>
                      {item.price != null && (
                        <Text style={styles.photoPriceText}>{formatPrice(item.price, item.currency || 'USD')}</Text>
                      )}
                    </View>
                    <Text style={styles.cardSubtitle}>
                      {[item.category, item.quantity].filter(Boolean).join(' · ') || 'No category or qty set'}
                    </Text>
                    {item.description ? (
                      <Text style={styles.photoDescriptionText} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
                {uploadingId === item.id ? (
                  <ActivityIndicator color={BRAND} />
                ) : (
                  <View style={{ alignItems: 'flex-end' }}>
                    <TouchableOpacity onPress={() => pickAndUpload(item)}>
                      <Text style={styles.photoActionText}>{item.image_url ? 'Change' : 'Add photo'}</Text>
                    </TouchableOpacity>
                    {item.image_url && (
                      <TouchableOpacity onPress={() => removePhoto(item)}>
                        <Text style={styles.photoRemoveText}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No menu items yet.</Text>}
        />
      )}
      <MenuItemDetailModal
        item={detailItem}
        visible={!!detailItem}
        onClose={() => setDetailItem(null)}
        restaurantContext={false}
        editable
        onSave={async (edits) => {
          if (!detailItem) return;
          const updated = await updateMenuItem(client, accessToken, restaurantId, detailItem.id, edits);
          setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
          setDetailItem(updated);
        }}
      />
    </SafeAreaView>
  );
}

const TRANSCRIPT_STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  uploading: { label: 'Uploading…', bg: '#94a3b822', fg: '#64748b' },
  chunking: { label: 'Chunking…', bg: '#fbbf2422', fg: '#b45309' },
  chunked: { label: 'Ready to embed', bg: '#60a5fa22', fg: '#2563eb' },
  embedding: { label: 'Embedding…', bg: '#fbbf2422', fg: '#b45309' },
  embedded: { label: 'Embedded ✓', bg: '#4ade8022', fg: '#15803d' },
  error: { label: 'Error', bg: '#f8717122', fg: '#b91c1c' },
};

function TranscriptStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const meta = TRANSCRIPT_STATUS_META[status] || { label: status, bg: '#94a3b822', fg: '#64748b' };
  return (
    <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.statusBadgeText, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

function TranscriptScreen({ restaurantId, onDone }: { restaurantId: string; onDone: () => void }) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [draftText, setDraftText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showChunks, setShowChunks] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef(0);

  const applyResult = (result: EatsRestaurantTranscript) => {
    setDocumentId(result.document_id);
    setText(result.text || '');
    setStatus(result.status);
    setUpdatedAt(result.updated_at);
    if (result.chunk_count !== undefined) setChunkCount(result.chunk_count ?? null);
    if (result.error_message !== undefined) setErrorMessage(result.error_message ?? null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getRestaurantTranscript(client, accessToken, restaurantId);
      applyResult(result);
    } catch (err) {
      Alert.alert('Could not load transcript', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, restaurantId]);

  // Silent refresh (no full-screen spinner) used while polling a
  // background re-embed -- e.g. a menu item's price was just edited
  // elsewhere, which schedules _resync_restaurant_document_task after
  // the response is sent, so this screen needs to pick up the
  // embedding -> embedded (or error) transition on its own.
  const refreshStatusSilently = useCallback(async () => {
    try {
      const result = await getRestaurantTranscript(client, accessToken, restaurantId);
      applyResult(result);
    } catch {
      // ignore transient errors while polling
    }
  }, [client, accessToken, restaurantId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    if (status === 'embedding' || status === 'chunking') {
      if (!pollRef.current) {
        pollAttemptsRef.current = 0;
        pollRef.current = setInterval(() => {
          pollAttemptsRef.current += 1;
          if (pollAttemptsRef.current > 24) {
            stopPolling();
            return;
          }
          refreshStatusSilently();
        }, 2500);
      }
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [status, refreshStatusSilently]);

  const startEditing = () => {
    setDraftText(text);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraftText('');
  };

  const save = async () => {
    const trimmed = draftText.trim();
    if (!trimmed) {
      Alert.alert('Transcript is empty', 'Please enter some text before saving.');
      return;
    }
    setSaving(true);
    try {
      const result = await updateRestaurantTranscript(client, accessToken, restaurantId, trimmed);
      applyResult(result);
      setEditing(false);
      setDraftText('');
      const parts: string[] = [];
      if (result.menu_items_updated) parts.push(`${result.menu_items_updated} item(s) updated`);
      if (result.menu_items_inserted) parts.push(`${result.menu_items_inserted} item(s) added`);
      Alert.alert(
        'Transcript saved',
        parts.length ? `Menu synced: ${parts.join(', ')}. Re-embedding complete.` : 'Re-embedding complete.'
      );
      // Pick up the authoritative chunk_count/error_message the PATCH
      // response doesn't itself carry.
      load();
    } catch (err: any) {
      Alert.alert('Could not save transcript', err?.response?.data?.detail || err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={{ width: 50 }} />
        <Text style={styles.headerTitle}>Menu transcript</Text>
        <TouchableOpacity onPress={editing ? cancelEditing : onDone}>
          <Text style={styles.headerBack}>{editing ? 'Cancel' : 'Done'}</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.transcriptBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.transcriptHint}>
            {documentId
              ? 'This is the saved menu transcript used by the chat assistant to answer customer questions. Editing a menu item resyncs this transcript automatically, and editing this transcript syncs matching prices/descriptions back onto the menu -- both directions re-chunk and re-embed the document.'
              : 'No transcript has been generated for this restaurant yet. Approve a menu scribe to create one, or add menu items and it will be built automatically.'}
          </Text>
          {!editing && (status || chunkCount != null) ? (
            <View style={styles.transcriptStatusRow}>
              <TranscriptStatusBadge status={status} />
              {chunkCount != null ? <Text style={styles.transcriptMeta}>{chunkCount} chunk(s)</Text> : null}
              {documentId ? (
                <TouchableOpacity onPress={() => setShowChunks(true)}>
                  <Text style={styles.transcriptLinkText}>View chunks</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {errorMessage ? <Text style={styles.transcriptErrorText}>{errorMessage}</Text> : null}
          {editing ? (
            <TextInput
              style={styles.transcriptInput}
              value={draftText}
              onChangeText={setDraftText}
              multiline
              editable={!saving}
              placeholder="Restaurant details and menu items..."
            />
          ) : (
            <Text style={styles.transcriptText}>{text || 'No transcript text yet.'}</Text>
          )}
          {updatedAt && !editing ? (
            <Text style={styles.transcriptMeta}>Updated: {new Date(updatedAt).toLocaleString()}</Text>
          ) : null}
        </ScrollView>
      )}
      {!loading && (
        <View style={styles.transcriptFooter}>
          {editing ? (
            <>
              <TouchableOpacity style={[styles.manageButton, { flex: 1 }]} onPress={cancelEditing} disabled={saving}>
                <Text style={styles.manageButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.manageButton, { flex: 1 }]} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color={BRAND} /> : <Text style={styles.manageButtonText}>Save</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={[styles.manageButton, { flex: 1 }]} onPress={startEditing} disabled={!documentId}>
              <Text style={styles.manageButtonText}>Edit transcript</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <TranscriptChunksModal
        visible={showChunks}
        restaurantId={restaurantId}
        onClose={() => setShowChunks(false)}
      />
    </SafeAreaView>
  );
}

/** Mobile counterpart of the web Documents tab's ChunksViewer -- lists
 *  every chunk the transcript document was split into (index + word
 *  count) and lets the owner tap one to fetch and read its full text,
 *  so "see chunked menu data and whether reembedding happens or not" is
 *  answerable without needing the web app. */
function TranscriptChunksModal({
  visible,
  restaurantId,
  onClose,
}: {
  visible: boolean;
  restaurantId: string;
  onClose: () => void;
}) {
  const { session, client } = useAuth();
  const accessToken = session?.accessToken || '';
  const [loading, setLoading] = useState(false);
  const [chunks, setChunks] = useState<EatsTranscriptChunkSummary[]>([]);
  const [docMeta, setDocMeta] = useState<{ status?: string | null; chunk_count?: number | null; error_message?: string | null } | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeContent, setActiveContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setLoadError('');
    setActiveIndex(null);
    setActiveContent('');
    getRestaurantTranscriptChunks(client, accessToken, restaurantId)
      .then((result) => {
        setChunks(result.chunks || []);
        setDocMeta(result.document || null);
      })
      .catch((err: any) => {
        setLoadError(err?.response?.data?.detail || err?.message || 'Could not load chunks.');
      })
      .finally(() => setLoading(false));
  }, [visible, client, accessToken, restaurantId]);

  const selectChunk = async (index: number) => {
    setActiveIndex(index);
    setContentLoading(true);
    setActiveContent('');
    try {
      const result = await getRestaurantTranscriptChunkContent(client, accessToken, restaurantId, index);
      setActiveContent(result.content);
    } catch (err: any) {
      setActiveContent(err?.response?.data?.detail || err?.message || 'Could not load chunk content.');
    } finally {
      setContentLoading(false);
    }
  };

  return (
    // RN's <Modal> presents on its OWN native root (a separate UIWindow on
    // iOS), which is disconnected from the app root's SafeAreaProvider --
    // the SafeAreaView below was measuring (0,0,0,0) insets inside this
    // Modal specifically (every other Modal in this app is a bottom sheet
    // that never reaches the top of the screen, so this never showed up
    // before). With a 0 top inset the custom header -- including the only
    // "Close" button -- rendered up under the status bar/Dynamic Island,
    // where it's visible but not reliably tappable, trapping the owner on
    // this screen with no way back. Nesting a SafeAreaProvider here gives
    // this Modal's own native root something to measure insets against.
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <SafeAreaProvider>
      <View style={styles.chunksOverlay}>
        <SafeAreaView style={styles.chunksPanel} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <View style={{ width: 50 }} />
            <Text style={styles.headerTitle}>Transcript chunks</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.headerBack}>Close</Text>
            </TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
          ) : loadError ? (
            <Text style={[styles.transcriptErrorText, { margin: 16 }]}>{loadError}</Text>
          ) : (
            <>
              <View style={styles.chunksSummaryRow}>
                <TranscriptStatusBadge status={docMeta?.status ?? null} />
                <Text style={styles.transcriptMeta}>{chunks.length} chunk(s)</Text>
              </View>
              {docMeta?.error_message ? <Text style={[styles.transcriptErrorText, { marginHorizontal: 16 }]}>{docMeta.error_message}</Text> : null}
              <ScrollView style={styles.chunksList} contentContainerStyle={{ paddingBottom: 24 }}>
                {chunks.length === 0 ? (
                  <Text style={[styles.emptyText, { marginTop: 24 }]}>No chunks yet.</Text>
                ) : (
                  chunks.map((chunk) => (
                    <TouchableOpacity
                      key={chunk.index}
                      style={[styles.chunkRow, activeIndex === chunk.index && styles.chunkRowActive]}
                      onPress={() => selectChunk(chunk.index)}
                    >
                      <Text style={styles.chunkRowTitle}>Chunk #{chunk.index + 1}</Text>
                      <Text style={styles.chunkRowMeta}>{chunk.word_count} words</Text>
                    </TouchableOpacity>
                  ))
                )}
                {activeIndex !== null ? (
                  <View style={styles.chunkContentBox}>
                    {contentLoading ? (
                      <ActivityIndicator color={BRAND} />
                    ) : (
                      <Text style={styles.chunkContentText}>{activeContent}</Text>
                    )}
                  </View>
                ) : null}
              </ScrollView>
            </>
          )}
        </SafeAreaView>
      </View>
      </SafeAreaProvider>
    </Modal>
  );
}

/** Groups a flat menu list into the standard sections (Appetizer, Entree,
 *  Dessert, etc. -- see MENU_CATEGORY_ORDER/menuCategoryBucket in eatsApi)
 *  for SectionList, in a fixed display order, dropping any section with
 *  no items instead of showing an empty "Dessert (0)" header. */
function groupItemsByCategory(items: EatsOwnerMenuItem[]): { title: string; data: EatsOwnerMenuItem[] }[] {
  const buckets = new Map<string, EatsOwnerMenuItem[]>();
  for (const item of items) {
    const bucket = menuCategoryBucket(item.category);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(item);
  }
  return MENU_CATEGORY_ORDER.filter((bucket) => buckets.has(bucket)).map((bucket) => ({
    title: bucket,
    data: buckets.get(bucket)!,
  }));
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: BRAND,
  },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerBack: { color: '#c9d2dc', fontSize: 13, fontWeight: '600', width: 50 },
  listHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  listHeaderTitle: { fontSize: 20, fontWeight: '700', color: '#14181f', marginBottom: 10 },
  recordButton: { backgroundColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  recordButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  list: { flex: 1, marginTop: 8, paddingHorizontal: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  workspaceRow: { flexGrow: 0, marginBottom: 10 },
  workspaceChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f1f3f5',
    maxWidth: 180,
  },
  workspaceChipActive: { backgroundColor: BRAND },
  workspaceChipText: { fontSize: 12.5, fontWeight: '600', color: '#5b6472' },
  workspaceChipTextActive: { color: '#fff' },
  pendingRunsSection: { marginBottom: 16 },
  pendingRunsTitle: { fontSize: 13, fontWeight: '700', color: '#9a6b00', marginBottom: 8 },
  pendingRunCard: {
    backgroundColor: '#fff8e6',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(154,107,0,0.25)',
  },
  pendingRunName: { fontSize: 15, fontWeight: '700', color: '#14181f' },
  pendingRunMeta: { fontSize: 12.5, color: '#6b7280', marginTop: 2 },
  pendingRunAction: { fontSize: 12.5, fontWeight: '700', color: BRAND, marginTop: 6 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', flexShrink: 1 },
  cardSubtitle: { fontSize: 13, color: '#5b6472', marginTop: 2 },
  marketplaceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  marketplaceLabel: { fontSize: 12, color: '#374151', flexShrink: 1, paddingRight: 8 },
  manageButton: { marginTop: 10, alignSelf: 'flex-start' },
  manageButtonText: { color: BRAND, fontWeight: '600', fontSize: 13 },
  cardButtonRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8, marginTop: 2 },
  transcriptBody: { padding: 16, paddingBottom: 40 },
  transcriptHint: { fontSize: 13, color: '#5b6472', marginBottom: 12, lineHeight: 19 },
  transcriptText: { fontSize: 14, color: '#14181f', lineHeight: 21 },
  transcriptInput: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, padding: 14, fontSize: 14,
    color: '#14181f', backgroundColor: '#fff', minHeight: 320, textAlignVertical: 'top', lineHeight: 20,
  },
  transcriptFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 10 },
  transcriptMeta: { fontSize: 11.5, color: '#8a93a3', marginTop: 10 },
  transcriptStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' },
  transcriptLinkText: { fontSize: 13, color: '#1b5fd6', fontWeight: '600' },
  transcriptErrorText: { fontSize: 12.5, color: '#b91c1c', marginBottom: 10, lineHeight: 18 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusBadgeText: { fontSize: 11.5, fontWeight: '700' },
  chunksOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  chunksPanel: { flex: 1, backgroundColor: '#fff' },
  chunksSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  chunksList: { flex: 1, paddingHorizontal: 16 },
  chunkRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1,
    borderColor: '#e4e7ec', marginBottom: 8, backgroundColor: '#fff',
  },
  chunkRowActive: { borderColor: BRAND, backgroundColor: '#f3f5f8' },
  chunkRowTitle: { fontSize: 13.5, fontWeight: '600', color: '#14181f' },
  chunkRowMeta: { fontSize: 12, color: '#8a93a3' },
  chunkContentBox: {
    marginTop: 4, marginBottom: 20, padding: 14, borderRadius: 10,
    backgroundColor: '#f7f8fa', borderWidth: 1, borderColor: '#e4e7ec', minHeight: 80,
  },
  chunkContentText: { fontSize: 13, color: '#14181f', lineHeight: 19 },
  emptyText: { textAlign: 'center', color: '#5b6472', marginTop: 40, paddingHorizontal: 20, fontSize: 14 },
  errorText: {
    marginHorizontal: 16,
    marginTop: 10,
    color: '#c0392b',
    backgroundColor: '#fdecea',
    padding: 10,
    borderRadius: 10,
    fontSize: 13,
  },
  recorderBody: { padding: 20, alignItems: 'stretch' },
  recorderHint: { fontSize: 13, color: '#5b6472', textAlign: 'center', marginTop: 12, paddingHorizontal: 12 },
  recorderCircleWrap: { alignItems: 'center', marginTop: 30, marginBottom: 20 },
  recorderCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recorderCircleActive: { backgroundColor: '#c0392b' },
  recorderIcon: { fontSize: 36, color: '#fff' },
  recorderTimer: { marginTop: 14, fontSize: 14, color: '#374151', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#d7dbe0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    marginTop: 10,
  },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#9aa3af',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: { backgroundColor: BRAND, borderColor: BRAND },
  checkboxMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkboxLabel: { flex: 1, fontSize: 13, color: '#374151' },
  recorderActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  primaryButton: { flex: 1, backgroundColor: BRAND, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#eef1f0',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryButtonText: { color: '#374151', fontWeight: '700', fontSize: 14 },
  reviewBody: { padding: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#14181f', marginTop: 18, marginBottom: 4 },
  itemEditCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e7eaee',
  },
  itemEditRow: { flexDirection: 'row', gap: 10 },
  itemEditField: { flex: 1 },
  removeItemText: { color: '#c0392b', fontSize: 12, fontWeight: '600', marginTop: 8, textAlign: 'right' },
  photoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  photoRowTappable: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5b6472',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 2,
    paddingTop: 14,
    paddingBottom: 6,
  },
  photoThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#eef1f0' },
  photoThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoThumbPlaceholderText: { fontSize: 9, color: '#9aa3af', textAlign: 'center' },
  photoRowInfo: { flex: 1 },
  photoRowTitleLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  photoPriceText: { fontSize: 14, fontWeight: '700', color: BRAND },
  photoDescriptionText: { fontSize: 12, color: '#374151', marginTop: 4 },
  photoActionText: { color: BRAND, fontWeight: '700', fontSize: 13 },
  photoRemoveText: { color: '#c0392b', fontWeight: '600', fontSize: 11, marginTop: 4 },
});
