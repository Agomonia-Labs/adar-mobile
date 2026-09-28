import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

// Bump this key's version suffix if the disclosure's substance changes
// materially (e.g. a new AI processor is added) -- that re-prompts users
// who already agreed to the older wording, the same way a privacy policy
// gets a new "last updated" date. See AiConsentScreen.tsx for the actual
// disclosure text, and adar-web/geetabitan-privacy.html for the full
// policy this summarizes. Required by Apple App Review Guideline 5.1.2(i)
// (effective Nov 13, 2025): sending personal data to third-party AI needs
// disclosure and explicit permission *before* it happens -- not just a
// line in a privacy policy nobody opens.
const CONSENT_KEY = 'geetabitan_ai_consent_v1';

export type ConsentState = 'loading' | 'given' | 'needed';

export function useAiConsent() {
  const [state, setState] = useState<ConsentState>('loading');

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(CONSENT_KEY)
      .then((value) => {
        if (!cancelled) setState(value === 'true' ? 'given' : 'needed');
      })
      .catch(() => {
        // If SecureStore itself is unavailable for some reason, fail safe
        // by asking -- never skip the disclosure.
        if (!cancelled) setState('needed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grant = useCallback(async () => {
    // Update UI immediately; persist best-effort. If persistence fails,
    // the only downside is being asked again next launch -- never unsafe.
    setState('given');
    try {
      await SecureStore.setItemAsync(CONSENT_KEY, 'true');
    } catch {
      // ignore
    }
  }, []);

  return { state, grant };
}
