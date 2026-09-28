import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AxiosInstance } from 'axios';
import { useLanguage } from './LanguageContext';
import type { GuestSession } from './useFrontdeskGuestSession';
import {
  GuestAppointmentType,
  GuestBooking,
  GuestPractice,
  GuestProvider,
  createGuestBooking,
  extractApiErrorMessage,
  listGuestAppointmentTypes,
  listGuestBookings,
  listGuestProviders,
} from './frontdeskApi';

type Step = 'service' | 'provider' | 'time' | 'details' | 'confirm' | 'done';
const STEP_ORDER: Step[] = ['service', 'provider', 'time', 'details', 'confirm'];

/** Sub-phases of the 'time' step: pick a month, then a day within it, then
 *  a time on that day -- drill-down browsing instead of a flat slot list,
 *  per the customer's request. */
type TimePhase = 'month' | 'day' | 'time';

/** Hard cap on how far out we let a customer book, regardless of what a
 *  practice's own `max_advance_days` says -- "max a couple of months". */
const MAX_ADVANCE_DAYS_CAP = 60;
const SLOT_STEP_MINUTES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Slot {
  start: string; // ISO
  provider: GuestProvider;
}

interface CalendarDay {
  year: number;
  month: number; // 0-11
  day: number; // 1-31
  weekday: number; // JS Date.getDay(), 0 = Sunday
}

interface MonthOption {
  year: number;
  month: number; // 0-11
  label: string;
  hasAvailability: boolean;
}

interface ProviderSummary {
  provider: GuestProvider;
  days: Set<number>; // JS Date.getDay() values (0 = Sunday)
  startHour: number;
  endHour: number;
}

function summarizeProvider(provider: GuestProvider): ProviderSummary {
  const valid = (provider.working_hours || []).filter((h) => h && h.start && h.end && Number.isInteger(h.weekday));
  const days = new Set(valid.map((h) => (h.weekday + 1) % 7)); // backend: 0=Mon..6=Sun -> JS: 0=Sun..6=Sat
  const starts = valid.map((h) => Number(h.start.split(':')[0])).filter(Number.isFinite);
  const ends = valid.map((h) => Number(h.end.split(':')[0])).filter(Number.isFinite);
  return {
    provider,
    days,
    startHour: starts.length ? Math.min(...starts) : 9,
    endHour: ends.length ? Math.max(...ends) : 17,
  };
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** [today, today+cap] window a customer may book into -- the smaller of the
 *  practice's own max_advance_days and our hard "couple of months" cap. */
function advanceWindow(maxAdvanceDays: number | undefined | null): { today: Date; last: Date } {
  const today = startOfDay(new Date());
  const capDays = Math.max(1, Math.min(maxAdvanceDays || MAX_ADVANCE_DAYS_CAP, MAX_ADVANCE_DAYS_CAP));
  return { today, last: new Date(today.getTime() + capDays * DAY_MS) };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Every open start time on one calendar day, across the given eligible
 *  providers, skipping anything before now+lead-time or that collides with
 *  an existing confirmed booking. In "first available" mode (more than one
 *  eligible provider) times are de-duplicated across providers -- the
 *  customer just sees one row per open time. */
function generateDaySlots(
  day: CalendarDay,
  providers: ProviderSummary[],
  service: GuestAppointmentType,
  existingBookings: GuestBooking[],
  leadTimeMinutes: number
): Slot[] {
  const cutoff = Date.now() + Math.max(0, leadTimeMinutes) * 60000;
  const seenTimes = new Set<string>();
  const results: Slot[] = [];
  providers.forEach((summary) => {
    if (!summary.days.has(day.weekday)) return;
    for (
      let minutes = summary.startHour * 60;
      minutes + service.duration_minutes <= summary.endHour * 60;
      minutes += SLOT_STEP_MINUTES
    ) {
      const start = new Date(day.year, day.month, day.day, Math.floor(minutes / 60), minutes % 60, 0, 0);
      if (start.getTime() < cutoff) continue;
      const blocked = existingBookings.some(
        (booking) =>
          booking.provider_id === summary.provider.id &&
          booking.status === 'confirmed' &&
          Math.abs(new Date(booking.start_time).getTime() - start.getTime()) < service.duration_minutes * 60000
      );
      if (blocked) continue;
      const iso = start.toISOString();
      if (seenTimes.has(iso)) return;
      seenTimes.add(iso);
      results.push({ start: iso, provider: summary.provider });
    }
  });
  return results.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/** Month/Year options spanning "the next couple of months" (see
 *  advanceWindow), each flagged with whether it has any bookable day at
 *  all so the UI can show-but-disable a month with nothing open. */
function buildMonthOptions(
  providers: ProviderSummary[],
  service: GuestAppointmentType,
  existingBookings: GuestBooking[],
  leadTimeMinutes: number,
  maxAdvanceDays: number | undefined | null
): MonthOption[] {
  const { today, last } = advanceWindow(maxAdvanceDays);
  const months: MonthOption[] = [];
  const cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  while (cursor <= last) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const label = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const firstDay = year === today.getFullYear() && month === today.getMonth() ? today.getDate() : 1;
    const lastDay = year === last.getFullYear() && month === last.getMonth() ? last.getDate() : daysInMonth(year, month);
    let hasAvailability = false;
    for (let d = firstDay; d <= lastDay && !hasAvailability; d += 1) {
      const weekday = new Date(year, month, d).getDay();
      if (!providers.some((p) => p.days.has(weekday))) continue;
      if (generateDaySlots({ year, month, day: d, weekday }, providers, service, existingBookings, leadTimeMinutes).length) {
        hasAvailability = true;
      }
    }
    months.push({ year, month, label, hasAvailability });
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
  }
  return months;
}

/** Days within one chosen month/year that actually have an open slot. */
function buildDayOptions(
  year: number,
  month: number,
  providers: ProviderSummary[],
  service: GuestAppointmentType,
  existingBookings: GuestBooking[],
  leadTimeMinutes: number,
  maxAdvanceDays: number | undefined | null
): CalendarDay[] {
  const { today, last } = advanceWindow(maxAdvanceDays);
  const firstDay = year === today.getFullYear() && month === today.getMonth() ? today.getDate() : 1;
  const lastDay = year === last.getFullYear() && month === last.getMonth() ? last.getDate() : daysInMonth(year, month);
  const days: CalendarDay[] = [];
  for (let d = firstDay; d <= lastDay; d += 1) {
    const weekday = new Date(year, month, d).getDay();
    if (!providers.some((p) => p.days.has(weekday))) continue;
    const calDay: CalendarDay = { year, month, day: d, weekday };
    if (generateDaySlots(calDay, providers, service, existingBookings, leadTimeMinutes).length) {
      days.push(calDay);
    }
  }
  return days;
}

function formatDayLabel(day: CalendarDay): string {
  return new Date(day.year, day.month, day.day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatTimeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Full date+time label -- used once a slot is picked (details/confirm/done
 *  screens), where the day is no longer implied by an on-screen heading. */
function formatSlotLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export interface BookingWizardProps {
  client: AxiosInstance;
  practiceId: string;
  /** Full practice record (max_advance_days, lead_time_minutes) so the
   *  Month/Day/Time picker can bound its window per-practice. May be null
   *  for a brief moment while the practice list is still loading. */
  practice: GuestPractice | null;
  brandColor: string;
  /** Shared guest-session getter -- lifted to FrontdeskHomeScreen so the
   *  booking wizard, "My Appointments", and (separately) chat/voice all
   *  reuse as few guest identities as the backend's per-IP rate limit
   *  allows, instead of each screen minting its own. Still used for the
   *  anonymous, browsing-only calls (providers/appointment types). */
  ensureSession: () => Promise<GuestSession>;
  /** The signed-in account's access token. Listing existing bookings (to
   *  compute open slots) and creating a new one both require this now --
   *  FrontdeskHomeScreen only renders BookingWizard once a session exists. */
  customerAccessToken: string;
  /** The signed-in account's own email -- prefills (but doesn't lock) the
   *  booking form's email field, and is always also cc'd on the
   *  confirmation server-side regardless of what's typed there. */
  customerEmail: string;
  onBooked?: () => void;
}

export function BookingWizard({
  client,
  practiceId,
  practice,
  brandColor,
  ensureSession,
  customerAccessToken,
  customerEmail,
  onBooked,
}: BookingWizardProps) {
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<GuestProvider[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<GuestAppointmentType[]>([]);
  const [bookings, setBookings] = useState<GuestBooking[]>([]);

  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string>(''); // '' = first available
  const [timePhase, setTimePhase] = useState<TimePhase>('month');
  const [selectedMonth, setSelectedMonth] = useState<{ year: number; month: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const emailTouchedRef = React.useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<GuestBooking | null>(null);

  useEffect(() => {
    if (customerEmail && !emailTouchedRef.current) setEmail(customerEmail);
  }, [customerEmail]);

  const loadPracticeData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await ensureSession();
      const start = new Date();
      start.setDate(start.getDate() - 1);
      const end = new Date();
      end.setDate(end.getDate() + 90);
      const [providersData, typesData, bookingsData] = await Promise.all([
        listGuestProviders(client, session.access_token, practiceId),
        listGuestAppointmentTypes(client, session.access_token, practiceId),
        listGuestBookings(client, customerAccessToken, practiceId, start.toISOString(), end.toISOString()),
      ]);
      setProviders(providersData);
      setAppointmentTypes(typesData);
      setBookings(bookingsData);
    } catch (err) {
      setError(extractApiErrorMessage(err, t('errorGeneric')));
    } finally {
      setLoading(false);
    }
  }, [client, ensureSession, customerAccessToken, practiceId, t]);

  const resetTimeSelection = useCallback(() => {
    setTimePhase('month');
    setSelectedMonth(null);
    setSelectedDay(null);
    setSlot(null);
  }, []);

  useEffect(() => {
    // Reset the wizard whenever the customer switches practices.
    setStep('service');
    setServiceId(null);
    setProviderId('');
    resetTimeSelection();
    setConfirmedBooking(null);
    loadPracticeData();
  }, [practiceId, loadPracticeData, resetTimeSelection]);

  const service = useMemo(() => appointmentTypes.find((s) => s.id === serviceId) || null, [appointmentTypes, serviceId]);
  const eligibleProviders = useMemo(() => {
    if (!service) return [];
    return providers.filter(
      (p) => p.appointment_type_ids.includes(service.id) && (!providerId || p.id === providerId)
    );
  }, [providers, service, providerId]);
  const eligibleProviderSummaries = useMemo(() => eligibleProviders.map(summarizeProvider), [eligibleProviders]);

  const monthOptions = useMemo(() => {
    if (!service || !eligibleProviderSummaries.length) return [];
    return buildMonthOptions(eligibleProviderSummaries, service, bookings, practice?.lead_time_minutes || 0, practice?.max_advance_days);
  }, [service, eligibleProviderSummaries, bookings, practice]);

  const dayOptions = useMemo(() => {
    if (!service || !eligibleProviderSummaries.length || !selectedMonth) return [];
    return buildDayOptions(
      selectedMonth.year,
      selectedMonth.month,
      eligibleProviderSummaries,
      service,
      bookings,
      practice?.lead_time_minutes || 0,
      practice?.max_advance_days
    );
  }, [service, eligibleProviderSummaries, bookings, selectedMonth, practice]);

  const daySlots = useMemo(() => {
    if (!service || !eligibleProviderSummaries.length || !selectedDay) return [];
    return generateDaySlots(selectedDay, eligibleProviderSummaries, service, bookings, practice?.lead_time_minutes || 0);
  }, [service, eligibleProviderSummaries, bookings, selectedDay, practice]);

  const stepIndex = STEP_ORDER.indexOf(step);

  const goBack = useCallback(() => {
    if (step === 'time') {
      if (timePhase === 'time') {
        setTimePhase('day');
        return;
      }
      if (timePhase === 'day') {
        setTimePhase('month');
        setSelectedDay(null);
        return;
      }
      setStep('provider');
      return;
    }
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1]);
  }, [step, timePhase]);

  const submitBooking = useCallback(async () => {
    if (!service || !slot) return;
    setSubmitting(true);
    setError(null);
    try {
      const booking = await createGuestBooking(client, customerAccessToken, {
        practice_id: practiceId,
        provider_id: slot.provider.id,
        appointment_type_id: service.id,
        start_time: slot.start,
        caller_name: name.trim(),
        caller_phone: phone.trim(),
        caller_email: email.trim(),
        reason: reason.trim(),
      });
      setConfirmedBooking(booking);
      setStep('done');
      onBooked?.();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setError(t('slotTaken'));
        setStep('time');
        setTimePhase('time');
        loadPracticeData(); // refresh the busy list so the retry reflects the real conflict
      } else {
        setError(extractApiErrorMessage(err, t('errorGeneric')));
      }
    } finally {
      setSubmitting(false);
    }
  }, [service, slot, customerAccessToken, client, practiceId, name, phone, email, reason, onBooked, t, loadPracticeData]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={brandColor} />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {step !== 'done' && (
        <View style={styles.stepper}>
          {STEP_ORDER.map((s, i) => (
            <View key={s} style={styles.stepDot}>
              <View
                style={[
                  styles.stepCircle,
                  { borderColor: brandColor },
                  i <= stepIndex && { backgroundColor: brandColor },
                ]}
              >
                <Text style={[styles.stepNumber, i <= stepIndex && styles.stepNumberActive]}>{i + 1}</Text>
              </View>
              <Text style={styles.stepLabel} numberOfLines={1}>
                {t((['stepService', 'stepProvider', 'stepTime', 'stepDetails', 'stepConfirm'] as const)[i])}
              </Text>
            </View>
          ))}
        </View>
      )}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.content}>
        {step === 'service' && (
          <>
            <Text style={styles.prompt}>{t('pickService')}</Text>
            {appointmentTypes.map((svc) => (
              <TouchableOpacity
                key={svc.id}
                style={[styles.option, { borderColor: brandColor }]}
                onPress={() => {
                  setServiceId(svc.id);
                  setProviderId('');
                  setStep('provider');
                }}
              >
                <Text style={styles.optionTitle}>{svc.name}</Text>
                <Text style={styles.optionSubtitle}>{svc.duration_minutes} min</Text>
                {svc.description ? <Text style={styles.optionDescription}>{svc.description}</Text> : null}
              </TouchableOpacity>
            ))}
          </>
        )}

        {step === 'provider' && service && (
          <>
            <Text style={styles.prompt}>{t('pickProvider')}</Text>
            <TouchableOpacity
              style={[styles.option, { borderColor: brandColor }]}
              onPress={() => {
                setProviderId('');
                resetTimeSelection();
                setStep('time');
              }}
            >
              <Text style={styles.optionTitle}>{t('firstAvailable')}</Text>
            </TouchableOpacity>
            {providers
              .filter((p) => p.appointment_type_ids.includes(service.id))
              .map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.option, { borderColor: brandColor }]}
                  onPress={() => {
                    setProviderId(p.id);
                    resetTimeSelection();
                    setStep('time');
                  }}
                >
                  <Text style={styles.optionTitle}>{p.name}</Text>
                  {p.role ? <Text style={styles.optionSubtitle}>{p.role}</Text> : null}
                </TouchableOpacity>
              ))}
          </>
        )}

        {step === 'time' && (
          <>
            {timePhase === 'month' && (
              <>
                <Text style={styles.prompt}>{t('pickMonth')}</Text>
                {monthOptions.length === 0 || monthOptions.every((m) => !m.hasAvailability) ? (
                  <Text style={styles.optionSubtitle}>{t('noSlots')}</Text>
                ) : null}
                {monthOptions.map((m) => (
                  <TouchableOpacity
                    key={`${m.year}-${m.month}`}
                    style={[styles.option, { borderColor: brandColor }, !m.hasAvailability && styles.disabledOption]}
                    disabled={!m.hasAvailability}
                    onPress={() => {
                      setSelectedMonth({ year: m.year, month: m.month });
                      setSelectedDay(null);
                      setTimePhase('day');
                    }}
                  >
                    <Text style={styles.optionTitle}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {timePhase === 'day' && selectedMonth && (
              <>
                <Text style={styles.prompt}>{t('pickDay')}</Text>
                {dayOptions.length === 0 && <Text style={styles.optionSubtitle}>{t('noSlots')}</Text>}
                {dayOptions.map((d) => (
                  <TouchableOpacity
                    key={`${d.year}-${d.month}-${d.day}`}
                    style={[styles.option, { borderColor: brandColor }]}
                    onPress={() => {
                      setSelectedDay(d);
                      setTimePhase('time');
                    }}
                  >
                    <Text style={styles.optionTitle}>{formatDayLabel(d)}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {timePhase === 'time' && selectedDay && (
              <>
                <Text style={styles.prompt}>{t('pickTime')}</Text>
                <Text style={styles.optionSubtitle}>{formatDayLabel(selectedDay)}</Text>
                {daySlots.length === 0 && <Text style={styles.optionSubtitle}>{t('noSlots')}</Text>}
                {daySlots.map((s, i) => (
                  <TouchableOpacity
                    key={`${s.provider.id}-${s.start}-${i}`}
                    style={[styles.option, { borderColor: brandColor }]}
                    onPress={() => {
                      setSlot(s);
                      setStep('details');
                    }}
                  >
                    <Text style={styles.optionTitle}>{formatTimeOnly(s.start)}</Text>
                    <Text style={styles.optionSubtitle}>{s.provider.name}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}

        {step === 'details' && (
          <>
            <Text style={styles.prompt}>{t('yourDetails')}</Text>
            <TextInput style={styles.input} placeholder={t('fullName')} value={name} onChangeText={setName} />
            <TextInput
              style={styles.input}
              placeholder={t('phone')}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.input}
              placeholder={t('email')}
              value={email}
              onChangeText={(v) => {
                emailTouchedRef.current = true;
                setEmail(v);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {email.trim().length > 0 && !EMAIL_SHAPE_RE.test(email.trim()) ? (
              <Text style={styles.fieldError}>{t('invalidEmail')}</Text>
            ) : null}
            <TextInput style={styles.input} placeholder={t('reason')} value={reason} onChangeText={setReason} />
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: brandColor },
                !name.trim() || !phone.trim() || !EMAIL_SHAPE_RE.test(email.trim()) ? styles.disabled : null,
              ]}
              disabled={!name.trim() || !phone.trim() || !EMAIL_SHAPE_RE.test(email.trim())}
              onPress={() => setStep('confirm')}
            >
              <Text style={styles.primaryButtonText}>{t('continue')}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'confirm' && service && slot && (
          <>
            <Text style={styles.prompt}>{t('reviewTitle')}</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryRow}>{service.name}</Text>
              <Text style={styles.summaryRow}>{slot.provider.name}</Text>
              <Text style={styles.summaryRow}>{formatSlotLabel(slot.start)}</Text>
              <Text style={styles.summaryRow}>{name} · {phone}</Text>
            </View>
            <Text style={styles.demoNotice}>{t('demoNotice')}</Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: brandColor }, submitting ? styles.disabled : null]}
              disabled={submitting}
              onPress={submitBooking}
            >
              <Text style={styles.primaryButtonText}>{submitting ? t('confirming') : t('confirmBooking')}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'done' && confirmedBooking && (
          <View style={styles.center}>
            <Text style={styles.confirmedTitle}>{t('bookingConfirmed')}</Text>
            <Text style={styles.optionSubtitle}>{t('bookingConfirmedBody')}</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryRow}>{confirmedBooking.appointment_type_name}</Text>
              <Text style={styles.summaryRow}>{confirmedBooking.provider_name}</Text>
              <Text style={styles.summaryRow}>{formatSlotLabel(confirmedBooking.start_time)}</Text>
            </View>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: brandColor }]}
              onPress={() => {
                setStep('service');
                setServiceId(null);
                setProviderId('');
                resetTimeSelection();
                setName('');
                setPhone('');
                setEmail('');
                setReason('');
                setConfirmedBooking(null);
              }}
            >
              <Text style={styles.primaryButtonText}>{t('bookAnother')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {step !== 'service' && step !== 'done' && (
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Text style={[styles.backButtonText, { color: brandColor }]}>{'‹ '}{t('back')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 8, color: '#5b6472' },
  stepper: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  stepDot: { alignItems: 'center', flex: 1 },
  stepCircle: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  stepNumber: { fontSize: 12, fontWeight: '700', color: '#9aa2ad' },
  stepNumberActive: { color: '#fff' },
  stepLabel: { fontSize: 10, color: '#5b6472' },
  errorBanner: { backgroundColor: '#fdecea', paddingVertical: 8, paddingHorizontal: 16 },
  errorText: { color: '#b3261e', fontSize: 13 },
  content: { padding: 16, paddingBottom: 32 },
  prompt: { fontSize: 16, fontWeight: '700', marginBottom: 12, color: '#14181f' },
  option: { borderWidth: 1.5, borderRadius: 12, padding: 14, marginBottom: 10 },
  disabledOption: { opacity: 0.4 },
  optionTitle: { fontSize: 15, fontWeight: '600', color: '#14181f' },
  optionSubtitle: { fontSize: 13, color: '#5b6472', marginTop: 2 },
  optionDescription: { fontSize: 12, color: '#9aa2ad', marginTop: 4 },
  fieldError: { fontSize: 12, color: '#b3261e', marginTop: -8, marginBottom: 12 },
  input: {
    borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, fontSize: 15,
  },
  primaryButton: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  summaryCard: { backgroundColor: '#f7f8fa', borderRadius: 12, padding: 16, marginBottom: 12 },
  summaryRow: { fontSize: 14, color: '#14181f', marginBottom: 4 },
  demoNotice: { fontSize: 12, color: '#9aa2ad', fontStyle: 'italic', marginBottom: 16 },
  confirmedTitle: { fontSize: 18, fontWeight: '700', color: '#14181f', marginBottom: 8 },
  backButton: { paddingVertical: 12, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb' },
  backButtonText: { fontWeight: '600' },
});
