import React, { useRef, useState } from 'react';
import {
  FlatList,
  Image,
  ImageSourcePropType,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { getAuthTheme } from '@adar/shared-auth';
import type { ChatMessage } from './types';

type ChatTheme = ReturnType<typeof getAuthTheme>;

export interface ChatViewProps {
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  send: (text: string) => Promise<void> | void;
  theme: ChatTheme;
  /** Shown above the input when there are no messages yet. */
  placeholder: string;
  /** Optional starter questions shown as tappable chips when empty. */
  suggestedQuestions?: string[];
  /** Optional logo shown above the placeholder text in the empty state. */
  logo?: ImageSourcePropType;
}

// adar-core's assistant replies are Markdown -- the web app renders them
// with react-markdown + remark-gfm (see adar-core/ui/src/App.jsx), which
// is why responses come back with **bold**, tables, etc. rather than
// plain text. This mirrors that on mobile via react-native-markdown-display
// (the closest equivalent with built-in GFM table support), styled to
// match the tenant theme instead of that library's defaults.
function markdownStyles(theme: ChatTheme) {
  return StyleSheet.create({
    body: { color: theme.textPrimary, fontSize: 15 },
    paragraph: { marginTop: 0, marginBottom: 8 },
    strong: { fontWeight: '700' },
    bullet_list: { marginBottom: 8 },
    ordered_list: { marginBottom: 8 },
    code_inline: {
      backgroundColor: theme.background,
      color: theme.textPrimary,
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    code_block: { backgroundColor: theme.background, borderRadius: 8, padding: 10 },
    fence: { backgroundColor: theme.background, borderRadius: 8, padding: 10 },
    link: { color: theme.brandColor },
    table: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, marginBottom: 8, overflow: 'hidden' },
    thead: { backgroundColor: theme.background },
    th: {
      padding: 8,
      fontWeight: '700',
      color: theme.textPrimary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    td: {
      padding: 8,
      color: theme.textPrimary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    tr: { flexDirection: 'row', borderBottomWidth: 0 },
  });
}

/**
 * Pure presentational "Ask ADAR" chat UI -- message list, empty-state
 * chips, input row. Shared by ChatScreen (authenticated, useChat()) and
 * GuestChatScreen (no-login, useGuestChat()) so the two only differ in
 * which controller feeds them, never in how the conversation renders.
 */
export function ChatView({ messages, sending, error, send, theme, placeholder, suggestedQuestions, logo }: ChatViewProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const mdStyles = markdownStyles(theme);

  const submit = () => {
    if (!draft.trim() || sending) return;
    const text = draft;
    setDraft('');
    send(text);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          {logo ? <Image source={logo} style={styles.logo} resizeMode="contain" /> : null}
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{placeholder}</Text>
          {(suggestedQuestions || []).map((q) => (
            <TouchableOpacity
              key={q}
              style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.surface }]}
              onPress={() => send(q)}
            >
              <Text style={{ color: theme.textPrimary }}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === 'user'
                  ? [styles.userBubble, { backgroundColor: theme.brandColor }]
                  : [styles.assistantBubble, { backgroundColor: theme.surface, borderColor: theme.border }],
              ]}
            >
              {item.role === 'user' ? (
                <Text style={styles.userText}>{item.text}</Text>
              ) : (
                <Markdown
                  style={mdStyles}
                  // Wide GFM tables (adar-core replies often include one)
                  // don't fit an 85%-width bubble -- let just the table
                  // scroll horizontally instead of squashing every column.
                  rules={{
                    table: (node, children) => (
                      <ScrollView key={node.key} horizontal showsHorizontalScrollIndicator>
                        <View style={mdStyles.table}>{children}</View>
                      </ScrollView>
                    ),
                  }}
                >
                  {item.text}
                </Markdown>
              )}
            </View>
          )}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={[styles.inputRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <TextInput
          style={[styles.input, { color: theme.textPrimary }]}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask a question..."
          placeholderTextColor={theme.textSecondary}
          onSubmitEditing={submit}
          editable={!sending}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendButton, { backgroundColor: theme.brandColor, opacity: sending ? 0.5 : 1 }]}
          onPress={submit}
          disabled={sending}
        >
          <Text style={styles.sendText}>{sending ? '...' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  logo: { width: 64, height: 64, borderRadius: 14, marginBottom: 16 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 8 },
  list: { padding: 16 },
  bubble: { borderRadius: 16, padding: 12, marginBottom: 10, maxWidth: '92%' },
  userBubble: { alignSelf: 'flex-end', maxWidth: '85%' },
  assistantBubble: { alignSelf: 'flex-start', borderWidth: 1 },
  userText: { color: '#fff' },
  error: { color: '#c0392b', textAlign: 'center', paddingVertical: 6, fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, padding: 10 },
  input: { flex: 1, fontSize: 15, paddingVertical: 8, paddingHorizontal: 12 },
  sendButton: { marginLeft: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  sendText: { color: '#fff', fontWeight: '700' },
});
