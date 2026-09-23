import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth, LoginScreen, OtpScreen, AuthTenantConfig } from '@adar/shared-auth';
import { HomeScreen } from './src/HomeScreen';

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
