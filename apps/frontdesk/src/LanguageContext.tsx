import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { LangCode, SUPPORTED_LANGUAGES, t as translate } from './i18n';

const LANG_KEY = 'frontdesk_lang_v1';
const DEFAULT_LANG: LangCode = 'en-US';

interface LanguageContextValue {
  lang: LangCode;
  setLang: (lang: LangCode) => void;
  t: (key: Parameters<typeof translate>[1]) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key) => translate(DEFAULT_LANG, key),
});

/**
 * App-wide language selection for ADAR Front Desk -- drives both the
 * on-screen UI strings (see i18n.ts) and the BCP-47 code passed to guest
 * STT/TTS (see useVoiceChat.ts). Persisted per-device so a returning
 * customer doesn't have to re-pick it every launch.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(DEFAULT_LANG);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(LANG_KEY)
      .then((value) => {
        if (!cancelled && value && SUPPORTED_LANGUAGES.some((l) => l.code === value)) {
          setLangState(value as LangCode);
        }
      })
      .catch(() => {
        // default (English) is a safe fallback
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = useCallback((next: LangCode) => {
    setLangState(next);
    SecureStore.setItemAsync(LANG_KEY, next).catch(() => {
      // best-effort -- worst case the choice doesn't persist across launches
    });
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, t: (key) => translate(lang, key) }),
    [lang, setLang]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
