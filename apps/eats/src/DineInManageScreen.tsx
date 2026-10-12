import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import { AxiosInstance } from 'axios';
import {
  EatsDineInTable,
  EatsDineInWorkingHour,
  EatsOwnerRestaurant,
  enableDineIn,
  getOwnerDineInHours,
  listOwnerTables,
  updateOwnerDineInHours,
  updateOwnerTables,
} from './eatsApi';
import { DineInBookingsScreen } from './DineInBookingsScreen';

const BRAND = '#1b2430';
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// A fixed dropdown instead of free text -- a typed value like "PST" isn't a
// real IANA zone (adar-rag's backend now rejects it outright), and even
// before that validation existed, a bad value here silently made customers
// and the chat assistant see times in a completely different zone than the
// owner intended. Real IANA names with their common labels, covering every
// US-mainland zone plus Alaska/Hawaii; DST is handled automatically by the
// zone itself, so there's no separate PST/PDT choice to get wrong.
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles, Seattle, Bothell)' },
  { value: 'America/Denver', label: 'Mountain Time (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (no daylight saving)' },
  { value: 'America/Chicago', label: 'Central Time (Chicago)' },
  { value: 'America/New_York', label: 'Eastern Time (New York)' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
];

type EditableTable = { id?: string; name: string; seats: string };
type EditableHour = EatsDineInWorkingHour & { enabled: boolean };

function defaultHours(): EditableHour[] {
  return WEEKDAY_LABELS.map((_, weekday) => ({
    weekday,
    start: '11:00',
    end: '21:00',
    enabled: weekday < 6, // Mon-Sat open by default, Sun closed -- just a
    // starting point the owner edits, not a real assumption about any
    // restaurant's actual hours.
  }));
}

/** Owner-side dine-in setup: turn reservations on, define the physical
 *  tables  (as party-size tiers -- "2 tables that seat 2", "1 table that
 *  seats 6"), and set the working hours the booking engine checks
 *  availability against. Mirrors the plain useState-stack pattern the
 *  rest of OwnerDashboardScreen.tsx uses -- this is one more screen in
 *  that same stack, not a new navigation concept. */
export function DineInManageScreen({
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
  const [enabled, setEnabled] = useState(!!restaurant.dine_in_enabled);
  const [enabling, setEnabling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBookings, setShowBookings] = useState(false);

  const [tables, setTables] = useState<EditableTable[]>([]);
  const [hours, setHours] = useState<EditableHour[]>(defaultHours());
  const [leadTimeMinutes, setLeadTimeMinutes] = useState('120');
  // Best guess at setup time -- the device's own IANA zone. Shown/editable
  // below so the owner can correct it if they're not setting this up from
  // the restaurant itself. This MUST match the restaurant's real location:
  // working hours are stored as plain wall-clock "HH:MM" and the booking
  // engine interprets them in this zone, so a wrong value here is what
  // caused customers to see availability shifted by several hours.
  // Snap the device's detected zone to the nearest option in our fixed
  // list (exact match if it's already one of the seven; America/Los_Angeles
  // otherwise) rather than seeding the picker with a value that isn't one
  // of its own choices.
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const [timezone, setTimezone] = useState(
    TIMEZONE_OPTIONS.some((o) => o.value === detectedTz) ? detectedTz : 'America/Los_Angeles'
  );
  const [timezonePickerOpen, setTimezonePickerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!restaurant.dine_in_enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [tableRows, hoursRes] = await Promise.all([
        listOwnerTables(client, accessToken, restaurant.id),
        getOwnerDineInHours(client, accessToken, restaurant.id),
      ]);
      setTables(
        tableRows.length
          ? tableRows.map((t) => ({ id: t.id, name: t.name, seats: String(t.seats) }))
          : [{ name: 'Table 1', seats: '2' }]
      );
      setLeadTimeMinutes(String(hoursRes.lead_time_minutes ?? 120));
      if (hoursRes.timezone) {
        // A restaurant set up before this screen had a fixed list (or one
        // still carrying a since-rejected free-text value like "PST") may
        // come back with something that isn't one of our seven options --
        // fall back rather than feeding the picker a value it can't show,
        // and the owner saving once more will persist a real zone.
        setTimezone(
          TIMEZONE_OPTIONS.some((o) => o.value === hoursRes.timezone) ? hoursRes.timezone : 'America/Los_Angeles'
        );
      }
      if (hoursRes.working_hours?.length) {
        const byWeekday = new Map(hoursRes.working_hours.map((h) => [h.weekday, h]));
        setHours(
          WEEKDAY_LABELS.map((_, weekday) => {
            const h = byWeekday.get(weekday);
            return h ? { ...h, enabled: true } : { weekday, start: '11:00', end: '21:00', enabled: false };
          })
        );
      }
    } catch {
      setError('Could not load your dine-in setup. Pull down or reopen this screen to try again.');
    } finally {
      setLoading(false);
    }
  }, [client, accessToken, restaurant]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleEnable() {
    setEnabling(true);
    setError(null);
    try {
      await enableDineIn(client, accessToken, restaurant.id, { notificationEmail: restaurant.email, timezone });
      setEnabled(true);
      setTables([{ name: 'Table 1', seats: '2' }]);
      setHours(defaultHours());
    } catch {
      Alert.alert('Could not enable dine-in', 'Please try again.');
    } finally {
      setEnabling(false);
    }
  }

  function updateTable(index: number, patch: Partial<EditableTable>) {
    setTables((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function addTable() {
    setTables((prev) => [...prev, { name: `Table ${prev.length + 1}`, seats: '2' }]);
  }

  function removeTable(index: number) {
    setTables((prev) => prev.filter((_, i) => i !== index));
  }

  function updateHour(weekday: number, patch: Partial<EditableHour>) {
    setHours((prev) => prev.map((h) => (h.weekday === weekday ? { ...h, ...patch } : h)));
  }

  async function handleSave() {
    const cleanTables = tables
      .map((t) => ({ id: t.id, name: t.name.trim(), seats: parseInt(t.seats, 10) }))
      .filter((t) => t.name && t.seats > 0);
    if (cleanTables.length === 0) {
      setError('Add at least one table before saving.');
      return;
    }
    const activeHours = hours
      .filter((h) => h.enabled)
      .map(({ weekday, start, end }) => ({ weekday, start, end }));
    const lead = parseInt(leadTimeMinutes, 10);

    setSaving(true);
    setError(null);
    try {
      const savedTables = await updateOwnerTables(client, accessToken, restaurant.id, cleanTables);
      setTables(savedTables.map((t) => ({ id: t.id, name: t.name, seats: String(t.seats) })));
      await updateOwnerDineInHours(client, accessToken, restaurant.id, activeHours, Number.isFinite(lead) ? lead : undefined, timezone);
      Alert.alert('Saved', 'Your dine-in tables and hours are up to date.');
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not save. Check your tables and hours and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (showBookings) {
    return (
      <DineInBookingsScreen
        client={client}
        accessToken={accessToken}
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
        onBack={() => setShowBookings(false)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onDone}>
          <Text style={styles.backLink}>← Done</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Dine-In — {restaurant.name}</Text>
        {enabled ? (
          <TouchableOpacity onPress={() => setShowBookings(true)}>
            <Text style={styles.bookingsLink}>Bookings</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {!enabled ? (
        <View style={styles.enableBox}>
          <Text style={styles.enableTitle}>Table reservations are off</Text>
          <Text style={styles.enableSubtitle}>
            Turn this on to let customers reserve a table for dine-in, up to 7 days ahead, alongside carryout
            ordering.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleEnable} disabled={enabling}>
            {enabling ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Turn on dine-in</Text>}
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {error && <Text style={styles.errorText}>{error}</Text>}

          <View>
            <Text style={styles.sectionTitle}>Tables</Text>
            <Text style={styles.sectionHint}>
              Add each physical table with how many it seats. Same-size tables are shown to customers as a group
              (e.g. "Tables for 2").
            </Text>
            {tables.map((t, i) => (
              <View key={t.id ?? `new-${i}`} style={styles.tableRow}>
                <TextInput
                  style={[styles.input, styles.tableNameInput]}
                  value={t.name}
                  onChangeText={(v) => updateTable(i, { name: v })}
                  placeholder="Table name"
                />
                <TextInput
                  style={[styles.input, styles.tableSeatsInput]}
                  value={t.seats}
                  onChangeText={(v) => updateTable(i, { seats: v.replace(/[^0-9]/g, '') })}
                  placeholder="Seats"
                  keyboardType="number-pad"
                />
                <TouchableOpacity style={styles.removeButton} onPress={() => removeTable(i)}>
                  <Text style={styles.removeButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addLink} onPress={addTable}>
              <Text style={styles.addLinkText}>+ Add table</Text>
            </TouchableOpacity>
          </View>

          <View>
            <Text style={styles.sectionTitle}>Working hours</Text>
            <Text style={styles.sectionHint}>Customers can only book within these hours on each day.</Text>
            {hours.map((h) => (
              <View key={h.weekday} style={styles.hourRow}>
                <View style={styles.hourDayToggle}>
                  <Switch
                    style={styles.hourDaySwitch}
                    value={h.enabled}
                    onValueChange={(v) => updateHour(h.weekday, { enabled: v })}
                    trackColor={{ true: BRAND }}
                  />
                  <Text style={styles.hourDayLabel} numberOfLines={1}>
                    {WEEKDAY_LABELS[h.weekday]}
                  </Text>
                </View>
                <TextInput
                  style={[styles.input, styles.hourTimeInput, !h.enabled && styles.inputDisabled]}
                 value={h.start}
                  onChangeText={(v) => updateHour(h.weekday, { start: v })}
                  placeholder="11:00"
                  editable={h.enabled}
                />
                <Text style={styles.hourToLabel}>to</Text>
                <TextInput
                  style={[styles.input, styles.hourTimeInput, !h.enabled && styles.inputDisabled]}
                  value={h.end}
                  onChangeText={(v) => updateHour(h.weekday, { end: v })}
                  placeholder="21:00"
                  editable={h.enabled}
                />
              </View>
            ))}
          </View>

          <View>
            <Text style={styles.sectionTitle}>Lead time</Text>
            <Text style={styles.sectionHint}>Minimum notice required before a reservation's start time.</Text>
            <TextInput
              style={[styles.input, styles.leadTimeInput]}
              value={leadTimeMinutes}
              onChangeText={(v) => setLeadTimeMinutes(v.replace(/[^0-9]/g, ''))}
              placeholder="120"
              keyboardType="number-pad"
            />
          </View>

          <View>
            <Text style={styles.sectionTitle}>Time zone</Text>
            <Text style={styles.sectionHint}>
              Must match this restaurant's actual location -- working hours above are checked against this zone, so
              a wrong value here is what makes customers see availability at the wrong time of day.
            </Text>
            <TouchableOpacity
              style={[styles.input, styles.timezoneInput, styles.timezonePickerButton]}
              onPress={() => setTimezonePickerOpen(true)}
            >
              <Text style={styles.timezonePickerText}>
                {TIMEZONE_OPTIONS.find((o) => o.value === timezone)?.label || timezone}
              </Text>
              <Text style={styles.timezonePickerChevron}>{'\u25BE'}</Text>
            </TouchableOpacity>
          </View>

          <Modal
            visible={timezonePickerOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setTimezonePickerOpen(false)}
          >
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => setTimezonePickerOpen(false)}
            >
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Time zone</Text>
                {TIMEZONE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={styles.modalRow}
                    onPress={() => {
                      setTimezone(opt.value);
                      setTimezonePickerOpen(false);
                    }}
                  >
                    <Text style={[styles.modalRowTitle, opt.value === timezone && styles.modalRowTitleSelected]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>

          <TouchableOpacity style={styles.primaryButton} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}
      </KeyboardAvoidingView>
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
  backLink: { fontSize: 13, color: BRAND, fontWeight: '600', width: 50 },
  bookingsLink: { fontSize: 13, color: BRAND, fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: BRAND, textAlign: 'center', marginHorizontal: 8 },
  enableBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 18 },
  enableTitle: { fontSize: 17, fontWeight: '800', color: BRAND, textAlign: 'center' },
  enableSubtitle: { fontSize: 13, color: '#5b6472', textAlign: 'center', lineHeight: 18, marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: BRAND, marginBottom: 2 },
  sectionHint: { fontSize: 12, color: '#5b6472', marginBottom: 10, lineHeight: 16 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tableNameInput: { flex: 1 },
  tableSeatsInput: { width: 64, textAlign: 'center' },
  removeButton: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#f4e6e5', alignItems: 'center', justifyContent: 'center' },
  removeButtonText: { color: '#c0392b', fontWeight: '800' },
  addLink: { marginTop: 2 },
  addLinkText: { fontSize: 13, fontWeight: '700', color: BRAND },
  hourRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  hourDayToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 110 },
  hourDaySwitch: { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] },
  hourDayLabel: { fontSize: 13, fontWeight: '700', color: BRAND },
  hourTimeInput: { width: 72, textAlign: 'center' },
  hourToLabel: { fontSize: 12, color: '#5b6472' },
  leadTimeInput: { width: 90 },
  timezoneInput: { width: '100%' },
  timezonePickerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timezonePickerText: { fontSize: 14, color: BRAND },
  timezonePickerChevron: { fontSize: 12, color: '#5b6472' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, maxHeight: '70%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', marginBottom: 12 },
  modalRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  modalRowTitle: { fontSize: 14, fontWeight: '600', color: '#14181f' },
  modalRowTitleSelected: { color: BRAND, fontWeight: '800' },
  input: { borderWidth: 1, borderColor: '#dde2e0', borderRadius: 8, padding: 10, fontSize: 14, color: BRAND },
  inputDisabled: { backgroundColor: '#f4f6f5', color: '#9aa2ad' },
  errorText: { fontSize: 12, color: '#c0392b', fontWeight: '600', marginBottom: 4 },
  primaryButton: { backgroundColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
