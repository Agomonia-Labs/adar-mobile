import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { streamChat } from './docintelApi';
import { VoiceRecorderButton } from './VoiceRecorderButton';
import { MarkdownMessage } from './MarkdownMessage';
import { AnswerFeedback } from './AnswerFeedback';
import { useWorkspace } from './WorkspaceContext';
import { useCountKey, useLanguage } from './i18n/LanguageContext';

const BRAND = '#2e7d4f';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

/** Document-grounded chat -- mirrors the web app's chat tab. `documentIds`
 *  is fixed for the life of this screen (the set the user picked on
 *  DocumentsScreen); switching documents means going back and re-selecting,
 *  same mental model as starting a new conversation about a new set of
 *  files. */
export function ChatScreen({ documentIds, onBack }: { documentIds: string[]; onBack: () => void }) {
  const { client, session, tenant } = useAuth() as any;
  const { active } = useWorkspace();
  const { language, t } = useLanguage();
  const chatHeaderTitle = useCountKey();
  const [messages, setMessages] = useState<Message[]>([]);
  // No auto-scroll previously: as a conversation grew past the first
  // exchange, new content (streaming tokens, then the thumbs/eval/listen
  // row that mounts a beat after streaming ends) landed below the fold
  // with nothing to bring it into view -- indistinguishable from "hung"
  // or "didn't show up" unless the user thought to scroll further.
  const listRef = useRef<FlatList<Message>>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<{ cancel: () => void } | null>(null);

  const baseURL: string = client.defaults.baseURL;
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const onSend = () => {
    const question = input.trim();
    if (!question || !session || busy) return;
    setInput('');
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text: question };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', text: '', streaming: true }]);
    setBusy(true);

    const history = messages.map((m) => ({ role: m.role, content: m.text }));

    cancelRef.current = streamChat(
      baseURL,
      session.accessToken,
      { question, documentIds, workspaceId: active?.id, history, responseLanguage: language },
      {
        onToken: (t) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + t } : m))
          );
        },
        onDone: () => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
          setBusy(false);
        },
        onError: (msg) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: m.text || `⚠️ ${msg}`, streaming: false } : m))
          );
          setBusy(false);
        },
      }
    );
  };

  return (
    <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← {t('chatBackToDocuments')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{chatHeaderTitle('chatHeaderTitle', documentIds.length)}</Text>
      </View>

      <FlatList
        ref={listRef}
        style={styles.flex}
        contentContainerStyle={{ padding: 16 }}
        data={messages}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => {
          // A same-tick scrollToEnd() can run before RN has finished the
          // layout pass that this very content-size change triggered --
          // especially for a row (like AnswerFeedback) that mounts a beat
          // after the text bubble itself, adding height in a SEPARATE
          // layout pass. One immediate call plus one deferred call covers
          // both a same-tick resize and a slightly-later one, rather than
          // risk landing short of the newly added content.
          listRef.current?.scrollToEnd({ animated: true });
          requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
        }}
        renderItem={({ item, index }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
            {item.role === 'user' ? (
              <Text style={styles.bubbleTextUser}>{item.text}</Text>
            ) : item.text ? (
              <MarkdownMessage>{item.text}</MarkdownMessage>
            ) : (
              <Text style={styles.bubbleTextAssistant}>{item.streaming ? '…' : ''}</Text>
            )}
            {item.streaming && item.text ? <ActivityIndicator size="small" color={BRAND} style={{ marginTop: 6 }} /> : null}
            {item.role === 'assistant' && !item.streaming && item.text ? (
              <AnswerFeedback
                client={client}
                accessToken={session!.accessToken}
                messageId={item.id}
                question={messages[index - 1]?.text ?? ''}
                answer={item.text}
              />
            ) : null}
          </View>
        )}
      />

      <View style={styles.inputRow}>
        <VoiceRecorderButton disabled={busy} onTranscribed={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))} />
        <TextInput
          style={styles.input}
          placeholder={t('chatInputPlaceholder')}
          value={input}
          onChangeText={setInput}
          multiline
          editable={!busy}
        />
        <TouchableOpacity style={[styles.sendButton, { opacity: input.trim() && !busy ? 1 : 0.5 }]} onPress={onSend} disabled={!input.trim() || busy}>
          <Text style={styles.sendButtonText}>{t('send')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e2e5ea', backgroundColor: '#fff',
  },
  backButton: { marginRight: 10 },
  backButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  headerTitle: { fontSize: 14, fontWeight: '600', color: '#14181f', flex: 1 },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12, marginBottom: 10 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: BRAND },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ea' },
  bubbleTextUser: { color: '#fff', fontSize: 14, lineHeight: 20 },
  bubbleTextAssistant: { color: '#14181f', fontSize: 14, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 12, borderTopWidth: 1, borderTopColor: '#e2e5ea',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15, maxHeight: 100, marginRight: 8,
  },
  sendButton: { backgroundColor: BRAND, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  sendButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
