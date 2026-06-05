/**
 * lib/i18n/typeNames.ts
 *
 * Single source of truth for localised Pokémon type names.
 *
 * The 18 type names (bug, dark, dragon, …) appear on three surfaces:
 *   1. PokedexFilterBar - type-filter pills
 *   2. PastureSearchBar - type-filter pills
 *   3. ScopeControl - type-filter pills in the practice scope panel
 *
 * Rather than duplicating `t("types.fire")` at each call site, every surface
 * imports this helper and passes its `t` function (from `useTranslations("types")`
 * or a compatible scope).
 *
 * Cross-layer note: this file lives in `lib/` (data-coder territory) but is
 * created by the ui-coder to centralise type-name rendering shared across three
 * components/ surfaces. Permitted by AGENTS.md "Cross-layer fixes" - the
 * alternative (three duplicated t() call sites in components/) is the
 * fragmentation pattern the DRY rule exists to prevent.
 */

import type { POKEMON_TYPES } from "@/lib/pokemon/types";

/** The type of the `t` function returned by `useTranslations("types")`. */
export type TypeTranslations = (key: (typeof POKEMON_TYPES)[number]) => string;

/**
 * Returns the localised display name for a Pokémon type.
 *
 * @param type  Lowercase type id from `POKEMON_TYPES` (e.g. `"fire"`).
 * @param t     The `t` function from `useTranslations("types")`.
 */
export function getTypeName(
  type: string,
  t: TypeTranslations,
): string {
  return t(type as (typeof POKEMON_TYPES)[number]);
}
