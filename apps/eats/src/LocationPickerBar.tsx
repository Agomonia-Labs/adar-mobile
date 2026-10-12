import React, { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DEFAULT_RADIUS_MILES, useEatsLocation } from './LocationContext';

const BRAND = '#1b2430';
const RADIUS_OPTIONS = [10, 25, 50, 100];

/** Persistent location chip shown atop Discover -- tap to change how
 *  restaurants/menu comparisons are scoped (GPS, a typed city/state, or a
 *  wider/narrower radius). Mirrors the DoorDash/Uber-Eats "change address"
 *  pattern the design called for: always visible, never buried in a
 *  settings screen, since it directly controls what shows up below it. */
export function LocationPickerBar() {
  const { location, radiusMiles, loading, error, requestDeviceLocation, setManualLocation, setRadiusMiles } =
    useEatsLocation();
  const [modalOpen, setModalOpen] = useState(false);
  const [cityInput, setCityInput] = useState('');
  const [stateInput, setStateInput] = useState('');

  const useMyLocation = async () => {
    await requestDeviceLocation();
    setModalOpen(false);
  };

  const useCityState = () => {
    if (!cityInput.trim() && !stateInput.trim()) return;
    setManualLocation(cityInput, stateInput);
    setModalOpen(false);
  };

  return (
    <>
      <TouchableOpacity style={styles.bar} onPress={() => setModalOpen(true)} activeOpacity={0.7}>
        <Text style={styles.pin}>📍</Text>
        <Text style={styles.label} numberOfLines={1}>
          {location ? `${location.label} · within ${radiusMiles} mi` : `Set your location (default: within ${DEFAULT_RADIUS_MILES} mi)`}
        </Text>
        <Text style={styles.change}>Change</Text>
      </TouchableOpacity>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Set your location</Text>
            <Text style={styles.sheetSubtitle}>
              Restaurants (and menu comparisons) are scoped to your location -- same city, or within the radius below.
            </Text>

            <TouchableOpacity style={styles.gpsButton} onPress={useMyLocation} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.gpsButtonText}>Use my current location</Text>}
            </TouchableOpacity>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Text style={styles.orText}>or search by city / state</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.inputCity]}
                placeholder="City"
                value={cityInput}
                onChangeText={setCityInput}
                autoCapitalize="words"
              />
              <TextInput
                style={[styles.input, styles.inputState]}
                placeholder="State"
                value={stateInput}
                onChangeText={setStateInput}
                autoCapitalize="characters"
                maxLength={20}
              />
            </View>
            <TouchableOpacity style={styles.secondaryButton} onPress={useCityState}>
              <Text style={styles.secondaryButtonText}>Use this location</Text>
            </TouchableOpacity>

            <Text style={styles.orText}>radius</Text>
            <View style={styles.radiusRow}>
              {RADIUS_OPTIONS.map((mi) => (
                <TouchableOpacity
                  key={mi}
                  style={[styles.radiusChip, radiusMiles === mi && styles.radiusChipActive]}
                  onPress={() => setRadiusMiles(mi)}
                >
                  <Text style={[styles.radiusChipText, radiusMiles === mi && styles.radiusChipTextActive]}>{mi} mi</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.closeButton} onPress={() => setModalOpen(false)}>
              <Text style={styles.closeButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#f3f4f6',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  pin: { fontSize: 14 },
  label: { flex: 1, fontSize: 13, color: '#14181f', fontWeight: '600' },
  change: { fontSize: 12.5, color: BRAND, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#14181f' },
  sheetSubtitle: { fontSize: 12.5, color: '#6b7280', marginBottom: 4 },
  gpsButton: { backgroundColor: BRAND, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  gpsButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  errorText: { color: '#b3261e', fontSize: 12.5, marginTop: 4 },
  orText: { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  inputCity: { flex: 2 },
  inputState: { flex: 1 },
  secondaryButton: {
    borderWidth: 1,
    borderColor: BRAND,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  radiusRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  radiusChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
  },
  radiusChipActive: { backgroundColor: BRAND, borderColor: BRAND },
  radiusChipText: { fontSize: 13, color: '#14181f', fontWeight: '600' },
  radiusChipTextActive: { color: '#fff' },
  closeButton: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  closeButtonText: { color: '#6b7280', fontWeight: '600', fontSize: 13.5 },
});
