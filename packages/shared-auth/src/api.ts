import axios, { AxiosInstance } from 'axios';
import type { AuthTenantConfig, LoginResponse, AuthSuccessPayload } from './types';

// Mirrors adar-core/ui/src/Login.jsx exactly — same endpoints, same
// request/response shapes, same /api/auth prefix (see
// adar-core/api/routes/auth.py: router = APIRouter(prefix="/api/auth")).

export function createAuthClient(tenant: AuthTenantConfig): AxiosInstance {
  const client = axios.create({
    baseURL: tenant.apiUrl,
    headers: tenant.apiKey ? { 'X-API-Key': tenant.apiKey } : undefined,
    timeout: 20000,
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
