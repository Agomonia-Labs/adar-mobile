import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth, LoginScreen, OtpScreen, AuthTenantConfig } from '@adar/shared-auth';
import { HomeScreen } from './src/HomeScreen';

// "Front Desk" is the scheduling deployment — DOMAIN=scheduling.
// See adar-core/ui/.env.scheduling for the source of truth.
const tenant: AuthTenantConfig = {
  apiUrl: 'https://api.scheduling.adar.agomoniai.com',
  apiKey: process.env.EXPO_PUBLIC_FRONTDESK_API_KEY || '',
  domain: 'scheduling',
  displayName: 'ADAR Front Desk',
  logoText: 'FD',
  brandColor: '#1c7293',
};

function Gate() {
  const { session, mfaPending, loading } = useAuth();
  if (loading) return null; // TODO: replace with a splash screen
  if (!session) return mfaPending ? <OtpScreen /> : <LoginScreen />;
  return <HomeScreen />;
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
