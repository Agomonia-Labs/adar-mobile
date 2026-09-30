import React, { useRef, useState } from 'react';
import {
  FlatList,
  Image,
  ImageSourcePropType,
  KeyboardAvoidingView,
  Linking,
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

export interface ChatViewVoiceProps {
  /** True while actively recording the user's voice. */
  recording: boolean;
  /** True while a recording is being transcribed, or a reply is being synthesized. */
  busy: boolean;
  /** Voice-specific error (mic permission, network, ...) -- separate from `error` above. */
  error: string | null;
  /** Starts recording on tap; tap again to stop, transcribe, and send. */
  onToggleRecord: () => void;
  /** Id of the assistant message currently playing back, if any. */
  playingMessageId: string | null;
  /** Synthesizes and plays one assistant message; tapping the same message again stops it. */
  onPlayMessage: (message: ChatMessage) => void;
}

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
  /** Omit entirely to render the plain text-only chat (default for every
   *  tenant). Only a caller that wires up recording + playback (see
   *  apps/geetabitan/src/useVoiceChat.ts) passes this, so ARCL/FrontDesk
   *  are unaffected. */
  voice?: ChatViewVoiceProps;
  /** Optional element rendered above the input row -- e.g. Geetabitan's
   *  embedded YouTube mini-player when a reply links to a video. Omit
   *  entirely for tenants that don't need it (keeps react-native-webview
   *  out of ARCL/FrontDesk, same reasoning as `voice` above). */
  videoPlayer?: React.ReactNode;
  /** Optional element rendered as part of the conversation itself, not
   *  above/outside it -- e.g. ADAR Front Desk's name/phone/email pre-chat
   *  form. Shown in the empty state (before the first message) AND as the
   *  message list's own ListHeaderComponent (so it stays visible, scrolling
   *  with the conversation, once messages start coming in) -- this is what
   *  makes it read as "part of the conversation" rather than a separate
   *  bar sitting outside the chat. Omit entirely for tenants that don't
   *  need it. */
  leadingContent?: React.ReactNode;
  /** Leave this at its default (0) for almost every screen, including one
   *  where ChatView sits below other plain sibling Views (a header, a tab
   *  bar, a context bar -- as in ADAR Front Desk's Ask ADAR tab).
   *  KeyboardAvoidingView measures its OWN real on-screen position
   *  automatically (measureInWindow) every time it renders, which already
   *  accounts for anything above it in the same view hierarchy -- adding
   *  that height again here double-counts it, over-padding the input row
   *  well past the keyboard's actual top edge and eating into the space
   *  left for the conversation above it (this bit Front Desk once; don't
   *  reintroduce it). The one case this prop is actually for for: content
   *  above ChatView that lives in a DIFFERENT native layer ChatView's own
   *  measurement can't see -- e.g. a native React Navigation header --
   *  where that header's height is the right (and only) value to pass. */
  keyboardVerticalOffset?: number;
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
  // Wrapper nodes (td/th/inline) carry an empty `content` string and put
  // the real text in `children` -- only leaf text nodes have a non-empty
  // `content` with no children. Recurse into children first, or this
  // returns '' for every cell (which is exactly what happened before).
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children.map(extractPlainText).join('');
  }
  if (typeof node.content === 'string') return node.content;
  return '';
}

// A table cell that contains a markdown link (e.g. Geetabitan's YouTube
// results table: "| লিংক | [▶ দেখুন](https://youtube.com/watch?v=...) |")
// used to lose the href entirely -- extractPlainText above flattens a
// `link` node down to just its label text ("▶ দেখুন"), because the custom
// `table` render rule below bypasses react-native-markdown-display's own
// `link` rule (the one that normally opens the href on tap). Recurse the
// same way extractPlainText does, but keep any `link` node tappable
// instead of discarding its href.
function renderInline(node: any, key: string, theme: ChatTheme): React.ReactNode {
  if (!node) return null;
  if (node.type === 'link') {
    const href = node.attributes?.href;
    return (
      <Text
        key={key}
        style={{ color: theme.brandColor, textDecorationLine: 'underline' }}
        onPress={() => { if (href) Linking.openURL(href); }}
      >
        {extractPlainText(node)}
      </Text>
    );
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children.map((child: any, i: number) => renderInline(child, `${key}-${i}`, theme));
  }
  if (typeof node.content === 'string') return node.content;
  return null;
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
                  style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 2 }}
                >
                  <Text style={{ fontSize: 13, color: theme.textSecondary, flexShrink: 0, marginRight: 8 }}>
                    {label}
                  </Text>
                  {/* flex + flexShrink so a long song title or channel name
                     (get_youtube_url's table can run long) wraps onto more
                     lines instead of overflowing the card/bubble/screen --
                     RN Views default to flexShrink: 0, so without this a
                     long value renders at its full width regardless of
                     the row's actual space. */}
                  <Text
                    style={{ fontSize: 13, fontWeight: '600', color: theme.textPrimary, flex: 1, flexShrink: 1, textAlign: 'right' }}
                  >
                    {renderInline(cell, `cell-${rowIdx}-${colIdx}`, theme)}
                  </Text>
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
 * The optional `voice` prop adds a mic button (record -> transcribe ->
 * send) and a per-assistant-message "Listen" control -- see
 * ChatViewVoiceProps above.
 */
export function ChatView({ messages, sending, error, send, theme, placeholder, suggestedQuestions, logo, voice, videoPlayer, leadingContent, keyboardVerticalOffset = 0 }: ChatViewProps) {
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
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          {leadingContent ? <View style={styles.leadingContentEmpty}>{leadingContent}</View> : null}
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
          style={styles.messageList}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={leadingContent ? <View style={styles.leadingContentList}>{leadingContent}</View> : null}
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
                <View>
                  <Markdown
                    style={mdStyles}
                    rules={{
                      table: (node) => renderTableAsCards(node, theme),
                    }}
                  >
                    {item.text}
                  </Markdown>
                  {voice ? (
                    <TouchableOpacity
                      style={styles.speakerButton}
                      onPress={() => voice.onPlayMessage(item)}
                      accessibilityLabel={voice.playingMessageId === item.id ? 'Stop playback' : 'Listen to this reply'}
                    >
                      <Text style={[styles.speakerText, { color: theme.brandColor }]}>
                        {voice.playingMessageId === item.id ? '⏸ Stop' : '🔊 Listen'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </View>
          )}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {voice?.error ? <Text style={styles.error}>{voice.error}</Text> : null}
      {videoPlayer}

      <View style={[styles.inputRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        {voice ? (
          <TouchableOpacity
            style={[
              styles.micButton,
              {
                backgroundColor: voice.recording ? '#c0392b' : theme.background,
                borderColor: voice.recording ? '#c0392b' : theme.border,
              },
            ]}
            onPress={voice.onToggleRecord}
            disabled={sending || (voice.busy && !voice.recording)}
            accessibilityLabel={voice.recording ? 'Stop recording' : 'Ask by voice'}
          >
            <Text style={styles.micText}>{voice.recording ? '⏹' : voice.busy ? '…' : '🎤'}</Text>
          </TouchableOpacity>
        ) : null}
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
  leadingContentEmpty: { width: '100%', marginBottom: 16 },
  leadingContentList: { marginHorizontal: -16, marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  logo: { width: 64, height: 64, borderRadius: 14, marginBottom: 16 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 8 },
  messageList: { flex: 1 },
  list: { padding: 16 },
  bubble: { borderRadius: 16, padding: 12, marginBottom: 10, maxWidth: '92%', overflow: 'hidden' },
  userBubble: { alignSelf: 'flex-end', maxWidth: '85%' },
  assistantBubble: { alignSelf: 'flex-start', borderWidth: 1 },
  userText: { color: '#fff' },
  error: { color: '#c0392b', textAlign: 'center', paddingVertical: 6, fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, padding: 10 },
  input: { flex: 1, fontSize: 15, paddingVertical: 8, paddingHorizontal: 12 },
  sendButton: { marginLeft: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  sendText: { color: '#fff', fontWeight: '700' },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  micText: { fontSize: 18 },
  speakerButton: { marginTop: 10, paddingTop: 2, alignSelf: 'flex-start' },
  speakerText: { fontSize: 12, fontWeight: '600' },
});
