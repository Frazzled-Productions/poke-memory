"use client";
// lib/i18n/useAppLocale.ts
// Client-side hook for reading the active locale (#1260).
//
// Reads from document.cookie so the value is available on the first render
// without a server round-trip. Falls back to "en" when the cookie is absent
// or holds an unsupported value.
//
// This is intentionally a simple cookie read - we do NOT call next-intl's
// `useLocale()` from within Client Components that also load locale-aware
// Pokémon name data, because that would require them to be wrapped in the
// next-intl provider hierarchy. The cookie is the single source of truth.

import { useEffect, useState } from "react";
import { LOCALE_COOKIE, SUPPORTED_LOCALES, DEFAULT_LOCALE, type AppLocale } from "@/i18n/locales";

function readLocaleCookie(): AppLocale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${LOCALE_COOKIE}=`));
  const value = match?.split("=")[1];
  if (value && (SUPPORTED_LOCALES as readonly string[]).includes(value)) {
    return value as AppLocale;
  }
  return DEFAULT_LOCALE;
}

/**
 * Returns the currently-active app locale.
 * Reactive - updates when the cookie changes (e.g. after a locale switch).
 *
 * Note: a locale switch sets the cookie via a Server Action and then calls
 * `router.refresh()`, which causes Next.js to re-render the Server Component
 * tree with the new locale. Client Components will re-mount and this hook
 * will return the updated value from the cookie on the next render.
 */
export function useAppLocale(): AppLocale {
  const [locale, setLocale] = useState<AppLocale>(readLocaleCookie);

  useEffect(() => {
    // Re-read whenever the settings storage event fires (the locale toggle
    // dispatches its own page refresh, but reading on every storage event is
    // harmless and keeps things in sync if multiple tabs are open).
    function handleStorage() {
      setLocale(readLocaleCookie());
    }
    // There is no standard "cookie change" event, but a storage event is fired
    // by `saveSettings` which is how locale-adjacent settings changes flow.
    // The primary update path is `router.refresh()` after the Server Action.
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return locale;
}
