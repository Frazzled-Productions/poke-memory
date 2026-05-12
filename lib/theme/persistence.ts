import { CURATED_POKEMON } from "./curated-pokemon";
import type { CuratedPokemon } from "./curated-pokemon";
import {
  loadSettings,
  saveSettings,
  type StoredFavouriteTheme,
} from "@/lib/settings/persistence";

// Legacy localStorage key. The favourite theme used to live here standalone;
// since #307 the canonical store is `user_settings.settings.favouriteTheme`
// so it syncs to the cloud alongside other settings. `loadFavourite` runs a
// one-time migration that copies any pre-existing legacy value into settings
// and removes the legacy key.
const LEGACY_STORAGE_KEY = "poke-memory:favourite:v1";
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export type StoredFavourite = StoredFavouriteTheme;

// Validate a raw shape against the StoredFavourite schema. Returns the
// validated object (with the canonical name from CURATED_POKEMON) or null if
// validation fails. Pure — takes a value, returns a value. Used for both
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
  const needsRemoteMigration =
    rawSpriteUrl !== null && rawSpriteUrl.startsWith("https://raw.githubusercontent.com");
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
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw !== null) {
        try {
          favourite = validateRawFavourite(JSON.parse(raw));
        } catch {
          favourite = null;
        }
        if (favourite !== null) {
          saveSettings({ ...settings, favouriteTheme: favourite });
        }
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
    // private browsing or storage full — silently ignore
  }
}
