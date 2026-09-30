import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { DocIntelDocument, SummaryType, streamCompare, streamSummarize } from './docintelApi';
import { MarkdownMessage } from './MarkdownMessage';
import { AnswerFeedback } from './AnswerFeedback';

const BRAND = '#2e7d4f';
const SUMMARY_TYPES: { key: SummaryType; label: string }[] = [
  { key: 'executive', label: 'Executive' },
  { key: 'detailed', label: 'Detailed' },
  { key: 'bullets', label: 'Bullet points' },
  { key: 'sections', label: 'By section' },
];

/** Summarize + Compare -- both are single-shot SSE streams over documents
 *  already picked on DocumentsScreen (embedded == ready), reusing the same
 *  streamSse() plumbing as ChatScreen. */
export function ToolsScreen({ documents }: { documents: DocIntelDocument[] }) {
  const { client, session } = useAuth();
  const [mode, setMode] = useState<'summarize' | 'compare'>('summarize');
  const embedded = documents.filter((d) => d.status === 'embedded');

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Tools</Text>
      <View style={styles.modeRow}>
        <TouchableOpacity style={[styles.modeButton, mode === 'summarize' && styles.modeButtonActive]} onPress={() => setMode('summarize')}>
          <Text style={[styles.modeButtonText, mode === 'summarize' && styles.modeButtonTextActive]}>Summarize</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeButton, mode === 'compare' && styles.modeButtonActive]} onPress={() => setMode('compare')}>
          <Text style={[styles.modeButtonText, mode === 'compare' && styles.modeButtonTextActive]}>Compare</Text>
        </TouchableOpacity>
      </View>
      {embedded.length === 0 ? (
        <Text style={styles.empty}>Upload and wait for at least one document to finish processing on the Documents tab first.</Text>
      ) : mode === 'summarize' ? (
        <SummarizePanel client={client} accessToken={session!.accessToken} baseURL={client.defaults.baseURL!} documents={embedded} />
      ) : (
        <ComparePanel client={client} accessToken={session!.accessToken} baseURL={client.defaults.baseURL!} documents={embedded} />
      )}
    </View>
  );
}

function SummarizePanel({ client, accessToken, baseURL, documents }: any) {
  const [docId, setDocId] = useState<string | null>(documents[0]?.id ?? null);
  const [type, setType] = useState<SummaryType>('executive');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);

  const onRun = () => {
    if (!docId) return;
    setOutput('');
    setError(null);
    setBusy(true);
    setMessageId(`summarize-${docId}-${Date.now()}`);
    streamSummarize(baseURL, accessToken, docId, type, {
      onToken: (t) => setOutput((prev) => prev + t),
      onDone: () => setBusy(false),
      onError: (msg) => { setError(msg); setBusy(false); },
    });
  };

  const docName = documents.find((d: any) => d.id === docId)?.original_name ?? 'this document';

  return (
    <ScrollView style={{ flex: 1 }}>
      <Text style={styles.label}>Document</Text>
      <DocPicker documents={documents} selected={docId ? [docId] : []} onToggle={(id) => setDocId(id)} single />
      <Text style={styles.label}>Style</Text>
      <View style={styles.chipRow}>
        {SUMMARY_TYPES.map((s) => (
          <TouchableOpacity key={s.key} style={[styles.chip, type === s.key && styles.chipActive]} onPress={() => setType(s.key)}>
            <Text style={[styles.chipText, type === s.key && styles.chipTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={[styles.runButton, { opacity: docId && !busy ? 1 : 0.5 }]} disabled={!docId || busy} onPress={onRun}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.runButtonText}>Summarize</Text>}
      </TouchableOpacity>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {output ? (
        <View style={styles.outputBox}>
          <MarkdownMessage>{output}</MarkdownMessage>
          {!busy && messageId ? (
            <AnswerFeedback
              client={client}
              accessToken={accessToken}
              messageId={messageId}
              question={`Summarize "${docName}" (${type} style)`}
              answer={output}
            />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function ComparePanel({ client, accessToken, baseURL, documents }: any) {
  const [selected, setSelected] = useState<string[]>([]);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);

  const onToggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const onRun = () => {
    if (selected.length !== 2) return;
    setOutput('');
    setError(null);
    setBusy(true);
    setMessageId(`compare-${selected[0]}-${selected[1]}-${Date.now()}`);
    streamCompare(baseURL, accessToken, selected[0], selected[1], {
      onToken: (t) => setOutput((prev) => prev + t),
      onDone: () => setBusy(false),
      onError: (msg) => { setError(msg); setBusy(false); },
    });
  };

  const compareLabel = selected.length === 2
    ? `Compare "${documents.find((d: any) => d.id === selected[0])?.original_name ?? 'document A'}" vs "${documents.find((d: any) => d.id === selected[1])?.original_name ?? 'document B'}"`
    : 'Compare these documents';

  return (
    <ScrollView style={{ flex: 1 }}>
      <Text style={styles.label}>Pick exactly two documents</Text>
      <DocPicker documents={documents} selected={selected} onToggle={onToggle} />
      <TouchableOpacity style={[styles.runButton, { opacity: selected.length === 2 && !busy ? 1 : 0.5 }]} disabled={selected.length !== 2 || busy} onPress={onRun}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.runButtonText}>Compare</Text>}
      </TouchableOpacity>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {output ? (
        <View style={styles.outputBox}>
          <MarkdownMessage>{output}</MarkdownMessage>
          {!busy && messageId ? (
            <AnswerFeedback
              client={client}
              accessToken={accessToken}
              messageId={messageId}
              question={compareLabel}
              answer={output}
            />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function DocPicker({ documents, selected, onToggle, single }: { documents: DocIntelDocument[]; selected: string[]; onToggle: (id: string) => void; single?: boolean }) {
  return (
    <View style={{ marginBottom: 14 }}>
      {documents.map((d) => {
        const isSelected = selected.includes(d.id);
        return (
          <TouchableOpacity
            key={d.id}
            style={[styles.docPickRow, isSelected && styles.docPickRowActive]}
            onPress={() => onToggle(d.id)}
          >
            <Text style={styles.docPickText} numberOfLines={1}>{d.original_name}</Text>
            {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fa', padding: 16 },
  header: { fontSize: 22, fontWeight: '700', color: '#14181f', marginBottom: 12 },
  modeRow: { flexDirection: 'row', marginBottom: 16, backgroundColor: '#e2e5ea', borderRadius: 10, padding: 3 },
  modeButton: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 },
  modeButtonActive: { backgroundColor: '#fff' },
  modeButtonText: { fontSize: 13, fontWeight: '600', color: '#5b6472' },
  modeButtonTextActive: { color: BRAND },
  empty: { color: '#5b6472', fontSize: 14, textAlign: 'center', marginTop: 40, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '700', color: '#5b6472', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { fontSize: 13, fontWeight: '600', color: '#5b6472' },
  chipTextActive: { color: '#fff' },
  docPickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 10, padding: 12, marginBottom: 8,
  },
  docPickRowActive: { borderColor: BRAND, backgroundColor: '#eaf5ee' },
  docPickText: { flex: 1, fontSize: 14, color: '#14181f' },
  checkmark: { color: BRAND, fontWeight: '700', fontSize: 16 },
  runButton: { backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginVertical: 12 },
  runButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  outputBox: { marginTop: 8, marginBottom: 30 },
  errorText: {
    color: '#c0392b', backgroundColor: '#fdecea', padding: 10, borderRadius: 10, marginBottom: 12,
    fontSize: 13, textAlign: 'center',
  },
});
