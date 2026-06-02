"use client";

/**
 * `useProfileStatus` — shared, read-only hook producing the three glanceable
 * profile signals for any surface, per the single-source-of-truth convention.
 *
 * Returns `{ streak, tokenBalance, masteryCount, totalSpecies, masteryPercent }`.
 * All values are `null` until after first client render to avoid SSR hydration
 * mismatches (mirrors the `useStreakNavState` pattern).
 *
 * Composes:
 *   - `useStreakNavState()` for `streak` and `tokenBalance` — does NOT re-read
 *     streak/token storage directly.
 *   - The `KEY_MASTERED_COUNT_BY_LOCALE` localStorage cache (written by
 *     `ReviewSession`) for `masteryCount` — avoids a full ~1025-card parse on
 *     non-Stats routes (#1234 perf concern).
 *   - `SEED_POKEMON.length` for `totalSpecies` (locale-independent seed count).
 *
 * Mastery is locale-scoped per #1259: the count is keyed by the user's current
 * `pokemonNameLocale` setting.
 *
 * Honours `useSuperuser().flags.pretendAllMastered`: when on, `masteryCount`
 * resolves to `totalSpecies` (100%).
 *
 * Owner: data-coder. Part 1/3 of the profile status bar (#1489).
 */

import { useEffect, useState } from "react";
import { useStreakNavState } from "@/lib/streak/useStreakNavState";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { readMasteredCountCache } from "@/lib/profile/masteredCountCache";
import { KEY_MASTERED_COUNT_BY_LOCALE } from "@/lib/storage/keys";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Shape returned by `useProfileStatus`. All values are `null` until after the
 * first client render (hydration-safe, mirrors `useStreakNavState`).
 */
export type ProfileStatus = {
  /** Current streak in days. `null` = not yet loaded. */
  streak: number | null;
  /** Token balance (0..3). `null` = not yet loaded. */
  tokenBalance: number | null;
  /**
   * Number of mastered species for the current `pokemonNameLocale`.
   * Drawn from the lightweight cache — NOT a full card-array parse.
   * `null` = not yet loaded.
   */
  masteryCount: number | null;
  /**
   * Total species in the seed (locale-independent). Always the same value
   * once loaded (`SEED_POKEMON.length`).
   * `null` = not yet loaded.
   */
  totalSpecies: number | null;
  /**
   * Mastery as a 0–100 percentage, rounded to one decimal place.
   * `null` when either `masteryCount` or `totalSpecies` is `null`, or when
   * `totalSpecies` is 0.
   */
  masteryPercent: number | null;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Read-only hook returning the three glanceable profile signals.
 *
 * Re-reads on:
 *   - `STREAK_UPDATED_EVENT` and `SETTINGS_SAVED_EVENT` (via `useStreakNavState`)
 *   - `storage` events for `KEY_MASTERED_COUNT_BY_LOCALE` (written by
 *     `ReviewSession` via `writeMasteredCountForLocale`)
 *   - `SETTINGS_SAVED_EVENT` (to pick up a locale change)
 */
export function useProfileStatus(): ProfileStatus {
  const streakState = useStreakNavState();
  const { flags } = useSuperuser();

  const [masteryState, setMasteryState] = useState<{
    masteryCount: number | null;
    totalSpecies: number | null;
    masteryPercent: number | null;
  }>({
    masteryCount: null,
    totalSpecies: null,
    masteryPercent: null,
  });

  useEffect(() => {
    const total = SEED_POKEMON.length;

    function refreshMastery() {
      if (flags.pretendAllMastered) {
        setMasteryState({
          masteryCount: total,
          totalSpecies: total,
          masteryPercent: 100,
        });
        return;
      }

      const settings = loadSettings();
      // Use activePokemonNameLocale first (set by the language switcher on
      // language-switch), falling back to pokemonNameLocale (the back-compat
      // alias), then "en". Mirrors the PokemonLocaleContext fallback chain
      // so the mastery count always reflects the currently-active language.
      const locale = settings.activePokemonNameLocale ?? settings.pokemonNameLocale ?? "en";
      const cache = readMasteredCountCache();
      const count = cache[locale];
      const percent =
        total > 0
          ? Math.round((count / total) * 1000) / 10
          : 0;

      setMasteryState({
        masteryCount: count,
        totalSpecies: total,
        masteryPercent: percent,
      });
    }

    refreshMastery();

    // Re-read when the mastered-count cache is updated (ReviewSession writes
    // this via writeMasteredCountForLocale after each mastery change).
    function handleStorage(e: StorageEvent) {
      if (e.key === KEY_MASTERED_COUNT_BY_LOCALE) {
        refreshMastery();
      }
    }

    // Re-read when settings change (pokemonNameLocale may have changed).
    function handleSettingsSaved() {
      refreshMastery();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(SETTINGS_SAVED_EVENT, handleSettingsSaved);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(SETTINGS_SAVED_EVENT, handleSettingsSaved);
    };
  }, [flags.pretendAllMastered]);

  return {
    streak: streakState.streak,
    tokenBalance: streakState.tokenBalance,
    ...masteryState,
  };
}
