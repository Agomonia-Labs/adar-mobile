import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AxiosInstance } from 'axios';
import { useAuth } from '@adar/shared-auth';
import {
  ArtifactType,
  LearningArtifact,
  QuizAttemptResult,
  deleteArtifact,
  extractDocIntelError,
  resolveLearningScope,
  saveArtifact,
  streamChat,
  submitQuizAttempt,
} from './docintelApi';
import { MarkdownMessage } from './MarkdownMessage';
import { styles as sharedStyles } from './academyStyles';
import { useLanguage } from './i18n/LanguageContext';

const BRAND = '#2e7d4f';

// ── Prompts (ported verbatim from the web app's LearningPanel.jsx
// STUDY_PROMPTS/PRACTICE_RETRY_PROMPT, so generated material has the same
// shape and quality here as on web) ─────────────────────────────────────────
const STUDY_PROMPTS: Record<ArtifactType, string> = {
  summary: 'Create a concise lesson summary covering the central ideas and important evidence in the selected course content.',
  study_guide: 'Create a structured study guide with learning objectives, major topics, explanations, examples, and review checkpoints.',
  key_concepts: `Identify the key concepts using only the selected course content. Format every concept in readable Markdown with this structure:
## Concept name
**Definition:** A clear explanation.
**Why it matters:** Its significance in the course.
**Review question:** A question that checks understanding.
**Answer:** A concise grounded answer.
Use separate sections, short paragraphs, and source citations where available.`,
  flashcards: `Create exactly 12 concise flashcards based only on the selected course content. Use this exact plain-text format for every card, with no table:
FLASHCARD 1
QUESTION: A clear question
ANSWER: A concise grounded answer
Continue through FLASHCARD 12. Keep each answer focused enough to review as a short tutor response.`,
  practice_questions: `Create exactly 6 grounded practice questions that progress from recall to application. Return one compact JSON object only, without Markdown, citations outside JSON, commentary, or code fences, using this exact structure:
{"schema_version":1,"instructions":"Select every correct answer, then submit each question for immediate feedback.","questions":[{"id":"q1","question":"Question text","options":[{"id":"A","text":"Option text","correct":true},{"id":"B","text":"Option text","correct":false},{"id":"C","text":"Option text","correct":false},{"id":"D","text":"Option text","correct":false}],"explanation":"Explain why the correct answer or answers are correct using the course material."}]}
Every question must have exactly four distinct options labeled A, B, C, and D. One or more options may be correct. Vary the number of correct answers across the quiz. Keep every option under 18 words and every explanation to one concise sentence. Escape quotes inside JSON strings. Do not include facts that are unsupported by the selected course content.`,
};
const PRACTICE_RETRY_PROMPT = `Create exactly 4 concise multiple-choice practice questions from the selected course material. Return valid compact JSON only, with no Markdown or text before or after it. Use schema_version 1 and a questions array. Every question needs id, question, exactly four options labeled A through D, at least one option with correct true, and a one-sentence explanation. Keep option text under 15 words. One or more answers may be correct.`;

const TYPE_LABELS: Record<ArtifactType, string> = {
  summary: 'Summary',
  study_guide: 'Study Guide',
  key_concepts: 'Key Concepts',
  flashcards: 'Flashcards',
  practice_questions: 'Practice Questions',
};

function pretty(type: string): string {
  return TYPE_LABELS[type as ArtifactType] || type;
}

function scopeLabel(workspace: any, moduleId: string, lessonId: string): string {
  if (!moduleId) return 'Entire course';
  const mod = (workspace?.modules || []).find((m: any) => m.id === moduleId);
  if (!mod) return 'Entire course';
  if (!lessonId) return `Module: ${mod.title}`;
  const lesson = (mod.lessons || []).find((l: any) => l.id === lessonId);
  return lesson ? `Lesson: ${lesson.title}` : `Module: ${mod.title}`;
}

/** Runs one non-streaming-to-the-UI generation: streams from /api/chat/stream
 *  internally but only resolves with the full text at the end (Study Tools
 *  content is saved as a whole artifact, not shown token-by-token). */
function generateContent(
  baseURL: string,
  accessToken: string,
  prompt: string,
  documentIds: string[],
  workspaceId: string,
  responseLanguage: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = '';
    streamChat(
      baseURL,
      accessToken,
      { question: prompt, documentIds, workspaceId, history: [], responseLanguage },
      {
        onToken: (tok) => { content += tok; },
        onDone: () => resolve(content),
        onError: (msg) => reject(new Error(msg)),
      }
    );
  });
}

function parseFlashcards(content: string): { question: string; answer: string }[] {
  const normalized = String(content || '')
    .replace(/\r/g, '')
    .replace(/^\s*(?:#{1,6}\s*)?(?:\*\*)?FLASHCARD\s+\d+(?:\*\*)?\s*$/gim, '')
    .trim();
  const cards: { question: string; answer: string }[] = [];
  const pattern = /(?:^|\n)\s*(?:\d+[.)]\s*)?(?:\*\*)?(?:QUESTION|Q)(?:\s+\d+)?(?:\*\*)?\s*[:.-]\s*([\s\S]*?)\n+\s*(?:\*\*)?(?:ANSWER|A)(?:\s+\d+)?(?:\*\*)?\s*[:.-]\s*([\s\S]*?)(?=\n\s*(?:\d+[.)]\s*)?(?:\*\*)?(?:QUESTION|Q)(?:\s+\d+)?(?:\*\*)?\s*[:.-]|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim();
    if (question && answer) cards.push({ question, answer });
  }
  return cards;
}

interface QuizOption { id: string; text: string; correct: boolean; }
interface QuizQuestion { id: string; question: string; options: QuizOption[]; explanation: string; }
interface ParsedQuiz { schema_version: 1; instructions: string; questions: QuizQuestion[]; }

function parseGeneratedQuiz(raw: string): ParsedQuiz {
  const cleaned = String(raw || '').replace(/^﻿/, '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI response ended before the quiz JSON was complete.');
  const candidate = cleaned.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  let quiz: any;
  try {
    quiz = JSON.parse(candidate);
  } catch {
    throw new Error('The AI response contained invalid quiz JSON after an automatic retry.');
  }
  if (!Array.isArray(quiz.questions) || !quiz.questions.length) throw new Error('The generated quiz did not include questions.');
  const questions: QuizQuestion[] = quiz.questions.map((question: any, index: number) => {
    if (!question?.question || !Array.isArray(question.options) || question.options.length !== 4) {
      throw new Error(`Question ${index + 1} must contain a question and exactly four options.`);
    }
    const options: QuizOption[] = question.options.map((option: any, optionIndex: number) => ({
      id: 'ABCD'[optionIndex],
      text: String(option?.text || '').trim(),
      correct: option?.correct === true,
    }));
    if (options.some((o) => !o.text) || !options.some((o) => o.correct)) {
      throw new Error(`Question ${index + 1} must contain four option texts and at least one correct answer.`);
    }
    if (new Set(options.map((o) => o.id)).size !== 4) throw new Error(`Question ${index + 1} must use four distinct option IDs.`);
    return {
      id: String(question.id || `q${index + 1}`),
      question: String(question.question).trim(),
      options,
      explanation: String(question.explanation || 'Review the correct answer against the cited course material.').trim(),
    };
  });
  return { schema_version: 1, instructions: String(quiz.instructions || 'Select every correct answer.'), questions };
}

function storedQuiz(content: string): ParsedQuiz | null {
  try { return parseGeneratedQuiz(content); } catch { return null; }
}

/** Study Tools -- generates summaries, study guides, key-concept sheets,
 *  flashcard decks, and interactive practice quizzes from this course's
 *  embedded content, and saves them so they're there next time (workspace
 *  refresh already returns `artifacts` + `quiz_attempts` as part of the one
 *  getCourseWorkspace() aggregate call -- see CourseDetailScreen.tsx). */
export function StudyToolsTab({
  courseId,
  workspace,
  onChanged,
}: {
  courseId: string;
  workspace: any;
  onChanged: () => void;
}) {
  const { client, session } = useAuth() as any;
  const { language, t } = useLanguage();
  const baseURL: string = client.defaults.baseURL;
  const [type, setType] = useState<ArtifactType>('study_guide');
  const [moduleId, setModuleId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (generating) {
      setElapsedSec(0);
      elapsedTimerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    } else if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, [generating]);

  const artifacts: LearningArtifact[] = workspace?.artifacts || [];
  const attempts: QuizAttemptResult[] = workspace?.quiz_attempts || [];
  const modules = workspace?.modules || [];
  const selectedModule = modules.find((m: any) => m.id === moduleId);
  const lessons = selectedModule?.lessons || [];

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const scope = await resolveLearningScope(client, session.accessToken, courseId, moduleId || undefined, lessonId || undefined);
      if (!scope.document_ids.length) throw new Error('No embedded content is available in this scope yet.');
      const scopedPrompt = `${scope.instruction}\n\nTASK:\n${STUDY_PROMPTS[type]}`;
      let content = await generateContent(baseURL, session.accessToken, scopedPrompt, scope.document_ids, scope.workspace_id, language);
      if (type === 'practice_questions') {
        try {
          content = JSON.stringify(parseGeneratedQuiz(content));
        } catch {
          const retryPrompt = `${scope.instruction}\n\nTASK:\n${PRACTICE_RETRY_PROMPT}`;
          const retryContent = await generateContent(baseURL, session.accessToken, retryPrompt, scope.document_ids, scope.workspace_id, language);
          content = JSON.stringify(parseGeneratedQuiz(retryContent));
        }
      }
      await saveArtifact(client, session.accessToken, courseId, {
        artifact_type: type,
        title: `${pretty(type)} · ${scopeLabel(workspace, moduleId, lessonId)}`,
        content,
        source_document_ids: scope.document_ids,
        module_id: moduleId || null,
        lesson_id: lessonId || null,
      });
      onChanged();
    } catch (e) {
      console.warn('[StudyTools] generate() failed', e);
      setError(extractDocIntelError(e, (e as Error)?.message || 'Could not generate this study material.'));
    } finally {
      setGenerating(false);
    }
  };

  const onDelete = async (artifactId: string) => {
    try {
      await deleteArtifact(client, session.accessToken, courseId, artifactId);
      onChanged();
    } catch (e) {
      setError(extractDocIntelError(e, 'Could not delete this item.'));
    }
  };

  return (
    <ScrollView style={[sharedStyles.overview, { flex: 1 }]}>
      <Text style={sharedStyles.sectionTitle}>{t('studyScopeTitle')}</Text>
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

      <Text style={[sharedStyles.sectionTitle, { marginTop: 12 }]}>{t('studyGenerateTitle')}</Text>
      <View style={styles.chipRow}>
        {(Object.keys(STUDY_PROMPTS) as ArtifactType[]).map((at) => (
          <TouchableOpacity key={at} style={[styles.chip, type === at && styles.chipActive]} onPress={() => setType(at)}>
            <Text style={[styles.chipText, type === at && styles.chipTextActive]}>{t(`studyType_${at}` as any)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={[sharedStyles.primaryButton, { opacity: generating ? 0.6 : 1 }]} disabled={generating} onPress={generate}>
        {generating ? <ActivityIndicator color="#fff" /> : <Text style={sharedStyles.primaryButtonText}>{t(`studyGenerateButton_${type}` as any)}</Text>}
      </TouchableOpacity>
      {generating ? (
        <Text style={sharedStyles.cardMeta}>
          {t('studyGeneratingProgress', { seconds: elapsedSec })}
        </Text>
      ) : null}
      {error ? <Text style={sharedStyles.errorTextSmall}>{error}</Text> : null}

      <Text style={[sharedStyles.sectionTitle, { marginTop: 24 }]}>{t('studySavedTitle')}</Text>
      {artifacts.length === 0 ? (
        <Text style={sharedStyles.empty}>{t('studyEmpty')}</Text>
      ) : (
        artifacts.map((item) => (
          <View key={item.id} style={sharedStyles.card}>
            <View style={styles.artifactHeader}>
              <View style={{ flex: 1 }}>
                <Text style={sharedStyles.cardTitle}>{item.title || pretty(item.artifact_type)}</Text>
                <Text style={sharedStyles.cardMeta}>
                  {scopeLabel(workspace, item.module_id || '', item.lesson_id || '')} · {new Date(item.created_at).toLocaleString()}
                </Text>
              </View>
              <TouchableOpacity onPress={() => onDelete(item.id)}>
                <Text style={styles.deleteText}>{t('delete')}</Text>
              </TouchableOpacity>
            </View>
            {item.artifact_type === 'flashcards' ? (
              <FlashcardDeck content={item.content} />
            ) : item.artifact_type === 'practice_questions' ? (
              <PracticeQuizView
                courseId={courseId}
                artifact={item}
                attempt={attempts.find((a: any) => a.id && item.id)}
                client={client}
                accessToken={session.accessToken}
                onChanged={onChanged}
              />
            ) : (
              <View style={{ marginTop: 8 }}>
                <MarkdownMessage justify>{item.content}</MarkdownMessage>
              </View>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function FlashcardDeck({ content }: { content: string }) {
  const cards = useMemo(() => parseFlashcards(content), [content]);
  if (!cards.length) return <MarkdownMessage justify>{content}</MarkdownMessage>;
  return (
    <View style={{ marginTop: 8 }}>
      {cards.map((card, index) => (
        <View key={`${index}-${card.question}`} style={styles.flashcard}>
          <Text style={styles.flashcardLabel}>Flashcard {index + 1}</Text>
          <View style={styles.flashcardQ}>
            <Text style={styles.flashcardQText}>{card.question}</Text>
          </View>
          <View style={styles.flashcardA}>
            <MarkdownMessage justify>{card.answer}</MarkdownMessage>
          </View>
        </View>
      ))}
    </View>
  );
}

function PracticeQuizView({
  courseId,
  artifact,
  client,
  accessToken,
  onChanged,
}: {
  courseId: string;
  artifact: LearningArtifact;
  attempt?: QuizAttemptResult;
  client: AxiosInstance;
  accessToken: string;
  onChanged: () => void;
}) {
  const quiz = useMemo(() => storedQuiz(artifact.content), [artifact.content]);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [submittedResult, setSubmittedResult] = useState<Record<string, { correct: boolean; correct_options: string[] }>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!quiz) return <MarkdownMessage justify>{artifact.content}</MarkdownMessage>;

  const toggle = (questionId: string, optionId: string) => {
    setSelections((cur) => {
      const set = new Set(cur[questionId] || []);
      set.has(optionId) ? set.delete(optionId) : set.add(optionId);
      return { ...cur, [questionId]: [...set] };
    });
  };

  const submit = async (question: QuizQuestion) => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await submitQuizAttempt(client, accessToken, courseId, artifact.id, { [question.id]: selections[question.id] || [] });
      setSelections(result.answers || {});
      setSubmittedResult(result.result || {});
    } catch (e) {
      setSaveError(extractDocIntelError(e, 'Could not save this answer.'));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await submitQuizAttempt(client, accessToken, courseId, artifact.id, {}, true);
      setSelections({});
      setSubmittedResult({});
      onChanged();
    } catch (e) {
      setSaveError(extractDocIntelError(e, 'Could not reset this attempt.'));
    } finally {
      setSaving(false);
    }
  };

  const completed = quiz.questions.filter((q) => submittedResult[q.id]);
  const correctCount = completed.filter((q) => submittedResult[q.id]?.correct).length;

  return (
    <View style={{ marginTop: 8 }}>
      <View style={styles.quizSummary}>
        <Text style={styles.quizSummaryText}>{quiz.instructions}</Text>
        <Text style={styles.quizScoreText}>
          {correctCount} correct · {completed.length} of {quiz.questions.length} submitted
        </Text>
        {completed.length > 0 ? (
          <TouchableOpacity onPress={reset} disabled={saving}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {quiz.questions.map((question, index) => {
        const done = Boolean(submittedResult[question.id]);
        const correct = done && submittedResult[question.id]?.correct;
        const correctOptions = question.options.filter((o) => o.correct);
        return (
          <View key={question.id} style={styles.quizQuestion}>
            <View style={styles.quizQuestionHeader}>
              <Text style={styles.questionNumber}>{index + 1}</Text>
              <Text style={styles.questionText}>{question.question}</Text>
              {done ? (
                <Text style={[styles.resultBadge, { color: correct ? '#2e7d4f' : '#c0392b' }]}>{correct ? 'Correct' : 'Incorrect'}</Text>
              ) : null}
            </View>
            {question.options.map((option) => {
              const selected = (selections[question.id] || []).includes(option.id);
              const showCorrect = done && option.correct;
              const showWrong = done && selected && !option.correct;
              return (
                <TouchableOpacity
                  key={option.id}
                  disabled={done}
                  onPress={() => toggle(question.id, option.id)}
                  style={[
                    styles.quizOption,
                    selected && !done && styles.quizOptionSelected,
                    showCorrect && styles.quizOptionCorrect,
                    showWrong && styles.quizOptionWrong,
                  ]}
                >
                  <Text style={styles.quizOptionId}>{option.id}</Text>
                  <Text style={styles.quizOptionText}>{option.text}</Text>
                </TouchableOpacity>
              );
            })}
            {!done ? (
              <TouchableOpacity
                style={[sharedStyles.secondaryButton, { opacity: (selections[question.id] || []).length ? 1 : 0.5 }]}
                disabled={saving || !(selections[question.id] || []).length}
                onPress={() => submit(question)}
              >
                <Text style={sharedStyles.secondaryButtonText}>{saving ? 'Saving...' : 'Submit answer'}</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.feedbackBox, { borderColor: correct ? '#2e7d4f' : '#c0392b' }]}>
                <Text style={styles.feedbackTitle}>{correct ? 'Correct answer' : 'Correct answer shown below'}</Text>
                <Text style={styles.feedbackAnswer}>{correctOptions.map((o) => `${o.id}. ${o.text}`).join('  |  ')}</Text>
                <Text style={styles.feedbackExplanation}>{question.explanation}</Text>
              </View>
            )}
          </View>
        );
      })}
      {saveError ? <Text style={sharedStyles.errorTextSmall}>{saveError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { fontSize: 13, fontWeight: '600', color: '#5b6472' },
  chipTextActive: { color: '#fff' },
  artifactHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  deleteText: { color: '#c0392b', fontSize: 12, fontWeight: '700' },
  flashcard: { marginBottom: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e2e5ea' },
  flashcardLabel: { fontSize: 10, fontWeight: '700', color: '#9aa3b2', textTransform: 'uppercase', marginBottom: 6, textAlign: 'center' },
  flashcardQ: { backgroundColor: BRAND, borderRadius: 10, padding: 10, marginBottom: 6, alignSelf: 'flex-end', maxWidth: '90%' },
  flashcardQText: { color: '#fff', fontSize: 13, lineHeight: 19, textAlign: 'justify' },
  flashcardA: { backgroundColor: '#f7f8fa', borderRadius: 10, padding: 10, maxWidth: '90%' },
  quizSummary: {
    padding: 10, borderWidth: 1, borderColor: '#cfe8d9', backgroundColor: '#eaf5ee', borderRadius: 10, marginBottom: 10,
  },
  quizSummaryText: { fontSize: 12, color: '#14181f', marginBottom: 4, textAlign: 'justify' },
  quizScoreText: { fontSize: 11, color: '#2e7d4f', fontWeight: '700' },
  retryText: { color: BRAND, fontWeight: '700', fontSize: 12, marginTop: 6 },
  quizQuestion: { marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#e2e5ea' },
  quizQuestionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  questionNumber: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: '#eaf5ee', color: BRAND, fontWeight: '800',
    fontSize: 12, textAlign: 'center', lineHeight: 22,
  },
  questionText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#14181f', textAlign: 'justify' },
  resultBadge: { fontSize: 11, fontWeight: '700' },
  quizOption: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 8,
    padding: 10, marginBottom: 6, backgroundColor: '#fff',
  },
  quizOptionSelected: { borderColor: BRAND, backgroundColor: '#eaf5ee' },
  quizOptionCorrect: { borderColor: '#2e7d4f', backgroundColor: 'rgba(46,125,79,0.08)' },
  quizOptionWrong: { borderColor: '#c0392b', backgroundColor: 'rgba(192,57,43,0.06)' },
  quizOptionId: { fontWeight: '800', fontSize: 12, color: '#5b6472', width: 16 },
  quizOptionText: { flex: 1, fontSize: 13, color: '#14181f', textAlign: 'justify' },
  feedbackBox: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 4 },
  feedbackTitle: { fontWeight: '700', fontSize: 12, color: '#14181f', marginBottom: 3 },
  feedbackAnswer: { fontSize: 12, color: '#14181f', marginBottom: 4, textAlign: 'justify' },
  feedbackExplanation: { fontSize: 12, color: '#5b6472', lineHeight: 17, textAlign: 'justify' },
});
