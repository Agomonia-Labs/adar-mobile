import { useCallback, useRef } from 'react';
import { AxiosInstance } from 'axios';

// Mirrors @adar/shared-chat's useGuestChat token lifecycle (30 min TTL,
// re-mint on expiry) but for the booking wizard's own guest identity --
// see api/routes/scheduling_guest.py's POST /session. Kept separate from
// the "Ask ADAR" tab's chat guest token (shared-chat's useGuestChat) since
// each concern mints its own short-lived, stateless guest identity; the
// booking session additionally needs practice_id/practice_ids, which the
// generic chat GuestSessionResponse type doesn't carry.
const TOKEN_TTL_SAFETY_MARGIN_MS = 15_000;

export interface GuestSession {
  access_token: string;
  expires_at: string;
  guest_id: string;
  practice_id: string;
  practice_ids: string[];
}

export function useFrontdeskGuestSession(client: AxiosInstance) {
  const tokenRef = useRef<string | null>(null);
  const expiresAtMsRef = useRef<number>(0);
  const practiceIdsRef = useRef<string[]>([]);

  const ensureSession = useCallback(async (): Promise<GuestSession> => {
    const stillValid = tokenRef.current && Date.now() < expiresAtMsRef.current - TOKEN_TTL_SAFETY_MARGIN_MS;
    if (!stillValid) {
      const { data } = await client.post<GuestSession>('/api/scheduling/guest/session');
      tokenRef.current = data.access_token;
      expiresAtMsRef.current = new Date(data.expires_at).getTime();
      practiceIdsRef.current = data.practice_ids || [data.practice_id];
      return data;
    }
    return {
      access_token: tokenRef.current as string,
      expires_at: new Date(expiresAtMsRef.current).toISOString(),
      guest_id: '',
      practice_id: practiceIdsRef.current[0] || '',
      practice_ids: practiceIdsRef.current,
    };
  }, [client]);

  return { ensureSession };
}
