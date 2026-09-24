import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { ChatScreen } from '@adar/shared-chat';

// Same wording/questions as the public guest experience (arcl.js /
// arcl_guest.py EXAMPLE_QUESTIONS) for consistency between guest mode
// and signed-in mode.
const ARCL_WELCOME_MESSAGE =
  'Welcome to the ADAR ARCL Cricket Assistant. Ask me about ARCL rules, teams, players, standings, schedules, results, or scorecards.';
const ARCL_SUGGESTED_QUESTIONS = [
  "What is the wide-ball rule in the men's ARCL league?",
  'Show the current Division H standings.',
  'Who are the top five batsmen in Division H?',
  "Show Agomoni Tigers' schedule.",
];

type Tab = 'home' | 'ask';

export function HomeScreen() {
  const { session, signOut, tenant } = useAuth();
  const [tab, setTab] = useState<Tab>('home');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#f7f8fa' }]}>
      <View style={[styles.tabBar, { borderColor: tenant.brandColor }]}>
        <TouchableOpacity
          style={[styles.tab, tab === 'home' && { backgroundColor: tenant.brandColor }]}
          onPress={() => setTab('home')}
        >
          <Text style={[styles.tabText, tab === 'home' && styles.tabTextActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'ask' && { backgroundColor: tenant.brandColor }]}
          onPress={() => setTab('ask')}
        >
          <Text style={[styles.tabText, tab === 'ask' && styles.tabTextActive]}>Ask ADAR</Text>
        </TouchableOpacity>
      </View>

      {tab === 'home' ? (
        <View style={styles.content}>
          <Text style={styles.title}>{tenant.displayName}</Text>
          <Text style={styles.subtitle}>Signed in as {session?.teamName}</Text>
          <Text style={styles.meta}>Role: {session?.role}</Text>
          <Text style={styles.placeholder}>
            Schedule, standings, roster, and scorecard screens are next — see ROADMAP.md.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: tenant.brandColor }]}
            onPress={() => signOut()}
          >
            <Text style={styles.buttonText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ChatScreen
          placeholder={ARCL_WELCOME_MESSAGE}
          suggestedQuestions={ARCL_SUGGESTED_QUESTIONS}
          logo={require('../assets/logo-mark.png')}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, backgroundColor: '#fff' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabText: { fontSize: 14, fontWeight: '600', color: '#5b6472' },
  tabTextActive: { color: '#fff' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#5b6472', marginBottom: 2 },
  meta: { fontSize: 13, color: '#5b6472', marginBottom: 16 },
  placeholder: {
    fontSize: 13,
    color: '#9aa2ad',
    marginBottom: 24,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  buttonText: { color: '#fff', fontWeight: '700' },
});
