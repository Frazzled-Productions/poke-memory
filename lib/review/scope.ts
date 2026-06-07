import type { ReviewableCard } from "@/lib/review/session";
import { generationOf } from "@/lib/stats/derive";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import type { FormCategory } from "@/lib/pokemon/forms";
import { KEY_LEGACY_PRACTICE_SCOPE } from "@/lib/storage/keys";
import { versionGroupLabel } from "@/lib/pokemon/versionGroupLabels";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { isCardEligible, type CardEligibilitySettings } from "@/lib/eligibility";
import { STARTER_IDS } from "@/lib/pokemon/starterIds";
// Import and re-export lightweight scope constants so server-side routes can
// import them from scopeConstants directly (no seed dependency), while all
// existing callers that import from this module continue to work unchanged.
import {
  EMPTY_SCOPE,
  isScopeEmpty,
  parseFormCategoryFilter,
} from "@/lib/eligibility/scopeConstants";
export { EMPTY_SCOPE, isScopeEmpty, parseFormCategoryFilter };

export type PracticeScopePreset = "starters" | "legendaries" | "incomplete-chains" | "mastery-blockers";

/**
 * Runtime context the scope matcher needs for presets that depend on the
 * user's review progress rather than a static id list.
 *
 * Today only `incomplete-chains` needs this: an "incomplete evolution chain"
 * is a chain the user has started but not finished mastering, so its member
 * species can only be known by inspecting the current card set (see
 * `incompleteChainSpeciesIds` in `lib/evolution/chains.ts`).
 *
 * Callers that do not use a progress-dependent preset can omit the context
 * entirely - `speciesMatchesScope` treats a missing set as empty, so an
 * `incomplete-chains` scope with no context simply matches nothing.
 */
export type ScopeMatchContext = {
  /**
   * Species ids that belong to an incomplete evolution chain. Recomputed by
   * the caller (`ReviewSession`) whenever the card set changes.
   */
  incompleteChainSpeciesIds?: ReadonlySet<number>;
  /**
   * Species ids where exactly one practice leg is mastered and the other is
   * not. Populated by the caller when the `mastery-blockers` preset is active
   * (#1767 data layer). A missing set matches nothing, so the preset is a
   * no-op until the UI PR wires the computation.
   */
  masteryBlockingSpeciesIds?: ReadonlySet<number>;
};

/**
 * Controls which alternate-form cards surface in practice sessions.
 *
 * - `all` - default forms + every form category present in the seed.
 * - `default-only` - only base species (isDefaultForm === true). Excludes all
 *                    alternate forms (Alolan Raichu, Rotom appliances, etc.).
 * - `include` - default forms PLUS an explicit allow-list of categories.
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
   * `{mode:'all'}` on load - existing users see no behaviour change.
   *
   * Optional at the TypeScript level for backwards-compatibility with
   * pre-#450 code that constructs `PracticeScope` literals without the field
   * (e.g. tests, legacy migration paths). All runtime paths treat a missing
   * value as `{mode:'all'}`.
   */
  formCategories?: FormCategoryFilter;
  /**
   * Game / version-group filter axis (#1089). Slugs come from PokéAPI
   * (e.g. `"gold-silver"`, `"sword-shield"`). Empty array means every game
   * is included, mirroring the convention of the other axes.
   *
   * Optional at the TypeScript level so persisted scopes built before #1089
   * continue to validate. All runtime paths treat a missing value as `[]`.
   */
  games?: string[];
};

/**
 * Pre-#333 storage key. The scope is now folded into `UserSettings` and
 * synced with the rest of settings via Supabase. The legacy key is read
 * once by `loadSettings` on first run after deploy and then cleared - see
 * `readLegacyScope` / `clearLegacyScope` below.
 */
const LEGACY_SCOPE_KEY = KEY_LEGACY_PRACTICE_SCOPE;

let _legendaryIds: ReadonlySet<number> | null = null;
/**
 * Cards in the SEED set tagged `isLegendary` (excludes mythicals by design).
 *
 * Only memoises when the seed is already loaded; returns an empty Set if the
 * seed is not yet available (so a later call after load recomputes correctly).
 */
function getLegendaryIds(): ReadonlySet<number> {
  if (_legendaryIds !== null) return _legendaryIds;
  const seed = getSeedIfLoaded();
  if (!seed) return new Set();  // not loaded yet: do not cache
  _legendaryIds = new Set(seed.seedPokemon.filter((p) => p.isLegendary).map((p) => p.id));
  return _legendaryIds;
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
 *   games          – ANY-OF semantics; passes if any of the entry's
 *                    `versionGroups` is listed in the scope (#1089).
 *   formCategories – evaluated first; returns false immediately when the card's
 *                    form fails the filter, regardless of other axes.
 *
 * Within the scope, the gens/types/presets/games categories are OR'd: passing
 * any active category passes the species. Within each category, an empty list
 * is "no contribution to the OR" (does not match anything).
 *
 * Empty scope is handled by callers - this function is only reached for
 * non-empty scopes.
 *
 * @param isDefaultForm  Whether this is the primary form of its species.
 *   Defaults to `true` (safe fallback for seeds that pre-date #445).
 * @param formCategory   The broad category of the form. Defaults to `"default"`.
 * @param versionGroups  PokéAPI version-group slugs whose pokedex includes
 *   this entry. Defaults to `[]` (safe fallback for pre-#1089 seeds - the
 *   entry then can never satisfy a games-axis match, which is the
 *   conservative behaviour).
 * @param context        Runtime data for progress-dependent presets. When the
 *   `incomplete-chains` preset is active, `context.incompleteChainSpeciesIds`
 *   supplies the species in incomplete chains; a missing set matches nothing.
 */
function speciesMatchesScope(
  speciesId: number,
  speciesTypes: readonly string[],
  scope: PracticeScope,
  isDefaultForm: boolean = true,
  formCategory: FormCategory = "default",
  versionGroups: readonly string[] = [],
  context: ScopeMatchContext = {},
  gamesSet?: ReadonlySet<string>,
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
  // fc.mode === 'all' - passthrough; form is never excluded

  // ── gens / types / presets / games (OR'd) ──────────────────────────────
  // If none of these axes are active, the species passes the scope based on
  // the form gate alone (all other axes are permissive by default).
  const gamesActive = (scope.games?.length ?? 0) > 0;
  const hasActiveAxes =
    scope.gens.length > 0 ||
    scope.types.length > 0 ||
    scope.presets.length > 0 ||
    gamesActive;
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
  if (
    scope.presets.includes("incomplete-chains") &&
    (context.incompleteChainSpeciesIds?.has(speciesId) ?? false)
  )
    return true;
  if (
    scope.presets.includes("mastery-blockers") &&
    (context.masteryBlockingSpeciesIds?.has(speciesId) ?? false)
  )
    return true;
  if (gamesActive) {
    const lookup = gamesSet ?? new Set(scope.games!);
    if (versionGroups.some((vg) => lookup.has(vg))) return true;
  }
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
 * form-specific evolution edges are always excluded (#448 is the follow-up) - 
 * they are treated as default forms to avoid spurious exclusions while the
 * form-edge feature is in progress.
 *
 * Cards built from a pre-#445 seed (generated.json without `isDefaultForm`)
 * receive safe defaults: `isDefaultForm=true`, `formCategory='default'`.
 */

/**
 * Lazy lookup map from pokemon id to SeedPokemon - built once on first use.
 *
 * Only memoises when the seed is already loaded; returns an empty Map if the
 * seed is not yet available (so a later call after load recomputes correctly).
 */
let _seedById: Map<number, SeedPokemon> | null = null;
function getSeedById(): Map<number, SeedPokemon> {
  if (_seedById !== null) return _seedById;
  const seed = getSeedIfLoaded();
  if (!seed) return new Map();  // not loaded yet: do not cache
  _seedById = new Map(seed.seedPokemon.map((p) => [p.id, p]));
  return _seedById;
}

export function cardMatchesScope(
  card: ReviewableCard,
  scope: PracticeScope,
  context: ScopeMatchContext = {},
): boolean {
  if (isScopeEmpty(scope)) return true;
  // Evolution edge cards filter on the pre-evo's species ID (the card is
  // "about" the pre-evolution - Bulbasaur → Ivysaur is a Gen 1 / Starters card
  // because of Bulbasaur, not Ivysaur). Reverse-evolution cards use the same
  // pre-evo anchor - the answer-side species. Other card types use their own id.
  //
  // For alternate-form cards (e.g. Alolan Raichu, id=10100), the card's own id
  // is outside the 1-1025 gen range so `generationOf(id)` returns 0. We use
  // `speciesId` instead - the base species ID that maps back into the gen table.
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
  // evolution edges are a follow-up - #448). Fall back to safe defaults for
  // seeds built before #445 where the fields may be absent.
  const isDefaultForm: boolean =
    card.cardType === "evolution" || card.cardType === "reverse-evolution"
      ? true
      : (card as { isDefaultForm?: boolean }).isDefaultForm ?? true;
  const formCategory: FormCategory =
    card.cardType === "evolution" || card.cardType === "reverse-evolution"
      ? "default"
      : (card as { formCategory?: FormCategory }).formCategory ?? "default";

  // Version-groups (#1089). Evolution cards anchor to the pre-evo just like
  // every other axis - a card "about" Bulbasaur should match a Red/Blue scope
  // because Bulbasaur appears in that dex, even though Ivysaur's set is
  // (effectively) identical here. Name/reverse/cry cards spread SeedPokemon
  // and carry `versionGroups` directly; fall back to [] for pre-#1089 seeds.
  const versionGroups: readonly string[] =
    card.cardType === "evolution" || card.cardType === "reverse-evolution"
      ? (getSeedById().get(card.preEvoId)?.versionGroups ?? [])
      : (card as { versionGroups?: string[] }).versionGroups ?? [];

  return speciesMatchesScope(
    pokemonId,
    types,
    scope,
    isDefaultForm,
    formCategory,
    versionGroups,
    context,
  );
}

/**
 * Map a `ReviewableCard` to the `EligibilityInput` shape consumed by the
 * shared `isCardEligible` predicate in `lib/eligibility`.
 *
 * The client card object uses the in-memory `cardType` strings `"evolution"`
 * and `"reverse-evolution"`, while the shared predicate (and the DB) use
 * the persisted slugs `"evolution-edge"` and `"reverse-evolution-edge"`.
 * This adapter normalises to the DB convention so both callers of
 * `isCardEligible` produce identical inputs for the same logical card.
 *
 * `subjectKey` is already present on every `ReviewableCard` (set by
 * `buildSession` / `hydrateSession`), so no encoding is needed here.
 */
function toEligibilityInput(card: ReviewableCard): { cardType: string; subjectKey: string } {
  let cardType = card.cardType as string;
  if (cardType === "evolution") cardType = "evolution-edge";
  else if (cardType === "reverse-evolution") cardType = "reverse-evolution-edge";
  return { cardType, subjectKey: card.subjectKey };
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
 * by this gate - they represent the default-form pre-evo identity.
 *
 * Use this function as the single eligibility chokepoint in the session
 * builder / scope-change handler instead of calling `cardMatchesScope` directly
 * when the forms gate setting is available.
 *
 * The alt-forms exclusion is delegated to the shared `isCardEligible` predicate
 * in `lib/eligibility` (#1160). All card-type flags are set to `true` here
 * because the type-enable gate lives in `computeEligibleCardIds`; this function
 * only owns the alt-forms check and the scope filter.
 */
export function cardIsEligible(
  card: ReviewableCard,
  scope: PracticeScope,
  alternateFormsEnabled: boolean,
  context: ScopeMatchContext = {},
): boolean {
  // Delegate the alt-forms gate to the shared predicate. All opt-in card-type
  // flags are true so only the `alternateFormsEnabled` axis is active.
  const altFormsSettings: CardEligibilitySettings = {
    evolutionCardsEnabled: true,
    reverseEvolutionCardsEnabled: true,
    cryCardsEnabled: true,
    alternateFormsEnabled,
  };
  if (!isCardEligible(toEligibilityInput(card), altFormsSettings)) return false;
  if (isScopeEmpty(scope)) return true;
  return cardMatchesScope(card, scope, context);
}

/**
 * Minimal settings surface consumed by `computeEligibleCardIds`. Matches the
 * subset of `UserSettings` that drives eligibility so the helper stays
 * decoupled from the full settings type and is easy to test.
 *
 * Re-exports `CardEligibilitySettings` fields plus `practiceScope`.
 */
export type EligibilitySettings = CardEligibilitySettings & {
  practiceScope: PracticeScope;
};

/**
 * Compute the set of card IDs that are eligible for a practice session given
 * the current settings and scope. This is the shared eligibility chokepoint
 * used by both `ReviewSession` and the badge hooks (`usePwaBadge`,
 * `useDocumentTitleBadge`) so all three surfaces always agree on the count.
 *
 * The three-tier gate applied here mirrors `ReviewSession.tsx`:
 *   1. Card-type enabled (evolutionCardsEnabled, etc.; name/reverse always on)
 *   2. `alternateFormsEnabled` master toggle
 *   3. `practiceScope` filter via `cardMatchesScope`
 *
 * Gates 1 and 2 are delegated to `isCardEligible` from `lib/eligibility`
 * (#1160) so they share a single source of truth with the daily Web Push
 * route. Gate 3 (practice scope) is client-side only and stays here.
 *
 * @param cards   The full persisted card set (from `loadSession`).
 * @param settings  Subset of `UserSettings` that drives eligibility.
 * @param context   Optional runtime context for progress-dependent presets
 *   (e.g. `incompleteChainSpeciesIds` for the "Incomplete evolution chains"
 *   preset). When omitted the preset simply matches nothing, which is the
 *   correct behaviour for callers without access to the full review state.
 *
 * Pure - no I/O, no DOM access, no hooks.
 */
export function computeEligibleCardIds(
  cards: readonly ReviewableCard[],
  settings: EligibilitySettings,
  context: ScopeMatchContext = {},
): Set<number> {
  const scopeEmpty = isScopeEmpty(settings.practiceScope);
  return new Set(
    cards
      .filter((c) => {
        // Gates 1 + 2: card-type enable flags + alternateFormsEnabled.
        // Shared with the server-side Web Push eligibility filter (#1160).
        if (!isCardEligible(toEligibilityInput(c), settings)) return false;
        // Gate 3: practice scope (client-only - localStorage-backed).
        if (scopeEmpty) return true;
        return cardMatchesScope(c, settings.practiceScope, context);
      })
      .map((c) => c.id),
  );
}

/**
 * Species-level eligibility check - mirrors `cardIsEligible` but operates on
 * a `SeedPokemon` rather than a `ReviewableCard`. Used by `getSeenPokemon` in
 * the Higher-or-Lower minigame so the pool respects the same two-tier gate
 * (master alternate-forms toggle first, then gens/types/presets scope) as the
 * practice session itself.
 *
 * @param alternateFormsEnabled  Mirror of `UserSettings.alternateFormsEnabled`.
 *   Defaults to `true` so callers that do not yet pass the flag see the
 *   previous behaviour - all species included.
 */
export function seedPokemonIsEligible(
  p: SeedPokemon,
  scope: PracticeScope,
  alternateFormsEnabled: boolean = true,
  context: ScopeMatchContext = {},
): boolean {
  const isDefaultForm = (p as { isDefaultForm?: boolean }).isDefaultForm ?? true;

  // Master gate: exclude alternate-form species when the toggle is off.
  if (!alternateFormsEnabled && !isDefaultForm) return false;

  if (isScopeEmpty(scope)) return true;

  const resolvedId = (p as { speciesId?: number }).speciesId ?? p.id;
  const formCategory = (p as { formCategory?: FormCategory }).formCategory ?? "default";
  const versionGroups = (p as { versionGroups?: string[] }).versionGroups ?? [];
  return speciesMatchesScope(
    resolvedId,
    p.types,
    scope,
    isDefaultForm,
    formCategory,
    versionGroups,
    context,
  );
}

/**
 * Count species in the seed pool that match the active scope, applying the
 * same two-tier gate as `cardIsEligible`. Returns `seed.length` (minus
 * alternate-form entries when gated off) for the empty scope.
 *
 * Drives the UI's live "X of N match" count beneath `ScopeControl`. When
 * `alternateFormsEnabled` is false, alternate-form species are excluded from
 * the count so the display is consistent with what actually surfaces in a
 * session.
 *
 * Distinct from `cardMatchesScope` because the caller has a `SeedPokemon`,
 * not a `ReviewableCard` - the underlying matching logic is shared via
 * the private `speciesMatchesScope` helper to keep them from drifting.
 *
 * @param alternateFormsEnabled  Mirror of `UserSettings.alternateFormsEnabled`.
 *   Defaults to `true` so existing callers that do not yet pass the gate
 *   (e.g. tests) see the previous behaviour - all species counted.
 */
export function countMatchingSpecies(
  seed: readonly SeedPokemon[],
  scope: PracticeScope,
  alternateFormsEnabled: boolean = true,
  context: ScopeMatchContext = {},
): number {
  // Precompute once so the inner loop uses O(1) Set lookups instead of
  // O(n) Array.includes across ~1025 species × up to 30 version-groups each.
  const gamesSet: ReadonlySet<string> | undefined =
    (scope.games?.length ?? 0) > 0 ? new Set(scope.games!) : undefined;
  let count = 0;
  for (const s of seed) {
    // isDefaultForm may be absent in a pre-#445 seed; default to true so old
    // seeds are never incorrectly excluded.
    const isDefaultForm = (s as { isDefaultForm?: boolean }).isDefaultForm ?? true;

    // Master gate: when the forms toggle is off, skip non-default-form entries
    // so the count matches what the session will actually build.
    if (!alternateFormsEnabled && !isDefaultForm) continue;

    if (isScopeEmpty(scope)) {
      count += 1;
      continue;
    }

    // For alternate-form entries, s.id is outside the 1-1025 gen range.
    // Use speciesId (the base species ID) so the gens axis resolves correctly.
    // Falls back to s.id for pre-#445 seeds where speciesId is absent.
    const resolvedId = (s as { speciesId?: number }).speciesId ?? s.id;
    // formCategory may be absent in a pre-#445 seed; fall back to 'default'.
    const formCategory = (s as { formCategory?: FormCategory }).formCategory ?? "default";
    // versionGroups may be absent in a pre-#1089 seed; fall back to [].
    const versionGroups = (s as { versionGroups?: string[] }).versionGroups ?? [];
    if (
      speciesMatchesScope(
        resolvedId,
        s.types,
        scope,
        isDefaultForm,
        formCategory,
        versionGroups,
        context,
        gamesSet,
      )
    )
      count += 1;
  }
  return count;
}

/**
 * Internal: shape-validate a raw parsed JSON value into a PracticeScope.
 * Permissive on individual entries - bad members are filtered out rather
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
        (v): v is PracticeScopePreset =>
          v === "starters" || v === "legendaries" || v === "incomplete-chains" || v === "mastery-blockers",
      )
    : [];
  // formCategories: absent in pre-#450 persisted scopes → default to {mode:'all'}.
  const formCategories: FormCategoryFilter = parseFormCategoryFilter(obj.formCategories);
  // games: absent in pre-#1089 persisted scopes → default to [].
  const games = Array.isArray(obj.games)
    ? (obj.games as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  return { gens, types, presets, formCategories, games };
}

/**
 * Read the legacy practice-scope key. Returns `null` when the key is
 * absent, malformed, or the runtime has no window/localStorage (SSR).
 *
 * Does NOT delete the key on read - callers stage the read-then-clear
 * sequence so we never lose data on a transient failure between the two
 * steps. `loadSettings` is the canonical caller (#333).
 */
export function readLegacyScope(): PracticeScope | null {
  return readLocalStorage(
    LEGACY_SCOPE_KEY,
    (raw) => parseScopeShape(JSON.parse(raw) as unknown),
    null,
  );
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
    // ignore - scope is non-critical
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
 * should use the settings hooks (`useSettings`) - `practiceScope` lives
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
    // ignore quota / serialisation errors - scope is non-critical
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
  if (scope.presets.includes("incomplete-chains")) parts.push("Incomplete chains");
  if (scope.presets.includes("mastery-blockers")) parts.push("Almost mastered");
  const fc = scope.formCategories ?? { mode: "all" };
  if (fc.mode === "default-only") parts.push("Default forms only");
  else if (fc.mode === "include" && fc.categories.length > 0) {
    const catLabels = fc.categories.map(
      (c) => c.charAt(0).toUpperCase() + c.slice(1),
    );
    parts.push(catLabels.join(", ") + " forms");
  }
  if ((scope.games?.length ?? 0) > 0) {
    const games = scope.games!;
    if (games.length === 1) {
      parts.push(versionGroupLabel(games[0]));
    } else {
      parts.push(`${games.length} games`);
    }
  }
  return parts.join(" · ");
}
