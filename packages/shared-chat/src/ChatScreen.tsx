import React, { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getAuthTheme, useAuth } from '@adar/shared-auth';
import { useChat } from './useChat';
import type { ChatMessage } from './types';

export interface ChatScreenProps {
  /** Shown above the input when there are no messages yet. Defaults to "Ask <tenant>". */
  placeholder?: string;
  /** Optional starter questions shown as tappable chips when the conversation is empty. */
  suggestedQuestions?: string[];
}

/**
 * Drop-in "Ask ADAR" chat screen, styled from the tenant's brand color via
 * shared-auth's getAuthTheme -- same visual language as the login screen,
 * just parameterized per app (ARCL green, Geetabitan maroon, Front Desk teal).
 */
export function ChatScreen({ placeholder, suggestedQuestions }: ChatScreenProps) {
  const { tenant } = useAuth();
  const theme = getAuthTheme(tenant);
  const { messages, sending, error, send } = useChat();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

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
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
            {placeholder || `Ask ${tenant.displayName}`}
          </Text>
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
              <Text style={item.role === 'user' ? styles.userText : { color: theme.textPrimary }}>
                {item.text}
              </Text>
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
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 8 },
  list: { padding: 16 },
  bubble: { borderRadius: 16, padding: 12, marginBottom: 10, maxWidth: '85%' },
  userBubble: { alignSelf: 'flex-end' },
  assistantBubble: { alignSelf: 'flex-start', borderWidth: 1 },
  userText: { color: '#fff' },
  error: { color: '#c0392b', textAlign: 'center', paddingVertical: 6, fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, padding: 10 },
  input: { flex: 1, fontSize: 15, paddingVertical: 8, paddingHorizontal: 12 },
  sendButton: { marginLeft: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  sendText: { color: '#fff', fontWeight: '700' },
});
