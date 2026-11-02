import {
  loadSettings,
  saveSettings,
  type StoredFavouriteTheme,
} from "@/lib/settings/persistence";
import { KEY_LEGACY_FAVOURITE_THEME } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { validateRawFavourite } from "./stored-theme";
import { masteredSpeciesIds } from "@/lib/badges/derive";
import type { ReviewableCard } from "@/lib/review/session";
import type { AppLocale } from "@/i18n/locales";

// Legacy localStorage key. The favourite theme used to live here standalone;
// since #307 the canonical store is `user_settings.settings.favouriteTheme`
// so it syncs to the cloud alongside other settings. `loadFavourite` runs a
// one-time migration that copies any pre-existing legacy value into settings
// and removes the legacy key.
const LEGACY_STORAGE_KEY = KEY_LEGACY_FAVOURITE_THEME;

export type StoredFavourite = StoredFavouriteTheme;

export function loadFavourite(): StoredFavourite | null {
  if (typeof window === "undefined") return null;
  try {
    const settings = loadSettings();
    let favourite = validateRawFavourite(settings.favouriteTheme);

    if (favourite === null) {
      // One-time migration from the legacy standalone key. If a user has a
      // saved theme from before #307, copy it into settings and clear the
      // legacy key so subsequent loads come from the canonical source.
      //
      // We check for key presence first so we know whether to attempt
      // removal (avoid a no-op removeItem on every load once migrated).
      const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyRaw !== null) {
        const legacyParsed = readLocalStorage(
          LEGACY_STORAGE_KEY,
          (raw) => validateRawFavourite(JSON.parse(raw) as unknown),
          null,
        );
        if (legacyParsed !== null) {
          favourite = legacyParsed;
          saveSettings({ ...settings, favouriteTheme: favourite });
        }
        // Clear the legacy key regardless of whether it parsed - we've either
        // migrated it or it was corrupt and we don't want to re-attempt.
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          // best-effort
        }
      }
    }

    return favourite;
  } catch {
    return null;
  }
}

/**
 * Build the union of mastered species IDs across all enrolled locales.
 * A species is mastered (BOTH name + reverse legs) in any enrolled locale.
 * This is the shared predicate for the theme picker and isFavouriteEarned (#1865).
 */
export function masteredSpeciesUnion(
  cards: readonly ReviewableCard[],
  forceAllMastered: boolean,
  enrolledLocales: readonly AppLocale[],
): Set<number> {
  const result = new Set<number>();
  for (const locale of enrolledLocales) {
    for (const id of masteredSpeciesIds(cards, forceAllMastered, locale)) {
      result.add(id);
    }
  }
  return result;
}

// Pure. Returns true if there is no favourite, or the favourite's species is
// mastered at species-level (BOTH name + reverse legs) in ANY enrolled locale
// (#1865). Uses masteredSpeciesIds which already encodes the two-leg rule.
// When `forceAllMastered` is true (superuser `pretendAllMastered`), returns
// true immediately without checking cards so the picker always opens.
// Used by the superuser exit-cleanup - a cheat-selected theme is wiped on
// flag-off via this predicate. NOT used for load-time auto-wipe in
// FavouriteThemeProvider (grandfathering decision, #1865): the provider keeps
// an already-applied favourite as-is; only the picker gate tightens.
export function isFavouriteEarned(
  favourite: StoredFavourite | null,
  cards: readonly ReviewableCard[],
  forceAllMastered: boolean,
  enrolledLocales: readonly AppLocale[],
): boolean {
  if (favourite === null) return true;
  if (forceAllMastered) return true;
  const mastered = masteredSpeciesUnion(cards, false, enrolledLocales);
  return mastered.has(favourite.id);
}

// Saves the theme (the colours on screen). Build it with `themeForSpecies`
// (English seed name, `paletteFor` colours), or pass null to remove it.
export function saveFavourite(theme: StoredFavourite | null): void {
  if (typeof window === "undefined") return;
  try {
    const settings = loadSettings();
    saveSettings({ ...settings, favouriteTheme: theme });
  } catch {
    // private browsing or storage full - silently ignore
  }
}
