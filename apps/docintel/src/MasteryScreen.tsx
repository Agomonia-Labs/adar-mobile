import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { extractDocIntelError, getCourseMastery } from './docintelApi';
import { styles } from './academyStyles';

const BRAND = '#2e7d4f';
const MASTERY_COLORS: Record<string, string> = { mastered: '#1e7e34', developing: '#a06a00', not_assessed: '#9aa3b2' };

/** Mastery tab: learner's own competency/mastery projection
 *  (GET /courses/{id}/mastery, learning.py's _build_mastery_projection) --
 *  per-lesson assessment scores, mastered/developing/not-assessed status,
 *  and up to 5 prioritized recommendations. A manager can switch learners
 *  via the picker built from workspace.members' students. */
export function MasteryTab({ courseId, workspace, canManage }: { courseId: string; workspace: any; canManage: boolean }) {
  const { client, session } = useAuth();
  const [learnerId, setLearnerId] = useState<string | undefined>(undefined);
  const [mastery, setMastery] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      setMastery(await getCourseMastery(client, session.accessToken, courseId, learnerId));
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not load mastery data.'));
    } finally {
      setLoading(false);
    }
  }, [client, session, courseId, learnerId]);

  useEffect(() => { refresh(); }, [refresh]);

  const students = (workspace?.members || []).filter((m: any) => m.persona === 'student');

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      {canManage && students.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 40, marginBottom: 12 }}>
          <TouchableOpacity
            onPress={() => setLearnerId(undefined)}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: !learnerId ? BRAND : '#d7dbe0', marginRight: 8 }}
          >
            <Text style={{ color: !learnerId ? BRAND : '#5b6472', fontWeight: '700', fontSize: 12 }}>Me</Text>
          </TouchableOpacity>
          {students.map((m: any) => (
            <TouchableOpacity
              key={m.user_id}
              onPress={() => setLearnerId(m.user_id)}
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: learnerId === m.user_id ? BRAND : '#d7dbe0', marginRight: 8 }}
            >
              <Text style={{ color: learnerId === m.user_id ? BRAND : '#5b6472', fontWeight: '700', fontSize: 12 }}>{m.full_name || m.email}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}

      {loading ? (
        <ActivityIndicator color={BRAND} style={{ marginTop: 20 }} />
      ) : error ? (
        <Text style={styles.errorTextSmall}>{error}</Text>
      ) : !mastery ? null : (
        <>
          <View style={styles.statsRow}>
            <MiniStat label="Progress" value={`${mastery.summary.progress_pct}%`} />
            <MiniStat label="Completed" value={`${mastery.summary.completed_lessons}/${mastery.summary.lesson_count}`} />
            <MiniStat label="Mastery" value={mastery.summary.mastery_pct != null ? `${mastery.summary.mastery_pct}%` : '—'} />
            <MiniStat label="Mastered" value={String(mastery.summary.mastered_lessons)} />
          </View>

          {mastery.recommendations?.length ? (
            <>
              <Text style={styles.sectionTitle}>Recommended next</Text>
              {mastery.recommendations.map((r: any, i: number) => (
                <View key={i} style={styles.card}>
                  <Text style={styles.cardTitle}>{r.title}</Text>
                  <Text style={styles.cardMeta}>{r.reason}</Text>
                  <Text style={{ fontSize: 13, color: '#374151', marginTop: 4, textAlign: 'justify' }}>{r.action}</Text>
                </View>
              ))}
            </>
          ) : null}

          <Text style={styles.sectionTitle}>By module</Text>
          {mastery.modules.map((m: any) => (
            <View key={m.id} style={styles.card}>
              <Text style={styles.cardTitle}>{m.title}</Text>
              <Text style={styles.cardMeta}>
                {m.completed_lessons}/{m.lesson_count} lessons · {m.progress_pct}% progress{m.mastery_pct != null ? ` · ${m.mastery_pct}% mastery` : ''}
              </Text>
              {m.lessons.map((l: any) => (
                <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingLeft: 6 }}>
                  <Text style={{ fontSize: 13, color: '#14181f', flex: 1 }} numberOfLines={1}>{l.title}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: MASTERY_COLORS[l.mastery_status] || '#5b6472' }}>
                    {l.assessment_score != null ? `${l.assessment_score}%` : l.status}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '25%', alignItems: 'center', marginBottom: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: '800', color: BRAND }}>{value}</Text>
      <Text style={{ fontSize: 10, color: '#5b6472', marginTop: 2 }}>{label}</Text>
    </View>
  );
}
