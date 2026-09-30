import { StyleSheet } from 'react-native';

const BRAND = '#2e7d4f';

// Shared style sheet for the Academy course-detail shell (CourseDetailScreen)
// and its four sub-tabs (CurriculumScreen, AssignmentsScreen, MasteryScreen,
// InstructorDashboardScreen). This used to live inside CourseDetailScreen.tsx
// with the four tab files importing `styles` from it -- but CourseDetailScreen
// also imports each of those four files (to render them as tabs), so that was
// a require cycle in all four directions at once. Metro warns about these
// ("Require cycle: CourseDetailScreen.tsx -> InstructorDashboardScreen.tsx ->
// CourseDetailScreen.tsx") because a cycle risks one side seeing an
// export as still-undefined if its module happens to evaluate before the
// other one finishes -- moving the shared styles here, with nothing
// importing back into any of the five screens, removes the cycle (and the
// risk) entirely instead of just hoping the module evaluation order stays
// lucky.

export const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f7f8fa' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e2e5ea', backgroundColor: '#fff',
  },
  backButton: { marginRight: 10 },
  backButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  headerTitle: { fontSize: 14, fontWeight: '600', color: '#14181f', flex: 1 },
  errorText: { color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, margin: 16, fontSize: 13, textAlign: 'center' },
  errorTextSmall: { color: '#c0392b', fontSize: 12, marginTop: 6 },
  subTabBar: { flexDirection: 'row', flexGrow: 0, flexShrink: 0, height: 46, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e5ea' },
  subTabButton: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  subTabLabel: { fontSize: 12, fontWeight: '700', color: '#9aa3b2' },
  subTabLabelActive: { color: BRAND },
  overview: { padding: 16 },
  overviewDesc: { fontSize: 14, color: '#374151', lineHeight: 20, marginBottom: 16, textAlign: 'justify' },
  overviewMeta: { fontSize: 12, color: '#5b6472', marginTop: 4 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  stat: { width: '25%', alignItems: 'center', marginBottom: 12 },
  statValue: { fontSize: 20, fontWeight: '800', color: BRAND },
  statLabel: { fontSize: 11, color: '#5b6472', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 8, backgroundColor: '#fff' },
  primaryButton: { backgroundColor: BRAND, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondaryButton: { borderWidth: 1.5, borderColor: BRAND, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryButtonText: { color: BRAND, fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e5ea' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#14181f' },
  cardMeta: { fontSize: 12, color: '#5b6472', marginTop: 3, textAlign: 'justify' },
  empty: { color: '#5b6472', fontSize: 14, textAlign: 'center', marginTop: 30, lineHeight: 20, paddingHorizontal: 10 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: 'flex-start' },
  pillText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Module/lesson scope picker -- shared by the AI Tutor and Study Tools
  // tabs (and mirrors the Content tab's own document/module/lesson chip
  // pickers) so a learner or teacher can narrow either feature to a
  // single lesson, a whole module, or leave it at the entire course.
  scopeBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e5ea' },
  scopeLabel: { fontSize: 11, fontWeight: '700', color: '#7a8290', marginBottom: 4, textTransform: 'uppercase' },
  scopeRow: { flexDirection: 'row', flexGrow: 0, flexShrink: 0, height: 36, marginBottom: 6 },
  scopeChip: { borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, backgroundColor: '#fff', maxWidth: 180 },
  scopeChipActive: { borderColor: BRAND, backgroundColor: 'rgba(46,125,79,0.08)' },
  scopeChipText: { fontSize: 12.5, color: '#5b6472' },
  scopeChipTextActive: { color: BRAND, fontWeight: '700' },
  scopeSummary: { fontSize: 11.5, color: '#5b6472' },
  scopeSelectedLabel: { fontSize: 13, color: '#14181f', fontWeight: '600', marginBottom: 6, lineHeight: 18 },
});

