import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth, LoginScreen, OtpScreen, AuthTenantConfig } from '@adar/shared-auth';
import { HomeScreen } from './src/HomeScreen';

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
