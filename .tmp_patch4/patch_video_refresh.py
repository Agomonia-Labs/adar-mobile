import pathlib

p = pathlib.Path.home() / "mnt/project/adar-mobile/apps/docintel/src/VideoDetailScreen.tsx"
s = p.read_text()

# 1. Import RefreshControl alongside the other react-native imports.
old1 = """import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';"""
assert s.count(old1) == 1
new1 = """import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';"""
s = s.replace(old1, new1)

# 2. Add a `refreshing` state (separate from the initial-load `loading` state,
#    same convention as the pull-to-refresh pattern used elsewhere in the app
#    -- e.g. DocumentsScreen -- so the spinner only shows on first load, and
#    a manual refresh gets its own lightweight indicator instead).
old2 = """  const [processing, setProcessing] = useState(false);
  const [processMessage, setProcessMessage] = useState<string | null>(null);"""
assert s.count(old2) == 1
new2 = """  const [processing, setProcessing] = useState(false);
  const [processMessage, setProcessMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);"""
s = s.replace(old2, new2)

# 3. A manual-refresh wrapper around the existing `refresh()` -- used by both
#    the explicit "Refresh status" button (mirrors VideoPanel.jsx's button
#    next to the "Processing Status" heading, which was the actual thing
#    missing here) and RefreshControl's pull-to-refresh gesture (the copy
#    elsewhere on this screen already said "pull to refresh", but nothing
#    was ever wired to a RefreshControl to make that true).
old3 = """  useEffect(() => { refresh(); }, [refresh]);"""
assert s.count(old3) == 1
new3 = """  useEffect(() => { refresh(); }, [refresh]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);"""
s = s.replace(old3, new3)

# 4. Wire RefreshControl into the ScrollView.
old4 = """        <ScrollView style={styles.flex}>
          {ready && playbackUrl ? ("""
assert s.count(old4) == 1
new4 = """        <ScrollView
          style={styles.flex}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleManualRefresh} tintColor={BRAND} colors={[BRAND]} />
          }
        >
          {ready && playbackUrl ? ("""
s = s.replace(old4, new4)

# 5. The actual gap reported: an explicit "Refresh status" button next to
#    the "Processing status" heading, same as VideoPanel.jsx's secondaryBtn
#    next to its "Processing Status" title -- pull-to-refresh alone isn't a
#    discoverable equivalent to that visible button.
old5 = """            {/* Processing status: metrics, progress bar, checkpoints -- mirrors
                VideoPanel.jsx's "Processing Status" band. */}
            <Text style={styles.sectionTitle}>Processing status</Text>
            <View style={styles.metricsRow}>"""
assert s.count(old5) == 1
new5 = """            {/* Processing status: metrics, progress bar, checkpoints -- mirrors
                VideoPanel.jsx's "Processing Status" band, including its
                explicit "Refresh status" button (not just pull-to-refresh --
                that button was the piece actually missing here). */}
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Processing status</Text>
              <TouchableOpacity
                style={[styles.refreshBtn, refreshing && styles.refreshBtnDisabled]}
                onPress={handleManualRefresh}
                disabled={refreshing}
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color={BRAND} />
                ) : (
                  <Text style={styles.refreshBtnText}>Refresh status</Text>
                )}
              </TouchableOpacity>
            </View>
            <View style={styles.metricsRow}>"""
s = s.replace(old5, new5)

# 6. Styles for the new row/button.
old6 = """  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', marginBottom: 10 },"""
assert s.count(old6) == 1
new6 = """  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#14181f', marginBottom: 10 },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refreshBtn: { borderWidth: 1, borderColor: '#d7dbe2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  refreshBtnDisabled: { opacity: 0.6 },
  refreshBtnText: { fontSize: 12, fontWeight: '600', color: '#5b6472' },"""
s = s.replace(old6, new6)

p.write_text(s)
print("patched OK")
