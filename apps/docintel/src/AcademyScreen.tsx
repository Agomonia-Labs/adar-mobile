import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { DocIntelCourse, askCourseQuestion, createCourse, extractDocIntelError, listCourses } from './docintelApi';
import { useWorkspace } from './WorkspaceContext';

const BRAND = '#2e7d4f';

// ── Knowledge Academy tab ───────────────────────────────────────────────────
// Phase 1 slice of a much larger real backend (routes/learning.py: course
// curricula, assignments, graded artifacts, mastery tracking, an
// instructor dashboard -- a full LMS). What's wired up here:
//   - Course list, scoped to the active workspace (see WorkspaceContext) --
//     Academy respects the same workspace-isolation boundary as
//     Documents/Chat.
//   - Admin/teacher: "+ New course" -- the concrete "configure Knowledge
//     Academy" entry point the product spec asked for.
//   - Everyone: "Ask a question" on a course, routed to that course's
//     teacher/advisor (learning.py's ask_human()) -- the core
//     "student can use current knowledge academy options" interaction.
// Curriculum authoring, assignments/artifacts, and the instructor
// dashboard are real, live endpoints NOT yet given a mobile screen --
// next slice of Academy work, not a placeholder for something that
// doesn't exist server-side.
export function AcademyScreen({ onOpenCourse }: { onOpenCourse: (courseId: string) => void }) {
  const { client, session } = useAuth();
  const { active, workspaces } = useWorkspace();
  const [courses, setCourses] = useState<DocIntelCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Academy courses live inside a workspace (learning_courses.workspace_id
  // is required server-side) -- Personal has no course list.
  const workspaceId = active?.id;
  const canManage = active?.my_role === 'owner' || active?.my_role === 'editor';

  const refresh = useCallback(async () => {
    if (!session || !workspaceId) { setCourses([]); setLoading(false); return; }
    setLoading(true);
    try {
      setCourses(await listCourses(client, session.accessToken, workspaceId));
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not load courses.'));
    } finally {
      setLoading(false);
    }
  }, [client, session, workspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!workspaceId) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Knowledge Academy</Text>
        <Text style={styles.empty}>
          Academy courses live inside a workspace. Switch out of Personal on the Workspaces tab to see or
          create courses{workspaces.length === 0 ? ' (create a workspace first)' : ''}.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.header}>Knowledge Academy</Text>
          <Text style={styles.subheader}>{active?.name}</Text>
        </View>
        {canManage ? (
          <TouchableOpacity style={styles.newButton} onPress={() => setShowCreate(true)}>
            <Text style={styles.newButtonText}>+ Course</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} />
      ) : courses.length === 0 ? (
        <Text style={styles.empty}>
          {canManage
            ? 'No courses yet in this workspace. Tap "+ Course" to configure one.'
            : 'No courses have been set up in this workspace yet.'}
        </Text>
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <CourseCard course={item} client={client} accessToken={session!.accessToken} onOpen={() => onOpenCourse(item.id)} />
          )}
        />
      )}

      <CreateCourseModal
        visible={showCreate}
        workspaceId={workspaceId}
        client={client}
        accessToken={session?.accessToken}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); refresh(); }}
      />
    </View>
  );
}

function CourseCard({ course, client, accessToken, onOpen }: { course: DocIntelCourse; client: any; accessToken: string; onOpen: () => void }) {
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSend = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await askCourseQuestion(client, accessToken, course.id, question.trim());
      setSent(true);
      setQuestion('');
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not send your question.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity style={styles.courseCard} activeOpacity={0.7} onPress={onOpen}>
      <Text style={styles.courseTitle}>{course.title}</Text>
      <Text style={styles.courseMeta}>
        {course.course_code}{course.semester ? ` · ${course.semester}` : ''} · {course.domain}
      </Text>
      {course.description ? <Text style={styles.courseDesc} numberOfLines={2}>{course.description}</Text> : null}
      <View style={styles.courseFooter}>
        <Text style={styles.courseMeta}>
          {course.member_count} member{course.member_count === 1 ? '' : 's'} · {course.asset_count} asset{course.asset_count === 1 ? '' : 's'}
        </Text>
        <TouchableOpacity onPress={(e) => { e.stopPropagation(); setAsking((v) => !v); }}>
          <Text style={styles.askLink}>{asking ? 'Cancel' : 'Ask a question'}</Text>
        </TouchableOpacity>
      </View>
      {asking ? (
        <View style={styles.askBox}>
          {sent ? (
            <Text style={styles.sentText}>Sent to the instructor -- you'll be notified when it's answered.</Text>
          ) : (
            <>
              {error ? <Text style={styles.errorTextSmall}>{error}</Text> : null}
              <TextInput
                style={styles.askInput}
                placeholder="What would you like to ask?"
                value={question}
                onChangeText={setQuestion}
                multiline
              />
              <TouchableOpacity style={[styles.askSend, { opacity: question.trim() && !busy ? 1 : 0.5 }]} disabled={!question.trim() || busy} onPress={onSend}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.askSendText}>Send</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function CreateCourseModal({ visible, workspaceId, client, accessToken, onClose, onCreated }: any) {
  const [title, setTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [instructorName, setInstructorName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 1 && !busy;

  const onSubmit = async () => {
    if (!canSubmit || !accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await createCourse(client, accessToken, {
        workspaceId,
        title: title.trim(),
        courseCode: courseCode.trim(),
        semester: '',
        description: '',
        instructorName: instructorName.trim(),
        domain: 'general',
      });
      setTitle(''); setCourseCode(''); setInstructorName('');
      onCreated();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not create the course.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.modalCard} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>Configure a course</Text>
          {error ? <Text style={styles.errorTextSmall}>{error}</Text> : null}
          <TextInput style={styles.input} placeholder="Course title" value={title} onChangeText={setTitle} />
          <TextInput style={styles.input} placeholder="Course code (optional)" value={courseCode} onChangeText={setCourseCode} />
          <TextInput style={styles.input} placeholder="Instructor name (optional)" value={instructorName} onChangeText={setInstructorName} />
          <TouchableOpacity style={[styles.primaryButton, { opacity: canSubmit ? 1 : 0.5 }]} disabled={!canSubmit} onPress={onSubmit}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Create course</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fa', padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  header: { fontSize: 22, fontWeight: '700', color: '#14181f' },
  subheader: { fontSize: 13, color: '#5b6472', marginTop: 2 },
  newButton: { backgroundColor: BRAND, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  newButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  empty: { color: '#5b6472', fontSize: 14, textAlign: 'center', marginTop: 40, lineHeight: 20, paddingHorizontal: 10 },
  courseCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e5ea' },
  courseTitle: { fontSize: 16, fontWeight: '700', color: '#14181f' },
  courseMeta: { fontSize: 12, color: '#5b6472', marginTop: 3 },
  courseDesc: { fontSize: 13, color: '#374151', marginTop: 6, lineHeight: 18 },
  courseFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  askLink: { color: BRAND, fontWeight: '700', fontSize: 13 },
  askBox: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#e2e5ea', paddingTop: 10 },
  askInput: { borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, padding: 10, fontSize: 14, minHeight: 60, marginBottom: 8 },
  askSend: { backgroundColor: BRAND, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  askSendText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sentText: { color: '#1e7e34', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#14181f', marginBottom: 14 },
  input: { borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 },
  primaryButton: { backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelButton: { alignItems: 'center', paddingVertical: 8 },
  cancelButtonText: { color: '#5b6472', fontWeight: '600', fontSize: 14 },
  errorText: { color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 13, textAlign: 'center' },
  errorTextSmall: { color: '#c0392b', fontSize: 12, marginBottom: 8 },
});
