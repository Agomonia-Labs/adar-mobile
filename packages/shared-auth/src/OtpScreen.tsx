import React, { useEffect, useState } from 'react';
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
import { useAuth } from './AuthContext';
import { getAuthTheme } from './theme';

export function OtpScreen() {
  const { tenant, emailHint, verifyCode, resendCode, cancelMfa, busy, error, clearError } = useAuth();
  const theme = getAuthTheme(tenant);

  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onVerify = async () => {
    if (otp.trim().length !== 6) return;
    try {
      await verifyCode(otp.trim());
    } catch {
      // surfaced via context error
    }
  };

  const onResend = async () => {
    setMessage(null);
    try {
      await resendCode();
      setMessage('New code sent!');
      setCooldown(60);
      setTimeout(() => setMessage(null), 3000);
    } catch {
      // surfaced via context error
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={[styles.logo, { backgroundColor: theme.brandColor }]}>
            <Text style={styles.logoText}>{tenant.logoText}</Text>
          </View>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Check your email</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            We sent a 6-digit login code to{'\n'}
            <Text style={{ fontWeight: '700' }}>{emailHint}</Text>
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {message ? <Text style={styles.success}>{message}</Text> : null}

          <TextInput
            style={[styles.otpInput, { borderColor: theme.border, color: theme.textPrimary }]}
            placeholder="000000"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            value={otp}
            onChangeText={(v) => {
              const digits = v.replace(/[^0-9]/g, '').slice(0, 6);
              setOtp(digits);
              if (error) clearError();
            }}
          />

          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.brandColor, opacity: otp.length === 6 && !busy ? 1 : 0.5 }]}
            onPress={onVerify}
            disabled={otp.length !== 6 || busy}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify code</Text>}
          </TouchableOpacity>

          <View style={styles.row}>
            <TouchableOpacity onPress={cancelMfa}>
              <Text style={[styles.link, { color: theme.brandColor }]}>← Back to sign in</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onResend} disabled={cooldown > 0}>
              <Text style={[styles.link, { color: cooldown > 0 ? theme.textSecondary : theme.brandColor }]}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.caption, { color: theme.textSecondary }]}>
            Code expires in 5 minutes · Do not share this code
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  title: { fontSize: 18, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  subtitle: { fontSize: 14, marginBottom: 20, textAlign: 'center', lineHeight: 20 },
  otpInput: {
    width: '100%', borderWidth: 1, borderRadius: 12, paddingVertical: 16, marginBottom: 16,
    fontSize: 32, fontWeight: '700', letterSpacing: 12, textAlign: 'center',
  },
  button: { width: '100%', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 4 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 14 },
  link: { fontSize: 14, fontWeight: '600' },
  caption: { fontSize: 12, marginTop: 18, textAlign: 'center' },
  error: {
    color: '#c0392b', backgroundColor: '#fdecea', width: '100%', padding: 10, borderRadius: 10,
    marginBottom: 12, fontSize: 13,
  },
  success: {
    color: '#1e7e34', backgroundColor: '#e9f7ef', width: '100%', padding: 10, borderRadius: 10,
    marginBottom: 12, fontSize: 13, textAlign: 'center',
  },
});
