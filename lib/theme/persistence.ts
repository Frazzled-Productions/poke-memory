import type { CuratedPokemon, ThemeColors } from "./curated-pokemon";

const STORAGE_KEY = "poke-memory:favourite:v1";

export type StoredFavourite = {
  id: number;
  colors: ThemeColors;
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
    return {
      id: obj.id,
      colors: {
        primary: c.primary,
        secondary: c.secondary,
        accent: c.accent,
        fgOnPrimary: c.fgOnPrimary,
      },
    };
  } catch {
    return null;
  }
}

export function saveFavourite(entry: CuratedPokemon | null): void {
  if (typeof window === "undefined") return;
  try {
    if (entry === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ id: entry.id, colors: entry.colors }),
      );
    }
  } catch {
    // private browsing or storage full — silently ignore
  }
}
