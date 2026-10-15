import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

const BRAND = '#1b2430';

export interface PickupTimeValue {
  mode: 'asap' | 'scheduled';
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM", 24h
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function todayInTimezone(tz?: string | null): string {
  try {
    // en-CA formats as YYYY-MM-DD -- a convenient built-in way to get an
    // ISO-shaped date string for an arbitrary IANA zone without a date
    // library. Hermes (Expo's JS engine) ships full ICU data, so
    // Intl.DateTimeFormat with an arbitrary timeZone works here same as
    // in a browser.
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

function currentTimeLabel(tz?: string | null): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz || 'UTC',
      hour: 'numeric', minute: '2-digit', weekday: 'short', month: 'short', day: 'numeric',
    }).format(new Date());
  } catch {
    return null;
  }
}

function dateFromParts(dateStr: string, timeStr: string): Date {
  const [y, mo, d] = (dateStr || todayInTimezone()).split('-').map((v) => parseInt(v, 10));
  const [hh, mm] = (timeStr || '12:00').split(':').map((v) => parseInt(v, 10));
  // A plain local Date, used only to drive the native picker widgets --
  // its Y/M/D/H/M fields are read back with the LOCAL getters below, never
  // interpreted as a real instant, so this never actually touches the
  // device's own timezone offset.
  return new Date(y, (mo || 1) - 1, d || 1, hh || 0, mm || 0);
}

/** Shared "ASAP or schedule for later" pickup-time control -- the mobile
 *  counterpart to the web app's PickupTimePicker.jsx. The date+time picked
 *  here is always meant as the RESTAURANT's own local wall-clock time, not
 *  the phone's -- the backend combines these raw YYYY-MM-DD/HH:MM values
 *  with the restaurant's actual timezone (see routes/restaurant.py's
 *  _resolve_pickup_time_request), so this component only needs to make
 *  that framing clear and show the customer what time it currently is
 *  there. The native date/time pickers return a Date object; we read its
 *  LOCAL Y/M/D/H/M back out (never .toISOString(), which would convert
 *  through the phone's own timezone offset) -- exactly like reading a web
 *  <input type="date">/<input type="time">'s naive string value. */
export function PickupTimePicker({
  timezone,
  value,
  onChange,
}: {
  timezone?: string | null;
  value: PickupTimeValue;
  onChange: (next: PickupTimeValue) => void;
}) {
  const [now, setNow] = useState<string | null>(() => currentTimeLabel(timezone));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    setNow(currentTimeLabel(timezone));
    const id = setInterval(() => setNow(currentTimeLabel(timezone)), 60000);
    return () => clearInterval(id);
  }, [timezone]);

  const minDate = todayInTimezone(timezone);

  function setMode(mode: 'asap' | 'scheduled') {
    if (mode === 'scheduled' && !value.date) {
      onChange({ mode, date: minDate, time: value.time || '' });
    } else {
      onChange({ ...value, mode });
    }
  }

  const dateLabel = value.date
    ? new Date(`${value.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Pick a date';
  const timeLabel = value.time
    ? (() => {
        const [hh, mm] = value.time.split(':').map((v) => parseInt(v, 10));
        const h12 = hh % 12 === 0 ? 12 : hh % 12;
        return `${h12}:${pad(mm)} ${hh >= 12 ? 'PM' : 'AM'}`;
      })()
    : 'Pick a time';

  return (
    <View style={styles.wrap}>
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, value.mode === 'asap' && styles.toggleBtnActive]}
          onPress={() => setMode('asap')}
        >
          <Text style={[styles.toggleBtnText, value.mode === 'asap' && styles.toggleBtnTextActive]}>ASAP</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, value.mode === 'scheduled' && styles.toggleBtnActive]}
          onPress={() => setMode('scheduled')}
        >
          <Text style={[styles.toggleBtnText, value.mode === 'scheduled' && styles.toggleBtnTextActive]}>
            Schedule for later
          </Text>
        </TouchableOpacity>
      </View>

      {value.mode === 'scheduled' && (
        <View style={styles.pickerRow}>
          <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowDatePicker(true)}>
            <Text style={styles.pickerBtnText}>{dateLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTimePicker(true)}>
            <Text style={styles.pickerBtnText}>{timeLabel}</Text>
          </TouchableOpacity>
        </View>
      )}

      {showDatePicker && (
        <DateTimePicker
          value={dateFromParts(value.date, value.time)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={new Date(`${minDate}T00:00:00`)}
          onChange={(event, selected) => {
            setShowDatePicker(Platform.OS === 'ios' && event.type !== 'dismissed');
            if (event.type !== 'dismissed' && selected) {
              onChange({
                ...value,
                mode: 'scheduled',
                date: `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}`,
              });
            }
          }}
        />
      )}
      {showTimePicker && (
        <DateTimePicker
          value={dateFromParts(value.date, value.time)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selected) => {
            setShowTimePicker(false);
            if (event.type !== 'dismissed' && selected) {
              onChange({
                ...value,
                mode: 'scheduled',
                time: `${pad(selected.getHours())}:${pad(selected.getMinutes())}`,
              });
            }
          }}
        />
      )}

      {now && (
        <Text style={styles.note}>
          {value.mode === 'scheduled' ? "Date and time are the restaurant's local time. " : ''}
          It's currently {now} at the restaurant.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleBtn: {
    flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#d7dbe0', backgroundColor: '#fff', alignItems: 'center',
  },
  toggleBtnActive: { backgroundColor: BRAND, borderColor: BRAND },
  toggleBtnText: { fontSize: 13, fontWeight: '600', color: '#5b6472' },
  toggleBtnTextActive: { color: '#fff' },
  pickerRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  pickerBtn: {
    flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#d7dbe0', backgroundColor: '#fff', alignItems: 'center',
  },
  pickerBtnText: { fontSize: 13, color: '#14181f', fontWeight: '600' },
  note: { fontSize: 11.5, color: '#8a93a3', marginTop: 6 },
});
