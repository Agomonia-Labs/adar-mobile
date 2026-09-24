import React, { useRef, useState } from 'react';
import {
  FlatList,
  Image,
  ImageSourcePropType,
  KeyboardAvoidingView,
  Platform,
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
  });
}

// GFM tables (adar-core replies often include one -- scorecards, standings)
// render badly as a literal grid on a narrow phone screen: tiny squashed
// columns or endless horizontal scrolling either way. Instead, flatten
// each row into a card: the row's first column becomes the card title
// (e.g. a player or team name) and every other column becomes a
// "Label: Value" line underneath it -- a plain vertical list that reads
// naturally on mobile with no scrolling or zooming required.
function extractPlainText(node: any): string {
  if (!node) return '';
  if (typeof node.content === 'string') return node.content;
  if (Array.isArray(node.children)) return node.children.map(extractPlainText).join('');
  return '';
}

function renderTableAsCards(node: any, theme: ChatTheme) {
  const thead = node.children?.find((c: any) => c.type === 'thead');
  const tbody = node.children?.find((c: any) => c.type === 'tbody');
  const headerRow = thead?.children?.[0];
  const headers: string[] = (headerRow?.children || []).map(extractPlainText);
  const bodyRows = tbody?.children || [];

  return (
    <View key={node.key} style={{ marginBottom: 8 }}>
      {bodyRows.map((row: any, rowIdx: number) => {
        const cells = row.children || [];
        const [firstCell, ...restCells] = cells;
        const title = firstCell ? extractPlainText(firstCell) : '';

        return (
          <View
            key={row.key ?? rowIdx}
            style={{
              backgroundColor: theme.background,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              borderRadius: 10,
              padding: 10,
              marginBottom: 8,
            }}
          >
            {title ? (
              <Text style={{ fontSize: 15, fontWeight: '700', color: theme.textPrimary, marginBottom: 4 }}>
                {title}
              </Text>
            ) : null}
            {restCells.map((cell: any, colIdx: number) => {
              const value = extractPlainText(cell);
              if (!value) return null;
              const label = headers[colIdx + 1] || '';
              return (
                <View
                  key={colIdx}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}
                >
                  <Text style={{ fontSize: 13, color: theme.textSecondary }}>{label}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textPrimary }}>{value}</Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
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
                  rules={{
                    table: (node) => renderTableAsCards(node, theme),
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
