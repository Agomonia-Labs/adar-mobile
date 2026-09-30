import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { extractDocIntelError, getInstructorDashboard } from './docintelApi';
import { styles } from './academyStyles';

const BRAND = '#2e7d4f';

/** Instructor dashboard: cohort rollup from
 *  GET /courses/{id}/instructor-dashboard (learning.py's
 *  _build_instructor_dashboard) -- summary stats, at-risk learners with
 *  reasons, difficult concepts (lessons scoring below the passing
 *  threshold), content gaps (lessons with no embedded evidence), open
 *  human questions, and per-assignment submission/approval counts. */
export function InstructorDashboardTab({ courseId }: { courseId: string }) {
  const { client, session } = useAuth();
  const [dash, setDash] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      setDash(await getInstructorDashboard(client, session.accessToken, courseId));
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not load the instructor dashboard.'));
    } finally {
      setLoading(false);
    }
  }, [client, session, courseId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <ActivityIndicator color={BRAND} style={{ marginTop: 30 }} />;
  if (error) return <Text style={styles.errorTextSmall}>{error}</Text>;
  if (!dash) return null;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.statsRow}>
        <MiniStat label="Students" value={String(dash.summary.student_count)} />
        <MiniStat label="Progress" value={`${dash.summary.cohort_progress_pct}%`} />
        <MiniStat label="Assessment" value={dash.summary.assessment_performance_pct != null ? `${dash.summary.assessment_performance_pct}%` : '—'} />
        <MiniStat label="At risk" value={String(dash.summary.at_risk_count)} danger={dash.summary.at_risk_count > 0} />
      </View>

      {dash.learners?.some((l: any) => l.at_risk) ? (
        <>
          <Text style={styles.sectionTitle}>At-risk learners</Text>
          {dash.learners.filter((l: any) => l.at_risk).map((l: any) => (
            <View key={l.user_id} style={styles.card}>
              <Text style={styles.cardTitle}>{l.full_name || l.email}</Text>
              <Text style={styles.cardMeta}>
                {l.progress_pct}% progress{l.assessment_pct != null ? ` · ${l.assessment_pct}% assessment` : ''} · {l.submitted_assignments}/{l.assignment_count} assignments
              </Text>
              {l.risk_reasons.map((r: string, i: number) => (
                <Text key={i} style={{ fontSize: 12, color: '#c0392b', marginTop: 3, textAlign: 'justify' }}>• {r}</Text>
              ))}
            </View>
          ))}
        </>
      ) : null}

      {dash.difficult_concepts?.length ? (
        <>
          <Text style={styles.sectionTitle}>Difficult concepts</Text>
          {dash.difficult_concepts.map((c: any) => (
            <View key={c.lesson_id} style={styles.card}>
              <Text style={styles.cardTitle}>{c.title}</Text>
              <Text style={styles.cardMeta}>{c.assessment_pct}% average · {c.attempt_count} attempt{c.attempt_count === 1 ? '' : 's'}</Text>
            </View>
          ))}
        </>
      ) : null}

      {dash.content_quality_gaps?.length ? (
        <>
          <Text style={styles.sectionTitle}>Content gaps</Text>
          {dash.content_quality_gaps.map((g: any) => (
            <Text key={g.lesson_id} style={styles.cardMeta}>• {g.title}: {g.gap}</Text>
          ))}
        </>
      ) : null}

      {dash.assignment_performance?.length ? (
        <>
          <Text style={styles.sectionTitle}>Assignments</Text>
          {dash.assignment_performance.map((a: any) => (
            <View key={a.assignment_id} style={styles.card}>
              <Text style={styles.cardTitle}>{a.title}</Text>
              <Text style={styles.cardMeta}>{a.submitted_count} submitted · {a.approved_count} approved</Text>
            </View>
          ))}
        </>
      ) : null}

      {dash.summary.open_question_count > 0 ? (
        <Text style={[styles.cardMeta, { marginTop: 8 }]}>{dash.summary.open_question_count} open student question(s) waiting for a reply.</Text>
      ) : null}
    </ScrollView>
  );
}

function MiniStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={{ width: '25%', alignItems: 'center', marginBottom: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: '800', color: danger ? '#c0392b' : BRAND }}>{value}</Text>
      <Text style={{ fontSize: 10, color: '#5b6472', marginTop: 2 }}>{label}</Text>
    </View>
  );
}
