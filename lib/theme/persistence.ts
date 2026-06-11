import { CURATED_POKEMON } from "./curated-pokemon";
import type { CuratedPokemon } from "./curated-pokemon";
import {
  loadSettings,
  saveSettings,
  type StoredFavouriteTheme,
} from "@/lib/settings/persistence";
import { KEY_LEGACY_FAVOURITE_THEME } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { masteredSpeciesIds } from "@/lib/badges/derive";
import type { ReviewableCard } from "@/lib/review/session";
import type { AppLocale } from "@/i18n/locales";

// Legacy localStorage key. The favourite theme used to live here standalone;
// since #307 the canonical store is `user_settings.settings.favouriteTheme`
// so it syncs to the cloud alongside other settings. `loadFavourite` runs a
// one-time migration that copies any pre-existing legacy value into settings
// and removes the legacy key.
const LEGACY_STORAGE_KEY = KEY_LEGACY_FAVOURITE_THEME;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export type StoredFavourite = StoredFavouriteTheme;

// True when `value` is an absolute https URL whose host is exactly
// raw.githubusercontent.com. Used to detect legacy remote sprite URLs that
// predate self-hosting; an exact host match avoids treating a look-alike host
// (e.g. `raw.githubusercontent.com.evil.example`) as a GitHub URL.
function isRawGithubUserContentUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname === "raw.githubusercontent.com";
}

// Validate a raw shape against the StoredFavourite schema. Returns the
// validated object (with the canonical name from CURATED_POKEMON) or null if
// validation fails. Pure - takes a value, returns a value. Used for both
// the cloud-pulled shape (loadSettings().favouriteTheme) and the legacy
// localStorage shape during one-time migration.
function validateRawFavourite(value: unknown): StoredFavourite | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== "number") return null;
  const curated = CURATED_POKEMON.find((p) => p.id === obj.id);
  if (!curated) return null;
  if (typeof obj.colors !== "object" || obj.colors === null) return null;
  const c = obj.colors as Record<string, unknown>;
  if (
    typeof c.primary !== "string" ||
    typeof c.secondary !== "string" ||
    typeof c.accent !== "string" ||
    typeof c.fgOnPrimary !== "string"
  ) {
    return null;
  }
  if (
    !HEX_COLOR.test(c.primary) ||
    !HEX_COLOR.test(c.secondary) ||
    !HEX_COLOR.test(c.accent) ||
    !HEX_COLOR.test(c.fgOnPrimary)
  ) {
    return null;
  }
  const rawSpriteUrl = typeof obj.spriteUrl === "string" ? obj.spriteUrl : null;
  // Migrate legacy remote sprite URLs stored before sprites were self-hosted.
  // raw.githubusercontent.com is no longer in next.config.ts remotePatterns.
  // Parse and match the host exactly - a substring check would also match a
  // look-alike host like `raw.githubusercontent.com.evil.example`.
  const needsRemoteMigration =
    rawSpriteUrl !== null && isRawGithubUserContentUrl(rawSpriteUrl);
  const spriteUrl = needsRemoteMigration ? `/sprites/pokemon/${obj.id}.png` : rawSpriteUrl;
  return {
    id: obj.id,
    name: curated.name,
    colors: {
      primary: c.primary,
      secondary: c.secondary,
      accent: c.accent,
      fgOnPrimary: c.fgOnPrimary,
    },
    spriteUrl,
  };
}

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

export function saveFavourite(
  entry: CuratedPokemon | null,
  spriteUrl: string | null = null,
): void {
  if (typeof window === "undefined") return;
  try {
    const settings = loadSettings();
    const next: StoredFavourite | null =
      entry === null
        ? null
        : { id: entry.id, name: entry.name, colors: entry.colors, spriteUrl };
    saveSettings({ ...settings, favouriteTheme: next });
  } catch {
    // private browsing or storage full - silently ignore
  }
}
