import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LoginScreen, OtpScreen, register, useAuth } from '@adar/shared-auth';

type Mode = 'login' | 'register';

export interface AccountGateProps {
  brandColor: string;
  /** Currently unused visually (LoginScreen already explains itself) --
   *  kept so callers can still describe why they're gating, in case a
   *  future spot needs to show it. */
  promptText?: string;
}

/**
 * The mandatory front gate for the whole customer experience: after the
 * consent screen, this is the very first thing a customer sees, and none
 * of Book / Ask ADAR / My Appointments render until it resolves to a real
 * session. It's the exact same email+password+OTP login already used at
 * scheduling.adar.agomoniai.com (adar-core/api/routes/auth.py), reused here
 * via @adar/shared-auth's LoginScreen/OtpScreen rather than inventing a
 * separate identity system -- there's no "continue as guest" option.
 *
 * There's no shared RegisterScreen (ARCL/Geetabitan don't need one -- their
 * accounts are created on the web), so the small sign-up form below is
 * local to Front Desk, built on shared-auth's register() + signIn().
 */
export function AccountGate({ brandColor }: AccountGateProps) {
  const { mfaPending, signIn, client } = useAuth();
  const [mode, setMode] = useState<Mode>('login');

  if (mfaPending) {
    return <OtpScreen />;
  }

  if (mode === 'register') {
    return (
      <RegisterForm
        brandColor={brandColor}
        client={client}
        onSwitchToLogin={() => setMode('login')}
        onRegistered={async (email, password) => {
          await signIn(email, password);
        }}
      />
    );
  }

  // mode === 'login' -- the initial screen shown right after consent.
  return (
    <View style={styles.flex}>
      <LoginScreen />
      <TouchableOpacity style={styles.footerLink} onPress={() => setMode('register')}>
        <Text style={[styles.footerLinkText, { color: brandColor }]}>New here? Create an account</Text>
      </TouchableOpacity>
    </View>
  );
}

function RegisterForm({
  brandColor,
  client,
  onSwitchToLogin,
  onRegistered,
}: {
  brandColor: string;
  client: any;
  onSwitchToLogin: () => void;
  onRegistered: (email: string, password: string) => Promise<void>;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    fullName.trim().length >= 2 &&
    email.trim().length > 3 &&
    password.length >= 8 &&
    password === confirmPassword &&
    !busy;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await register(client, {
        teamName: fullName.trim(),
        email: email.trim(),
        password,
        contactPerson: fullName.trim(),
      });
      await onRegistered(email.trim(), password);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not create your account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.formCenter} keyboardShouldPersistTaps="handled">
        <Text style={styles.promptTitle}>Create your account</Text>
        <Text style={styles.promptSubtitle}>Used to sign you in and confirm your bookings by email.</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <TextInput
          style={styles.input}
          placeholder="Full name"
          autoCapitalize="words"
          value={fullName}
          onChangeText={setFullName}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (min 8 characters)"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="Confirm password"
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: brandColor, opacity: canSubmit ? 1 : 0.5 }]}
          disabled={!canSubmit}
          onPress={onSubmit}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Create account</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerLink} onPress={onSwitchToLogin}>
          <Text style={[styles.footerLinkText, { color: brandColor }]}>Already have an account? Sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  promptWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  formCenter: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  promptTitle: { fontSize: 18, fontWeight: '700', color: '#14181f', textAlign: 'center', marginBottom: 8 },
  promptSubtitle: { fontSize: 13, color: '#5b6472', textAlign: 'center', marginBottom: 20, maxWidth: 320 },
  primaryButton: { width: '100%', maxWidth: 340, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryButton: { paddingVertical: 8 },
  secondaryButtonText: { fontWeight: '600', fontSize: 14 },
  footerLink: { alignSelf: 'center', marginTop: 4, marginBottom: 4 },
  footerLinkText: { fontWeight: '600', fontSize: 13 },
  backLink: { position: 'absolute', top: 8, left: 16, padding: 8 },
  backLinkText: { fontWeight: '600', fontSize: 14 },
  input: {
    width: '100%', maxWidth: 340, borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, fontSize: 15,
  },
  errorText: {
    color: '#c0392b', backgroundColor: '#fdecea', width: '100%', maxWidth: 340, padding: 10,
    borderRadius: 10, marginBottom: 12, fontSize: 13, textAlign: 'center',
  },
});
