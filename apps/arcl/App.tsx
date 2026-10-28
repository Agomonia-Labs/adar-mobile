import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth, OtpScreen, AuthTenantConfig } from '@adar/shared-auth';
import { HomeScreen } from './src/HomeScreen';
import { AccountGate } from './src/AccountGate';
import { ConsentScreen } from './src/ConsentScreen';
import { useArclConsent } from './src/useArclConsent';

// One adar-core deployment per app — this is the ARCL instance.
// See adar-core/ui/.env.production for the source of truth.
const tenant: AuthTenantConfig = {
  apiUrl: 'https://api.arcl.tigers.agomoniai.com',
  // ARCL's production deployment uses an API key header (see
  // adar-core/ui/.env.production VITE_API_KEY) — set it via an env
  // var at build time rather than hardcoding it here.
  apiKey: process.env.EXPO_PUBLIC_ARCL_API_KEY || '',
  domain: 'arcl',
  displayName: 'ADAR ARCL',
  logoText: 'AC',
  brandColor: '#0c4d34',
};

// Dev-only: the consent flag lives in the app's document directory (see
// useArclConsent.ts), which is wiped on delete/reinstall -- so once
// you've tapped "I Agree & Continue" on your phone, every later rebuild
// skips straight past the consent screen. That's correct for a real
// user; for repeat testing, tap this to clear it and see the consent
// screen again on the next reload. Never rendered in a release build.
// Same pattern as docintel/frontdesk/geetabitan's App.tsx.
function DevResetConsentButton({ onReset }: { onReset: () => void }) {
  if (!__DEV__) return null;
  return (
    <TouchableOpacity style={devStyles.resetButton} onPress={onReset}>
      <Text style={devStyles.resetText}>Reset Consent</Text>
    </TouchableOpacity>
  );
}

// No more "continue as guest" -- sign-in (or create-account) is required
// before anything else renders. The public no-login experience still
// lives at labs.agomoniai.com/arcl on the web; this app is sign-in-only.
// The AI-data-sharing consent screen is gated in ahead of EVERYTHING else,
// including sign-in -- required by Apple App Review Guideline 5.1.2(i),
// and matching docintel/frontdesk/geetabitan's App.tsx.
function Gate() {
  const { state: consentState, grant: grantConsent, reset: resetConsent } = useArclConsent();
  const { session, mfaPending, loading } = useAuth();

  let screen: React.ReactNode;
  if (consentState === 'loading') {
    screen = null;
  } else if (consentState === 'needed') {
    screen = <ConsentScreen onAccept={grantConsent} />;
  } else if (loading) {
    screen = null; // TODO: replace with a splash screen
  } else if (session) {
    screen = <HomeScreen />;
  } else if (mfaPending) {
    screen = <OtpScreen />;
  } else {
    screen = <AccountGate brandColor={tenant.brandColor} />;
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
        <StatusBar style="light" />
        <Gate />
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

