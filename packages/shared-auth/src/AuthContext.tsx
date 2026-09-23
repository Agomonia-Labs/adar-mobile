import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AxiosInstance } from 'axios';
import { createAuthClient, forgotPassword, login, resendOtp, verifyOtp } from './api';
import { clearSession, loadSession, saveSession } from './storage';
import type { AuthSession, AuthTenantConfig } from './types';
import { isMfaChallenge } from './types';

interface AuthContextValue {
  tenant: AuthTenantConfig;
  client: AxiosInstance;
  /** Restored / active session, or null when signed out. */
  session: AuthSession | null;
  /** True while restoring a saved session on cold start. */
  loading: boolean;
  /** True while a login/verify/resend call is in flight. */
  busy: boolean;
  /** True once /login has returned an MFA challenge, until verify-otp succeeds. */
  mfaPending: boolean;
  emailHint: string | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  verifyCode: (otp: string) => Promise<void>;
  resendCode: () => Promise<void>;
  cancelMfa: () => void;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  tenant,
  children,
}: {
  tenant: AuthTenantConfig;
  children: React.ReactNode;
}) {
  const client = useMemo(() => createAuthClient(tenant), [tenant]);

  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSession().then((restored) => {
      if (!cancelled) {
        setSession(restored);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setBusy(true);
      try {
        const data = await login(client, email, password);
        if (isMfaChallenge(data)) {
          setMfaToken(data.mfa_token);
          setEmailHint(data.email_hint);
        } else {
          const next: AuthSession = {
            accessToken: data.access_token,
            teamId: data.team_id,
            teamName: data.team_name,
            role: data.role,
            status: data.status || 'active',
            practiceId: data.practice_id,
          };
          await saveSession(next);
          setSession(next);
        }
      } catch (err) {
        const anyErr = err as { response?: { data?: { detail?: string } } };
        setError(anyErr?.response?.data?.detail || 'Login failed. Please try again.');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [client]
  );

  const verifyCode = useCallback(
    async (otp: string) => {
      if (!mfaToken) return;
      setError(null);
      setBusy(true);
      try {
        const data = await verifyOtp(client, mfaToken, otp);
        const next: AuthSession = {
          accessToken: data.access_token,
          teamId: data.team_id,
          teamName: data.team_name,
          role: data.role,
          status: data.status || 'active',
          practiceId: data.practice_id,
        };
        await saveSession(next);
        setSession(next);
        setMfaToken(null);
        setEmailHint(null);
      } catch (err) {
        const anyErr = err as { response?: { data?: { detail?: string } } };
        setError(anyErr?.response?.data?.detail || 'Invalid code. Please try again.');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [client, mfaToken]
  );

  const resendCode = useCallback(async () => {
    if (!mfaToken) return;
    setError(null);
    try {
      await resendOtp(client, mfaToken);
    } catch (err) {
      const anyErr = err as { response?: { data?: { detail?: string } } };
      setError(anyErr?.response?.data?.detail || 'Could not resend code.');
      throw err;
    }
  }, [client, mfaToken]);

  const cancelMfa = useCallback(() => {
    setMfaToken(null);
    setEmailHint(null);
    setError(null);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
    setMfaToken(null);
    setEmailHint(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value: AuthContextValue = {
    tenant,
    client,
    session,
    loading,
    busy,
    mfaPending: !!mfaToken,
    emailHint,
    error,
    signIn,
    verifyCode,
    resendCode,
    cancelMfa,
    signOut,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

// Exposed for screens that want forgot-password without growing the
// context's surface area.
export async function requestPasswordReset(client: AxiosInstance, email: string) {
  return forgotPassword(client, email);
}
