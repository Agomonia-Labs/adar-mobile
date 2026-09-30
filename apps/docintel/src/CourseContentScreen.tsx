import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import {
  DocIntelDocument,
  LearningDocument,
  addCourseAsset,
  extractDocIntelError,
  listLearningDocuments,
  removeCourseAsset,
} from './docintelApi';
import { DocumentViewerScreen } from './DocumentViewerScreen';
import { styles as sharedStyles } from './academyStyles';

const BRAND = '#2e7d4f';

function isTimed(doc: any) {
  const type = doc?.file_type || doc?.doc_type;
  return type === 'video' || type === 'audio';
}

function fmtTime(value: number | null | undefined) {
  const total = Math.max(0, Number(value) || 0);
  return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
}

function scopeLabel(workspace: any, moduleId: string, lessonId: string) {
  if (!moduleId) return 'Entire course';
  const mod = (workspace?.modules || []).find((m: any) => m.id === moduleId);
  if (!mod) return 'Entire course';
  if (!lessonId) return `Module: ${mod.title}`;
  const lesson = (mod.lessons || []).find((l: any) => l.id === lessonId);
  return lesson ? `Lesson: ${lesson.title}` : `Module: ${mod.title}`;
}

function assetToDoc(asset: any, workspace: any): DocIntelDocument {
  return {
    id: asset.document_id,
    original_name: asset.title || asset.original_name,
    file_type: asset.file_type,
    file_size: 0,
    status: asset.status,
    chunk_count: asset.chunk_count ?? null,
    error_message: null,
    workspace_id: workspace?.workspace_id || null,
    doc_type: asset.doc_type ?? null,
    doc_domain: null,
    doc_language: null,
    tags: [],
    created_at: asset.created_at,
    updated_at: asset.created_at,
  };
}

/** Course Content tab: attach already-processed workspace documents/audio/
 *  video (optionally scoped to a module or lesson, or a time range for
 *  timed media) as course assets -- mirrors the web app's CourseContent
 *  (LearningPanel.jsx). Embedded assets are what the AI Tutor and Study
 *  Tools ground their answers in. */
export function ContentTab({ courseId, workspace, canManage, onChanged }: {
  courseId: string; workspace: any; canManage: boolean; onChanged: () => void;
}) {
  const { client, session } = useAuth();
  const [documents, setDocuments] = useState<LearningDocument[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [moduleId, setModuleId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [startSeconds, setStartSeconds] = useState('');
  const [endSeconds, setEndSeconds] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingAsset, setViewingAsset] = useState<any | null>(null);

  useEffect(() => {
    if (!session || !workspace?.workspace_id) return;
    let cancelled = false;
    listLearningDocuments(client, session.accessToken, workspace.workspace_id)
      .then((docs) => { if (!cancelled) setDocuments(docs); })
      .catch((err) => { if (!cancelled) setDocsError(extractDocIntelError(err, 'Could not load workspace documents.')); });
    return () => { cancelled = true; };
  }, [session, workspace?.workspace_id]);

  const assets = workspace?.assets || [];
  const modules = workspace?.modules || [];
  const selectedModule = modules.find((m: any) => m.id === moduleId);
  const lessons = selectedModule?.lessons || [];
  const selectedDocument = (documents || []).find((d) => d.id === selectedDoc);
  const timed = isTimed(selectedDocument);
  const invalidRange = timed && ((startSeconds === '') !== (endSeconds === '') || (startSeconds !== '' && Number(endSeconds) <= Number(startSeconds)));

  if (viewingAsset) {
    return <DocumentViewerScreen doc={assetToDoc(viewingAsset, workspace)} onBack={() => setViewingAsset(null)} />;
  }

  const attach = async () => {
    if (!session || !selectedDoc || invalidRange) return;
    setBusy(true); setError(null);
    try {
      await addCourseAsset(client, session.accessToken, courseId, {
        document_id: selectedDoc,
        module_id: moduleId || null,
        lesson_id: lessonId || null,
        ...(timed && startSeconds !== '' ? { start_seconds: Number(startSeconds), end_seconds: Number(endSeconds) } : {}),
      } as any);
      setSelectedDoc(null); setModuleId(''); setLessonId(''); setStartSeconds(''); setEndSeconds('');
      onChanged();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not attach this content.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (assetId: string) => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      await removeCourseAsset(client, session.accessToken, courseId, assetId);
      onChanged();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not remove this content.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      {canManage && (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.sectionTitle}>Attach workspace content</Text>
          {documents === null && !docsError ? (
            <ActivityIndicator size="small" color={BRAND} />
          ) : docsError ? (
            <Text style={sharedStyles.errorTextSmall}>{docsError}</Text>
          ) : (documents || []).length === 0 ? (
            <Text style={sharedStyles.empty}>No processed documents in this workspace yet.</Text>
          ) : (
            <>
              <Text style={cs.label}>Content</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cs.docPicker}>
                {(documents || []).map((doc) => (
                  <TouchableOpacity
                    key={doc.id}
                    onPress={() => setSelectedDoc(doc.id)}
                    style={[cs.docChip, selectedDoc === doc.id && cs.docChipActive]}
                  >
                    <Text style={[cs.docChipText, selectedDoc === doc.id && cs.docChipTextActive]} numberOfLines={1}>
                      {doc.original_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={cs.label}>Module (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cs.docPicker}>
                <TouchableOpacity onPress={() => { setModuleId(''); setLessonId(''); }} style={[cs.docChip, !moduleId && cs.docChipActive]}>
                  <Text style={[cs.docChipText, !moduleId && cs.docChipTextActive]}>Entire course</Text>
                </TouchableOpacity>
                {modules.map((m: any, i: number) => (
                  <TouchableOpacity key={m.id} onPress={() => { setModuleId(m.id); setLessonId(''); }} style={[cs.docChip, moduleId === m.id && cs.docChipActive]}>
                    <Text style={[cs.docChipText, moduleId === m.id && cs.docChipTextActive]} numberOfLines={1}>{`M${i + 1}: ${m.title}`}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {moduleId && lessons.length > 0 ? (
                <>
                  <Text style={cs.label}>Lesson (optional)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cs.docPicker}>
                    <TouchableOpacity onPress={() => setLessonId('')} style={[cs.docChip, !lessonId && cs.docChipActive]}>
                      <Text style={[cs.docChipText, !lessonId && cs.docChipTextActive]}>All lessons</Text>
                    </TouchableOpacity>
                    {lessons.map((l: any, i: number) => (
                      <TouchableOpacity key={l.id} onPress={() => setLessonId(l.id)} style={[cs.docChip, lessonId === l.id && cs.docChipActive]}>
                        <Text style={[cs.docChipText, lessonId === l.id && cs.docChipTextActive]} numberOfLines={1}>{`L${i + 1}: ${l.title}`}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              ) : null}

              {lessonId || moduleId ? (
                <Text style={cs.selectedLabel} numberOfLines={3}>
                  {lessonId
                    ? `Lesson: ${lessons.find((l: any) => l.id === lessonId)?.title ?? ''}`
                    : `Module: ${selectedModule?.title ?? ''}`}
                </Text>
              ) : null}

              {timed ? (
                <View style={cs.timeRow}>
                  <TextInput style={[sharedStyles.input, { flex: 1 }]} placeholder="Start (sec)" keyboardType="numeric" value={startSeconds} onChangeText={setStartSeconds} />
                  <TextInput style={[sharedStyles.input, { flex: 1 }]} placeholder="End (sec)" keyboardType="numeric" value={endSeconds} onChangeText={setEndSeconds} />
                </View>
              ) : null}
              {timed ? <Text style={sharedStyles.cardMeta}>Leave both blank to attach the complete recording.</Text> : null}

              {error ? <Text style={sharedStyles.errorTextSmall}>{error}</Text> : null}
              <TouchableOpacity
                style={[sharedStyles.primaryButton, (!selectedDoc || invalidRange || busy) && { opacity: 0.5 }, { marginTop: 10 }]}
                onPress={attach}
                disabled={!selectedDoc || invalidRange || busy}
              >
                <Text style={sharedStyles.primaryButtonText}>Attach</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      <Text style={sharedStyles.sectionTitle}>Course content</Text>
      {assets.length === 0 ? (
        <Text style={sharedStyles.empty}>No content attached yet. Attached files become available to the AI Tutor and Study Tools.</Text>
      ) : (
        assets.map((asset: any) => (
          <TouchableOpacity
            key={asset.id}
            style={sharedStyles.card}
            onPress={() => setViewingAsset(asset)}
          >
            <View style={cs.assetHeader}>
              <Text style={cs.assetIcon}>{asset.file_type === 'video' ? '▶' : asset.file_type === 'audio' ? '\u{1F3B5}' : '▤'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={sharedStyles.cardTitle}>{asset.title || asset.original_name}</Text>
                <Text style={sharedStyles.cardMeta}>
                  {asset.doc_type || asset.file_type} · {asset.status} · {asset.chunk_count || 0} chunks
                  {asset.duration_seconds ? ` · ${fmtTime(asset.duration_seconds)}` : ''}
                </Text>
              </View>
              <Text style={cs.openHint}>View ›</Text>
              {canManage ? (
                <TouchableOpacity onPress={() => remove(asset.id)} disabled={busy} style={{ marginLeft: 10 }}>
                  <Text style={{ color: '#c0392b', fontSize: 12.5, fontWeight: '700' }}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={sharedStyles.cardMeta}>
              {scopeLabel(workspace, asset.module_id, asset.lesson_id)}
              {asset.start_seconds != null ? ` · ${fmtTime(asset.start_seconds)}-${fmtTime(asset.end_seconds)}` : ' · complete asset'}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const cs = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '700', color: '#7a8290', marginTop: 8, marginBottom: 4, textTransform: 'uppercase' },
  docPicker: { flexDirection: 'row', flexGrow: 0, flexShrink: 0, height: 36, marginBottom: 4 },
  docChip: { borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, backgroundColor: '#fff', maxWidth: 180 },
  docChipActive: { borderColor: BRAND, backgroundColor: 'rgba(46,125,79,0.08)' },
  docChipText: { fontSize: 12.5, color: '#5b6472' },
  docChipTextActive: { color: BRAND, fontWeight: '700' },
  timeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  assetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  assetIcon: { fontSize: 16, color: BRAND },
  openHint: { fontSize: 12, color: BRAND, fontWeight: '700' },
  selectedLabel: { fontSize: 13, color: '#14181f', fontWeight: '600', marginTop: 4, marginBottom: 6, lineHeight: 18 },
});
