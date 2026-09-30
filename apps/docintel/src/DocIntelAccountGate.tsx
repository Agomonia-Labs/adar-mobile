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
import { LoginScreen, OtpScreen, registerUser, resendVerificationEmail, useAuth } from '@adar/shared-auth';

// DocIntel's front gate. LoginScreen/OtpScreen are shared-auth's generic
// components (no changes needed -- DocIntel's /api/auth/login +
// /api/auth/verify-otp already match the same mfa_token/otp contract the
// other three apps use). The one thing DocIntel needs of its own is this
// register form: shared-auth's existing register() is team-shaped
// (team_name/contact_person), which doesn't apply to a user-shaped
// deployment -- see registerUser() in packages/shared-auth/src/api.ts.
//
// DocIntel registration is also NOT auto-verified like Front Desk's: only
// the very first account on the whole deployment (bootstrap admin) is
// auto-verified. Every account after that gets `needs_verify: true` and
// must click an emailed verification link before /login will accept it
// (adar-rag/backend/auth/router.py's register()/login()) -- so this
// screen has a third state beyond login/register: "check your email".

type Mode = 'login' | 'register' | 'check-email';

export function DocIntelAccountGate({ brandColor }: { brandColor: string }) {
  const { mfaPending, signIn, client } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [pendingEmail, setPendingEmail] = useState('');

  if (mfaPending) {
    return <OtpScreen />;
  }

  if (mode === 'check-email') {
    return (
      <CheckEmailScreen
        brandColor={brandColor}
        email={pendingEmail}
        client={client}
        onBackToLogin={() => setMode('login')}
      />
    );
  }

  if (mode === 'register') {
    return (
      <RegisterForm
        brandColor={brandColor}
        client={client}
        onSwitchToLogin={() => setMode('login')}
        onRegistered={async (email, password, needsVerify) => {
          if (needsVerify) {
            setPendingEmail(email);
            setMode('check-email');
          } else {
            // First account on this deployment -- auto-verified admin,
            // same "register then sign in immediately" flow Front Desk uses.
            await signIn(email, password);
          }
        }}
      />
    );
  }

  return (
    <View style={styles.flex}>
      <LoginScreen />
      <TouchableOpacity style={styles.footerLink} onPress={() => setMode('register')}>
        <Text style={[styles.footerLinkText, { color: brandColor }]}>New here? Create an account</Text>
      </TouchableOpacity>
    </View>
  );
}

function CheckEmailScreen({
  brandColor,
  email,
  client,
  onBackToLogin,
}: {
  brandColor: string;
  email: string;
  client: any;
  onBackToLogin: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onResend = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await resendVerificationEmail(client, email);
      setMessage('If that email needs verifying, a new link is on its way.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.centerScreen}>
      <Text style={styles.checkEmailTitle}>Check your email</Text>
      <Text style={styles.checkEmailBody}>
        We sent a verification link to{'\n'}
        <Text style={{ fontWeight: '700' }}>{email}</Text>
        {'\n\n'}Click it, then come back here and sign in.
      </Text>
      {message ? <Text style={styles.success}>{message}</Text> : null}
      <TouchableOpacity
        style={[styles.primaryButton, { backgroundColor: brandColor, opacity: busy ? 0.6 : 1 }]}
        onPress={onResend}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Resend link</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.footerLink} onPress={onBackToLogin}>
        <Text style={[styles.footerLinkText, { color: brandColor }]}>← Back to sign in</Text>
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
  onRegistered: (email: string, password: string, needsVerify: boolean) => Promise<void>;
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
      const result = await registerUser(client, { email: email.trim(), password, fullName: fullName.trim() });
      await onRegistered(email.trim(), password, result.needs_verify);
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
        <Text style={styles.promptSubtitle}>
          Sign, ingest, and ask questions of your documents -- synced with the DocIntel web app.
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <TextInput style={styles.input} placeholder="Full name" autoCapitalize="words" value={fullName} onChangeText={setFullName} />
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput style={styles.input} placeholder="Password (min 8 characters)" secureTextEntry value={password} onChangeText={setPassword} />
        <TextInput style={styles.input} placeholder="Confirm password" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} />
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
  centerScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#f7f8fa' },
  checkEmailTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center', color: '#14181f' },
  checkEmailBody: { fontSize: 14, color: '#5b6472', textAlign: 'center', marginBottom: 20, lineHeight: 21, maxWidth: 320 },
  formCenter: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  promptTitle: { fontSize: 18, fontWeight: '700', color: '#14181f', textAlign: 'center', marginBottom: 8 },
  promptSubtitle: { fontSize: 13, color: '#5b6472', textAlign: 'center', marginBottom: 20, maxWidth: 320 },
  primaryButton: { width: '100%', maxWidth: 340, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  footerLink: { alignSelf: 'center', marginTop: 4, marginBottom: 4 },
  footerLinkText: { fontWeight: '600', fontSize: 13 },
  input: {
    width: '100%', maxWidth: 340, borderWidth: 1, borderColor: '#d7dbe0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, fontSize: 15,
  },
  errorText: {
    color: '#c0392b', backgroundColor: '#fdecea', width: '100%', maxWidth: 340, padding: 10,
    borderRadius: 10, marginBottom: 12, fontSize: 13, textAlign: 'center',
  },
  success: {
    color: '#1e7e34', backgroundColor: '#e9f7ef', width: '100%', maxWidth: 340, padding: 10,
    borderRadius: 10, marginBottom: 12, fontSize: 13, textAlign: 'center',
  },
});
