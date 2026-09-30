/** The 5 languages Knowledge Academy (and the rest of DocIntel) supports,
 *  end to end: AI Tutor/Chat/Study Tools responses (backend's
 *  services/language.py -- see chat.py's `response_language` field),
 *  voice input (Gemini-based transcription in routes/voice.py, which
 *  takes a free-text "expected spoken language" hint), and voice output
 *  (expo-speech's on-device TTS, which wants a BCP-47 locale). `code` is
 *  the 2-letter code used everywhere on the backend side; keep it in sync
 *  with services/language.py's LANGUAGE_NAMES on the adar-rag repo. */
export type LanguageCode = 'en' | 'es' | 'hi' | 'bn' | 'fr';

export interface LanguageMeta {
  code: LanguageCode;
  /** English name, for anywhere this needs to show up in an English UI. */
  englishName: string;
  /** The language's own name for itself, shown in the picker. */
  nativeName: string;
  /** Sent to routes/voice.py's /transcribe as a plain-language hint --
   *  Gemini-based transcription understands a language name directly,
   *  no need for a locale-code lookup table on that side. */
  sttHint: string;
  /** BCP-47 locale expo-speech's Speech.speak() expects for `language`. */
  ttsLocale: string;
}

export const SUPPORTED_LANGUAGES: LanguageMeta[] = [
  { code: 'en', englishName: 'English', nativeName: 'English', sttHint: 'English', ttsLocale: 'en-US' },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', sttHint: 'Spanish', ttsLocale: 'es-ES' },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', sttHint: 'Hindi', ttsLocale: 'hi-IN' },
  { code: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', sttHint: 'Bengali', ttsLocale: 'bn-IN' },
  { code: 'fr', englishName: 'French', nativeName: 'Français', sttHint: 'French', ttsLocale: 'fr-FR' },
];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function languageMeta(code: LanguageCode): LanguageMeta {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) || SUPPORTED_LANGUAGES[0];
}
