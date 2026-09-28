import React from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLanguage } from './LanguageContext';

const PRIVACY_URL = 'https://labs.agomoniai.com/frontdesk-privacy';
const BRAND = '#1c7293';

export interface ConsentScreenProps {
  onAccept: () => void;
}

// Secondary-language consent blocks, shown below the always-present English
// text when the customer's selected app language has full translation (see
// i18n.ts -- Arabic is voice-only today, so it isn't included here).
const TRANSLATIONS: Partial<Record<string, { title: string; lines: string[]; voiceNote: string }>> = {
  'es-US': {
    title: 'Antes de continuar',
    lines: [
      'Las preguntas que escribes o dices se envían al modelo de IA Gemini de Google para generar respuestas.',
      'Si usas el micrófono, tu grabación de voz se envía a Google Cloud Speech-to-Text para convertirla en texto, y las respuestas leídas en voz alta se generan con Google Cloud Text-to-Speech.',
      'Cuando reservas una cita, tu nombre, teléfono/correo y los datos de la cita se guardan para mostrar la reserva -- esta es una vista previa del producto, así que las citas son solo de demostración.',
    ],
    voiceNote: 'La voz es opcional -- puedes usar la aplicación solo escribiendo.',
  },
  'bn-BD': {
    title: 'চালিয়ে যাওয়ার আগে',
    lines: [
      'আপনি যা টাইপ করেন বা বলেন তা উত্তর তৈরির জন্য Google-এর Gemini AI মডেলে পাঠানো হয়।',
      'মাইক্রোফোন ব্যবহার করলে, আপনার ভয়েস রেকর্ডিং টেক্সটে রূপান্তরের জন্য Google Cloud Speech-to-Text-এ পাঠানো হয়, এবং জোরে পড়া উত্তরগুলো Google Cloud Text-to-Speech দিয়ে তৈরি হয়।',
      'আপনি যখন একটি অ্যাপয়েন্টমেন্ট বুক করেন, তখন আপনার নাম, ফোন/ইমেইল এবং অ্যাপয়েন্টমেন্টের বিবরণ বুকিং দেখানোর জন্য সংরক্ষণ করা হয় -- এটি একটি প্রোডাক্ট প্রিভিউ, তাই অ্যাপয়েন্টমেন্টগুলো শুধু ডেমো বুকিং।',
    ],
    voiceNote: 'ভয়েস ঐচ্ছিক -- আপনি চাইলে শুধু লিখেও অ্যাপটি ব্যবহার করতে পারেন।',
  },
  'hi-IN': {
    title: 'जारी रखने से पहले',
    lines: [
      'आप जो टाइप करते हैं या बोलते हैं वह जवाब बनाने के लिए Google के Gemini AI मॉडल को भेजा जाता है।',
      'माइक्रोफ़ोन इस्तेमाल करने पर, आपकी आवाज़ की रिकॉर्डिंग टेक्स्ट में बदलने के लिए Google Cloud Speech-to-Text को भेजी जाती है, और ज़ोर से पढ़े गए जवाब Google Cloud Text-to-Speech से बनाए जाते हैं।',
      'जब आप कोई अपॉइंटमेंट बुक करते हैं, तो आपका नाम, फ़ोन/ईमेल और अपॉइंटमेंट का विवरण बुकिंग दिखाने के लिए सुरक्षित किया जाता है -- यह एक प्रोडक्ट प्रीव्यू है, इसलिए अपॉइंटमेंट्स केवल डेमो बुकिंग हैं।',
    ],
    voiceNote: 'आवाज़ वैकल्पिक है -- आप चाहें तो सिर्फ़ टाइप करके भी ऐप इस्तेमाल कर सकते हैं।',
  },
};

/**
 * Required by Apple App Review Guideline 5.1.2(i): apps must clearly
 * disclose, and get explicit permission for, sending personal data to
 * third-party AI. ADAR Front Desk sends typed/spoken questions to Google's
 * Gemini model, voice recordings to Google Cloud Speech-to-Text, replies to
 * Google Cloud Text-to-Speech, and -- specific to a booking app -- the
 * customer's name/phone/email and appointment details when they book.
 * Shown once (see useFrontdeskConsent.ts), gated at the very top of
 * App.tsx's <Gate> so it covers every entry point -- guided booking, guest
 * chat, and voice -- before any of that happens.
 */
export function ConsentScreen({ onAccept }: ConsentScreenProps) {
  const { lang } = useLanguage();
  const translation = TRANSLATIONS[lang];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Image source={require('../assets/icon.png')} style={styles.logoMark} />
        <Text style={styles.title}>Before you continue</Text>

        <Text style={styles.body}>ADAR Front Desk uses Google Cloud AI services to work:</Text>
        <Text style={styles.bullet}>
          {'•'} Questions you type or say are sent to Google&apos;s <Text style={styles.bold}>Gemini</Text> AI
          model to generate answers.
        </Text>
        <Text style={styles.bullet}>
          {'•'} If you use the microphone, your voice recording is sent to{' '}
          <Text style={styles.bold}>Google Cloud Speech-to-Text</Text>, and spoken replies are generated with{' '}
          <Text style={styles.bold}>Google Cloud Text-to-Speech</Text>.
        </Text>
        <Text style={styles.bullet}>
          {'•'} Booking requires a signed-in account. Your <Text style={styles.bold}>name, phone, email, and
          appointment details</Text> are saved to show the booking, and a confirmation email is sent to you, the
          provider, and the practice. This app is a live product preview across a set of sample practices, so
          appointments aren&apos;t sent to a real business.
        </Text>
        <Text style={styles.body}>
          Google processes this only to provide these features -- it is not used for advertising. Voice is
          optional; you can use ADAR Front Desk by typing only.
        </Text>

        {translation ? (
          <>
            <Text style={[styles.title, styles.secondTitle]}>{translation.title}</Text>
            {translation.lines.map((line, i) => (
              <Text key={i} style={styles.bullet}>
                {'•'} {line}
              </Text>
            ))}
            <Text style={styles.body}>{translation.voiceNote}</Text>
          </>
        ) : null}

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
  secondTitle: { marginTop: 28 },
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
