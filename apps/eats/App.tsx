import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, AuthTenantConfig, OtpScreen, useAuth } from '@adar/shared-auth';
import { EatsAccountGate } from './src/EatsAccountGate';
import { CartProvider } from './src/CartContext';
import { HomeScreen } from './src/HomeScreen';
import { ConsentScreen } from './src/ConsentScreen';
import { useEatsConsent } from './src/useEatsConsent';

// ADAR Eats is powered by the SAME adar-rag/backend deployment as ADAR
// DocIntel (the restaurant marketplace/menu/order/feedback routes live
// alongside DocIntel's own routes in that one FastAPI app, prefixed
// /api/restaurant -- see adar-rag/backend/main.py). That makes Eats
// user-shaped (email/password/OTP, full_name, no team/X-API-Key concept)
// exactly like DocIntel, not team-shaped like Front Desk/ARCL/Geetabitan
// -- see packages/shared-auth/src/types.ts's AuthSuccessPayload comment.
// apiUrl points at the backend's own Cloud Run URL directly, same reason
// DocIntel's App.tsx does: Firebase Hosting's proxy has a 60s timeout that
// would cut off longer requests, and there's no reason to route through
// it from a native app anyway.
const tenant: AuthTenantConfig = {
  apiUrl: 'https://docintel-backend-tzwvc47f5q-uc.a.run.app',
  apiKey: '',
  domain: 'restaurant',
  displayName: 'ADAR Eats',
  logoText: 'AE',
  logoImage: require('./assets/icon.png'),
  brandColor: '#1b2430',
};

// Dev-only: the consent flag lives in the iOS Keychain (see
// useEatsConsent.ts), which outlives an app delete/reinstall on the same
// device -- so once you've tapped "I Agree & Continue" once on your phone,
// every later rebuild skips straight past the consent screen. That's
// correct behavior for a real user; for repeat testing, tap this to clear
// it and see the consent screen again on the next reload. Never rendered
// in a release build, and (see Gate below) only rendered before sign-in --
// once you're actually inside HomeScreen, this button's fixed bottom-right
// spot is exactly where the chat input row, the cart's checkout button,
// and owner-dashboard form fields all sit, so leaving it mounted there
// permanently overlapped real app content instead of just sitting over
// the consent/sign-in screens it's meant to help test. Same pattern as
// docintel/frontdesk/geetabitan's App.tsx (that overlap risk applies
// there too, just not reported yet -- out of scope here).
function DevResetConsentButton({ onReset }: { onReset: () => void }) {
  if (!__DEV__) return null;
  return (
    <TouchableOpacity style={devStyles.resetButton} onPress={onReset}>
      <Text style={devStyles.resetText}>Reset Consent</Text>
    </TouchableOpacity>
  );
}

function Gate() {
  const { state: consentState, grant: grantConsent, reset: resetConsent } = useEatsConsent();
  const { session, mfaPending, loading } = useAuth();

  let screen: React.ReactNode;
  if (consentState === 'loading') {
    screen = null;
  } else if (consentState === 'needed') {
    screen = <ConsentScreen onAccept={grantConsent} />;
  } else if (loading) {
    screen = null;
  } else if (session) {
    screen = <HomeScreen />;
  } else if (mfaPending) {
    screen = <OtpScreen />;
  } else {
    screen = <EatsAccountGate brandColor={tenant.brandColor} />;
  }

  return (
    <>
      {screen}
      {!session && <DevResetConsentButton onReset={resetConsent} />}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider tenant={tenant}>
        <CartProvider>
          <StatusBar style="light" />
          <Gate />
        </CartProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const devStyles = StyleSheet.create({
  resetButton: {
    position: 'absolute',
    bottom: 40,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  resetText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});
