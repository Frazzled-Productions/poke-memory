// i18n/locales.ts
// Locale constants shared between server and client modules (#1260).
// Kept separate from i18n/request.ts (which imports `next/headers`) so that
// client components can import the constants without pulling in a
// Server-Component-only module.

/** Locale values accepted by the app. */
export const SUPPORTED_LOCALES = ["en", "ja", "zh-Hans", "zh-Hant"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

/** Cookie name used to persist the user's chosen locale. */
export const LOCALE_COOKIE = "poke-memory:locale";

/** Fallback when the cookie is absent or holds an unsupported value. */
export const DEFAULT_LOCALE: AppLocale = "en";

/**
 * Each locale's name written in its own script (endonym).
 * Used in the machine-translation banner and the locale picker in Settings.
 * Centralised here so both surfaces stay in sync automatically.
 */
export const LOCALE_ENDONYMS: Record<AppLocale, string> = {
  en: "English",
  ja: "日本語",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};
