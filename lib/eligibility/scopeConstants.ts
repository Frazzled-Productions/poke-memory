/**
 * Lightweight scope constants and helpers — no SEED_POKEMON dependency.
 *
 * Extracted from `lib/review/scope.ts` so server-side routes (e.g.
 * `app/api/push/send-daily/route.ts`) can import these without pulling the
 * ~3.8 MB `generated.json` seed into their bundle.
 *
 * `lib/review/scope.ts` re-exports every symbol defined here so all existing
 * client-side callers continue to import from their current path without
 * change.
 *
 * Pure — no I/O, no side effects, no seed dependency.
 */

import type { PracticeScope, FormCategoryFilter } from "@/lib/review/scope";
import type { FormCategory } from "@/lib/pokemon/forms";

export const EMPTY_SCOPE: PracticeScope = {
  gens: [],
  types: [],
  presets: [],
  formCategories: { mode: "all" },
  games: [],
};

export function isScopeEmpty(scope: PracticeScope): boolean {
  return (
    scope.gens.length === 0 &&
    scope.types.length === 0 &&
    scope.presets.length === 0 &&
    (scope.formCategories?.mode ?? "all") === "all" &&
    (scope.games?.length ?? 0) === 0
  );
}

const VALID_FORM_CATEGORIES: readonly FormCategory[] = [
  "default", "regional", "mega", "gmax", "primal", "forme",
];

/**
 * Parse a raw JSON value into a `FormCategoryFilter`.
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
