/**
 * Form-filtering helpers for the seed pipeline.
 *
 * Extracted from scripts/seed-pokemon.mjs so they are unit-testable in normal
 * TypeScript/Vitest land. The seed script imports the compiled output via the
 * module system — see scripts/seed-pokemon.mjs for usage.
 *
 * "Worth learning" means the form is pedagogically distinct from the base form
 * and exists in at least one mainline game as a non-battle-only variant.
 *
 * v1 scope:
 *   INCLUDE  — regional variants (Alolan/Galarian/Hisuian/Paldean),
 *              out-of-battle formes (Deoxys, Rotom, Tauros, Calyrex fusions,
 *              Necrozma fusions, Ogerpon masks, Cap Pikachus, Partner
 *              Pikachu/Eevee, Meowstic-F, Indeedee-F, Zacian/Zamazenta
 *              crowned, size variants (Pumpkaboo/Gourgeist).
 *
 *   EXCLUDE  — is_battle_only (Megas, Gigantamax, Aegislash-Blade,
 *              Darmanitan-Zen, Morpeko-Hangry, Terapagos-Terastal),
 *              totem forms, Koraidon/Miraidon ride forms, Minior meteor
 *              forms, cosmetic pattern variants (Vivillon/Unown/Alcremie —
 *              they share a pokemon_id and are handled separately), stub
 *              Megas (IDs 10278+, detected via base_experience === null &&
 *              moves.length === 0).
 */

export type FormCategory =
  | "default"
  | "regional"
  | "mega"
  | "gmax"
  | "primal"
  | "forme";

/**
 * A stub Pokémon entry has no base_experience and no moves.
 * This pattern matches the stub Mega entries (IDs 10278+) that exist in
 * PokéAPI but don't correspond to real in-game Pokémon.
 */
export function isStubEntry(pokemonData: {
  base_experience: number | null;
  moves?: unknown[];
}): boolean {
  return (
    pokemonData.base_experience === null &&
    (pokemonData.moves ?? []).length === 0
  );
}

/**
 * Returns true if an alternate form is worth learning (should appear in the
 * seed). Always returns false for the default form (isDefaultForm=true) since
 * the default form is handled by the main species processing path.
 *
 * @param formData    The `/pokemon-form/{slug}` API response.
 * @param pokemonData The `/pokemon/{id}` API response for this variety.
 */
export function isWorthLearning(
  formData: {
    form_name?: string | null;
    is_battle_only?: boolean;
    is_default?: boolean;
  },
  pokemonData: {
    base_experience: number | null;
    moves?: unknown[];
  },
): boolean {
  // Stub entries are fan-wiki placeholders with no real game data.
  if (isStubEntry(pokemonData)) return false;

  // Battle-only forms (Megas, Gigantamax, Aegislash-Blade, Darmanitan-Zen,
  // Morpeko-Hangry, Terapagos-Terastal, Primal — primal is also battle_only).
  if (formData.is_battle_only) return false;

  const fn = formData.form_name ?? "";

  // Empty form_name means this is the base/default form — handled elsewhere.
  // "totem" forms are oversized boss versions; not pedagogically distinct.
  if (fn === "" || fn === "totem") return false;

  // Minior meteor forms — just coloured rocks, no gameplay distinction.
  if (/-(meteor)$/.test(fn)) return false;

  // Koraidon/Miraidon ride-mode forms — cosmetic, not separate Pokémon.
  // Matches at the start of the form_name (e.g. "sprinting-build") or after
  // a dash (e.g. "some-glide-form"). PokéAPI form_names for ride modes use
  // the verb as the leading word, so (^|-) catches both positions.
  if (
    /(^|-)(gliding|limited|sprinting|swimming|aquatic|drive|glide|low-power)/.test(
      fn,
    )
  )
    return false;

  return true;
}

/**
 * Classifies a form into a broad category for future scope-toggle filtering.
 *
 * Note: Mega and Gmax forms will be recorded here but excluded from v1 output
 * because their `is_battle_only` flag causes `isWorthLearning` to return
 * false before `formCategoryFor` is ever called. The category is recorded
 * anyway so future opt-in (e.g. a "Megas" scope axis) can filter on it.
 *
 * Primal forms (Kyogre/Groudon) are also `is_battle_only: true` in PokéAPI
 * and are excluded the same way.
 */
export function formCategoryFor(formData: {
  form_name?: string | null;
  is_default?: boolean;
}): FormCategory {
  const fn = formData.form_name ?? "";

  if (/^(alola|galar|hisui|paldea)/.test(fn)) return "regional";
  if (/^mega/.test(fn)) return "mega";
  if (fn === "gmax") return "gmax";
  if (fn === "primal") return "primal";
  if (fn === "" || formData.is_default) return "default";

  return "forme";
}

/**
 * Converts a kebab-case PokéAPI form slug into a display-name fallback.
 * E.g. "alolan-raichu" → "Alolan Raichu". Used only when the PokéAPI
 * `pokemon-form` names[] array lacks an English entry.
 */
export function slugToDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
