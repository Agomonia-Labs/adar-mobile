// Everything here mirrors the real contract implemented in
// adar-core/api/routes/auth.py — keep the two in sync.

import type { ImageSourcePropType } from 'react-native';

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
  /** Optional real logo image (e.g. require('../assets/icon.png')), shown
   *  on LoginScreen/OtpScreen instead of the logoText circle badge when
   *  set. Apps without a logo asset (ARCL, Geetabitan today) simply omit
   *  this and keep the text badge. */
  logoImage?: ImageSourcePropType;
  /** Primary brand color, hex */
  brandColor: string;
}

export interface AuthSession {
  accessToken: string;
  /** Team-shaped deployments (scheduling/arcl/geetabitan): the real team
   *  id. User-shaped deployments (docintel): falls back to user_id, so
   *  every consumer has a stable per-account identity either way. */
  teamId: string;
  /** Team-shaped deployments: the real team name. User-shaped
   *  deployments: falls back to full_name, then email. */
  teamName: string;
  role: string;
  status: string;
  /** Only set for practice-scoped scheduling/front-desk staff logins */
  practiceId?: string;
  /** Only set for user-shaped (docintel) logins -- the real user id
   *  (same value teamId falls back to above, kept under its own name too
   *  so a docintel-aware screen doesn't have to read it out of teamId). */
  userId?: string;
  /** Only set for user-shaped (docintel) logins. */
  fullName?: string;
  /** Only set for user-shaped (docintel) logins. */
  email?: string;
}

/** Raw shape returned by POST /api/auth/login and /api/auth/verify-otp
 *  when they succeed outright (no MFA step pending).
 *
 *  Two deployment shapes share this one type:
 *  - Team-shaped (adar-core: scheduling/arcl/geetabitan) -- team_id/team_name present.
 *  - User-shaped (adar-rag: docintel) -- user_id/full_name/email present instead;
 *    team_id/team_name are absent. See AuthContext.tsx's signIn/verifyCode,
 *    which fall back teamId/teamName to the user-shaped fields so every
 *    consumer still gets a stable identity either way. */
export interface AuthSuccessPayload {
  access_token: string;
  team_id?: string;
  team_name?: string;
  role: string;
  status?: string;
  practice_id?: string;
  user_id?: string;
  full_name?: string;
  email?: string;
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
