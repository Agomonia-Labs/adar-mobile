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

/** Raw shape POST /api/demo/tts returns. Audio is base64-encoded MP3. */
export interface TtsResponseBody {
  audio: string;
  cached: boolean;
}

/** Raw shape POST /api/stt returns. */
export interface SttResponseBody {
  text: string;
}
