import React from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const PRIVACY_URL = 'https://labs.agomoniai.com/docintel-privacy';
const BRAND = '#2e7d4f';

export interface ConsentScreenProps {
  onAccept: () => void;
}

/**
 * Required by Apple App Review Guideline 5.1.2(i): apps must clearly
 * disclose, and get explicit permission for, sending personal data to
 * third-party AI. ADAR DocIntel sends the documents/videos you upload and
 * the questions you ask about them to Google's Gemini models to answer,
 * summarize, and compare -- and, specific to this app, your voice
 * recordings for transcription and, in Knowledge Academy, your assignment
 * submissions for a first-pass AI evaluation. Shown once (see
 * useDocIntelConsent.ts), gated at the very top of App.tsx's <Gate>, before
 * sign-in/registration -- same pattern as frontdesk/ConsentScreen.tsx and
 * geetabitan/AiConsentScreen.tsx.
 */
export function ConsentScreen({ onAccept }: ConsentScreenProps) {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Image source={require('../assets/icon.png')} style={styles.logoMark} />
        <Text style={styles.title}>Before you continue</Text>

        <Text style={styles.body}>ADAR DocIntel uses Google Cloud AI services to work:</Text>
        <Text style={styles.bullet}>
          {'•'} Documents and videos you upload, and the questions you ask about them, are sent to
          Google&apos;s <Text style={styles.bold}>Gemini</Text> AI models to answer questions, generate
          summaries, and compare documents -- grounded in your own content.
        </Text>
        <Text style={styles.bullet}>
          {'•'} If you use the microphone, your voice recording is sent to <Text style={styles.bold}>Google&apos;s
          Gemini</Text> models to transcribe it into text.
        </Text>
        <Text style={styles.bullet}>
          {'•'} DocIntel requires a signed-in account. Your <Text style={styles.bold}>name and email</Text> are
          used to create it, and your uploaded files, chat history, and Knowledge Academy activity are stored
          to provide the Service. Content you place in a shared workspace or course is visible to that
          workspace&apos;s or course&apos;s other members.
        </Text>
        <Text style={styles.bullet}>
          {'•'} In Knowledge Academy, an assignment submission you turn in can receive an automated
          first-pass <Text style={styles.bold}>Gemini</Text> evaluation against the instructor&apos;s rubric,
          before an instructor reviews it.
        </Text>
        <Text style={styles.body}>
          Google processes this only to provide these features -- it is not used for advertising. Voice is
          optional; you can use ADAR DocIntel by typing only.
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
