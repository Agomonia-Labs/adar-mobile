import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import {
  CourseCalendarItem,
  createCourseCalendarItem,
  deleteCourseCalendarItem,
  extractDocIntelError,
  updateCourseCalendarItem,
} from './docintelApi';
import { styles as sharedStyles } from './academyStyles';

const BRAND = '#2e7d4f';

function emptyDraft() {
  return { item_type: 'announcement' as 'announcement' | 'deadline', title: '', description: '', starts_at: '', all_day: false };
}

function fmt(dateStr: string | null | undefined) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

/** Calendar tab: announcements + deadlines for the course, mirrors the
 *  web app's CourseCalendar (LearningPanel.jsx) -- published assignment
 *  due dates are merged in server-side (source: 'assignment', not
 *  editable), course_calendar items (source: 'course_calendar') can be
 *  added/edited/removed by teachers, advisors, and admins
 *  (can_manage_calendar). */
export function CalendarTab({ courseId, workspace, onChanged }: {
  courseId: string; workspace: any; onChanged: () => void;
}) {
  const { client, session } = useAuth();
  const [draft, setDraft] = useState(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items: CourseCalendarItem[] = workspace?.calendar_items || [];
  const canManage = !!workspace?.can_manage_calendar;

  const startEdit = (item: any) => {
    setEditingId(item.id);
    setDraft({
      item_type: item.item_type,
      title: item.title || '',
      description: item.description || '',
      starts_at: item.starts_at ? item.starts_at.slice(0, 16) : '',
      all_day: !!item.all_day,
    });
  };

  const cancelEdit = () => { setEditingId(null); setDraft(emptyDraft()); };

  const save = async () => {
    if (!session || !draft.title.trim() || !draft.starts_at) return;
    setBusy(true); setError(null);
    try {
      const isoStart = new Date(draft.starts_at).toISOString();
      const body = { item_type: draft.item_type, title: draft.title.trim(), description: draft.description.trim(), starts_at: isoStart, all_day: draft.all_day };
      if (editingId) {
        await updateCourseCalendarItem(client, session.accessToken, courseId, editingId, body);
      } else {
        await createCourseCalendarItem(client, session.accessToken, courseId, body);
      }
      cancelEdit();
      onChanged();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not save this calendar item.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      await deleteCourseCalendarItem(client, session.accessToken, courseId, id);
      onChanged();
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not delete this calendar item.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      {canManage && (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.sectionTitle}>{editingId ? 'Edit calendar item' : 'Add announcement or deadline'}</Text>
          <View style={cal.typeRow}>
            {(['announcement', 'deadline'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setDraft({ ...draft, item_type: t })}
                style={[cal.typeChip, draft.item_type === t && cal.typeChipActive]}
              >
                <Text style={[cal.typeChipText, draft.item_type === t && cal.typeChipTextActive]}>
                  {t === 'announcement' ? 'Announcement' : 'Deadline'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={sharedStyles.input}
            placeholder="Title"
            value={draft.title}
            onChangeText={(v) => setDraft({ ...draft, title: v })}
          />
          <TextInput
            style={[sharedStyles.input, { minHeight: 70, textAlignVertical: 'top' }]}
            placeholder="Details (optional)"
            value={draft.description}
            onChangeText={(v) => setDraft({ ...draft, description: v })}
            multiline
          />
          <TextInput
            style={sharedStyles.input}
            placeholder="Date & time, e.g. 2026-10-15 14:00"
            value={draft.starts_at}
            onChangeText={(v) => setDraft({ ...draft, starts_at: v })}
          />
          <TouchableOpacity style={cal.allDayRow} onPress={() => setDraft({ ...draft, all_day: !draft.all_day })}>
            <View style={[cal.checkbox, draft.all_day && cal.checkboxChecked]}>
              {draft.all_day ? <Text style={cal.checkboxMark}>{'✓'}</Text> : null}
            </View>
            <Text style={cal.allDayLabel}>All-day item</Text>
          </TouchableOpacity>
          {error ? <Text style={sharedStyles.errorTextSmall}>{error}</Text> : null}
          <View style={cal.formActions}>
            {editingId ? (
              <TouchableOpacity style={sharedStyles.secondaryButton} onPress={cancelEdit} disabled={busy}>
                <Text style={sharedStyles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[sharedStyles.primaryButton, (!draft.title.trim() || !draft.starts_at || busy) && { opacity: 0.5 }]}
              onPress={save}
              disabled={!draft.title.trim() || !draft.starts_at || busy}
            >
              <Text style={sharedStyles.primaryButtonText}>{editingId ? 'Save changes' : 'Add to calendar'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={sharedStyles.sectionTitle}>Course calendar</Text>
      {items.length === 0 ? (
        <Text style={sharedStyles.empty}>No announcements or deadlines yet.</Text>
      ) : (
        items.map((item: any) => (
          <View key={item.id} style={[cal.item, item.item_type === 'deadline' ? cal.itemDeadline : cal.itemAnnouncement]}>
            <View style={cal.itemHeader}>
              <Text style={cal.itemIcon}>{item.item_type === 'deadline' ? '\u{1F4C5}' : '\u{1F514}'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={sharedStyles.cardTitle}>{item.title}</Text>
                <Text style={sharedStyles.cardMeta}>
                  {item.item_type === 'deadline' ? 'Deadline' : 'Announcement'} · {fmt(item.starts_at)}{item.all_day ? ' · All day' : ''}
                </Text>
              </View>
              <Text style={cal.source}>{item.source === 'assignment' ? 'Assignment' : 'Course'}</Text>
            </View>
            {item.description ? <Text style={cal.itemDesc}>{item.description}</Text> : null}
            {item.created_by_name ? <Text style={sharedStyles.cardMeta}>Set by {item.created_by_name}</Text> : null}
            {canManage && item.editable ? (
              <View style={cal.itemActions}>
                <TouchableOpacity onPress={() => startEdit(item)} disabled={busy}>
                  <Text style={cal.actionLink}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => remove(item.id)} disabled={busy}>
                  <Text style={[cal.actionLink, { color: '#c0392b' }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const cal = StyleSheet.create({
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeChip: { flex: 1, borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 8, paddingVertical: 8, alignItems: 'center', backgroundColor: '#fff' },
  typeChipActive: { borderColor: BRAND, backgroundColor: 'rgba(46,125,79,0.08)' },
  typeChipText: { fontSize: 13, color: '#5b6472', fontWeight: '600' },
  typeChipTextActive: { color: BRAND },
  allDayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: '#c7ccd4', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: BRAND, borderColor: BRAND },
  checkboxMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  allDayLabel: { fontSize: 13, color: '#3c4552' },
  formActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
  item: { borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: '#fff', borderLeftWidth: 3 },
  itemAnnouncement: { borderLeftColor: '#60a5fa' },
  itemDeadline: { borderLeftColor: '#f59e0b' },
  itemHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemIcon: { fontSize: 16 },
  itemDesc: { fontSize: 13, color: '#3c4552', marginTop: 6, lineHeight: 18, textAlign: 'justify' },
  source: { fontSize: 9.5, fontWeight: '700', color: '#9aa1ab', textTransform: 'uppercase' },
  itemActions: { flexDirection: 'row', gap: 16, marginTop: 8 },
  actionLink: { fontSize: 12.5, fontWeight: '700', color: BRAND },
});
