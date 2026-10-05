/** The languages the Menu Assistant's voice + multilingual reply features
 *  support, end to end: AI reply language (backend's services/language.py
 *  -- see routes/chat.py's `response_language` field, passed through
 *  eatsApi.ts's streamRestaurantChat), voice input (Gemini/Google Speech
 *  transcription in routes/voice.py, which takes a free-text "expected
 *  spoken language" hint), and voice output (expo-speech's on-device TTS
 *  for most languages, server-side Google TTS for Bengali -- see
 *  ListenButton.tsx). Mirrors apps/docintel/src/i18n/languages.ts, which
 *  is where this same backend infrastructure was first wired up on
 *  mobile -- keep the two lists in sync; `code` is the 2-letter code
 *  used on the backend side (services/language.py's LANGUAGE_NAMES). */
export type LanguageCode = 'en' | 'es' | 'hi' | 'bn' | 'fr';

export interface LanguageMeta {
  code: LanguageCode;
  /** English name, for the picker's accessibility label. */
  englishName: string;
  /** The language's own name for itself, shown in the picker. */
  nativeName: string;
  /** Sent to routes/voice.py's /transcribe as a plain-language hint. */
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

export function languageMeta(code: LanguageCode | string): LanguageMeta {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) || SUPPORTED_LANGUAGES[0];
}

// Route through the backend's server-side Google Cloud TTS (routes/
// voice.py's /speak) for every language it already has a voice mapped
// for (TTS_VOICE_BY_LANGUAGE) -- the SAME voices adar-core's Geetabitan
// /api/tts, ADAR Front Desk /api/demo/tts, and the telephony Conversation
// Assistant already use, most notably the explicitly male
// en-US-Chirp3-HD-Fenrir / bn-IN-Chirp3-HD-Fenrir voices, rather than
// whatever generic (and possibly differently-gendered) voice the
// on-device OS happens to pick for expo-speech. French is the one
// exception: the backend has no voice mapped for it yet, so it still
// falls back to on-device TTS below rather than mis-rendering French
// text through a fallback English voice.
export const SERVER_TTS_LANGUAGES: ReadonlySet<LanguageCode> = new Set(['en', 'es', 'hi', 'bn']);
