import type { ReviewableCard } from "@/lib/review/session";
import { generationOf } from "@/lib/stats/derive";
import { SEED_POKEMON } from "@/lib/pokemon/seed";

export type PracticeScopePreset = "starters" | "legendaries";

export type PracticeScope = {
  /** Empty array == all generations included. */
  gens: number[];
  /** Empty array == all types included. */
  types: string[];
  /** Preset groups OR'd onto the gen/type filters. */
  presets: PracticeScopePreset[];
};

export const EMPTY_SCOPE: PracticeScope = { gens: [], types: [], presets: [] };

const STORAGE_KEY = "poke-memory:practice-scope:v1";

const STARTER_IDS: ReadonlySet<number> = new Set([
  1, 4, 7,
  152, 155, 158,
  252, 255, 258,
  387, 390, 393,
  495, 498, 501,
  650, 653, 656,
  722, 725, 728,
  810, 813, 816,
  906, 909, 912,
]);

/** Cards in the SEED set tagged `isLegendary` (excludes mythicals by design). */
function legendaryIds(): ReadonlySet<number> {
  return new Set(SEED_POKEMON.filter((p) => p.isLegendary).map((p) => p.id));
}

let _legendaryIds: ReadonlySet<number> | null = null;
function getLegendaryIds(): ReadonlySet<number> {
  if (_legendaryIds === null) _legendaryIds = legendaryIds();
  return _legendaryIds;
}

export function isScopeEmpty(scope: PracticeScope): boolean {
  return scope.gens.length === 0 && scope.types.length === 0 && scope.presets.length === 0;
}

/**
 * True if the card matches the active scope. Empty scope matches every
 * card (the practice page's default). Filter shape:
 *
 *   gens  – ANY-OF semantics (intersection across categories).
 *   types – ANY-OF semantics across the card's types[].
 *   presets – OR'd with gens/types (a card in any active preset passes).
 *
 * A card passes when at least one of (gen match, type match, preset
 * match) is true. Within each, an empty filter is interpreted as
 * "include nothing from this category" — so an empty scope short-circuits
 * upstream and never reaches this function.
 */
export function cardMatchesScope(card: ReviewableCard, scope: PracticeScope): boolean {
  if (isScopeEmpty(scope)) return true;
  const pokemonId = card.cardType === "evolution" ? card.pokemonId : card.id;
  // Generation match
  if (scope.gens.length > 0) {
    const gen = generationOf(pokemonId);
    if (scope.gens.includes(gen)) return true;
  }
  // Type match
  if (scope.types.length > 0 && card.cardType !== "evolution") {
    if (card.types.some((t) => scope.types.includes(t))) return true;
  }
  // Preset match
  if (scope.presets.includes("starters") && STARTER_IDS.has(pokemonId)) return true;
  if (scope.presets.includes("legendaries") && getLegendaryIds().has(pokemonId)) return true;
  return false;
}

export function loadScope(): PracticeScope {
  if (typeof window === "undefined") return EMPTY_SCOPE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_SCOPE;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return EMPTY_SCOPE;
    const obj = parsed as Record<string, unknown>;
    const gens = Array.isArray(obj.gens) ? (obj.gens as unknown[]).filter((v): v is number => typeof v === "number") : [];
    const types = Array.isArray(obj.types) ? (obj.types as unknown[]).filter((v): v is string => typeof v === "string") : [];
    const presets = Array.isArray(obj.presets)
      ? (obj.presets as unknown[]).filter((v): v is PracticeScopePreset => v === "starters" || v === "legendaries")
      : [];
    return { gens, types, presets };
  } catch {
    return EMPTY_SCOPE;
  }
}

export function saveScope(scope: PracticeScope): void {
  if (typeof window === "undefined") return;
  try {
    if (isScopeEmpty(scope)) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
    }
  } catch {
    // ignore quota / serialisation errors — scope is non-critical
  }
}

/** Human label for the chip / aria-label, e.g. "Gen 1 · Fire · Starters". */
export function scopeLabel(scope: PracticeScope): string {
  if (isScopeEmpty(scope)) return "All Pokémon";
  const parts: string[] = [];
  if (scope.gens.length > 0) parts.push(scope.gens.map((g) => `Gen ${g}`).join(", "));
  if (scope.types.length > 0) {
    parts.push(
      scope.types.map((t) => t[0].toUpperCase() + t.slice(1)).join(", "),
    );
  }
  if (scope.presets.includes("starters")) parts.push("Starters");
  if (scope.presets.includes("legendaries")) parts.push("Legendaries");
  return parts.join(" · ");
}
