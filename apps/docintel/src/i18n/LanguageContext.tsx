import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_LANGUAGE, LanguageCode, LanguageMeta, SUPPORTED_LANGUAGES, languageMeta } from './languages';
import { TRANSLATIONS, TranslationKey } from './translations';

const STORAGE_KEY = 'docintel_language';

interface LanguageContextValue {
  language: LanguageCode;
  meta: LanguageMeta;
  languages: LanguageMeta[];
  setLanguage: (code: LanguageCode) => void;
  /** Looks up `key` in the active language, falling back to English if a
   *  translation is somehow missing, and substitutes any `{name}`
   *  placeholders from `vars`. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/** Device-local, not tied to the signed-in account -- this is a per-device
 *  preference (SecureStore, same mechanism shared-auth's storage.ts uses
 *  for the session), so it works before login too and survives sign-out.
 *  Deliberately its own provider rather than living in shared-auth: the
 *  other three mobile apps (arcl/frontdesk/geetabitan) don't need this. */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(DEFAULT_LANGUAGE);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(STORAGE_KEY).then((saved) => {
      if (cancelled || !saved) return;
      if (SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
        setLanguageState(saved as LanguageCode);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const setLanguage = useCallback((code: LanguageCode) => {
    setLanguageState(code);
    SecureStore.setItemAsync(STORAGE_KEY, code).catch(() => {
      // Best-effort persistence -- worst case the choice doesn't survive
      // an app restart, which isn't worth failing the selection itself over.
    });
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      let value = TRANSLATIONS[language][key] ?? TRANSLATIONS[DEFAULT_LANGUAGE][key] ?? key;
      if (vars) {
        for (const [name, val] of Object.entries(vars)) {
          value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(val));
        }
      }
      return value;
    },
    [language]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, meta: languageMeta(language), languages: SUPPORTED_LANGUAGES, setLanguage, t }),
    [language, setLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}

/** Convenience for a count-dependent key pair (`{base}_one` / `{base}_other`). */
export function useCountKey() {
  const { t } = useLanguage();
  return (base: string, count: number, vars?: Record<string, string | number>) =>
    t(`${base}_${count === 1 ? 'one' : 'other'}` as TranslationKey, { count, ...vars });
}
