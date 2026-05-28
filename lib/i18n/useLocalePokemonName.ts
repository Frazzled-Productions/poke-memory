"use client";
// lib/i18n/useLocalePokemonName.ts
// Hook for resolving a Pokémon's locale-appropriate display name (#1260).
//
// Returns the English name immediately (synchronously from props), then
// replaces it with the locale-appropriate name once the locale-names sidecar
// has loaded. Falls back to the English name if the sidecar is unavailable or
// if the languages Labs flag is off.
//
// Transliteration (rōmaji for ja, pinyin for zh-Hans/zh-Hant) is always shown
// when locale !== en. No extra toggle — it is a learning aid for non-Latin
// scripts and its presence is the value proposition of enabling the flag.

import { useEffect, useState } from "react";
import { loadLocaleNames, getLocaleName, getTransliteration } from "@/lib/pokemon/localeNames";
import { isLabsFlagEnabled } from "@/lib/labs/flags";
import { loadSettings } from "@/lib/settings/persistence";
import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/locales";
import { useAppLocale } from "./useAppLocale";
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
 * Resolves the locale-appropriate display name for a Pokémon species.
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
  const locale = useAppLocale();
  const [localeName, setLocaleName] = useState<LocalePokemonName>({
    name: englishName,
    transliteration: null,
  });

  useEffect(() => {
    // If no speciesId, or locale is English, or labs flag is off — use English.
    const settings = loadSettings();
    const flagOn = isLabsFlagEnabled(settings.labsFlags, "languages");
    if (!speciesId || locale === DEFAULT_LOCALE || !flagOn) {
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
