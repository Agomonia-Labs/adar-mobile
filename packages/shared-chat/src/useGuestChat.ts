import { useCallback, useRef, useState } from 'react';
import { AxiosInstance } from 'axios';
import { createGuestSession, extractChatErrorMessage, sendGuestChatMessage } from './api';
import type { ChatMessage } from './types';
import type { UseChatResult } from './useChat';

let guestMessageCounter = 0;
function nextGuestId(): string {
  guestMessageCounter += 1;
  return `g${Date.now()}_${guestMessageCounter}`;
}

// Mirrors adar-core/api/routes/arcl_guest.py's GUEST_MAX_SESSION_MESSAGES --
// refreshing proactively at this count means we mint a new guest identity
// before the server would reject with 429, rather than surfacing that as
// an error to the user.
const GUEST_SESSION_MAX_MESSAGES = 20;

/**
 * Chat controller for the anonymous "guest" experience -- the same
 * no-login flow that powers https://labs.agomoniai.com/arcl. Same
 * { messages, sending, error, send, reset } shape as useChat(), so it's a
 * drop-in for anything built against that interface (see ChatView).
 *
 * Unlike useChat(), this needs no signed-in session: it mints its own
 * short-lived (30 min) guest bearer token on first send via
 * createGuestSession, and re-mints automatically when the token expires
 * or the per-session question limit is reached.
 */
export function useGuestChat(client: AxiosInstance, domain: string): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const expiresAtMsRef = useRef<number>(0);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const sentCountRef = useRef(0);

  const ensureGuestToken = useCallback(async () => {
    const stillValid =
      tokenRef.current &&
      Date.now() < expiresAtMsRef.current &&
      sentCountRef.current < GUEST_SESSION_MAX_MESSAGES;
    if (!stillValid) {
      const guest = await createGuestSession(client, domain);
      tokenRef.current = guest.access_token;
      expiresAtMsRef.current = new Date(guest.expires_at).getTime();
      sentCountRef.current = 0;
      // A fresh guest identity means a fresh adar-core session too --
      // the old session_id belonged to the previous (now-discarded)
      // guest token's user_id.
      sessionIdRef.current = undefined;
    }
    return tokenRef.current as string;
  }, [client, domain]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      setError(null);
      setMessages((prev) => [
        ...prev,
        { id: nextGuestId(), role: 'user', text: trimmed, createdAt: Date.now() },
      ]);
      setSending(true);

      try {
        const token = await ensureGuestToken();
        const result = await sendGuestChatMessage(client, domain, token, trimmed, sessionIdRef.current);
        sessionIdRef.current = result.session_id;
        sentCountRef.current += 1;
        setMessages((prev) => [
          ...prev,
          { id: nextGuestId(), role: 'assistant', text: result.response, createdAt: Date.now() },
        ]);
      } catch (err) {
        setError(extractChatErrorMessage(err, 'Something went wrong. Please try again.'));
      } finally {
        setSending(false);
      }
    },
    [client, domain, ensureGuestToken, sending]
  );

  const reset = useCallback(() => {
    setMessages([]);
    tokenRef.current = null;
    expiresAtMsRef.current = 0;
    sessionIdRef.current = undefined;
    sentCountRef.current = 0;
    setError(null);
  }, []);

  return { messages, sending, error, send, reset };
}
