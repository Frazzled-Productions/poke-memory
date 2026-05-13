import type { ReviewableCard } from "@/lib/review/session";
import { generationOf } from "@/lib/stats/derive";
import { SEED_POKEMON, type SeedPokemon } from "@/lib/pokemon/seed";

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

/**
 * Pre-#333 storage key. The scope is now folded into `UserSettings` and
 * synced with the rest of settings via Supabase. The legacy key is read
 * once by `loadSettings` on first run after deploy and then cleared — see
 * `readLegacyScope` / `clearLegacyScope` below.
 */
const LEGACY_SCOPE_KEY = "poke-memory:practice-scope:v1";

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
 * Shared core: does a species (identified by `id` + `types`) pass the
 * active non-empty scope? Used by both `cardMatchesScope` (name-card path)
 * and `countMatchingSpecies` so the two cannot drift.
 *
 *   gens    – ANY-OF semantics; passes if `generationOf(id)` is listed.
 *   types   – ANY-OF semantics; passes if any of the species' types is listed.
 *   presets – OR'd with gens/types; passes if the species id is in any
 *             active preset's id set.
 *
 * Within the scope, the categories are OR'd: passing any active category
 * passes the species. Within each category, an empty list is "no
 * contribution to the OR" (does not match anything).
 *
 * Empty scope is handled by callers — this function is only reached for
 * non-empty scopes.
 */
function speciesMatchesScope(
  speciesId: number,
  speciesTypes: readonly string[],
  scope: PracticeScope,
): boolean {
  if (scope.gens.length > 0) {
    const gen = generationOf(speciesId);
    if (scope.gens.includes(gen)) return true;
  }
  if (scope.types.length > 0) {
    if (speciesTypes.some((t) => scope.types.includes(t))) return true;
  }
  if (scope.presets.includes("starters") && STARTER_IDS.has(speciesId)) return true;
  if (scope.presets.includes("legendaries") && getLegendaryIds().has(speciesId)) return true;
  return false;
}

/**
 * True if the card matches the active scope. Empty scope matches every
 * card (the practice page's default).
 *
 * Evolution cards lack a `types[]` field (they prompt for the next-stage
 * sprite, not the parent species' typing), so the type-axis path is
 * skipped for them — gens and presets still apply.
 */
export function cardMatchesScope(card: ReviewableCard, scope: PracticeScope): boolean {
  if (isScopeEmpty(scope)) return true;
  // Evolution edge cards filter on the pre-evo's species ID (the card is
  // "about" the pre-evolution — Bulbasaur → Ivysaur is a Gen 1 / Starters card
  // because of Bulbasaur, not Ivysaur). Other card types use their own id.
  const pokemonId = card.cardType === "evolution" ? card.preEvoId : card.id;
  // Evolution cards don't carry the parent species' `types[]` on the
  // card itself; downgrade to an effectively-empty types array so the
  // type axis is a no-op for them. Other card types use their own types.
  const types: readonly string[] =
    card.cardType === "evolution" ? [] : card.types;
  return speciesMatchesScope(pokemonId, types, scope);
}

/**
 * Count species in the seed pool that match the active scope. Returns
 * `seed.length` for the empty scope (the practice page's default).
 *
 * Drives the UI's live "X of N match" count beneath `ScopeControl`.
 * Distinct from `cardMatchesScope` because the caller has a `SeedPokemon`,
 * not a `ReviewableCard` — the underlying matching logic is shared via
 * the private `speciesMatchesScope` helper to keep them from drifting.
 */
export function countMatchingSpecies(
  seed: readonly SeedPokemon[],
  scope: PracticeScope,
): number {
  if (isScopeEmpty(scope)) return seed.length;
  let count = 0;
  for (const s of seed) {
    if (speciesMatchesScope(s.id, s.types, scope)) count += 1;
  }
  return count;
}

/**
 * Internal: shape-validate a raw parsed JSON value into a PracticeScope.
 * Permissive on individual entries — bad members are filtered out rather
 * than dropping the whole payload. Returns null on a non-object payload.
 *
 * NOTE: `lib/settings/persistence.ts#validatePracticeScope` is the strict
 * settings-level validator (rejects out-of-range gens, requires all
 * three array fields). This loose parser exists for the legacy
 * localStorage migration and the deprecated `loadScope` shim, both of
 * which need to recover whatever they can from a partial payload.
 */
function parseScopeShape(value: unknown): PracticeScope | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const gens = Array.isArray(obj.gens)
    ? (obj.gens as unknown[]).filter((v): v is number => typeof v === "number")
    : [];
  const types = Array.isArray(obj.types)
    ? (obj.types as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const presets = Array.isArray(obj.presets)
    ? (obj.presets as unknown[]).filter(
        (v): v is PracticeScopePreset => v === "starters" || v === "legendaries",
      )
    : [];
  return { gens, types, presets };
}

/**
 * Read the legacy practice-scope key. Returns `null` when the key is
 * absent, malformed, or the runtime has no window/localStorage (SSR).
 *
 * Does NOT delete the key on read — callers stage the read-then-clear
 * sequence so we never lose data on a transient failure between the two
 * steps. `loadSettings` is the canonical caller (#333).
 */
export function readLegacyScope(): PracticeScope | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(LEGACY_SCOPE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return parseScopeShape(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * Remove the legacy practice-scope key. Idempotent and safe to call when
 * the key is absent. No-op on the server.
 */
export function clearLegacyScope(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_SCOPE_KEY);
  } catch {
    // ignore — scope is non-critical
  }
}

/**
 * @deprecated reads the legacy localStorage key directly. New callers
 * should use the settings hooks (`useSettings`) which surface
 * `practiceScope` from `UserSettings`. Retained as a transitional shim
 * for the existing `components/review/ReviewSession.tsx` callsite until
 * the UI agent moves it onto the settings hook (#333).
 */
export function loadScope(): PracticeScope {
  return readLegacyScope() ?? EMPTY_SCOPE;
}

/**
 * @deprecated writes the legacy localStorage key directly. New callers
 * should use the settings hooks (`useSettings`) — `practiceScope` lives
 * inside `UserSettings` and rides the existing settings JSONB sync.
 * Retained as a transitional shim (#333).
 */
export function saveScope(scope: PracticeScope): void {
  if (typeof window === "undefined") return;
  try {
    if (isScopeEmpty(scope)) {
      window.localStorage.removeItem(LEGACY_SCOPE_KEY);
    } else {
      window.localStorage.setItem(LEGACY_SCOPE_KEY, JSON.stringify(scope));
    }
  } catch {
    // ignore quota / serialisation errors — scope is non-critical
  }
}

const ROMAN_NUMERALS: Record<number, string> = {
  1: "I", 2: "II", 3: "III", 4: "IV", 5: "V",
  6: "VI", 7: "VII", 8: "VIII", 9: "IX",
};

/** Human label for the chip / aria-label, e.g. "Gen I · Fire · Starters". */
export function scopeLabel(scope: PracticeScope): string {
  if (isScopeEmpty(scope)) return "All Pokémon";
  const parts: string[] = [];
  if (scope.gens.length > 0) {
    parts.push("Gen " + scope.gens.map((g) => ROMAN_NUMERALS[g] ?? String(g)).join(", "));
  }
  if (scope.types.length > 0) {
    parts.push(
      scope.types.map((t) => t[0].toUpperCase() + t.slice(1)).join(", "),
    );
  }
  if (scope.presets.includes("starters")) parts.push("Starters");
  if (scope.presets.includes("legendaries")) parts.push("Legendaries");
  return parts.join(" · ");
}
