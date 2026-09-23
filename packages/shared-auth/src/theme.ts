import type { AuthTenantConfig } from './types';

// Minimal shared style tokens, parameterized by the tenant's brand
// color so all three apps get the same auth-screen layout with their
// own identity. Extend this (spacing scale, typography, etc.) as the
// apps grow past the auth screens.
export function getAuthTheme(tenant: AuthTenantConfig) {
  return {
    brandColor: tenant.brandColor,
    background: '#f7f8fa',
    surface: '#ffffff',
    border: '#e2e5ea',
    textPrimary: '#14181f',
    textSecondary: '#5b6472',
    danger: '#c0392b',
    radius: 16,
  };
}
