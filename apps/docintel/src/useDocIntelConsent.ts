import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

// Bump this key's version suffix if the disclosure's substance changes
// materially (e.g. a new AI processor is added). See ConsentScreen.tsx for
// the actual disclosure text, and adar-web/docintel-privacy.html for the
// full policy this summarizes. Required by Apple App Review Guideline
// 5.1.2(i) (effective Nov 13, 2025): sending personal data to third-party
// AI needs disclosure and explicit permission *before* it happens -- not
// just a line in a privacy policy nobody opens. Same pattern as
// frontdesk/useFrontdeskConsent.ts and geetabitan/useAiConsent.ts.
const CONSENT_KEY = 'docintel_ai_consent_v1';

export type ConsentState = 'loading' | 'given' | 'needed';

export function useDocIntelConsent() {
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
    setState('given');
    try {
      await SecureStore.setItemAsync(CONSENT_KEY, 'true');
    } catch {
      // ignore -- worst case is being asked again next launch
    }
  }, []);

  // Dev-only escape hatch (see App.tsx's __DEV__-gated reset control): once
  // granted, this flag lives in the iOS Keychain, which survives an app
  // delete/reinstall on the same device -- so without this, re-testing the
  // consent screen means actually wiping the device's Keychain by hand.
  // Never exposed to a real user; production behavior (ask once, remember
  // forever) is unchanged.
  const reset = useCallback(async () => {
    setState('needed');
    try {
      await SecureStore.deleteItemAsync(CONSENT_KEY);
    } catch {
      // ignore -- state is already 'needed' locally either way
    }
  }, []);

  return { state, grant, reset };
}
