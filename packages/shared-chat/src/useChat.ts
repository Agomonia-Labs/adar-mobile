import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@adar/shared-auth';
import { extractChatErrorMessage, sendChatMessage } from './api';
import type { ChatMessage } from './types';

let messageCounter = 0;
function nextId(): string {
  messageCounter += 1;
  return `m${Date.now()}_${messageCounter}`;
}

export interface UseChatResult {
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  reset: () => void;
}

/**
 * Drives a single "Ask ADAR" conversation against POST /api/chat, reusing
 * the authenticated axios client + team identity from shared-auth's
 * useAuth(). Keeps its own session_id thread so follow-up questions stay
 * in context (adar-core creates/continues an ADK session per session_id).
 */
export function useChat(): UseChatResult {
  const { client, session } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      setError(null);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', text: trimmed, createdAt: Date.now() },
      ]);
      setSending(true);

      try {
        // team_id is a stable, URL/identifier-safe slug (unlike
        // team_name, which can contain spaces) -- required, since
        // adar-core validates user_id against ^[a-zA-Z0-9_-]{1,64}$.
        const userId = session?.teamId || 'anonymous';
        const result = await sendChatMessage(client, trimmed, userId, sessionIdRef.current);
        sessionIdRef.current = result.session_id;
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', text: result.response, createdAt: Date.now() },
        ]);
      } catch (err) {
        setError(extractChatErrorMessage(err, 'Something went wrong. Please try again.'));
      } finally {
        setSending(false);
      }
    },
    [client, session, sending]
  );

  const reset = useCallback(() => {
    setMessages([]);
    sessionIdRef.current = undefined;
    setError(null);
  }, []);

  return { messages, sending, error, send, reset };
}
