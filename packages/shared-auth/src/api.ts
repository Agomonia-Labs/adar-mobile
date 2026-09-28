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

export function extractErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { detail?: string } } };
  return anyErr?.response?.data?.detail || fallback;
}
