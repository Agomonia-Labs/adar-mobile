import { AxiosInstance } from 'axios';

// Thin REST wrappers around api/routes/scheduling_guest.py -- the same
// endpoints adar-web/front-desk.html's ApiFrontDeskAdapter calls for the
// public labs.agomoniai.com/front-desk demo. Reusing this exact API/dataset
// (rather than inventing a new one) is deliberate: it's what "use the
// existing dataset that exists now in the api" means here.

export interface GuestPractice {
  id: string;
  practice_id: string;
  name: string;
  domain: string;
  tagline: string;
  color: string;
  timezone: string;
  lead_time_minutes: number;
  max_advance_days: number;
  location: string;
  active: boolean;
}

export interface WorkingHour {
  weekday: number; // 0 = Monday, per adar-core's ingestion convention
  start: string; // "HH:MM"
  end: string;
}

export interface GuestProvider {
  id: string;
  name: string;
  role: string;
  bio: string;
  appointment_type_ids: string[];
  working_hours: WorkingHour[];
}

export interface GuestAppointmentType {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  description: string;
}

export interface GuestBooking {
  id: string;
  practice_id: string;
  provider_id: string;
  provider_name: string;
  appointment_type_id: string;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  caller_name: string;
  caller_phone: string;
  caller_email: string;
  reason: string;
  status: string;
  source_channel: string;
}

export interface CreateGuestBookingInput {
  practice_id: string;
  provider_id: string;
  appointment_type_id: string;
  start_time: string; // ISO 8601
  caller_name: string;
  caller_phone: string;
  caller_email: string;
  reason: string;
}

function authHeaders(accessToken: string) {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

export async function listGuestPractices(client: AxiosInstance, accessToken: string): Promise<GuestPractice[]> {
  const { data } = await client.get('/api/scheduling/guest/practices', authHeaders(accessToken));
  return data.practices || [];
}

export async function listGuestProviders(
  client: AxiosInstance,
  accessToken: string,
  practiceId: string
): Promise<GuestProvider[]> {
  const { data } = await client.get('/api/scheduling/guest/providers', {
    ...authHeaders(accessToken),
    params: { practice_id: practiceId },
  });
  return data.providers || [];
}

export async function listGuestAppointmentTypes(
  client: AxiosInstance,
  accessToken: string,
  practiceId: string
): Promise<GuestAppointmentType[]> {
  const { data } = await client.get('/api/scheduling/guest/appointment-types', {
    ...authHeaders(accessToken),
    params: { practice_id: practiceId },
  });
  return data.appointment_types || [];
}

/** `start`/`end` are ISO 8601 datetimes -- matches the web adapter's
 *  7-days-back to 90-days-forward window, used both to show "My
 *  Appointments" and to compute open slots (see buildAvailableSlots in
 *  BookingWizard.tsx, mirroring adar-web/front-desk.js's own client-side
 *  slot computation from provider working hours minus existing bookings). */
export async function listGuestBookings(
  client: AxiosInstance,
  accessToken: string,
  practiceId: string,
  start: string,
  end: string
): Promise<GuestBooking[]> {
  const { data } = await client.get('/api/scheduling/guest/bookings', {
    ...authHeaders(accessToken),
    params: { practice_id: practiceId, start, end },
  });
  return data.bookings || [];
}

export async function createGuestBooking(
  client: AxiosInstance,
  accessToken: string,
  input: CreateGuestBookingInput
): Promise<GuestBooking> {
  const { data } = await client.post('/api/scheduling/guest/bookings', input, authHeaders(accessToken));
  return data;
}

export async function cancelGuestBooking(
  client: AxiosInstance,
  accessToken: string,
  appointmentId: string,
  reason = 'Cancelled from ADAR Front Desk app'
): Promise<GuestBooking> {
  const { data } = await client.delete(`/api/scheduling/guest/appointments/${encodeURIComponent(appointmentId)}`, {
    ...authHeaders(accessToken),
    params: { reason },
  });
  return data;
}

export function extractApiErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { detail?: string } | string }; message?: string };
  const data = anyErr?.response?.data;
  const detail = typeof data === 'string' ? data : data?.detail;
  return detail || anyErr?.message || fallback;
}
