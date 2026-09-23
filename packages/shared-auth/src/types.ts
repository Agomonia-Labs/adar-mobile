// Everything here mirrors the real contract implemented in
// adar-core/api/routes/auth.py — keep the two in sync.

export interface AuthTenantConfig {
  /** Base URL of THIS product's adar-core deployment.
   *  e.g. https://api.arcl.tigers.agomoniai.com */
  apiUrl: string;
  /** Some deployments (see adar-core/ui VITE_API_KEY) require an API key
   *  header. Leave empty string if this product's deployment doesn't use one. */
  apiKey?: string;
  /** Matches the backend's DOMAIN env var: 'arcl' | 'geetabitan' | 'scheduling' */
  domain: string;
  /** Shown on the login screen, e.g. "ADAR ARCL" */
  displayName: string;
  /** Short text mark for the logo badge, e.g. "AC" */
  logoText: string;
  /** Primary brand color, hex */
  brandColor: string;
}

export interface AuthSession {
  accessToken: string;
  teamId: string;
  teamName: string;
  role: string;
  status: string;
  /** Only set for practice-scoped scheduling/front-desk staff logins */
  practiceId?: string;
}

/** Raw shape returned by POST /api/auth/login and /api/auth/verify-otp
 *  when they succeed outright (no MFA step pending). */
export interface AuthSuccessPayload {
  access_token: string;
  team_id: string;
  team_name: string;
  role: string;
  status?: string;
  practice_id?: string;
}

/** Raw shape returned by POST /api/auth/login when MFA is required. */
export interface MfaChallengePayload {
  mfa_required: true;
  mfa_token: string;
  email_hint: string;
}

export type LoginResponse = AuthSuccessPayload | MfaChallengePayload;

export function isMfaChallenge(r: LoginResponse): r is MfaChallengePayload {
  return (r as MfaChallengePayload).mfa_required === true;
}
