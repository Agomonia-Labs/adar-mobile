import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { LearningScope, extractDocIntelError, resolveLearningScope, streamChat } from './docintelApi';
import { MarkdownMessage } from './MarkdownMessage';
import { AnswerFeedback } from './AnswerFeedback';
import { VoiceRecorderButton } from './VoiceRecorderButton';
import { styles as sharedStyles } from './academyStyles';
import { useCountKey, useLanguage } from './i18n/LanguageContext';

const BRAND = '#2e7d4f';

interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

/** AI Tutor -- Knowledge Academy's flagship feature. It is NOT a separate
 *  AI: it's the exact same /api/chat/stream the main Chat tab uses, scoped
 *  to this course's embedded content via GET .../scope (which also hands
 *  back a course-aware grounding instruction, prepended to every question
 *  -- mirrors the web app's Tutor component in LearningPanel.jsx). A
 *  learner or teacher can narrow that scope to a single lesson, a whole
 *  module, or leave it at the entire course, same as web's ScopeBar --
 *  every activity (a quick check on one lesson vs. a broad course
 *  question) happens at a different one of those three levels. */
export function TutorTab({ courseId, workspace }: { courseId: string; workspace: any }) {
  const { client, session } = useAuth() as any;
  const { language, t } = useLanguage();
  const assetsAvailable = useCountKey();
  const [moduleId, setModuleId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [scope, setScope] = useState<LearningScope | null>(null);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  // No auto-scroll previously: as a conversation grew past the first
  // exchange, new content (streaming tokens, then the thumbs/eval/listen
  // row that mounts a beat after streaming ends) landed below the fold
  // with nothing to bring it into view -- indistinguishable from "hung"
  // or "didn't show up" unless the user thought to scroll further.
  const listRef = useRef<FlatList<TutorMessage>>(null);
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

  const modules = workspace?.modules || [];
  const selectedModule = modules.find((m: any) => m.id === moduleId);
  const lessons = selectedModule?.lessons || [];

  useEffect(() => {
    let cancelled = false;
    setScopeLoading(true);
    resolveLearningScope(client, session.accessToken, courseId, moduleId || undefined, lessonId || undefined)
      .then((s) => { if (!cancelled) { setScope(s); setScopeError(null); } })
      .catch((e) => { if (!cancelled) { setScope(null); setScopeError(extractDocIntelError(e, "Could not load this course's content scope.")); } })
      .finally(() => { if (!cancelled) setScopeLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, moduleId, lessonId]);

  // Switching scope mid-conversation would mix answers grounded in
  // different content under one thread -- start a fresh conversation
  // instead, same as web keying a separate session per scope.
  useEffect(() => { setMessages([]); }, [moduleId, lessonId]);

  useEffect(() => () => { cancelRef.current?.cancel(); }, []);

  const onSend = (question: string) => {
    const q = question.trim();
    if (!q || !scope || busy) return;
    if (!scope.document_ids.length) {
      setScopeError(t('tutorNoScopeContent'));
      return;
    }
    setScopeError(null);
    setInput('');
    const userMsg: TutorMessage = { id: `u-${Date.now()}`, role: 'user', text: q };
    const assistantId = `a-${Date.now()}`;
    const history = messages.map((m) => ({ role: m.role, content: m.text }));
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', text: '', streaming: true }]);
    setBusy(true);

    cancelRef.current = streamChat(
      baseURL,
      session.accessToken,
      {
        question: `${scope.instruction}\n\nSTUDENT QUESTION:\n${q}`,
        documentIds: scope.document_ids,
        workspaceId: scope.workspace_id,
        history,
        responseLanguage: language,
      },
      {
        onToken: (t) => setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + t } : m))),
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

  const canSend = !!scope && !scopeLoading && !busy && scope.document_ids.length > 0;

  return (
    <View testID="tutor-root" style={[styles.flex, { paddingBottom: keyboardHeight }]}>
      <View style={sharedStyles.scopeBar}>
        <Text style={sharedStyles.scopeLabel}>Module</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={sharedStyles.scopeRow}>
          <TouchableOpacity
            onPress={() => { setModuleId(''); setLessonId(''); }}
            style={[sharedStyles.scopeChip, !moduleId && sharedStyles.scopeChipActive]}
          >
            <Text style={[sharedStyles.scopeChipText, !moduleId && sharedStyles.scopeChipTextActive]}>{t('entireCourse')}</Text>
          </TouchableOpacity>
          {modules.map((m: any, i: number) => (
            <TouchableOpacity
              key={m.id}
              onPress={() => { setModuleId(m.id); setLessonId(''); }}
              style={[sharedStyles.scopeChip, moduleId === m.id && sharedStyles.scopeChipActive]}
            >
              <Text style={[sharedStyles.scopeChipText, moduleId === m.id && sharedStyles.scopeChipTextActive]} numberOfLines={1}>
                {`M${i + 1}: ${m.title}`}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {moduleId && lessons.length > 0 ? (
          <>
            <Text style={sharedStyles.scopeLabel}>Lesson</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={sharedStyles.scopeRow}>
              <TouchableOpacity onPress={() => setLessonId('')} style={[sharedStyles.scopeChip, !lessonId && sharedStyles.scopeChipActive]}>
                <Text style={[sharedStyles.scopeChipText, !lessonId && sharedStyles.scopeChipTextActive]}>{t('allLessons')}</Text>
              </TouchableOpacity>
              {lessons.map((l: any, i: number) => (
                <TouchableOpacity
                  key={l.id}
                  onPress={() => setLessonId(l.id)}
                  style={[sharedStyles.scopeChip, lessonId === l.id && sharedStyles.scopeChipActive]}
                >
                  <Text style={[sharedStyles.scopeChipText, lessonId === l.id && sharedStyles.scopeChipTextActive]} numberOfLines={1}>
                    {`L${i + 1}: ${l.title}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        ) : null}

        {lessonId || moduleId ? (
          <Text style={sharedStyles.scopeSelectedLabel} numberOfLines={3}>
            {lessonId
              ? `Lesson: ${lessons.find((l: any) => l.id === lessonId)?.title ?? ''}`
              : `Module: ${selectedModule?.title ?? ''}`}
          </Text>
        ) : null}

        {scopeLoading ? (
          <View style={styles.scopeStatusRow}>
            <ActivityIndicator size="small" color={BRAND} />
            <Text style={sharedStyles.scopeSummary}>{t('tutorLoadingScope')}</Text>
          </View>
        ) : scopeError ? (
          <Text style={sharedStyles.errorTextSmall}>{scopeError}</Text>
        ) : scope ? (
          <Text style={sharedStyles.scopeSummary}>{assetsAvailable('assetsAvailable', scope.document_ids.length)}</Text>
        ) : null}
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
              <MarkdownMessage justify>{item.text}</MarkdownMessage>
            ) : (
              <Text style={styles.bubbleTextAssistant}>{item.streaming ? '…' : ''}</Text>
            )}
            {item.streaming && item.text ? <ActivityIndicator size="small" color={BRAND} style={{ marginTop: 6 }} /> : null}
            {item.role === 'assistant' && !item.streaming && item.text ? (
              <AnswerFeedback
                client={client}
                accessToken={session.accessToken}
                messageId={item.id}
                question={messages[index - 1]?.text ?? ''}
                answer={item.text}
              />
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          <Text style={sharedStyles.empty}>
            {t(lessonId ? 'tutorEmptyLesson' : moduleId ? 'tutorEmptyModule' : 'tutorEmptyCourse')}
          </Text>
        }
      />
      <View style={styles.inputRow}>
        <VoiceRecorderButton disabled={busy} onTranscribed={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))} />
        <TextInput
          style={styles.input}
          placeholder={t('tutorInputPlaceholder')}
          value={input}
          onChangeText={setInput}
          multiline
          editable={!busy}
        />
        <TouchableOpacity
          style={[styles.sendButton, { opacity: input.trim() && canSend ? 1 : 0.5 }]}
          onPress={() => onSend(input)}
          disabled={!input.trim() || !canSend}
        >
          <Text style={styles.sendButtonText}>{t('send')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scopeStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12, marginBottom: 10 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: BRAND },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ea' },
  bubbleTextUser: { color: '#fff', fontSize: 14, lineHeight: 20, textAlign: 'justify' },
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
