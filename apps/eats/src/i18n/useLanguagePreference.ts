import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_LANGUAGE, LanguageCode, SUPPORTED_LANGUAGES, languageMeta } from './languages';

const STORAGE_KEY = 'adareats_language';

/** Device-local language preference for the Menu Assistant chat -- not
 *  tied to the signed-in account, same mechanism apps/docintel/src/i18n/
 *  LanguageContext.tsx uses (SecureStore, shared-auth's own storage
 *  mechanism), so it works before login too and survives sign-out. Scoped
 *  to the chat screen only (no app-wide UI translation layer here, unlike
 *  DocIntel) -- this picks the AI reply language and the voice input/
 *  output locale, per the user's request to reuse what already exists
 *  for the chat interface specifically. */
export function useLanguagePreference() {
  const [language, setLanguageState] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (cancelled) return;
        if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
          setLanguageState(saved as LanguageCode);
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((code: LanguageCode) => {
    setLanguageState(code);
    SecureStore.setItemAsync(STORAGE_KEY, code).catch(() => {
      // Best-effort persistence -- worst case the choice doesn't survive
      // an app restart, not worth failing the selection itself over.
    });
  }, []);

  return { language, meta: languageMeta(language), languages: SUPPORTED_LANGUAGES, setLanguage, loaded };
}
