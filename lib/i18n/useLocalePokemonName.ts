"use client";
// lib/i18n/useLocalePokemonName.ts
// Hook for resolving a Pokémon's locale-appropriate display name (#1260).
//
// Returns the English name immediately (synchronously from props), then
// replaces it with the locale-appropriate name once the locale-names sidecar
// has loaded. Falls back to the English name if the sidecar is unavailable or
// if the languages Labs flag is off.
//
// The Pokémon-name locale is independent of the app UI locale (#1260 follow-up).
// It is read from `UserSettings.pokemonNameLocale` (localStorage) rather than
// from the `poke-memory:locale` cookie, which drives only the app UI language.
//
// Transliteration (rōmaji for ja, pinyin for zh-Hans/zh-Hant) is always shown
// when locale !== en. No extra toggle — it is a learning aid for non-Latin
// scripts and its presence is the value proposition of enabling the flag.

import { useEffect, useState } from "react";
import { loadLocaleNames, getLocaleName, getTransliteration } from "@/lib/pokemon/localeNames";
import { isLabsFlagEnabled } from "@/lib/labs/flags";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/locales";
import type { TransliterationLocale } from "@/lib/pokemon/seed";

export type LocalePokemonName = {
  /** The primary display name in the active locale. */
  name: string;
  /**
   * Transliteration in Latin script, or null when not applicable (en locale or
   * not yet loaded).
   */
  transliteration: string | null;
};

/**
 * Reads the Pokémon-name locale from settings and keeps it in sync with same-
 * tab `saveSettings` calls (via `SETTINGS_SAVED_EVENT`) and other-tab writes
 * (via the `storage` event).
 */
function readPokemonNameLocale(): AppLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const settings = loadSettings();
  const flagOn = isLabsFlagEnabled(settings.labsFlags, "languages");
  if (!flagOn) return DEFAULT_LOCALE;
  return settings.pokemonNameLocale ?? DEFAULT_LOCALE;
}

/**
 * Resolves the locale-appropriate display name for a Pokémon species.
 *
 * The locale is read from `UserSettings.pokemonNameLocale`, which is
 * independent of the app UI locale cookie. This means a user can keep the
 * app UI in English while practising Pokémon names in Japanese (or vice
 * versa).
 *
 * @param speciesId  PokéAPI species ID (matches SeedPokemon.speciesId).
 * @param englishName  The English name — used immediately and as a fallback.
 *
 * Returns synchronously on first render (English name, no transliteration),
 * then updates once the locale-names sidecar resolves.
 */
export function useLocalePokemonName(
  speciesId: number | undefined,
  englishName: string,
): LocalePokemonName {
  const [locale, setLocale] = useState<AppLocale>(readPokemonNameLocale);

  // Keep locale in sync: same-tab saveSettings fires SETTINGS_SAVED_EVENT,
  // other-tab writes fire the storage event.
  useEffect(() => {
    function handleChange() {
      setLocale(readPokemonNameLocale());
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, handleChange);
    window.addEventListener("storage", handleChange);
    // Re-read on mount in case settings changed between SSR and hydration.
    setLocale(readPokemonNameLocale());
    return () => {
      window.removeEventListener(SETTINGS_SAVED_EVENT, handleChange);
      window.removeEventListener("storage", handleChange);
    };
  }, []);

  const [localeName, setLocaleName] = useState<LocalePokemonName>({
    name: englishName,
    transliteration: null,
  });

  useEffect(() => {
    if (!speciesId || locale === DEFAULT_LOCALE) {
      setLocaleName({ name: englishName, transliteration: null });
      return;
    }

    let cancelled = false;
    void loadLocaleNames().then(() => {
      if (cancelled) return;
      const name = getLocaleName(speciesId, locale as AppLocale) ?? englishName;
      const transliteration =
        locale !== "en"
          ? (getTransliteration(speciesId, locale as TransliterationLocale) ?? null)
          : null;
      setLocaleName({ name, transliteration });
    });

    return () => {
      cancelled = true;
    };
  }, [speciesId, englishName, locale]);

  return localeName;
}
