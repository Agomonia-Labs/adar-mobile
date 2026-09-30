import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, AuthTenantConfig, useAuth } from '@adar/shared-auth';
import { LanguageProvider } from './src/i18n/LanguageContext';
import { DocIntelAccountGate } from './src/DocIntelAccountGate';
import { DocIntelHomeScreen } from './src/DocIntelHomeScreen';
import { WorkspaceProvider } from './src/WorkspaceContext';
import { ConsentScreen } from './src/ConsentScreen';
import { useDocIntelConsent } from './src/useDocIntelConsent';

// DocIntel is the ODD deployment out among these four mobile apps: it's
// powered by adar-rag/backend (a separate repo/Cloud Run service/Firebase
// project from adar-core), it's USER-shaped rather than team-shaped (see
// packages/shared-auth/src/types.ts's AuthSuccessPayload comment), and it
// has no X-API-Key concept -- every call just needs the signed-in user's
// bearer token. apiUrl points at the backend's own Cloud Run URL directly
// (not the docintel.adar.agomoniai.com Firebase-Hosting-fronted domain
// the web app uses) -- see adar-rag/frontend/.env.production's
// VITE_STREAM_BASE comment: Firebase Hosting's proxy has a 60s timeout
// that cuts off longer chat/summarize/compare SSE streams, so the web app
// itself bypasses it for streaming, and there's no reason for the mobile
// app to route through it at all.
const tenant: AuthTenantConfig = {
  apiUrl: 'https://docintel-backend-tzwvc47f5q-uc.a.run.app',
  apiKey: '',
  domain: 'docintel',
  displayName: 'ADAR DocIntel',
  logoText: 'DI',
  logoImage: require('./assets/icon.png'),
  brandColor: '#2e7d4f',
};

// Dev-only: the consent flag lives in the iOS Keychain (see
// useDocIntelConsent.ts), which outlives an app delete/reinstall on the
// same device -- so once you've tapped "I Agree & Continue" once on your
// phone, every later rebuild skips straight past the consent screen. That's
// correct behavior for a real user; for repeat testing, tap this to clear
// it and see the consent screen again on the next reload. Never rendered
// in a release build. Same pattern as frontdesk/geetabitan's App.tsx.
function DevResetConsentButton({ onReset }: { onReset: () => void }) {
  if (!__DEV__) return null;
  return (
    <TouchableOpacity style={devStyles.resetButton} onPress={onReset}>
      <Text style={devStyles.resetText}>Reset Consent</Text>
    </TouchableOpacity>
  );
}

function Gate() {
  const { state: consentState, grant: grantConsent, reset: resetConsent } = useDocIntelConsent();
  const { session, loading } = useAuth();

  let screen: React.ReactNode;
  if (consentState === 'loading') {
    screen = null;
  } else if (consentState === 'needed') {
    screen = <ConsentScreen onAccept={grantConsent} />;
  } else if (loading) {
    screen = null; // TODO: replace with a splash screen
  } else if (!session) {
    screen = <DocIntelAccountGate brandColor={tenant.brandColor} />;
  } else {
    screen = (
      <WorkspaceProvider baseURL={tenant.apiUrl}>
        <DocIntelHomeScreen />
      </WorkspaceProvider>
    );
  }

  return (
    <>
      {screen}
      <DevResetConsentButton onReset={resetConsent} />
    </>
  );
}

export default function App() {
  // Set the app-wide audio mode ONCE, here, before anything else in the
  // tree ever touches audio -- confirmed via live device testing that
  // setting playsInSilentModeIOS from inside VideoDetailScreen resolves
  // without error but does NOT stop iOS's ring/silent switch from muting
  // video playback (verified: switch to Ring -> audio works; switch to
  // Silent -> silent, even though the JS call reports success). Several
  // expo-av versions only reliably honor this if the audio session category
  // is established before any other audio-touching component (a <Video>,
  // an Audio.Sound, a Recording) has already activated the session with
  // the default category. Doing it once at the true root, before Gate/
  // DocIntelHomeScreen/VideoDetailScreen ever mount, is the standard fix.
  useEffect(() => {
    Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <AuthProvider tenant={tenant}>
          <StatusBar style="dark" />
          <Gate />
        </AuthProvider>
      </LanguageProvider>
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
