import { AxiosInstance } from 'axios';
import type {
  ChatResponseBody,
  GuestSessionResponse,
  SttResponseBody,
  TtsResponseBody,
} from './types';

// POST /api/chat is domain-generic across every adar-core deployment
// (arcl, geetabitan, scheduling) -- same endpoint, same request/response
// shape regardless of tenant. Auth is the tenant's X-API-Key header
// (already attached by shared-auth's createAuthClient), not a bearer
// token -- see adar-core/api/main.py's _verify_api_key.
export async function sendChatMessage(
  client: AxiosInstance,
  message: string,
  userId: string,
  sessionId?: string
): Promise<ChatResponseBody> {
  const { data } = await client.post<ChatResponseBody>('/api/chat', {
    message,
    user_id: userId,
    session_id: sessionId,
  });
  return data;
}

// POST /api/demo/tts -- no auth required (see adar-core/api/main.py).
// Returns base64-encoded MP3, so callers typically write it to a temp
// file and play it with expo-av (left to the app, not this package, to
// avoid forcing an expo-av dependency on apps that don't need voice).
export async function synthesizeSpeech(
  client: AxiosInstance,
  text: string,
  lang = 'en-US'
): Promise<TtsResponseBody> {
  const { data } = await client.post<TtsResponseBody>('/api/demo/tts', { text, lang });
  return data;
}

// POST /api/stt -- DOES require the signed-in user's bearer token (see
// adar-core/api/main.py's Depends(get_current_team)), unlike chat/tts.
export async function transcribeSpeech(
  client: AxiosInstance,
  accessToken: string,
  audioBase64: string,
  mime: string,
  lang = 'en-US'
): Promise<SttResponseBody> {
  const { data } = await client.post<SttResponseBody>(
    '/api/stt',
    { audio: audioBase64, mime, lang },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data;
}

// Surfaces the REAL cause in the app's error banner instead of a bare
// fallback -- a wrong/expected-shape error swallowed down to "Something
// went wrong" is much harder to debug on a device than reading it off
// the screen directly. Also logs the raw error so `adb logcat` (filtered
// to the app's own PID, tag ReactNativeJS) shows it too.
export function extractChatErrorMessage(err: unknown, fallback: string): string {
  console.error('[shared-chat] request failed:', err);
  const anyErr = err as {
    response?: { status?: number; data?: { detail?: string } | string };
    request?: unknown;
    message?: string;
  };

  const data = anyErr?.response?.data;
  const detail = typeof data === 'string' ? data : data?.detail;
  if (detail) return detail;

  // Got an HTTP response, but not the {detail: "..."} shape we expected
  // (e.g. a proxy/gateway error page, a 500 with no JSON body).
  if (anyErr?.response?.status) {
    return `Request failed (HTTP ${anyErr.response.status})${anyErr.message ? `: ${anyErr.message}` : ''}`;
  }

  // Request was sent but never got a response at all -- DNS failure, no
  // connectivity, timeout, TLS error, etc. (axios sets `request` but not
  // `response` in this case).
  if (anyErr?.request) {
    return `No response from server${anyErr.message ? ` (${anyErr.message})` : ''}`;
  }

  return anyErr?.message || fallback;
}

// ── Guest ("try without an account") flow ──────────────────────────────────
// Mirrors adar-core/api/routes/arcl_guest.py -- the same backend flow that
// powers the public https://labs.agomoniai.com/arcl demo, no login required.
// Unlike sendChatMessage above, these calls are unauthenticated by the
// tenant's usual X-API-Key/session and instead carry a short-lived guest
// bearer token that's minted per-device by createGuestSession.

/** POST /api/{domain}/guest/session -- mints a short-lived (30 min) guest
 *  identity. No request body, no auth needed beyond the tenant's base
 *  client. Rate limited server-side to 20 sessions/10min per origin+IP. */
export async function createGuestSession(
  client: AxiosInstance,
  domain: string
): Promise<GuestSessionResponse> {
  const { data } = await client.post<GuestSessionResponse>(`/api/${domain}/guest/session`);
  return data;
}

/** POST /api/{domain}/guest/chat -- same ChatResponse shape as the
 *  authenticated /api/chat, but scoped to the guest token's identity
 *  (server derives user_id from the token, not the request body) and
 *  rate limited to 12 questions/min, 20 questions total per guest
 *  session. */
export interface GuestCallerDetails {
  name: string;
  phone: string;
  email: string;
}

export async function sendGuestChatMessage(
  client: AxiosInstance,
  domain: string,
  accessToken: string,
  message: string,
  sessionId?: string,
  practiceId?: string,
  callerDetails?: GuestCallerDetails,
  /** The app's active language code (e.g. "bn-BD") -- lets the backend
   *  (api/main.py's scheduling_guest_chat) instruct the agent to actually
   *  reply in that language for the whole conversation, instead of only
   *  auto-detecting from what the customer typed. Optional; omit for
   *  callers that don't have a language concept (ARCL/Geetabitan). */
  preferredLanguage?: string,
  /** The signed-in customer's real access token (separate from the
   *  anonymous guest `accessToken` above, which still authenticates the
   *  request and scopes rate limiting). Sent as X-Customer-Token so the
   *  backend can attach the customer's real identity to this turn --
   *  server-verified, never a plain body field the model could spoof --
   *  so a booking made from this conversation shows up in that account's
   *  My Appointments tab. Optional; omit for a caller with no signed-in
   *  account concept. */
  customerAccessToken?: string
): Promise<ChatResponseBody> {
  const { data } = await client.post<ChatResponseBody>(
    `/api/${domain}/guest/chat`,
    {
      message,
      session_id: sessionId,
      practice_id: practiceId,
      caller_name: callerDetails?.name,
      caller_phone: callerDetails?.phone,
      caller_email: callerDetails?.email,
      preferred_language: preferredLanguage,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(customerAccessToken ? { 'X-Customer-Token': customerAccessToken } : {}),
      },
    }
  );
  return data;
}

// ── Guest voice (STT/TTS under the guest bearer token) ─────────────────────
// Same underlying Google STT/TTS as the authenticated /api/stt and
// /api/demo/tts (see adar-core/api/main.py's speech_to_text/demo_tts),
// just re-scoped behind the guest bearer token so voice use also counts
// against each guest route module's own enforce_voice_rate_limit -- kept
// separate from transcribeSpeech/synthesizeSpeech above rather than
// overloading them, since guest calls need the guest token in the
// Authorization header instead of a signed-in session's accessToken.

/** POST /api/{domain}/guest/stt */
export async function transcribeGuestSpeech(
  client: AxiosInstance,
  domain: string,
  accessToken: string,
  audioBase64: string,
  mime: string,
  lang = 'en-US'
): Promise<SttResponseBody> {
  const { data } = await client.post<SttResponseBody>(
    `/api/${domain}/guest/stt`,
    { audio: audioBase64, mime, lang },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data;
}

/** POST /api/{domain}/guest/tts */
export async function synthesizeGuestSpeech(
  client: AxiosInstance,
  domain: string,
  accessToken: string,
  text: string,
  lang = 'en-US'
): Promise<TtsResponseBody> {
  const { data } = await client.post<TtsResponseBody>(
    `/api/${domain}/guest/tts`,
    { text, lang },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data;
}
