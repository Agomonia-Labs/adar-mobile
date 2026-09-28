import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useAuth } from './AuthContext';
import { getAuthTheme } from './theme';
import { requestPasswordReset } from './AuthContext';

export function LoginScreen() {
  const { tenant, client, signIn, busy, error, clearError } = useAuth();
  const theme = getAuthTheme(tenant);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const onSubmit = async () => {
    if (!canSubmit) return;
    try {
      await signIn(email, password);
    } catch {
      // error is already surfaced via context state
    }
  };

  const onForgot = async () => {
    if (!forgotEmail.trim()) return;
    await requestPasswordReset(client, forgotEmail);
    setMessage('If that email is registered you will receive a reset link shortly.');
  };

  if (mode === 'forgot') {
    return (
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: theme.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.center}>
          <View style={styles.card}>
            <Logo text={tenant.logoText} color={theme.brandColor} image={tenant.logoImage} />
            <Text style={[styles.title, { color: theme.textPrimary }]}>Reset your password</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Enter the email on your account and we'll send you a reset link.
            </Text>
            {message ? <Text style={styles.success}>{message}</Text> : null}
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.textPrimary }]}
              placeholder="Email"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              value={forgotEmail}
              onChangeText={setForgotEmail}
            />
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.brandColor }]}
              onPress={onForgot}
            >
              <Text style={styles.buttonText}>Send reset link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkRow} onPress={() => { setMode('login'); setMessage(null); }}>
              <Text style={[styles.link, { color: theme.brandColor }]}>← Back to sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Logo text={tenant.logoText} color={theme.brandColor} image={tenant.logoImage} />
          <Text style={[styles.title, { color: theme.textPrimary }]}>{tenant.displayName}</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Sign in to continue</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.textPrimary }]}
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={(v) => { setEmail(v); if (error) clearError(); }}
          />
          <TextInput
            style={[styles.input, { borderColor: theme.border, color: theme.textPrimary }]}
            placeholder="Password"
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            value={password}
            onChangeText={(v) => { setPassword(v); if (error) clearError(); }}
          />

          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.brandColor, opacity: canSubmit ? 1 : 0.5 }]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkRow} onPress={() => setMode('forgot')}>
            <Text style={[styles.link, { color: theme.brandColor }]}>Forgot password?</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Logo({ text, color, image }: { text: string; color: string; image?: ImageSourcePropType }) {
  if (image) {
    return <Image source={image} style={styles.logoImage} />;
  }
  return (
    <View style={[styles.logo, { backgroundColor: color }]}>
      <Text style={styles.logoText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 400, alignItems: 'center' },
  logo: {
    width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  logoText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  logoImage: { width: 56, height: 56, borderRadius: 16, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  subtitle: { fontSize: 14, marginBottom: 20, textAlign: 'center' },
  input: {
    width: '100%', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, marginBottom: 12,
  },
  button: {
    width: '100%', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4, marginBottom: 4,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  linkRow: { marginTop: 14 },
  link: { fontSize: 14, fontWeight: '600' },
  error: {
    color: '#c0392b', backgroundColor: '#fdecea', width: '100%', padding: 10, borderRadius: 10,
    marginBottom: 12, fontSize: 13,
  },
  success: {
    color: '#1e7e34', backgroundColor: '#e9f7ef', width: '100%', padding: 10, borderRadius: 10,
    marginBottom: 12, fontSize: 13, textAlign: 'center',
  },
});
