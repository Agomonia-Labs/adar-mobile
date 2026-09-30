import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { extractDocIntelError, getCourseWorkspace } from './docintelApi';
import { styles } from './academyStyles';
import { CurriculumTab } from './CurriculumScreen';
import { AssignmentsTab } from './AssignmentsScreen';
import { MasteryTab } from './MasteryScreen';
import { InstructorDashboardTab } from './InstructorDashboardScreen';
import { CalendarTab } from './CalendarScreen';
import { ContentTab } from './CourseContentScreen';
import { TutorTab } from './TutorScreen';
import { StudyToolsTab } from './StudyToolsScreen';
import { QuestionsTab } from './QuestionsScreen';

const BRAND = '#2e7d4f';
type SubTab = 'overview' | 'calendar' | 'curriculum' | 'content' | 'tutor' | 'study' | 'assignments' | 'mastery' | 'dashboard' | 'questions';

/** Course detail: the rest of learning.py's real LMS that AcademyScreen's
 *  course list didn't yet surface -- curriculum authoring, assignments +
 *  submissions + review, mastery tracking, and the instructor dashboard.
 *  One `getCourseWorkspace` call (learning.py's _course_workspace
 *  aggregate) drives Overview/Curriculum/Assignments; Mastery and
 *  Dashboard hit their own endpoints since they're their own computed
 *  projections, not part of the aggregate. */
export function CourseDetailScreen({ courseId, onBack }: { courseId: string; onBack: () => void }) {
  const { client, session } = useAuth();
  const [workspace, setWorkspace] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SubTab>('overview');

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const data = await getCourseWorkspace(client, session.accessToken, courseId);
      setWorkspace(data);
    } catch (err) {
      setError(extractDocIntelError(err, 'Could not load this course.'));
    } finally {
      setLoading(false);
    }
  }, [client, session, courseId]);

  useEffect(() => { refresh(); }, [refresh]);

  const canManage = !!workspace?.can_manage;
  const tabs: { key: SubTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'curriculum', label: 'Curriculum' },
    { key: 'content', label: 'Content' },
    { key: 'tutor', label: 'AI Tutor' },
    { key: 'study', label: 'Study Tools' },
    { key: 'assignments', label: 'Assignments' },
    { key: 'mastery', label: 'Mastery' },
    ...(canManage ? [{ key: 'dashboard' as SubTab, label: 'Dashboard' }] : []),
    { key: 'questions', label: 'Questions' },
  ];

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Academy</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{workspace?.title || 'Course'}</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subTabBar}>
            {tabs.map((t) => (
              <TouchableOpacity key={t.key} style={styles.subTabButton} onPress={() => setTab(t.key)}>
                <Text style={[styles.subTabLabel, tab === t.key && styles.subTabLabelActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Every tab body renders inside this one bounded, clipped
           *  container -- without it, a tab whose own root isn't flex:1
           *  (or, on react-native-web, even one that is, since web's flex
           *  default min-height is content-based rather than 0) can grow
           *  to its natural content height instead of the space actually
           *  left under the header + tab bar, showing as a large empty
           *  gap before the tab's own content. minHeight: 0 forces every
           *  tab to actually shrink to (and scroll within) that space. */}
          <View style={{ flex: 1, minHeight: 0 }}>
            {tab === 'overview' ? <OverviewTab workspace={workspace} /> : null}
            {tab === 'calendar' ? (
              <CalendarTab courseId={courseId} workspace={workspace} onChanged={refresh} />
            ) : null}
            {tab === 'curriculum' ? (
              <CurriculumTab courseId={courseId} workspace={workspace} canManage={canManage} onSaved={refresh} />
            ) : null}
            {tab === 'content' ? (
              <ContentTab courseId={courseId} workspace={workspace} canManage={canManage} onChanged={refresh} />
            ) : null}
            {tab === 'tutor' ? <TutorTab courseId={courseId} workspace={workspace} /> : null}
            {tab === 'study' ? (
              <StudyToolsTab courseId={courseId} workspace={workspace} onChanged={refresh} />
            ) : null}
            {tab === 'assignments' ? (
              <AssignmentsTab courseId={courseId} workspace={workspace} canManage={canManage} onChanged={refresh} />
            ) : null}
            {tab === 'mastery' ? (
              <MasteryTab courseId={courseId} workspace={workspace} canManage={canManage} />
            ) : null}
            {tab === 'dashboard' && canManage ? <InstructorDashboardTab courseId={courseId} /> : null}
            {tab === 'questions' ? (
              <QuestionsTab courseId={courseId} workspace={workspace} canManage={canManage} onChanged={refresh} />
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

function OverviewTab({ workspace }: { workspace: any }) {
  if (!workspace) return null;
  const moduleCount = workspace.modules?.length || 0;
  const lessonCount = (workspace.modules || []).reduce((n: number, m: any) => n + (m.lessons?.length || 0), 0);
  return (
    <View style={styles.overview}>
      {workspace.description ? <Text style={styles.overviewDesc}>{workspace.description}</Text> : null}
      <View style={styles.statsRow}>
        <Stat label="Members" value={workspace.members?.length || 0} />
        <Stat label="Modules" value={moduleCount} />
        <Stat label="Lessons" value={lessonCount} />
        <Stat label="Assignments" value={workspace.assignments?.length || 0} />
      </View>
      <Text style={styles.overviewMeta}>
        {workspace.course_code}{workspace.semester ? ` · ${workspace.semester}` : ''} · {workspace.domain}
      </Text>
      <Text style={styles.overviewMeta}>Your role: {workspace.my_persona}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
