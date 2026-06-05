// i18n/request.ts
// next-intl per-request configuration (#1260).
//
// We use next-intl WITHOUT i18n routing - the locale lives in a cookie
// (`poke-memory:locale`) rather than in the URL path. This avoids breaking
// the existing URL structure and lets the locale change without a page
// navigation.
//
// Cookie-based locale is read in `app/layout.tsx` (outside any `'use cache'`
// function), then forwarded into `setRequestLocale(locale)` so that
// `useTranslations` resolves correctly throughout the React tree for that
// request. Cached subtrees receive the locale as an explicit argument.
//
// IMPORTANT: this file imports `next/headers` (server-only). Client components
// must import locale constants from `i18n/locales.ts` instead.

import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import {
  SUPPORTED_LOCALES,
  LOCALE_COOKIE,
  DEFAULT_LOCALE,
  type AppLocale,
} from "./locales";

// Re-export constants so callers that specifically need the server module
// can still access them here.
export { SUPPORTED_LOCALES, LOCALE_COOKIE, DEFAULT_LOCALE };
export type { AppLocale };

/**
 * Resolve the request locale from the cookie, falling back to `DEFAULT_LOCALE`.
 * Reads from the Next.js `cookies()` store - must be called outside
 * `'use cache'` functions. Returns a Promise because `cookies()` is async
 * in Next.js 16.
 */
export async function resolveLocale(): Promise<AppLocale> {
  // In some server-action contexts `cookies()` may throw; guard with try/catch.
  try {
    const jar = await cookies();
    const value = jar.get(LOCALE_COOKIE)?.value;
    if (value && (SUPPORTED_LOCALES as readonly string[]).includes(value)) {
      return value as AppLocale;
    }
  } catch {
    // Non-fatal - fall back to default.
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages = (await import(`../messages/${locale}.json`)) as {
    default: Record<string, unknown>;
  };

  return {
    locale,
    messages: messages.default,
  };
});
