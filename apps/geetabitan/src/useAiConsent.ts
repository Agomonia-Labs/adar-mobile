import { useCallback, useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';

// Bump this key's version suffix if the disclosure's substance changes
// materially (e.g. a new AI processor is added) -- that re-prompts users
// who already agreed to the older wording, the same way a privacy policy
// gets a new "last updated" date. See AiConsentScreen.tsx for the actual
// disclosure text, and adar-web/geetabitan-privacy.html for the full
// policy this summarizes. Required by Apple App Review Guideline 5.1.2(i)
// (effective Nov 13, 2025): sending personal data to third-party AI needs
// disclosure and explicit permission *before* it happens -- not just a
// line in a privacy policy nobody opens.
//
// IMPORTANT: this flag lives in the app's document directory, NOT the iOS
// Keychain (expo-secure-store, used here previously). Keychain items are
// designed to survive an app delete/reinstall on the same device, which
// caused a real App Review regression: once a device had granted consent
// on an earlier build, every later resubmission reviewed on that same
// device skipped the consent screen entirely, so the reviewer never saw
// the AI-data-sharing disclosure and Apple rejected again under
// 5.1.1(i)/5.1.2(i) even though the screen existed in the code. The
// document directory is wiped by iOS when the app is deleted, so a fresh
// install -- exactly what App Review does for each review pass -- always
// sees the consent screen again. Real users still only see it once per
// install, which is the correct, intended behavior.
const CONSENT_KEY = 'geetabitan_ai_consent_v1';
const CONSENT_FILE = `${FileSystem.documentDirectory}${CONSENT_KEY}.json`;

export type ConsentState = 'loading' | 'given' | 'needed';

export function useAiConsent() {
  const [state, setState] = useState<ConsentState>('loading');

  useEffect(() => {
    let cancelled = false;
    FileSystem.getInfoAsync(CONSENT_FILE)
      .then((info) => {
        if (!cancelled) setState(info.exists ? 'given' : 'needed');
      })
      .catch(() => {
        // If the filesystem check itself fails for some reason, fail safe
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
      await FileSystem.writeAsStringAsync(CONSENT_FILE, 'true');
    } catch {
      // ignore
    }
  }, []);

  return { state, grant };
}
