import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { AxiosInstance } from 'axios';
import {
  EatsEvent,
  EatsEventMenuItem,
  EatsEventStall,
  EatsOwnerMenuItem,
  EatsOwnerRestaurant,
  createStallMenuItem,
  deleteStallMenuItem,
  deleteStallMenuItemPhoto,
  getMyStall,
  getRestaurantDetail,
  listAvailableEvents,
  listMyStalls,
  requestStall,
  updateMyStall,
  updateStallMenuItem,
  uploadStallMenuItemPhoto,
} from './eatsApi';

const BRAND = '#1b2430';

function formatPrice(price: number | null, currency: string) {
  if (price == null) return '';
  return `${currency === 'USD' ? '$' : currency + ' '}${price.toFixed(2)}`;
}

type Screen = 'stalls' | 'request' | 'stallDetail';

/** Owner-side Events & Stalls setup: request a stall at an event open for
 *  onboarding, then manage that stall (accepting_orders, zone/power
 *  fields) and its event menu (link regular menu items or add event-only
 *  ones, with photos). Mirrors the plain useState-stack pattern
 *  DineInManageScreen.tsx/OwnerDashboardScreen.tsx use -- one more screen
 *  in that same stack, not a new navigation concept. Admin event
 *  creation/approval has no screen here -- that stays web-only. */
export function EventsManageScreen({
  client,
  accessToken,
  restaurant,
  onDone,
}: {
  client: AxiosInstance;
  accessToken: string;
  restaurant: EatsOwnerRestaurant;
  onDone: () => void;
}) {
  const [screen, setScreen] = useState<Screen>('stalls');
  const [stalls, setStalls] = useState<EatsEventStall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStallId, setActiveStallId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listMyStalls(client, accessToken, restaurant.id);
      setStalls(rows);
    } catch {
      setError('Could not load your stalls. Pull down or reopen this screen to try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, restaurant.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (screen === 'request') {
    return (
      <RequestStallScreen
        client={client}
        accessToken={accessToken}
        restaurant={restaurant}
        existingEventIds={stalls.map((s) => s.event_id)}
        onCancel={() => setScreen('stalls')}
        onRequested={() => {
          setScreen('stalls');
          load();
        }}
      />
    );
  }

  if (screen === 'stallDetail' && activeStallId) {
    return (
      <StallDetailScreen
        client={client}
        accessToken={accessToken}
        restaurant={restaurant}
        stallId={activeStallId}
        onDone={() => {
          setScreen('stalls');
          load();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onDone}>
          <Text style={styles.backLink}>← Done</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Events — {restaurant.name}</Text>
        <View style={{ width: 50 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <TouchableOpacity style={styles.primaryButton} onPress={() => setScreen('request')}>
          <Text style={styles.primaryButtonText}>+ Request a stall at an event</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>My stalls</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={BRAND} />
        ) : stalls.length === 0 ? (
          <Text style={styles.emptyText}>You haven't requested a stall at any event yet.</Text>
        ) : (
          stalls.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.stallCard}
              onPress={() => {
                setActiveStallId(s.id);
                setScreen('stallDetail');
              }}
            >
              <Text style={styles.stallName}>{s.stall_name}</Text>
              <Text style={styles.stallMeta}>
                {s.event_name || 'Event'} · {s.status}
                {s.status === 'active' && !s.accepting_orders ? ' · paused' : ''}
              </Text>
              {s.status === 'rejected' && s.rejection_reason ? (
                <Text style={styles.stallRejected}>Rejected: {s.rejection_reason}</Text>
              ) : null}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Request a stall ──────────────────────────────────────────────────────
function RequestStallScreen({
  client,
  accessToken,
  restaurant,
  existingEventIds,
  onCancel,
  onRequested,
}: {
  client: AxiosInstance;
  accessToken: string;
  restaurant: EatsOwnerRestaurant;
  existingEventIds: string[];
  onCancel: () => void;
  onRequested: () => void;
}) {
  const [events, setEvents] = useState<EatsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [stallName, setStallName] = useState('');
  const [locationZone, setLocationZone] = useState('');
  const [spacePowerNeeds, setSpacePowerNeeds] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const all = await listAvailableEvents(client, accessToken);
        setEvents(all.filter((e) => !existingEventIds.includes(e.id)));
      } catch {
        setError('Could not load events open for onboarding.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!selectedEventId) {
      setError('Pick an event first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await requestStall(client, accessToken, restaurant.id, {
        eventId: selectedEventId,
        stallName: stallName.trim(),
        locationZone: locationZone.trim(),
        spacePowerNeeds: spacePowerNeeds.trim(),
      });
      onRequested();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not submit this stall request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.backLink}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Request a stall</Text>
        <View style={{ width: 50 }} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} color={BRAND} />
        ) : events.length === 0 ? (
          <Text style={styles.emptyText}>No events are currently open for stall requests.</Text>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Event</Text>
            {events.map((e) => (
              <TouchableOpacity
                key={e.id}
                style={[styles.optionRow, selectedEventId === e.id && styles.optionRowActive]}
                onPress={() => setSelectedEventId(e.id)}
              >
                <Text style={[styles.optionText, selectedEventId === e.id && styles.optionTextActive]}>
                  {e.name}{e.venue ? ` · ${e.venue}` : ''}
                </Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.sectionTitle}>Stall name (optional)</Text>
            <TextInput
              style={styles.input}
              value={stallName}
              onChangeText={setStallName}
              placeholder={`${restaurant.name} at this event`}
            />
            <Text style={styles.sectionTitle}>Preferred zone (optional)</Text>
            <TextInput style={styles.input} value={locationZone} onChangeText={setLocationZone} placeholder="e.g. Food Court North" />
            <Text style={styles.sectionTitle}>Space / power needs (optional)</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={spacePowerNeeds}
              onChangeText={setSpacePowerNeeds}
              placeholder="e.g. 10x10 booth, two 120V outlets"
              multiline
            />

            {error && <Text style={styles.errorText}>{error}</Text>}
            <TouchableOpacity style={styles.primaryButton} onPress={submit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Submit request</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Stall detail: pacing, fields, menu ───────────────────────────────────
function StallDetailScreen({
  client,
  accessToken,
  restaurant,
  stallId,
  onDone,
}: {
  client: AxiosInstance;
  accessToken: string;
  restaurant: EatsOwnerRestaurant;
  stallId: string;
  onDone: () => void;
}) {
  const [stall, setStall] = useState<EatsEventStall | null>(null);
  const [items, setItems] = useState<EatsEventMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [stallName, setStallName] = useState('');
  const [locationZone, setLocationZone] = useState('');
  const [spacePowerNeeds, setSpacePowerNeeds] = useState('');
  const [editingFields, setEditingFields] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await getMyStall(client, accessToken, restaurant.id, stallId);
      setStall(detail);
      setItems(detail.menu_items);
      setStallName(detail.stall_name);
      setLocationZone(detail.location_zone);
      setSpacePowerNeeds(detail.space_power_needs);
    } catch {
      setError('Could not load this stall. Pull down or reopen this screen to try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, restaurant.id, stallId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleAccepting = async () => {
    if (!stall) return;
    setSaving(true);
    try {
      const updated = await updateMyStall(client, accessToken, restaurant.id, stallId, {
        acceptingOrders: !stall.accepting_orders,
      });
      setStall((prev) => (prev ? { ...prev, accepting_orders: updated.accepting_orders } : prev));
    } catch {
      Alert.alert('Could not update', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveFields = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMyStall(client, accessToken, restaurant.id, stallId, {
        stallName: stallName.trim(),
        locationZone: locationZone.trim(),
        spacePowerNeeds: spacePowerNeeds.trim(),
      });
      setStall((prev) => (prev ? { ...prev, ...updated } : updated));
      setEditingFields(false);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not save these details.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !stall) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onDone}>
            <Text style={styles.backLink}>← Done</Text>
          </TouchableOpacity>
        </View>
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
        {error && <Text style={styles.errorText}>{error}</Text>}
      </SafeAreaView>
    );
  }

  const locked = stall.status === 'rejected';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onDone}>
          <Text style={styles.backLink}>← Done</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{stall.stall_name}</Text>
        <View style={{ width: 50 }} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Text style={styles.stallMeta}>
          {stall.event_name || 'Event'} · Status: {stall.status}
        </Text>
        {locked && stall.rejection_reason ? (
          <Text style={styles.stallRejected}>Rejected: {stall.rejection_reason}</Text>
        ) : null}

        {stall.status === 'active' && (
          <View style={styles.pacingRow}>
            <Text style={styles.pacingLabel}>Accepting new orders</Text>
            <Switch value={stall.accepting_orders} onValueChange={toggleAccepting} disabled={saving} trackColor={{ true: BRAND }} />
          </View>
        )}

        {!locked && (
          <View>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Stall details</Text>
              {!editingFields && (
                <TouchableOpacity onPress={() => setEditingFields(true)}>
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
            {editingFields ? (
              <>
                <Text style={styles.fieldLabel}>Stall name</Text>
                <TextInput style={styles.input} value={stallName} onChangeText={setStallName} />
                <Text style={styles.fieldLabel}>Zone</Text>
                <TextInput style={styles.input} value={locationZone} onChangeText={setLocationZone} />
                <Text style={styles.fieldLabel}>Space / power needs</Text>
                <TextInput style={[styles.input, styles.multiline]} value={spacePowerNeeds} onChangeText={setSpacePowerNeeds} multiline />
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.secondaryButtonSmall} onPress={() => setEditingFields(false)}>
                    <Text style={styles.secondaryButtonSmallText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primaryButtonSmall} onPress={saveFields} disabled={saving}>
                    {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonSmallText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.stallMeta}>Zone: {stall.location_zone || 'Not set'}</Text>
                <Text style={styles.stallMeta}>Space/power: {stall.space_power_needs || 'Not set'}</Text>
              </>
            )}
          </View>
        )}

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Event menu</Text>
        <StallMenuEditor
          client={client}
          accessToken={accessToken}
          restaurantId={restaurant.id}
          stallId={stallId}
          items={items}
          locked={locked}
          onChanged={load}
        />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Event menu editor ─────────────────────────────────────────────────────
function StallMenuEditor({
  client,
  accessToken,
  restaurantId,
  stallId,
  items,
  locked,
  onChanged,
}: {
  client: AxiosInstance;
  accessToken: string;
  restaurantId: string;
  stallId: string;
  items: EatsEventMenuItem[];
  locked: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [catalog, setCatalog] = useState<EatsOwnerMenuItem[]>([]);
  const [existingId, setExistingId] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newDescription, setNewDescription] = useState('');

  useEffect(() => {
    if (showAdd && mode === 'existing' && catalog.length === 0) {
      getRestaurantDetail(client, accessToken, restaurantId)
        .then((d) => setCatalog(d.menu_items || []))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdd, mode]);

  const addItem = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'existing') {
        if (!existingId) {
          setError('Pick a menu item.');
          setBusy(false);
          return;
        }
        await createStallMenuItem(client, accessToken, restaurantId, stallId, { menuItemId: existingId });
      } else {
        const price = parseFloat(newPrice);
        if (!newName.trim() || !Number.isFinite(price)) {
          setError('Name and price are required for a net-new item.');
          setBusy(false);
          return;
        }
        await createStallMenuItem(client, accessToken, restaurantId, stallId, {
          itemName: newName.trim(), category: newCategory, description: newDescription, price,
        });
      }
      setExistingId(''); setNewName(''); setNewCategory(''); setNewPrice(''); setNewDescription('');
      setShowAdd(false);
      onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not add this item.');
    } finally {
      setBusy(false);
    }
  };

  const toggleAvailability = async (item: EatsEventMenuItem) => {
    setBusy(true);
    try {
      await updateStallMenuItem(client, accessToken, restaurantId, stallId, item.id, {
        availability: item.availability === 'available' ? 'unavailable' : 'available',
      });
      onChanged();
    } catch {
      Alert.alert('Could not update', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeItem = (item: EatsEventMenuItem) => {
    Alert.alert('Remove item', `Remove "${item.item_name}" from this event's menu?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteStallMenuItem(client, accessToken, restaurantId, stallId, item.id);
            onChanged();
          } catch {
            Alert.alert('Could not remove', 'Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const pickAndUpload = (item: EatsEventMenuItem) => {
    Alert.alert('Add photo', `Photo for "${item.item_name}"`, [
      { text: 'Take photo', onPress: () => captureAndUpload(item, 'camera') },
      { text: 'Choose from library', onPress: () => captureAndUpload(item, 'library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const captureAndUpload = async (item: EatsEventMenuItem, source: 'camera' | 'library') => {
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
      setPhotoBusyId(item.id);
      const uriParts = asset.uri.split('.');
      const ext = (uriParts[uriParts.length - 1] || 'jpg').toLowerCase();
      const mimeType = asset.mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg');
      await uploadStallMenuItemPhoto(client, accessToken, restaurantId, stallId, item.id, {
        uri: asset.uri, mimeType, name: `event-item-${item.id}.${ext}`,
      });
      onChanged();
    } catch (err: any) {
      Alert.alert('Upload failed', err?.response?.data?.detail || err?.message || 'Please try again.');
    } finally {
      setPhotoBusyId(null);
    }
  };

  const removePhoto = async (item: EatsEventMenuItem) => {
    setPhotoBusyId(item.id);
    try {
      await deleteStallMenuItemPhoto(client, accessToken, restaurantId, stallId, item.id);
      onChanged();
    } catch {
      Alert.alert('Could not remove photo', 'Please try again.');
    } finally {
      setPhotoBusyId(null);
    }
  };

  return (
    <View>
      {error && <Text style={styles.errorText}>{error}</Text>}
      {items.length === 0 && <Text style={styles.emptyText}>No items added to this stall's event menu yet.</Text>}
      {items.map((item) => (
        <View key={item.id} style={styles.menuItemRow}>
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.menuThumb} />
          ) : (
            <View style={[styles.menuThumb, styles.menuThumbEmpty]}>
              <Text style={styles.menuThumbEmptyText}>No photo</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.menuItemName}>{item.item_name}</Text>
            <Text style={styles.stallMeta}>
              {formatPrice(item.price, item.currency)} · {item.availability}
              {item.has_inherited_photo ? ' · using regular-menu photo' : ''}
            </Text>
            {!locked && (
              <View style={styles.photoActionsRow}>
                {photoBusyId === item.id ? (
                  <ActivityIndicator size="small" color={BRAND} />
                ) : item.image_gcs_path ? (
                  <TouchableOpacity onPress={() => removePhoto(item)}>
                    <Text style={styles.photoRemoveText}>Remove photo</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => pickAndUpload(item)}>
                    <Text style={styles.photoActionText}>{item.has_inherited_photo ? 'Replace photo' : 'Add photo'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
          {!locked && (
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <TouchableOpacity disabled={busy} onPress={() => toggleAvailability(item)}>
                <Text style={styles.photoActionText}>{item.availability === 'available' ? "Mark 86'd" : 'Mark available'}</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={busy} onPress={() => removeItem(item)}>
                <Text style={styles.photoRemoveText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}

      {!locked && !showAdd && (
        <TouchableOpacity style={styles.secondaryButtonSmall} onPress={() => setShowAdd(true)}>
          <Text style={styles.secondaryButtonSmallText}>+ Add item</Text>
        </TouchableOpacity>
      )}
      {!locked && showAdd && (
        <View style={styles.addItemBox}>
          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.modeChip, mode === 'existing' && styles.modeChipActive]} onPress={() => setMode('existing')}>
              <Text style={[styles.modeChipText, mode === 'existing' && styles.modeChipTextActive]}>From regular menu</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeChip, mode === 'new' && styles.modeChipActive]} onPress={() => setMode('new')}>
              <Text style={[styles.modeChipText, mode === 'new' && styles.modeChipTextActive]}>Event-only item</Text>
            </TouchableOpacity>
          </View>
          {mode === 'existing' ? (
            catalog.length === 0 ? (
              <Text style={styles.stallMeta}>Loading your regular menu…</Text>
            ) : (
              catalog.map((ci) => (
                <TouchableOpacity
                  key={ci.id}
                  style={[styles.optionRow, existingId === ci.id && styles.optionRowActive]}
                  onPress={() => setExistingId(ci.id)}
                >
                  <Text style={[styles.optionText, existingId === ci.id && styles.optionTextActive]}>
                    {ci.item_name} ({formatPrice(ci.price, ci.currency)})
                  </Text>
                </TouchableOpacity>
              ))
            )
          ) : (
            <>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput style={styles.input} value={newName} onChangeText={setNewName} />
              <Text style={styles.fieldLabel}>Price</Text>
              <TextInput style={styles.input} value={newPrice} onChangeText={setNewPrice} keyboardType="decimal-pad" />
              <Text style={styles.fieldLabel}>Category</Text>
              <TextInput style={styles.input} value={newCategory} onChangeText={setNewCategory} />
              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput style={[styles.input, styles.multiline]} value={newDescription} onChangeText={setNewDescription} multiline />
            </>
          )}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.secondaryButtonSmall} onPress={() => setShowAdd(false)}>
              <Text style={styles.secondaryButtonSmallText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButtonSmall} disabled={busy} onPress={addItem}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonSmallText}>Add to event menu</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16,
    paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#eef1f0',
  },
  backLink: { fontSize: 13, color: BRAND, fontWeight: '600', width: 50 },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: BRAND, textAlign: 'center', marginHorizontal: 8 },
  scrollContent: { padding: 16, paddingBottom: 60, gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: BRAND, marginTop: 14, marginBottom: 6 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  editLink: { fontSize: 13, color: BRAND, fontWeight: '700' },
  emptyText: { fontSize: 13, color: '#5b6472' },
  errorText: { fontSize: 12, color: '#c0392b', fontWeight: '600', backgroundColor: '#fdecea', padding: 8, borderRadius: 8 },
  primaryButton: { backgroundColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 6 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  stallCard: { backgroundColor: '#f4f6f5', borderRadius: 10, padding: 12, marginBottom: 8 },
  stallName: { fontSize: 15, fontWeight: '700', color: BRAND },
  stallMeta: { fontSize: 12, color: '#5b6472', marginTop: 2 },
  stallRejected: { fontSize: 12, color: '#c0392b', fontWeight: '600', marginTop: 4 },
  optionRow: { borderWidth: 1, borderColor: '#dde2e0', borderRadius: 8, padding: 10, marginBottom: 6 },
  optionRowActive: { borderColor: BRAND, backgroundColor: '#eef1f0' },
  optionText: { fontSize: 13, color: BRAND },
  optionTextActive: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#dde2e0', borderRadius: 8, padding: 10, fontSize: 14, color: BRAND, marginBottom: 8 },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#5b6472', marginBottom: 4 },
  pacingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingVertical: 8 },
  pacingLabel: { fontSize: 13, fontWeight: '700', color: BRAND },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  secondaryButtonSmall: { flex: 1, borderWidth: 1, borderColor: BRAND, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  secondaryButtonSmallText: { color: BRAND, fontWeight: '700', fontSize: 13 },
  primaryButtonSmall: { flex: 1, backgroundColor: BRAND, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  primaryButtonSmallText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  menuItemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eef1f0' },
  menuThumb: { width: 48, height: 48, borderRadius: 8 },
  menuThumbEmpty: { backgroundColor: '#f4f6f5', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dde2e0', borderStyle: 'dashed' },
  menuThumbEmptyText: { fontSize: 8.5, color: '#9aa2ad', textAlign: 'center' },
  menuItemName: { fontSize: 14, fontWeight: '700', color: '#14181f' },
  photoActionsRow: { marginTop: 4 },
  photoActionText: { fontSize: 12, color: BRAND, fontWeight: '700' },
  photoRemoveText: { fontSize: 12, color: '#c0392b', fontWeight: '700' },
  addItemBox: { backgroundColor: '#f4f6f5', borderRadius: 10, padding: 10, marginTop: 10 },
  modeChip: { flex: 1, borderWidth: 1, borderColor: '#dde2e0', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  modeChipActive: { backgroundColor: BRAND, borderColor: BRAND },
  modeChipText: { fontSize: 12, fontWeight: '700', color: '#5b6472' },
  modeChipTextActive: { color: '#fff' },
});
