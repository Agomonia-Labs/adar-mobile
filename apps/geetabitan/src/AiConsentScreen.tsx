import React from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const PRIVACY_URL = 'https://labs.agomoniai.com/geetabitan-privacy';
const BRAND = '#7a1f33';

export interface AiConsentScreenProps {
  onAccept: () => void;
}

/**
 * Required by Apple App Review Guideline 5.1.2(i) (effective Nov 13,
 * 2025): apps must clearly disclose, and get explicit permission for,
 * sending personal data to third-party AI. ADAR Geetabitan sends typed
 * questions to Google's Gemini model, and -- only if the voice features
 * are used -- recordings to Google Cloud Speech-to-Text and replies to
 * Google Cloud Text-to-Speech. Shown once (see useAiConsent.ts), gated at
 * the very top of App.tsx's <Gate> so it covers every entry point --
 * guest chat, signed-in chat, and voice -- before any of that happens.
 */
export function AiConsentScreen({ onAccept }: AiConsentScreenProps) {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Image source={require('../assets/logo-mark.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Before you continue</Text>

        <Text style={styles.body}>ADAR Geetabitan uses Google Cloud AI services to work:</Text>
        <Text style={styles.bullet}>
          {'•'} Questions you type are sent to Google&apos;s <Text style={styles.bold}>Gemini</Text> AI
          model to generate answers.
        </Text>
        <Text style={styles.bullet}>
          {'•'} If you use the microphone, your voice recording is sent to{' '}
          <Text style={styles.bold}>Google Cloud Speech-to-Text</Text> to convert it to text.
        </Text>
        <Text style={styles.bullet}>
          {'•'} If you tap &quot;Listen&quot;, the reply text is sent to{' '}
          <Text style={styles.bold}>Google Cloud Text-to-Speech</Text> to read it aloud.
        </Text>
        <Text style={styles.body}>
          Google processes this only to provide these features -- it is not used for advertising. Voice
          questions are optional; you can use ADAR Geetabitan by typing only.
        </Text>

        <Text style={[styles.title, styles.banglaTitle]}>চালিয়ে যাওয়ার আগে</Text>
        <Text style={styles.bullet}>
          {'•'} আপনি যা লেখেন তা উত্তর তৈরির জন্য Google-এর Gemini AI মডেলে পাঠানো হয়।
        </Text>
        <Text style={styles.bullet}>
          {'•'} মাইক্রোফোন ব্যবহার করলে, আপনার ভয়েস রেকর্ডিং টেক্সটে রূপান্তরের জন্য Google Cloud
          Speech-to-Text-এ পাঠানো হয়।
        </Text>
        <Text style={styles.bullet}>
          {'•'} &quot;Listen&quot; চাপলে, উত্তরটি জোরে পড়ার জন্য Google Cloud Text-to-Speech-এ পাঠানো
          হয়।
        </Text>
        <Text style={styles.body}>ভয়েস প্রশ্ন ঐচ্ছিক -- আপনি চাইলে শুধু লিখেও ব্যবহার করতে পারেন।</Text>

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
  logo: { width: 56, height: 56, borderRadius: 12, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 16, color: '#14181f' },
  banglaTitle: { marginTop: 28 },
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
