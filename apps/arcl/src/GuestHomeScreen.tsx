import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@adar/shared-auth';
import { GuestChatScreen } from '@adar/shared-chat';

// Same example questions adar-core/api/routes/arcl_guest.py serves from
// GET /api/arcl/guest/examples -- kept as a static list here so the
// empty-state chips render instantly without an extra round trip.
const ARCL_GUEST_QUESTIONS = [
  "What is the wide-ball rule in the men's ARCL league?",
  'Show the current Division H standings.',
  'Who are the top five batsmen in Division H?',
  "Show Agomoni Tigers' schedule.",
];

// Verbatim from adar-web/arcl.js's own welcome bubble -- same wording the
// live https://labs.agomoniai.com/arcl experience shows on load.
const ARCL_WELCOME_MESSAGE =
  'Welcome to the ADAR ARCL Cricket Assistant. Ask me about ARCL rules, teams, players, standings, schedules, results, or scorecards.';

/**
 * The no-login landing experience -- same guest flow that backs
 * https://labs.agomoniai.com/arcl, no email/password needed. This is
 * what a fresh install lands on by default; "Sign in" switches to the
 * real account flow for anyone who has one.
 */
export function GuestHomeScreen({ onSignIn }: { onSignIn: () => void }) {
  const { tenant } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { borderColor: tenant.brandColor }]}>
        <Text style={[styles.badge, { color: tenant.brandColor }]}>Guest experience</Text>
        <TouchableOpacity onPress={onSignIn}>
          <Text style={[styles.signIn, { color: tenant.brandColor }]}>Sign in</Text>
        </TouchableOpacity>
      </View>
      <GuestChatScreen
        domain="arcl"
        placeholder={ARCL_WELCOME_MESSAGE}
        suggestedQuestions={ARCL_GUEST_QUESTIONS}
        logo={require('../assets/icon.png')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  badge: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  signIn: { fontSize: 14, fontWeight: '700' },
});
