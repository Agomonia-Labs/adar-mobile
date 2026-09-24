import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth, LoginScreen, OtpScreen, AuthTenantConfig } from '@adar/shared-auth';
import { HomeScreen } from './src/HomeScreen';
import { GuestHomeScreen } from './src/GuestHomeScreen';

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
  // Starts on the no-login guest experience (same flow as
  // labs.agomoniai.com/arcl) -- "Sign in" flips this to the real login
  // flow for anyone with an actual ARCL account.
  const [wantsSignIn, setWantsSignIn] = useState(false);

  if (loading) return null; // TODO: replace with a splash screen
  if (session) return <HomeScreen />;
  if (mfaPending) return <OtpScreen />;

  if (wantsSignIn) {
    return (
      <View style={styles.flex}>
        <LoginScreen />
        <TouchableOpacity style={styles.guestLink} onPress={() => setWantsSignIn(false)}>
          <Text style={[styles.guestLinkText, { color: tenant.brandColor }]}>
            ← Continue as guest instead
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <GuestHomeScreen onSignIn={() => setWantsSignIn(true)} />;
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  guestLink: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
  },
  guestLinkText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
