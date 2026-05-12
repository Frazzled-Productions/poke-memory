import { CURATED_POKEMON } from "./curated-pokemon";
import type { CuratedPokemon, ThemeColors } from "./curated-pokemon";

const STORAGE_KEY = "poke-memory:favourite:v1";
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export type StoredFavourite = {
  id: number;
  name: string;
  colors: ThemeColors;
  spriteUrl: string | null;
};

export function loadFavourite(): StoredFavourite | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
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
    const needsMigration =
      rawSpriteUrl !== null && rawSpriteUrl.startsWith("https://raw.githubusercontent.com");
    const spriteUrl = needsMigration ? `/sprites/pokemon/${obj.id}.png` : rawSpriteUrl;
    if (needsMigration) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ id: obj.id, name: curated.name, colors: c, spriteUrl }),
        );
      } catch {
        // private browsing or storage full — best-effort migration
      }
    }
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
    if (entry === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          id: entry.id,
          name: entry.name,
          colors: entry.colors,
          spriteUrl,
        }),
      );
    }
  } catch {
    // private browsing or storage full — silently ignore
  }
}
