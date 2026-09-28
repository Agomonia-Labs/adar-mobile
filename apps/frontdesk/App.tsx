import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, AuthTenantConfig, useAuth } from '@adar/shared-auth';
import { LanguageProvider } from './src/LanguageContext';
import { ConsentScreen } from './src/ConsentScreen';
import { useFrontdeskConsent } from './src/useFrontdeskConsent';
import { FrontdeskHomeScreen } from './src/FrontdeskHomeScreen';
import { AccountGate } from './src/AccountGate';

// "Front Desk" is the scheduling deployment -- DOMAIN=scheduling.
// See adar-core/ui/.env.scheduling for the source of truth.
const tenant: AuthTenantConfig = {
  apiUrl: 'https://api.scheduling.adar.agomoniai.com',
  apiKey: process.env.EXPO_PUBLIC_FRONTDESK_API_KEY || '',
  domain: 'scheduling',
  displayName: 'ADAR Front Desk',
  logoText: 'FD',
  // Real logo (same file as the header/consent screen/app icon) -- shown
  // on the sign-in and OTP screens instead of the "FD" text badge.
  logoImage: require('./assets/icon.png'),
  brandColor: '#1c7293',
};

// Provider- and practice-specific tooling (managing a real deployed
// practice) is explicitly web-only -- see FrontdeskHomeScreen.tsx and
// adar-core/api/routes/scheduling_admin.py. This app is the end-to-end
// CUSTOMER experience (book, chat/voice, manage appointments), and a real
// signed-in account is required for all of it: after the consent screen,
// the customer must sign in (same email+password+OTP login already used at
// scheduling.adar.agomoniai.com) before the Book / Ask ADAR / My
// Appointments tabs ever appear.
// Dev-only: the consent flag lives in the iOS Keychain (see
// useFrontdeskConsent.ts), which outlives an app delete/reinstall on the
// same device -- so once you've tapped "I Agree & Continue" once on your
// phone, every later rebuild skips straight past the consent screen (to
// sign-in, or straight into the app if you're also still signed in). That's
// correct behavior for a real customer; for repeat testing, tap this to
// clear it and see the consent screen again on the next reload. Never
// rendered in a release build.
function DevResetConsentButton({ onReset }: { onReset: () => void }) {
  if (!__DEV__) return null;
  return (
    <TouchableOpacity style={devStyles.resetButton} onPress={onReset}>
      <Text style={devStyles.resetText}>Reset Consent</Text>
    </TouchableOpacity>
  );
}

function Gate() {
  const { state: consentState, grant: grantConsent, reset: resetConsent } = useFrontdeskConsent();
  const { session, loading } = useAuth();

  let screen: React.ReactNode;
  if (consentState === 'loading') {
    screen = null;
  } else if (consentState === 'needed') {
    screen = <ConsentScreen onAccept={grantConsent} />;
  } else if (loading) {
    screen = null; // TODO: replace with a splash screen
  } else if (!session) {
    screen = <AccountGate brandColor={tenant.brandColor} promptText="Sign in to continue" />;
  } else {
    screen = <FrontdeskHomeScreen />;
  }

  return (
    <>
      {screen}
      <DevResetConsentButton onReset={resetConsent} />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider tenant={tenant}>
        <LanguageProvider>
          <StatusBar style="dark" />
          <Gate />
        </LanguageProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const devStyles = StyleSheet.create({
  resetButton: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  resetText: { color: '#fff', fontSize: 10, fontWeight: '600' },
});
