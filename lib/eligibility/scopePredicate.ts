/**
 * Server-side practice-scope predicate (#1159).
 *
 * Mirrors the logic in `lib/review/scope.ts#speciesMatchesScope` but operates
 * on the compact `ScopeLookupEntry` shape rather than a full `SeedPokemon`
 * or `ReviewableCard`. Used by the daily Web Push route so the server-side
 * "cards due" count respects the user's practice scope (gens, types, games,
 * presets, formCategories) and not just the card-type-enabled flags.
 *
 * Design choices:
 *
 * - `incomplete-chains` preset is skipped server-side. It requires runtime
 *   card-review state (which species in a chain the user has already mastered)
 *   that is not available without a full session build on the server. The safe
 *   posture is to treat "incomplete-chains" as "never matches" (i.e. counts
 *   as 0 from this preset), which is the same behaviour the client uses when
 *   the context is absent.
 *
 * - `formCategories` with mode `"include"` is a client-only toggle exposed via
 *   ScopeControl. It maps directly to the `formCategory` field in the lookup.
 *
 * - `versionGroups` / games axis uses the `versionGroups` field from the lookup.
 *
 * Pure — no I/O, no side effects.
 */

import type { PracticeScope, FormCategoryFilter } from "@/lib/review/scope";
import type { ScopeLookupEntry } from "@/lib/pokemon/scopeLookup";
import type { FormCategory } from "@/lib/pokemon/forms";
import { generationOf } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Starter species ids — duplicated from lib/review/scope.ts because that
// module imports SEED_POKEMON (too heavy for a server route). Kept in sync
// manually; the seed does not change these ids.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Core predicate
// ---------------------------------------------------------------------------

/**
 * Returns true when the species described by `entry` passes the active
 * `scope`. Empty scope (all axes empty / mode "all") returns true for every
 * entry.
 *
 * Matches the semantics of `speciesMatchesScope` in `lib/review/scope.ts`:
 *
 *   formCategories gate:
 *     Applied first. mode "default-only" → only `isDefaultForm` entries pass.
 *     mode "include" → default forms always pass; non-default forms pass only
 *     if their `formCategory` is listed. mode "all" → no restriction.
 *
 *   gens / types / presets / games (OR'd):
 *     A species passes when it matches at least one active axis. An empty axis
 *     contributes nothing to the OR. If all axes are empty the species passes
 *     (formCategories gate already evaluated).
 *
 * `incomplete-chains` preset: skipped (treated as "no match") because the
 * server does not have access to the user's per-chain mastery state.
 */
export function scopeMatchesEntry(
  entry: ScopeLookupEntry,
  scope: PracticeScope,
): boolean {
  // ── formCategories gate (hard filter) ───────────────────────────────────
  const fc: FormCategoryFilter = scope.formCategories ?? { mode: "all" };
  if (fc.mode === "default-only") {
    if (!entry.isDefaultForm) return false;
  } else if (fc.mode === "include") {
    // Default forms always pass; non-default forms must be in the allow-list.
    if (!entry.isDefaultForm && !fc.categories.includes(entry.formCategory as FormCategory)) {
      return false;
    }
  }
  // fc.mode === "all" → passthrough

  // ── gens / types / presets / games (OR'd) ───────────────────────────────
  const gamesActive = (scope.games?.length ?? 0) > 0;
  const hasActiveAxes =
    scope.gens.length > 0 ||
    scope.types.length > 0 ||
    scope.presets.length > 0 ||
    gamesActive;

  if (!hasActiveAxes) return true;

  if (scope.gens.length > 0) {
    const gen = generationOf(entry.speciesId);
    if (scope.gens.includes(gen)) return true;
  }

  if (scope.types.length > 0) {
    if (entry.types.some((t) => scope.types.includes(t))) return true;
  }

  if (scope.presets.includes("starters") && STARTER_IDS.has(entry.speciesId)) {
    return true;
  }

  if (scope.presets.includes("legendaries") && entry.isLegendary) {
    return true;
  }

  // "incomplete-chains" preset skipped server-side — requires runtime state.

  if (gamesActive) {
    const gamesSet = new Set(scope.games!);
    if (entry.versionGroups.some((vg) => gamesSet.has(vg))) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Subject-key resolver
// ---------------------------------------------------------------------------

/**
 * Given a card's `cardType` and `subjectKey`, return the pokemon id(s) that
 * anchor the scope check. For name/reverse/cry cards this is the single
 * numeric id in `subjectKey`. For evolution-edge / reverse-evolution-edge
 * cards, the scope is anchored on the **pre-evo id** — the "from" id in the
 * `"<fromId>>><toId>"` format. This mirrors `cardMatchesScope` in
 * `lib/review/scope.ts`, which uses `card.preEvoId` for evolution cards.
 *
 * Returns `null` when the subjectKey cannot be parsed for the given card type.
 */
export function resolveAnchorId(cardType: string, subjectKey: string): number | null {
  if (
    cardType === "name" ||
    cardType === "reverse" ||
    cardType === "cry"
  ) {
    const id = parseInt(subjectKey, 10);
    return isNaN(id) ? null : id;
  }

  if (
    cardType === "evolution-edge" ||
    cardType === "reverse-evolution-edge"
  ) {
    const sep = subjectKey.indexOf(">>>");
    if (sep === -1) return null;
    // Pre-evo is the "from" id — the part before ">>>".
    const fromId = parseInt(subjectKey.slice(0, sep), 10);
    return isNaN(fromId) ? null : fromId;
  }

  // Unknown card type — cannot resolve.
  return null;
}
