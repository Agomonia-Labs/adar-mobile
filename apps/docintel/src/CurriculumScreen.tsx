import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { extractDocIntelError, saveCurriculum } from './docintelApi';
import { styles } from './academyStyles';

const BRAND = '#2e7d4f';

interface EditLesson { id?: string; title: string; description: string; objectivesText: string; competenciesText: string; }
interface EditModule { id?: string; title: string; description: string; lessons: EditLesson[]; }

function fromWorkspace(modules: any[]): EditModule[] {
  return (modules || []).map((m) => ({
    id: m.id, title: m.title || '', description: m.description || '',
    lessons: (m.lessons || []).map((l: any) => ({
      id: l.id, title: l.title || '', description: l.description || '',
      objectivesText: (l.objectives || []).join(', '),
      competenciesText: (l.competencies || []).join(', '),
    })),
  }));
}

/** Curriculum tab: whole-tree replace editor for
 *  PUT /courses/{id}/curriculum -- a module/lesson omitted from the saved
 *  array is deleted server-side (save_curriculum in learning.py), so this
 *  edits a full local copy and only writes it back on "Save curriculum". */
export function CurriculumTab({ courseId, workspace, canManage, onSaved }: {
  courseId: string; workspace: any; canManage: boolean; onSaved: () => void;
}) {
  const { client, session } = useAuth();
  const [modules, setModules] = useState<EditModule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (workspace?.modules) { setModules(fromWorkspace(workspace.modules)); setDirty(false); }
  }, [workspace]);

  if (!canManage) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {modules.length === 0 ? (
          <Text style={styles.empty}>The curriculum hasn't been published yet.</Text>
        ) : (
          modules.map((m, mi) => (
            <View key={m.id || mi} style={styles.card}>
              <Text style={styles.cardTitle}>{m.title}</Text>
              {m.description ? <Text style={styles.cardMeta}>{m.description}</Text> : null}
              {m.lessons.map((l, li) => (
                <View key={l.id || li} style={{ marginTop: 8, paddingLeft: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#14181f' }}>{li + 1}. {l.title}</Text>
                  {l.objectivesText ? <Text style={styles.cardMeta}>Objectives: {l.objectivesText}</Text> : null}
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    );
  }

  const updateModule = (i: number, patch: Partial<EditModule>) =>
    setModules((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m))) as any;
  const updateLesson = (mi: number, li: number, patch: Partial<EditLesson>) =>
    setModules((prev) =>
      prev.map((m, idx) => (idx !== mi ? m : { ...m, lessons: m.lessons.map((l, lidx) => (lidx === li ? { ...l, ...patch } : l)) }))
    );
  const addModule = () => { setModules((prev) => [...prev, { title: 'New module', description: '', lessons: [] }]); setDirty(true); };
  const removeModule = (i: number) => { setModules((prev) => prev.filter((_, idx) => idx !== i)); setDirty(true); };
  const addLesson = (mi: number) =>
    setModules((prev) =>
      prev.map((m, idx) => (idx !== mi ? m : { ...m, lessons: [...m.lessons, { title: 'New lesson', description: '', objectivesText: '', competenciesText: '' }] }))
    );
  const removeLesson = (mi: number, li: number) =>
    setModules((prev) => prev.map((m, idx) => (idx !== mi ? m : { ...m, lessons: m.lessons.filter((_, lidx) => lidx !== li) })));

  const markDirty = () => setDirty(true);

  const onSave = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await saveCurriculum(
        client, session.accessToken, courseId,
        modules.filter((m) => m.title.trim()).map((m) => ({
          id: m.id, title: m.title.trim(), description: m.description.trim(),
          lessons: m.lessons.filter((l) => l.title.trim()).map((l) => ({
            id: l.id, title: l.title.trim(), description: l.description.trim(),
            objectives: l.objectivesText.split(',').map((s) => s.trim()).filter(Boolean),
            competencies: l.competenciesText.split(',').map((s) => s.trim()).filter(Boolean),
          })),
        }))
      );
      setDirty(false);
      onSaved();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not save the curriculum.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      {error ? <Text style={styles.errorTextSmall}>{error}</Text> : null}
      {modules.map((m, mi) => (
        <View key={m.id || `new-${mi}`} style={styles.card}>
          <TextInput
            style={[styles.input, { fontWeight: '700', marginBottom: 4 }]}
            value={m.title}
            onChangeText={(t) => { updateModule(mi, { title: t }); markDirty(); }}
            placeholder="Module title"
          />
          <TextInput
            style={styles.input}
            value={m.description}
            onChangeText={(t) => { updateModule(mi, { description: t }); markDirty(); }}
            placeholder="Module description (optional)"
            multiline
          />
          {m.lessons.map((l, li) => (
            <View key={l.id || `newl-${li}`} style={{ marginTop: 8, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: '#e2e5ea' }}>
              <TextInput
                style={styles.input}
                value={l.title}
                onChangeText={(t) => { updateLesson(mi, li, { title: t }); markDirty(); }}
                placeholder={`Lesson ${li + 1} title`}
              />
              <TextInput
                style={styles.input}
                value={l.objectivesText}
                onChangeText={(t) => { updateLesson(mi, li, { objectivesText: t }); markDirty(); }}
                placeholder="Objectives, comma separated"
              />
              <TextInput
                style={styles.input}
                value={l.competenciesText}
                onChangeText={(t) => { updateLesson(mi, li, { competenciesText: t }); markDirty(); }}
                placeholder="Competencies, comma separated"
              />
              <TouchableOpacity onPress={() => { removeLesson(mi, li); markDirty(); }}>
                <Text style={{ color: '#c0392b', fontSize: 12, fontWeight: '700', marginBottom: 4 }}>Remove lesson</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity onPress={() => addLesson(mi)}>
            <Text style={{ color: BRAND, fontSize: 13, fontWeight: '700', marginTop: 8 }}>+ Add lesson</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => removeModule(mi)}>
            <Text style={{ color: '#c0392b', fontSize: 12, fontWeight: '700', marginTop: 10 }}>Remove module</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={styles.secondaryButton} onPress={addModule}>
        <Text style={styles.secondaryButtonText}>+ Add module</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.primaryButton, { opacity: dirty && !busy ? 1 : 0.5 }]} disabled={!dirty || busy} onPress={onSave}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save curriculum</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}
