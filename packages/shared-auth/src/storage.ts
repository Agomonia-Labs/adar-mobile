import * as SecureStore from 'expo-secure-store';
import type { AuthSession } from './types';

// Same key names the web app (adar-core/ui/src/App.jsx) uses in
// localStorage — kept identical for consistency across platforms,
// even though each mobile app's SecureStore is already sandboxed
// per-app so there's no real collision risk.
const KEYS = {
  token: 'adar_token',
  teamId: 'adar_team_id',
  teamName: 'adar_team_name',
  role: 'adar_role',
  status: 'adar_status',
  practiceId: 'adar_practice_id',
} as const;

async function set(key: string, value: string | undefined | null) {
  if (value === undefined || value === null || value === '') {
    await SecureStore.deleteItemAsync(key);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

export async function saveSession(session: AuthSession): Promise<void> {
  await Promise.all([
    set(KEYS.token, session.accessToken),
    set(KEYS.teamId, session.teamId),
    set(KEYS.teamName, session.teamName),
    set(KEYS.role, session.role),
    set(KEYS.status, session.status),
    set(KEYS.practiceId, session.practiceId),
  ]);
}

export async function loadSession(): Promise<AuthSession | null> {
  const [accessToken, teamId, teamName, role, status, practiceId] = await Promise.all([
    SecureStore.getItemAsync(KEYS.token),
    SecureStore.getItemAsync(KEYS.teamId),
    SecureStore.getItemAsync(KEYS.teamName),
    SecureStore.getItemAsync(KEYS.role),
    SecureStore.getItemAsync(KEYS.status),
    SecureStore.getItemAsync(KEYS.practiceId),
  ]);
  if (!accessToken || !teamId) return null;
  return {
    accessToken,
    teamId,
    teamName: teamName || '',
    role: role || '',
    status: status || 'active',
    practiceId: practiceId || undefined,
  };
}

export async function clearSession(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)));
}
