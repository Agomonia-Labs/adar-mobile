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

export function extractChatErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { detail?: string } } };
  return anyErr?.response?.data?.detail || fallback;
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
export async function sendGuestChatMessage(
  client: AxiosInstance,
  domain: string,
  accessToken: string,
  message: string,
  sessionId?: string
): Promise<ChatResponseBody> {
  const { data } = await client.post<ChatResponseBody>(
    `/api/${domain}/guest/chat`,
    { message, session_id: sessionId },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data;
}
