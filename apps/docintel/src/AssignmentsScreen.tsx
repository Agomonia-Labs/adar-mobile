import React, { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import {
  DocIntelAssignment,
  DocIntelSubmission,
  RubricCriterion,
  createAssignment,
  evaluateAssignmentSubmission,
  extractDocIntelError,
  reviewAssignmentSubmission,
  saveAssignmentSubmission,
} from './docintelApi';
import { styles } from './academyStyles';
import { MarkdownMessage } from './MarkdownMessage';

const BRAND = '#2e7d4f';
const TYPES: DocIntelAssignment['assignment_type'][] = ['written', 'document', 'presentation', 'project'];
const STATUS_COLORS: Record<string, string> = {
  draft: '#9aa3b2', submitted: '#a06a00', in_review: '#2e6fdb',
  revision_requested: '#c0392b', approved: '#1e7e34',
};

export function AssignmentsTab({ courseId, workspace, canManage, onChanged }: {
  courseId: string; workspace: any; canManage: boolean; onChanged: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const assignments: DocIntelAssignment[] = workspace?.assignments || [];
  const submissions: DocIntelSubmission[] = workspace?.submissions || [];
  const open = assignments.find((a) => a.id === openId) || null;

  if (open) {
    return (
      <AssignmentDetail
        courseId={courseId}
        assignment={open}
        submissions={submissions.filter((s) => s.assignment_id === open.id)}
        canManage={canManage}
        myUserId={workspace?.my_profile?.user_id}
        onBack={() => setOpenId(null)}
        onChanged={onChanged}
      />
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      {canManage ? (
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.secondaryButtonText}>+ New assignment</Text>
        </TouchableOpacity>
      ) : null}
      {assignments.length === 0 ? (
        <Text style={styles.empty}>No assignments yet.</Text>
      ) : (
        assignments.map((a) => {
          const mySubmission = submissions.find((s) => s.assignment_id === a.id);
          return (
            <TouchableOpacity key={a.id} style={styles.card} onPress={() => setOpenId(a.id)}>
              <Text style={styles.cardTitle}>{a.title}</Text>
              <Text style={styles.cardMeta}>
                {a.assignment_type} · {a.max_score} pts{a.due_at ? ` · due ${new Date(a.due_at).toLocaleDateString()}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', marginTop: 6 }}>
                <View style={[styles.pill, { backgroundColor: a.publication_status === 'draft' ? '#f0f1f3' : '#e5f4ea' }]}>
                  <Text style={[styles.pillText, { color: a.publication_status === 'draft' ? '#5b6472' : '#1e7e34' }]}>{a.publication_status}</Text>
                </View>
                {!canManage && mySubmission ? (
                  <View style={[styles.pill, { backgroundColor: '#eef2ff', marginLeft: 6 }]}>
                    <Text style={[styles.pillText, { color: STATUS_COLORS[mySubmission.status] || '#374151' }]}>{mySubmission.status}</Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })
      )}

      <CreateAssignmentModal
        visible={showCreate}
        courseId={courseId}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); onChanged(); }}
      />
    </ScrollView>
  );
}

function CreateAssignmentModal({ visible, courseId, onClose, onCreated }: {
  visible: boolean; courseId: string; onClose: () => void; onCreated: () => void;
}) {
  const { client, session } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<DocIntelAssignment['assignment_type']>('written');
  const [maxScore, setMaxScore] = useState('100');
  const [rubric, setRubric] = useState<RubricCriterion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rubricTotal = rubric.reduce((n, r) => n + (r.weight || 0), 0);
  const rubricOk = rubric.length === 0 || rubricTotal === 100;
  const canSubmit = title.trim().length > 1 && rubricOk && !busy;

  const addCriterion = () =>
    setRubric((prev) => [...prev, { id: `c${prev.length + 1}`, title: 'Criterion', description: '', weight: 0 }]);

  const onSubmit = async () => {
    if (!canSubmit || !session) return;
    setBusy(true);
    setError(null);
    try {
      await createAssignment(client, session.accessToken, courseId, {
        title: title.trim(), description: description.trim(), assignmentType: type,
        rubric, maxScore: parseInt(maxScore, 10) || 100, publicationStatus: 'published',
      });
      setTitle(''); setDescription(''); setRubric([]);
      onCreated();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not create the assignment.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <ScrollView style={{ maxHeight: '85%' }} contentContainerStyle={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 14 }}>New assignment</Text>
          {error ? <Text style={styles.errorTextSmall}>{error}</Text> : null}
          <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} />
          <TextInput style={styles.input} placeholder="Description" value={description} onChangeText={setDescription} multiline />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setType(t)}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: type === t ? BRAND : '#d7dbe0', marginRight: 8, marginBottom: 8 }}
              >
                <Text style={{ color: type === t ? BRAND : '#5b6472', fontWeight: '700', fontSize: 12 }}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} placeholder="Max score" value={maxScore} onChangeText={setMaxScore} keyboardType="number-pad" />

          <Text style={{ fontSize: 13, fontWeight: '700', color: '#14181f', marginTop: 4, marginBottom: 6 }}>
            Rubric {rubric.length ? `(weights total ${rubricTotal}/100)` : '(optional)'}
          </Text>
          {rubric.map((r, i) => (
            <View key={r.id} style={{ flexDirection: 'row', marginBottom: 6 }}>
              <TextInput
                style={[styles.input, { flex: 1, marginRight: 6, marginBottom: 0 }]}
                value={r.title}
                onChangeText={(t) => setRubric((prev) => prev.map((c, idx) => (idx === i ? { ...c, title: t } : c)))}
                placeholder="Criterion"
              />
              <TextInput
                style={[styles.input, { width: 70, marginBottom: 0 }]}
                value={String(r.weight)}
                onChangeText={(t) => setRubric((prev) => prev.map((c, idx) => (idx === i ? { ...c, weight: parseInt(t, 10) || 0 } : c)))}
                keyboardType="number-pad"
                placeholder="Wt"
              />
            </View>
          ))}
          <TouchableOpacity onPress={addCriterion}>
            <Text style={{ color: BRAND, fontWeight: '700', fontSize: 13, marginBottom: 8 }}>+ Add criterion</Text>
          </TouchableOpacity>
          {!rubricOk ? <Text style={styles.errorTextSmall}>Rubric weights must total 100.</Text> : null}

          <TouchableOpacity style={[styles.primaryButton, { opacity: canSubmit ? 1 : 0.5 }]} disabled={!canSubmit} onPress={onSubmit}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Create & publish</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 10 }} onPress={onClose}>
            <Text style={{ color: '#5b6472', fontWeight: '600' }}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function AssignmentDetail({ courseId, assignment, submissions, canManage, myUserId, onBack, onChanged }: {
  courseId: string; assignment: DocIntelAssignment; submissions: DocIntelSubmission[]; canManage: boolean;
  myUserId?: string; onBack: () => void; onChanged: () => void;
}) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      <TouchableOpacity onPress={onBack}><Text style={{ color: BRAND, fontWeight: '700', marginBottom: 12 }}>← Assignments</Text></TouchableOpacity>
      <Text style={styles.cardTitle}>{assignment.title}</Text>
      {assignment.description ? <Text style={{ fontSize: 14, color: '#374151', marginTop: 6, lineHeight: 19, textAlign: 'justify' }}>{assignment.description}</Text> : null}
      <Text style={styles.cardMeta}>
        {assignment.assignment_type} · {assignment.max_score} pts{assignment.due_at ? ` · due ${new Date(assignment.due_at).toLocaleDateString()}` : ''}
      </Text>
      {assignment.rubric?.length ? (
        <View style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#14181f', marginBottom: 4 }}>Rubric</Text>
          {assignment.rubric.map((r) => (
            <Text key={r.id} style={styles.cardMeta}>• {r.title} — {r.weight}%</Text>
          ))}
        </View>
      ) : null}

      <View style={{ height: 16 }} />

      {canManage ? (
        <>
          <Text style={styles.sectionTitle}>Submissions ({submissions.length})</Text>
          {submissions.length === 0 ? (
            <Text style={styles.empty}>No submissions yet.</Text>
          ) : (
            submissions.map((s) => (
              <SubmissionReviewCard key={s.id} courseId={courseId} assignmentId={assignment.id} submission={s} onChanged={onChanged} />
            ))
          )}
        </>
      ) : (
        <StudentSubmissionBox
          courseId={courseId}
          assignmentId={assignment.id}
          existing={submissions.find((s) => s.user_id === myUserId) || submissions[0] || null}
          closed={assignment.publication_status === 'closed'}
          onChanged={onChanged}
        />
      )}
    </ScrollView>
  );
}

function SubmissionReviewCard({ courseId, assignmentId, submission, onChanged }: {
  courseId: string; assignmentId: string; submission: DocIntelSubmission; onChanged: () => void;
}) {
  const { client, session } = useAuth();
  const [feedback, setFeedback] = useState(submission.instructor_feedback || '');
  const [score, setScore] = useState(submission.score != null ? String(submission.score) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runEvaluation = async () => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      await evaluateAssignmentSubmission(client, session.accessToken, courseId, assignmentId, submission.id);
      onChanged();
    } catch (err) { setError(extractDocIntelError(err, 'Evaluation failed.')); } finally { setBusy(false); }
  };

  const review = async (status: 'revision_requested' | 'approved') => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      await reviewAssignmentSubmission(client, session.accessToken, courseId, assignmentId, submission.id, {
        status, instructorFeedback: feedback.trim(), score: score ? parseFloat(score) : null,
      });
      onChanged();
    } catch (err) { setError(extractDocIntelError(err, 'Could not save your review.')); } finally { setBusy(false); }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{submission.full_name || submission.email}</Text>
      <View style={[styles.pill, { backgroundColor: '#eef2ff', marginTop: 4 }]}>
        <Text style={[styles.pillText, { color: STATUS_COLORS[submission.status] || '#374151' }]}>{submission.status}</Text>
      </View>
      {submission.submission_text ? <Text style={{ fontSize: 13, color: '#374151', marginTop: 8, lineHeight: 18, textAlign: 'justify' }}>{submission.submission_text}</Text> : null}
      {submission.ai_evaluation?.summary ? (
        <View style={{ marginTop: 8, backgroundColor: '#f7f8fa', borderRadius: 8, padding: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#14181f', marginBottom: 2 }}>AI first pass</Text>
          <MarkdownMessage justify>{submission.ai_evaluation.summary}</MarkdownMessage>
        </View>
      ) : null}
      {error ? <Text style={styles.errorTextSmall}>{error}</Text> : null}
      {submission.status === 'submitted' ? (
        <TouchableOpacity style={styles.secondaryButton} disabled={busy} onPress={runEvaluation}>
          <Text style={styles.secondaryButtonText}>{busy ? 'Running…' : 'Run AI evaluation'}</Text>
        </TouchableOpacity>
      ) : null}
      {['submitted', 'in_review'].includes(submission.status) ? (
        <>
          <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="Feedback" value={feedback} onChangeText={setFeedback} multiline />
          <TextInput style={styles.input} placeholder="Score" value={score} onChangeText={setScore} keyboardType="numeric" />
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity style={[styles.primaryButton, { flex: 1, marginRight: 6, backgroundColor: '#c0392b' }]} disabled={busy} onPress={() => review('revision_requested')}>
              <Text style={styles.primaryButtonText}>Request revision</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryButton, { flex: 1 }]} disabled={busy} onPress={() => review('approved')}>
              <Text style={styles.primaryButtonText}>Approve</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  );
}

function StudentSubmissionBox({ courseId, assignmentId, existing, closed, onChanged }: {
  courseId: string; assignmentId: string; existing: DocIntelSubmission | null; closed: boolean; onChanged: () => void;
}) {
  const { client, session } = useAuth();
  const [text, setText] = useState(existing?.submission_text || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = existing && ['submitted', 'in_review', 'approved'].includes(existing.status);

  const save = async (submit: boolean) => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      await saveAssignmentSubmission(client, session.accessToken, courseId, assignmentId, {
        submissionText: text.trim(), documentIds: existing?.document_ids || [], submit,
      });
      onChanged();
    } catch (err) { setError(extractDocIntelError(err, 'Could not save your submission.')); } finally { setBusy(false); }
  };

  return (
    <View>
      <Text style={styles.sectionTitle}>Your submission</Text>
      {existing ? (
        <View style={[styles.pill, { backgroundColor: '#eef2ff', marginBottom: 10 }]}>
          <Text style={[styles.pillText, { color: STATUS_COLORS[existing.status] || '#374151' }]}>{existing.status}</Text>
        </View>
      ) : null}
      {existing?.instructor_feedback ? (
        <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#e2e5ea' }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#14181f' }}>Instructor feedback</Text>
          <Text style={{ fontSize: 13, color: '#374151', marginTop: 4, textAlign: 'justify' }}>{existing.instructor_feedback}</Text>
          {existing.score != null ? <Text style={{ fontSize: 12, color: '#5b6472', marginTop: 4 }}>Score: {existing.score}</Text> : null}
        </View>
      ) : null}
      {error ? <Text style={styles.errorTextSmall}>{error}</Text> : null}
      {closed ? (
        <Text style={styles.empty}>This assignment is closed.</Text>
      ) : locked ? (
        <Text style={styles.empty}>Your submission is under review. You'll see feedback here once it's reviewed.</Text>
      ) : (
        <>
          <TextInput style={[styles.input, { minHeight: 100 }]} placeholder="Write your response…" value={text} onChangeText={setText} multiline />
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity style={[styles.secondaryButton, { flex: 1, marginRight: 6 }]} disabled={busy || !text.trim()} onPress={() => save(false)}>
              <Text style={styles.secondaryButtonText}>Save draft</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryButton, { flex: 1 }]} disabled={busy || !text.trim()} onPress={() => save(true)}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Submit</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}
