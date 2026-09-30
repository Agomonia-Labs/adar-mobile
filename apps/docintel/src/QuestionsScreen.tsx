import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { answerCourseQuestion, askCourseQuestion, extractDocIntelError } from './docintelApi';
import { styles as sharedStyles } from './academyStyles';

const BRAND = '#2e7d4f';
const STATUS_COLORS: Record<string, string> = { open: '#a06a00', answered: '#1e7e34', closed: '#6b7280' };

function QuestionCard({ item, courseId, canManage, myPersona, onChanged }: {
  item: any; courseId: string; canManage: boolean; myPersona: string; onChanged: () => void;
}) {
  const { client, session } = useAuth();
  const [answer, setAnswer] = useState(item.answer || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAnswer = ['teacher', 'advisor', 'admin'].includes(myPersona) || canManage;

  const submitAnswer = async () => {
    if (!session || !answer.trim()) return;
    setBusy(true); setError(null);
    try {
      await answerCourseQuestion(client, session.accessToken, courseId, item.id, { answer: answer.trim(), status: 'answered' });
      onChanged();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not save the answer.'));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      await answerCourseQuestion(client, session.accessToken, courseId, item.id, { status: 'closed' });
      onChanged();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not close this question.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={sharedStyles.card}>
      <View style={q.header}>
        <View style={[q.statusPill, { borderColor: STATUS_COLORS[item.status] || '#9aa1ab' }]}>
          <Text style={[q.statusText, { color: STATUS_COLORS[item.status] || '#9aa1ab' }]}>{item.status}</Text>
        </View>
        <Text style={sharedStyles.cardMeta}>To {item.target_role} · {item.asker_name || item.asker_email}</Text>
      </View>
      <Text style={[sharedStyles.cardTitle, { textAlign: 'justify' }]}>{item.question}</Text>
      {(canAnswer || item.answer) ? (
        <TextInput
          style={[sharedStyles.input, { minHeight: 60, textAlignVertical: 'top', marginTop: 8 }]}
          editable={canAnswer && item.status !== 'closed'}
          value={answer}
          placeholder="Write a reviewed response..."
          onChangeText={setAnswer}
          multiline
        />
      ) : null}
      {error ? <Text style={sharedStyles.errorTextSmall}>{error}</Text> : null}
      <View style={q.actions}>
        {canAnswer && item.status !== 'closed' ? (
          <TouchableOpacity style={[sharedStyles.primaryButton, (!answer.trim() || busy) && { opacity: 0.5 }]} onPress={submitAnswer} disabled={!answer.trim() || busy}>
            <Text style={sharedStyles.primaryButtonText}>Answer</Text>
          </TouchableOpacity>
        ) : null}
        {item.status === 'answered' ? (
          <TouchableOpacity style={sharedStyles.secondaryButton} onPress={close} disabled={busy}>
            <Text style={sharedStyles.secondaryButtonText}>Close</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

/** Questions tab (Teacher/Advisor escalation): learners can route a
 *  question that needs human judgment to a teacher or advisor with course
 *  context attached; teachers/advisors/admins answer from the same list.
 *  Mirrors the web app's Questions component (LearningPanel.jsx). */
export function QuestionsTab({ courseId, workspace, canManage, onChanged }: {
  courseId: string; workspace: any; canManage: boolean; onChanged: () => void;
}) {
  const { client, session } = useAuth();
  const [targetRole, setTargetRole] = useState<'teacher' | 'advisor'>('teacher');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions = workspace?.questions || [];
  const myPersona = workspace?.my_persona || 'student';

  const submit = async () => {
    if (!session || !question.trim()) return;
    setBusy(true); setError(null);
    try {
      await askCourseQuestion(client, session.accessToken, courseId, question.trim(), targetRole);
      setQuestion('');
      onChanged();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not send this question.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      <View style={sharedStyles.card}>
        <Text style={sharedStyles.sectionTitle}>Ask a person</Text>
        <View style={q.roleRow}>
          {(['teacher', 'advisor'] as const).map((r) => (
            <TouchableOpacity key={r} onPress={() => setTargetRole(r)} style={[q.roleChip, targetRole === r && q.roleChipActive]}>
              <Text style={[q.roleChipText, targetRole === r && q.roleChipTextActive]}>{r === 'teacher' ? 'Teacher' : 'Advisor'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={[sharedStyles.input, { minHeight: 70, textAlignVertical: 'top' }]}
          placeholder="What needs human guidance or clarification?"
          value={question}
          onChangeText={setQuestion}
          multiline
        />
        {error ? <Text style={sharedStyles.errorTextSmall}>{error}</Text> : null}
        <TouchableOpacity style={[sharedStyles.primaryButton, (!question.trim() || busy) && { opacity: 0.5 }]} onPress={submit} disabled={!question.trim() || busy}>
          <Text style={sharedStyles.primaryButtonText}>Send</Text>
        </TouchableOpacity>
      </View>

      <Text style={sharedStyles.sectionTitle}>Escalations</Text>
      {questions.length === 0 ? (
        <Text style={sharedStyles.empty}>Questions that need human judgment can be routed to a teacher or advisor with course context.</Text>
      ) : (
        questions.map((item: any) => (
          <QuestionCard key={item.id} item={item} courseId={courseId} canManage={canManage} myPersona={myPersona} onChanged={onChanged} />
        ))
      )}
    </ScrollView>
  );
}

const q = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  statusPill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 10.5, fontWeight: '700', textTransform: 'capitalize' },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 8 },
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  roleChip: { flex: 1, borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 8, paddingVertical: 8, alignItems: 'center', backgroundColor: '#fff' },
  roleChipActive: { borderColor: BRAND, backgroundColor: 'rgba(46,125,79,0.08)' },
  roleChipText: { fontSize: 13, color: '#5b6472', fontWeight: '600' },
  roleChipTextActive: { color: BRAND },
});
