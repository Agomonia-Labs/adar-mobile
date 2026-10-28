import React from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const PRIVACY_URL = 'https://labs.agomoniai.com/eats-privacy';
const BRAND = '#1b2430';

export interface ConsentScreenProps {
  onAccept: () => void;
}

/**
 * Required by Apple App Review Guideline 5.1.2(i): apps must clearly
 * disclose, and get explicit permission for, sending personal data to
 * third-party AI. ADAR Eats sends the questions you ask its Menu
 * Assistant, Dine-In Assistant, and Event Assistant, your spoken menu
 * walkthrough if you're a restaurant owner, your voice recordings, and
 * your order feedback to Google's Gemini models to answer, transcribe,
 * and understand them. Payment is handled entirely on Stripe's own page
 * -- ADAR never receives your card details.
 * Shown once (see useEatsConsent.ts), gated at the very top of App.tsx's
 * <Gate>, before sign-in/registration -- same pattern as
 * docintel/ConsentScreen.tsx, frontdesk/ConsentScreen.tsx and
 * geetabitan/AiConsentScreen.tsx.
 */
export function ConsentScreen({ onAccept }: ConsentScreenProps) {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Image source={require('../assets/icon.png')} style={styles.logoMark} />
        <Text style={styles.title}>Before you continue</Text>

        <Text style={styles.body}>ADAR Eats uses Google Cloud AI services to work:</Text>
        <Text style={styles.bullet}>
          {'•'} Questions you ask the Menu Assistant, the Dine-In Assistant, or an Event Assistant --
          about restaurants, dishes, prices, table availability, or event stalls, in any of the
          App&apos;s supported languages -- are sent to Google&apos;s <Text style={styles.bold}>Gemini</Text>{' '}
          AI models to understand your request and answer it, grounded in the actual restaurant, menu, or
          event data.
        </Text>
        <Text style={styles.bullet}>
          {'•'} If you use the microphone to ask a question, or tap "Listen" to hear a reply, your voice
          recording or the assistant&apos;s reply is sent to <Text style={styles.bold}>Google Cloud
          Speech-to-Text / Text-to-Speech</Text> to convert between speech and text.
        </Text>
        <Text style={styles.bullet}>
          {'•'} If you&apos;re a restaurant owner, a spoken walkthrough you record of your restaurant and
          menu is transcribed and read by <Text style={styles.bold}>Gemini</Text> to turn it into structured
          menu items for your review before anything is published.
        </Text>
        <Text style={styles.bullet}>
          {'•'} Feedback and ratings you leave on an order or dish are read by{' '}
          <Text style={styles.bold}>Gemini</Text> to summarize sentiment, which feeds into menu search,
          comparisons, and recommendations for other diners.
        </Text>
        <Text style={styles.bullet}>
          {'•'} ADAR Eats requires a signed-in account. Your <Text style={styles.bold}>name and email</Text>{' '}
          are used to create it, and your restaurants, menus, orders, cart, and conversation history are
          stored to provide the Service.
        </Text>
        <Text style={styles.bullet}>
          {'•'} Payment for an order is completed entirely on <Text style={styles.bold}>Stripe&apos;s</Text>{' '}
          own secure checkout page, opened from within the App -- ADAR Eats never receives or stores your
          card details.
        </Text>
        <Text style={styles.body}>
          Google and Stripe process this only to provide these features -- it is not used for advertising.
          Voice is optional; you can use ADAR Eats by typing only.
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
