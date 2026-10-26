import { CURATED_POKEMON } from "./curated-pokemon";
import type { StoredFavouriteTheme } from "@/lib/settings/persistence";
import { isSpeciesId } from "@/lib/pokemon/seed-constants";

// Structural validation of a stored theme, kept apart from
// lib/theme/persistence.ts so the settings parser can use it for the
// favourite carry-over (#2187) without an import cycle.

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

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
// validated object or null if validation fails. Any species id in the seed is
// accepted (#2187); a curated species gets its canonical name from
// CURATED_POKEMON, any other keeps its stored (English seed) name. The stored
// colours are only checked for shape here: the colours applied come from
// `paletteFor` (FavouriteThemeProvider), so palette fixes reach old picks.
// Pure - takes a value, returns a value. Used for both the cloud-pulled shape
// (loadSettings().favouriteTheme) and the legacy localStorage shape during
// one-time migration.
export function validateRawFavourite(value: unknown): StoredFavouriteTheme | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (!isSpeciesId(obj.id)) return null;
  const curated = CURATED_POKEMON.find((p) => p.id === obj.id);
  const name = curated?.name ?? (typeof obj.name === "string" ? obj.name : "");
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
    name,
    colors: {
      primary: c.primary,
      secondary: c.secondary,
      accent: c.accent,
      fgOnPrimary: c.fgOnPrimary,
    },
    spriteUrl,
  };
}
