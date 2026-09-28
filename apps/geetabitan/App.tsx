import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, AuthTenantConfig } from '@adar/shared-auth';
import { GuestHomeScreen } from './src/GuestHomeScreen';
import { AiConsentScreen } from './src/AiConsentScreen';
import { useAiConsent } from './src/useAiConsent';

// See adar-core/ui/.env.geetabitan for the source of truth.
const tenant: AuthTenantConfig = {
  apiUrl: 'https://api.geetabitan.adar.agomoniai.com',
  apiKey: process.env.EXPO_PUBLIC_GEETABITAN_API_KEY || '',
  domain: 'geetabitan',
  displayName: 'ADAR Geetabitan',
  logoText: 'GB',
  brandColor: '#7a1f33',
};

function Gate() {
  // Required by Apple App Review Guideline 5.1.2(i) -- checked first, before
  // the guest chat/voice screen can render, until the user has explicitly
  // agreed to the AI-data-sharing disclosure. See useAiConsent.ts /
  // AiConsentScreen.tsx.
  const { state: consentState, grant: grantConsent } = useAiConsent();

  if (consentState === 'loading') return null; // TODO: replace with a splash screen
  if (consentState === 'needed') return <AiConsentScreen onAccept={grantConsent} />;

  // Geetabitan is open to everyone now -- guest-only, no sign-in/account
  // flow. (HomeScreen.tsx / the LoginScreen+OtpScreen flow are kept in the
  // repo but no longer wired in, in case signed-in mode comes back later.)
  return <GuestHomeScreen />;
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
