import React from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const PRIVACY_URL = 'https://labs.agomoniai.com/arcl-privacy';
const BRAND = '#0c4d34';

export interface ConsentScreenProps {
  onAccept: () => void;
}

/**
 * Required by Apple App Review Guideline 5.1.2(i): apps must clearly
 * disclose, and get explicit permission for, sending personal data to
 * third-party AI. ADAR ARCL sends the questions you ask the cricket
 * assistant to Google's Gemini models (via Vertex AI) to generate the
 * answers. Shown once (see useArclConsent.ts), gated at the very top of
 * App.tsx's <Gate>, before sign-in/registration -- same pattern as
 * docintel/ConsentScreen.tsx, frontdesk/ConsentScreen.tsx and
 * geetabitan/AiConsentScreen.tsx.
 */
export function ConsentScreen({ onAccept }: ConsentScreenProps) {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Image source={require('../assets/icon.png')} style={styles.logoMark} />
        <Text style={styles.title}>Before you continue</Text>

        <Text style={styles.body}>ADAR ARCL uses Google Cloud AI services to work:</Text>
        <Text style={styles.bullet}>
          {'•'} The questions you ask the assistant are sent to Google&apos;s{' '}
          <Text style={styles.bold}>Gemini</Text> AI models (via Google Cloud Vertex AI) to generate the
          assistant&apos;s answers -- rules, standings, teams, players, schedules, results, and scorecards for
          the ARCL cricket league.
        </Text>
        <Text style={styles.bullet}>
          {'•'} ADAR ARCL requires a signed-in account. Your <Text style={styles.bold}>name and email</Text>{' '}
          are used to create and secure it, and your conversation history is stored on our Google Cloud
          infrastructure (Firestore/Cloud SQL) to keep context across questions and let you continue a
          conversation later.
        </Text>
        <Text style={styles.body}>
          Google processes this only to generate the assistant&apos;s answers -- it is not used for
          advertising, and we do not sell your information. You can review or delete your account at any time
          from the Profile screen.
        </Text>

        <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
          <Text style={styles.link}>Read the full Privacy Policy</Text>
        </TouchableOpacity>
      </ScrollView>

      <TouchableOpacity style={styles.acceptButton} onPress={onAccept}>
        <Text style={styles.acceptText}>I Agree &amp; Continue</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { padding: 24, paddingBottom: 8 },
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 16, color: '#14181f' },
  body: { fontSize: 14, lineHeight: 21, color: '#3a4150', marginBottom: 10 },
  bullet: { fontSize: 14, lineHeight: 21, color: '#3a4150', marginBottom: 8, paddingLeft: 4 },
  bold: { fontWeight: '700', color: '#14181f' },
  link: {
    fontSize: 14,
    fontWeight: '600',
    color: BRAND,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
    textDecorationLine: 'underline',
  },
  acceptButton: {
    backgroundColor: BRAND,
    paddingVertical: 16,
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 24,
    borderRadius: 12,
  },
  acceptText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
