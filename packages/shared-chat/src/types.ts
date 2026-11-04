// Mirrors the real contract implemented in adar-core/api/schemas.py
// (ChatRequest/ChatResponse) and the /api/demo/tts and /api/stt handlers
// in adar-core/api/main.py — keep these in sync.

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

/** Raw shape POST /api/chat expects. */
export interface ChatRequestBody {
  message: string;
  user_id: string;
  session_id?: string;
}

/** Raw shape POST /api/chat returns (api/schemas.py ChatResponse). */
export interface ChatResponseBody {
  response: string;
  session_id: string;
  user_id: string;
  eval?: Record<string, unknown> | null;
  trace_id?: string | null;
}

/** Raw shape POST /api/demo/tts returns. Audio is base64-encoded MP3.
 *  A long reply's text doesn't always fit in one TTS request (Google's
 *  text:synthesize endpoint caps input at 5,000 UTF-8 bytes), so the
 *  backend synthesizes the caller's requested chunk_index and reports how
 *  many chunks the full text was split into via chunk_count. A caller that
 *  ignores these two fields still gets chunk 0 exactly as before. */
export interface TtsResponseBody {
  audio: string;
  cached: boolean;
  chunk_index?: number;
  chunk_count?: number;
}

/** Raw shape POST /api/stt returns. */
export interface SttResponseBody {
  text: string;
}

// ── Guest ("try without an account") flow ──────────────────────────────────
// Mirrors adar-core/api/routes/arcl_guest.py (also used by the public
// https://labs.agomoniai.com/arcl demo) -- same pattern backs
// /api/geetabitan/guest/* and /api/scheduling/guest/* for the other domains.

/** Raw shape POST /api/{domain}/guest/session returns. */
export interface GuestSessionResponse {
  access_token: string;
  token_type: string;
  /** Token lifetime in seconds (30 min server-side). */
  expires_in: number;
  expires_at: string;
  guest_id: string;
  scope: string[];
}
