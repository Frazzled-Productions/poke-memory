import type { ReviewableCard } from "@/lib/review/session";
import { generationOf } from "@/lib/stats/derive";
import { SEED_POKEMON, type SeedPokemon } from "@/lib/pokemon/seed";
import type { FormCategory } from "@/lib/pokemon/forms";

export type PracticeScopePreset = "starters" | "legendaries";

/**
 * Controls which alternate-form cards surface in practice sessions.
 *
 * - `all`          — default forms + every form category present in the seed.
 * - `default-only` — only base species (isDefaultForm === true). Excludes all
 *                    alternate forms (Alolan Raichu, Rotom appliances, etc.).
 * - `include`      — default forms PLUS an explicit allow-list of categories.
 */
export type FormCategoryFilter =
  | { mode: "all" }
  | { mode: "default-only" }
  | { mode: "include"; categories: FormCategory[] };

export type PracticeScope = {
  /** Empty array == all generations included. */
  gens: number[];
  /** Empty array == all types included. */
  types: string[];
  /** Preset groups OR'd onto the gen/type filters. */
  presets: PracticeScopePreset[];
  /**
   * Alternate-form filter axis. Defaults to `{mode:'all'}` so new users see
   * all seeded forms. Persisted scopes without this field migrate to
   * `{mode:'all'}` on load — existing users see no behaviour change.
   *
   * Optional at the TypeScript level for backwards-compatibility with
   * pre-#450 code that constructs `PracticeScope` literals without the field
   * (e.g. tests, legacy migration paths). All runtime paths treat a missing
   * value as `{mode:'all'}`.
   */
  formCategories?: FormCategoryFilter;
};

export const EMPTY_SCOPE: PracticeScope = {
  gens: [],
  types: [],
  presets: [],
  formCategories: { mode: "all" },
};

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
  return (
    scope.gens.length === 0 &&
    scope.types.length === 0 &&
    scope.presets.length === 0 &&
    (scope.formCategories?.mode ?? "all") === "all"
  );
}

/**
 * Shared core: does a species (identified by `id` + `types`) pass the
 * active non-empty scope? Used by both `cardMatchesScope` (name-card path)
 * and `countMatchingSpecies` so the two cannot drift.
 *
 *   gens           – ANY-OF semantics; passes if `generationOf(id)` is listed.
 *   types          – ANY-OF semantics; passes if any of the species' types is listed.
 *   presets        – OR'd with gens/types; passes if the species id is in any
 *                    active preset's id set.
 *   formCategories – evaluated first; returns false immediately when the card's
 *                    form fails the filter, regardless of other axes.
 *
 * Within the scope, the gens/types/presets categories are OR'd: passing any
 * active category passes the species. Within each category, an empty list is
 * "no contribution to the OR" (does not match anything).
 *
 * Empty scope is handled by callers — this function is only reached for
 * non-empty scopes.
 *
 * @param isDefaultForm  Whether this is the primary form of its species.
 *   Defaults to `true` (safe fallback for seeds that pre-date #445).
 * @param formCategory   The broad category of the form. Defaults to `"default"`.
 */
function speciesMatchesScope(
  speciesId: number,
  speciesTypes: readonly string[],
  scope: PracticeScope,
  isDefaultForm: boolean = true,
  formCategory: FormCategory = "default",
): boolean {
  // ── formCategories gate (hard filter applied before the OR axes) ───────
  // When mode !== 'all', a form that fails the gate is excluded regardless of
  // the gens/types/presets axes.
  const fc = scope.formCategories ?? { mode: "all" };
  if (fc.mode === "default-only") {
    if (!isDefaultForm) return false;
  } else if (fc.mode === "include") {
    if (!isDefaultForm && !fc.categories.includes(formCategory)) return false;
  }
  // fc.mode === 'all' — passthrough; form is never excluded

  // ── gens / types / presets (OR'd) ──────────────────────────────────────
  // If none of these axes are active, the species passes the scope based on
  // the form gate alone (all other axes are permissive by default).
  const hasActiveAxes =
    scope.gens.length > 0 || scope.types.length > 0 || scope.presets.length > 0;
  if (!hasActiveAxes) return true;

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
 * Evolution cards don't carry their pre-evolution's `types[]` directly on the
 * card, so the type-axis check resolves `card.preEvoId` to the corresponding
 * `SeedPokemon` entry and uses its types. This means a Fire scope includes
 * `Charmander → Charmeleon` because Charmander is Fire, while `Eevee → Flareon`
 * is excluded because Eevee is Normal.
 *
 * For the `formCategories` axis, name/reverse/cry cards carry `isDefaultForm`
 * and `formCategory` directly (spread from SeedPokemon). For evolution cards,
 * form-specific evolution edges are always excluded (#448 is the follow-up) —
 * they are treated as default forms to avoid spurious exclusions while the
 * form-edge feature is in progress.
 *
 * Cards built from a pre-#445 seed (generated.json without `isDefaultForm`)
 * receive safe defaults: `isDefaultForm=true`, `formCategory='default'`.
 */

/** Lazy lookup map from pokemon id to SeedPokemon — built once on first use. */
let _seedById: Map<number, SeedPokemon> | null = null;
function getSeedById(): Map<number, SeedPokemon> {
  if (_seedById === null) _seedById = new Map(SEED_POKEMON.map((p) => [p.id, p]));
  return _seedById;
}

export function cardMatchesScope(card: ReviewableCard, scope: PracticeScope): boolean {
  if (isScopeEmpty(scope)) return true;
  // Evolution edge cards filter on the pre-evo's species ID (the card is
  // "about" the pre-evolution — Bulbasaur → Ivysaur is a Gen 1 / Starters card
  // because of Bulbasaur, not Ivysaur). Reverse-evolution cards use the same
  // pre-evo anchor — the answer-side species. Other card types use their own id.
  //
  // For alternate-form cards (e.g. Alolan Raichu, id=10100), the card's own id
  // is outside the 1-1025 gen range so `generationOf(id)` returns 0. We use
  // `speciesId` instead — the base species ID that maps back into the gen table.
  // This follows the `card.speciesId ?? card.id` pattern from the brief.
  const pokemonId =
    card.cardType === "evolution" || card.cardType === "reverse-evolution"
      ? card.preEvoId
      : (card as { speciesId?: number }).speciesId ?? card.id;
  // Evolution cards (both directions) don't carry the pre-evo's `types[]` on
  // the card itself. Resolve them from the seed so the type axis works: a Fire
  // scope matches Charmander→Charmeleon because Charmander is Fire.
  // Falls back to [] if the preEvoId is missing from the seed (shouldn't happen
  // with a well-formed seed, but defensive guard avoids a runtime crash).
  const types: readonly string[] =
    card.cardType === "evolution" || card.cardType === "reverse-evolution"
      ? (getSeedById().get(card.preEvoId)?.types ?? [])
      : card.types;

  // Resolve form metadata. Name/reverse/cry cards spread SeedPokemon and carry
  // these fields. Evolution cards are treated as default forms (form-specific
  // evolution edges are a follow-up — #448). Fall back to safe defaults for
  // seeds built before #445 where the fields may be absent.
  const isDefaultForm: boolean =
    card.cardType === "evolution" || card.cardType === "reverse-evolution"
      ? true
      : (card as { isDefaultForm?: boolean }).isDefaultForm ?? true;
  const formCategory: FormCategory =
    card.cardType === "evolution" || card.cardType === "reverse-evolution"
      ? "default"
      : (card as { formCategory?: FormCategory }).formCategory ?? "default";

  return speciesMatchesScope(pokemonId, types, scope, isDefaultForm, formCategory);
}

/**
 * Two-tier eligibility check (#658). Returns true when the card should surface
 * in a practice session, applying the master `alternateFormsEnabled` gate
 * **before** the `practiceScope` filter.
 *
 * Gate semantics:
 *   - `alternateFormsEnabled: false` → any form card (`isDefaultForm === false`)
 *     is excluded immediately, regardless of `practiceScope.formCategories`.
 *   - `alternateFormsEnabled: true`  → form cards are eligible; the scope
 *     filter (`cardMatchesScope`) applies as normal.
 *
 * Evolution and reverse-evolution cards are never treated as alternate forms
 * by this gate — they represent the default-form pre-evo identity.
 *
 * Use this function as the single eligibility chokepoint in the session
 * builder / scope-change handler instead of calling `cardMatchesScope` directly
 * when the forms gate setting is available.
 */
export function cardIsEligible(
  card: ReviewableCard,
  scope: PracticeScope,
  alternateFormsEnabled: boolean,
): boolean {
  // Gate: exclude all form cards when the master toggle is off.
  if (!alternateFormsEnabled) {
    if (
      card.cardType !== "evolution" &&
      card.cardType !== "reverse-evolution" &&
      (card as { isDefaultForm?: boolean }).isDefaultForm === false
    ) {
      return false;
    }
  }
  if (isScopeEmpty(scope)) return true;
  return cardMatchesScope(card, scope);
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
    // For alternate-form entries, s.id is outside the 1-1025 gen range.
    // Use speciesId (the base species ID) so the gens axis resolves correctly.
    // Falls back to s.id for pre-#445 seeds where speciesId is absent.
    const resolvedId = (s as { speciesId?: number }).speciesId ?? s.id;
    // isDefaultForm and formCategory may be absent in a pre-#445 seed; fall
    // back to 'true' / 'default' so existing seeds always pass the form gate.
    const isDefaultForm = (s as { isDefaultForm?: boolean }).isDefaultForm ?? true;
    const formCategory = (s as { formCategory?: FormCategory }).formCategory ?? "default";
    if (speciesMatchesScope(resolvedId, s.types, scope, isDefaultForm, formCategory)) count += 1;
  }
  return count;
}

const VALID_FORM_CATEGORIES: readonly FormCategory[] = [
  "default", "regional", "mega", "gmax", "primal", "forme",
];

/**
 * Internal: parse a raw JSON value into a `FormCategoryFilter`.
 * Returns `{mode:'all'}` on absent / malformed input so persisted scopes
 * without this field silently upgrade to the safe default.
 */
export function parseFormCategoryFilter(value: unknown): FormCategoryFilter {
  if (typeof value !== "object" || value === null) return { mode: "all" };
  const obj = value as Record<string, unknown>;
  if (obj.mode === "default-only") return { mode: "default-only" };
  if (obj.mode === "include") {
    const cats = Array.isArray(obj.categories)
      ? (obj.categories as unknown[]).filter(
          (v): v is FormCategory =>
            typeof v === "string" && (VALID_FORM_CATEGORIES as readonly string[]).includes(v),
        )
      : [];
    return { mode: "include", categories: cats };
  }
  return { mode: "all" };
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
  // formCategories: absent in pre-#450 persisted scopes → default to {mode:'all'}.
  const formCategories: FormCategoryFilter = parseFormCategoryFilter(obj.formCategories);
  return { gens, types, presets, formCategories };
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
  const fc = scope.formCategories ?? { mode: "all" };
  if (fc.mode === "default-only") parts.push("Default forms only");
  else if (fc.mode === "include" && fc.categories.length > 0) {
    const catLabels = fc.categories.map(
      (c) => c.charAt(0).toUpperCase() + c.slice(1),
    );
    parts.push(catLabels.join(", ") + " forms");
  }
  return parts.join(" · ");
}
