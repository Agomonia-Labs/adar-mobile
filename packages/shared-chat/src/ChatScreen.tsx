import React from 'react';
import { getAuthTheme, useAuth } from '@adar/shared-auth';
import { ChatView } from './ChatView';
import { useChat } from './useChat';

export interface ChatScreenProps {
  /** Shown above the input when there are no messages yet. Defaults to "Ask <tenant>". */
  placeholder?: string;
  /** Optional starter questions shown as tappable chips when the conversation is empty. */
  suggestedQuestions?: string[];
}

/**
 * Drop-in "Ask ADAR" chat screen for a signed-in user -- styled from the
 * tenant's brand color via shared-auth's getAuthTheme (same visual
 * language as the login screen), driven by useChat() against the
 * authenticated POST /api/chat. For the no-login "guest" experience, see
 * GuestChatScreen instead.
 */
export function ChatScreen({ placeholder, suggestedQuestions }: ChatScreenProps) {
  const { tenant } = useAuth();
  const theme = getAuthTheme(tenant);
  const chat = useChat();

  return (
    <ChatView
      {...chat}
      theme={theme}
      placeholder={placeholder || `Ask ${tenant.displayName}`}
      suggestedQuestions={suggestedQuestions}
    />
  );
}
