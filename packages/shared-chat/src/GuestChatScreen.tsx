import React from 'react';
import { ImageSourcePropType } from 'react-native';
import { getAuthTheme, useAuth } from '@adar/shared-auth';
import { ChatView } from './ChatView';
import { useGuestChat } from './useGuestChat';

export interface GuestChatScreenProps {
  /** Matches the backend's DOMAIN env var + guest route prefix, e.g.
   *  'arcl' for /api/arcl/guest/*. */
  domain: string;
  /** Shown above the input when there are no messages yet. Defaults to "Ask <tenant>". */
  placeholder?: string;
  /** Optional starter questions shown as tappable chips when the conversation is empty. */
  suggestedQuestions?: string[];
  /** Optional logo shown above the placeholder text in the empty state. */
  logo?: ImageSourcePropType;
}

/**
 * The no-login "Ask ADAR" experience -- same UI as ChatScreen, but backed
 * by useGuestChat() against POST /api/{domain}/guest/chat instead of the
 * authenticated /api/chat. This is the same backend flow that powers
 * https://labs.agomoniai.com/arcl (adar-core/api/routes/arcl_guest.py):
 * a short-lived guest identity, no email/password, no account needed.
 *
 * Still reads `tenant`/`client` off shared-auth's useAuth() for branding
 * and the base HTTP client -- those are available whether or not anyone
 * is actually signed in (AuthProvider always provides them).
 */
export function GuestChatScreen({ domain, placeholder, suggestedQuestions, logo }: GuestChatScreenProps) {
  const { tenant, client } = useAuth();
  const theme = getAuthTheme(tenant);
  const chat = useGuestChat(client, domain);

  return (
    <ChatView
      {...chat}
      theme={theme}
      placeholder={placeholder || `Ask ${tenant.displayName}`}
      suggestedQuestions={suggestedQuestions}
      logo={logo}
    />
  );
}
