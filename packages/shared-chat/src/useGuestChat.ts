import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { AxiosInstance } from 'axios';
import { createGuestSession, extractChatErrorMessage, sendGuestChatMessage } from './api';
import type { GuestCallerDetails } from './api';
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

export interface UseGuestChatResult extends UseChatResult {
  /** Returns the current (possibly freshly minted) guest bearer token --
   *  the same one `send` uses internally. Exposed so callers can hit other
   *  guest-scoped endpoints (voice STT/TTS) under the same guest identity
   *  instead of minting a second, unrelated guest session. */
  getAccessToken: () => Promise<string>;
}

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
export function useGuestChat(
  client: AxiosInstance,
  domain: string,
  /** Optional, read fresh on every send() -- lets a caller like ADAR Front
   *  Desk's multi-practice "Ask ADAR" tab tell the agent which practice is
   *  currently selected in the app without recreating this hook's
   *  callbacks every time the selection changes. Callers that only ever
   *  have one practice/tenant (ARCL, Geetabitan) simply omit this. */
  practiceIdRef?: MutableRefObject<string | undefined>,
  /** Optional, read fresh on every send() -- the customer's name/phone/
   *  email from a pre-chat text-box form (ADAR Front Desk's "Ask ADAR"
   *  tab), sent to the agent once as a "caller details" hint (its
   *  instructions already know this shape -- it's the same hint a
   *  pre-chat form on the booking screen was always meant to supply) and
   *  then not repeated unless the details actually change, so the agent
   *  confirms them once instead of re-asking or re-greeting every turn.
   *  reset() clears the "already sent" memory too, so a fresh
   *  conversation re-sends the current details on its first message. */
  callerDetailsRef?: MutableRefObject<GuestCallerDetails | undefined>,
  /** Optional, read fresh on every send() -- the app's active language
   *  code (e.g. "bn-BD" for ADAR Front Desk's language picker), sent as
   *  preferred_language so the agent's actual reply follows the app's
   *  language selection instead of just auto-detecting from the message
   *  text. Callers with no language concept simply omit this. */
  languageRef?: MutableRefObject<string | undefined>,
  /** Optional, read fresh on every send() -- the signed-in customer's real
   *  access token (separate from this hook's own anonymous guest token),
   *  sent as X-Customer-Token so the backend can attach the customer's
   *  real identity to bookings made in this conversation. Callers with no
   *  signed-in-account concept simply omit this. */
  customerAccessTokenRef?: MutableRefObject<string | undefined>
): UseGuestChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const expiresAtMsRef = useRef<number>(0);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const sentCountRef = useRef(0);
  const lastSentCallerDetailsRef = useRef<string>('');

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
        const details = callerDetailsRef?.current;
        const detailsKey = details ? JSON.stringify(details) : '';
        const includeDetails = !!details && detailsKey !== lastSentCallerDetailsRef.current;
        const result = await sendGuestChatMessage(
          client,
          domain,
          token,
          trimmed,
          sessionIdRef.current,
          practiceIdRef?.current,
          includeDetails ? details : undefined,
          languageRef?.current,
          customerAccessTokenRef?.current
        );
        if (includeDetails) lastSentCallerDetailsRef.current = detailsKey;
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
    [client, domain, ensureGuestToken, sending, practiceIdRef, callerDetailsRef, languageRef, customerAccessTokenRef]
  );

  const reset = useCallback(() => {
    setMessages([]);
    tokenRef.current = null;
    expiresAtMsRef.current = 0;
    sessionIdRef.current = undefined;
    sentCountRef.current = 0;
    lastSentCallerDetailsRef.current = '';
    setError(null);
  }, []);

  return { messages, sending, error, send, reset, getAccessToken: ensureGuestToken };
}
