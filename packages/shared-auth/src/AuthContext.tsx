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

  // Persisted sign-in is the whole point of storing the session in
  // SecureStore: once a person has signed in, reopening the app should
  // never show the login screen again while their token is still good --
  // loadSession() above restores it silently on every cold start. The one
  // case that legitimately has to fall back to the login screen is the
  // token actually being invalid or expired (decode_token on the backend
  // answers those with 401, see api/routes/auth.py) -- without this, a
  // signed-in person would instead sit on a home screen that silently
  // fails every request once their 30-day token lapses. A 401 only ever
  // means "no/garbage/expired credentials" in this API (role/permission
  // problems are always 403), so it's safe to treat any 401 as "sign this
  // person out and let them sign back in" -- if there's no session yet
  // (e.g. a wrong-password attempt on the login screen itself) this is a
  // harmless no-op.
  useEffect(() => {
    const id = client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error?.response?.status === 401) {
          await clearSession();
          setSession(null);
          setMfaToken(null);
          setEmailHint(null);
        }
        return Promise.reject(error);
      }
    );
    return () => {
      client.interceptors.response.eject(id);
    };
  }, [client]);

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
