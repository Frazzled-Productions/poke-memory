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
// It is read from `UserSettings.pokemonNameLocale` (localStorage) via
// `PokemonLocaleContext` rather than calling `loadSettings()` directly. This
// means all N call sites on a page share one subscription instead of N — the
// structural fix for the hydration timeout on WebKit CI (#1329).

import { useEffect, useState } from "react";
import { loadLocaleNames, getLocaleName, getTransliteration } from "@/lib/pokemon/localeNames";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { usePokemonLocaleContext } from "@/lib/i18n/PokemonLocaleContext";
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
 * The locale is read from `PokemonLocaleContext`, which consolidates the
 * `pokemonNameLocale` setting subscription into a single provider for the
 * whole tree.  Each call site costs one `useContext` read per render rather
 * than one `loadSettings()` call + two event-listener registrations.
 *
 * The hook's external API is unchanged — existing call sites continue to work
 * without modification.
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
  // O(1) context read — the subscription is owned by PokemonLocaleProvider.
  const { locale } = usePokemonLocaleContext();

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
      const name = getLocaleName(speciesId, locale) ?? englishName;
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
