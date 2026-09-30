import axios, { AxiosInstance } from 'axios';
import type { AuthTenantConfig, LoginResponse, AuthSuccessPayload } from './types';

// Mirrors adar-core/ui/src/Login.jsx exactly — same endpoints, same
// request/response shapes, same /api/auth prefix (see
// adar-core/api/routes/auth.py: router = APIRouter(prefix="/api/auth")).

export function createAuthClient(tenant: AuthTenantConfig): AxiosInstance {
  const client = axios.create({
    baseURL: tenant.apiUrl,
    headers: tenant.apiKey ? { 'X-API-Key': tenant.apiKey } : undefined,
    // 2 minutes -- ARCL's ADK orchestration can take a while on
    // complex queries (multi-tool lookups, standings/stats joins), and
    // the default 20s was cutting those off client-side before the
    // backend even finished.
    timeout: 120000,
  });
  return client;
}

export async function login(
  client: AxiosInstance,
  email: string,
  password: string
): Promise<LoginResponse> {
  const { data } = await client.post<LoginResponse>('/api/auth/login', {
    email: email.trim().toLowerCase(),
    password,
  });
  return data;
}

export async function verifyOtp(
  client: AxiosInstance,
  mfaToken: string,
  otp: string
): Promise<AuthSuccessPayload> {
  const { data } = await client.post<AuthSuccessPayload>('/api/auth/verify-otp', {
    mfa_token: mfaToken,
    otp: otp.trim(),
  });
  return data;
}

export async function resendOtp(client: AxiosInstance, mfaToken: string): Promise<void> {
  await client.post('/api/auth/resend-otp', { mfa_token: mfaToken });
}

/** Self-registration -- mirrors adar-core/api/routes/auth.py's
 *  RegisterRequest exactly (team_name/email/password/contact_person). A
 *  new account starts "pending"/"pending_payment"/"active" depending on
 *  that deployment's BILLING_ENABLED setting; sign in right after with
 *  login() the same way the web Login.jsx flow does. */
export async function register(
  client: AxiosInstance,
  params: { teamName: string; email: string; password: string; contactPerson: string }
): Promise<{ message: string; team_id: string; status: string }> {
  const { data } = await client.post('/api/auth/register', {
    team_name: params.teamName.trim(),
    email: params.email.trim().toLowerCase(),
    password: params.password,
    contact_person: params.contactPerson.trim(),
  });
  return data;
}

export async function forgotPassword(client: AxiosInstance, email: string): Promise<void> {
  // Backend always reports success regardless of whether the email is
  // registered — same behavior the web Login.jsx relies on.
  try {
    await client.post('/api/auth/forgot-password', { email: email.trim().toLowerCase() });
  } catch {
    /* intentionally swallowed, matches web behavior */
  }
}

/** Raw shape returned by POST /api/auth/register on a user-shaped
 *  (docintel) deployment -- mirrors adar-rag/backend/auth/router.py's
 *  register() exactly. Unlike register() above (team-shaped, auto-verified,
 *  safe to sign in right after), a non-first docintel account is NOT
 *  verified yet: needs_verify is true and login() will 403 until the
 *  user clicks the emailed verification link. Callers must branch on
 *  needs_verify instead of calling signIn() unconditionally. */
export interface RegisterUserResponse {
  message: string;
  user_id: string;
  email: string;
  role: string;
  is_verified: boolean;
  needs_verify: boolean;
}

/** Self-registration for a user-shaped (docintel) deployment -- mirrors
 *  adar-rag/backend/auth/router.py's RegisterRequest exactly
 *  (email/password/full_name, no team_name/contact_person). See
 *  RegisterUserResponse above for what to do with the result. */
export async function registerUser(
  client: AxiosInstance,
  params: { email: string; password: string; fullName: string }
): Promise<RegisterUserResponse> {
  const { data } = await client.post<RegisterUserResponse>(
    '/api/auth/register',
    {
      email: params.email.trim().toLowerCase(),
      password: params.password,
      full_name: params.fullName.trim(),
    },
    // Tells adar-rag/backend/auth/router.py's register() this signup came
    // from a mobile app (as opposed to the DocIntel web frontend, which
    // posts to the same endpoint without this header) -- new mobile
    // signups default to the enterprise tier there.
    { headers: { 'X-Client-Platform': 'mobile' } }
  );
  return data;
}

/** Self-service account deletion for a team-shaped (adar-core) deployment
 *  -- mirrors adar-core/api/routes/auth.py's POST /api/auth/delete-account
 *  exactly (Bearer token + current password as confirmation). Required by
 *  App Store Guideline 5.1.1(v) for any app that supports account
 *  creation, which AccountGate's sign-up form does for Front Desk. The
 *  docintel (user-shaped) deployment has its own separate deleteAccount in
 *  apps/docintel/src/docintelApi.ts -- this one is for team-shaped
 *  deployments (scheduling/arcl/geetabitan) instead. */
export async function deleteAccount(
  client: AxiosInstance,
  accessToken: string,
  password: string
): Promise<{ message: string }> {
  const { data } = await client.post(
    '/api/auth/delete-account',
    { password },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data;
}

export function extractErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { detail?: string } } };
  return anyErr?.response?.data?.detail || fallback;
}

/** POST /api/auth/resend-verification — user-shaped (docintel) deployments
 *  only. Re-sends the email verification LINK (not an OTP) to an
 *  unverified account; mirrors adar-rag/backend/auth/router.py's
 *  resend_verification exactly. The response is intentionally the same
 *  whether or not the email exists/is unverified (mirrors backend
 *  behavior, avoids leaking account existence). */
export async function resendVerificationEmail(client: AxiosInstance, email: string): Promise<void> {
  await client.post('/api/auth/resend-verification', { email: email.trim().toLowerCase() });
}
