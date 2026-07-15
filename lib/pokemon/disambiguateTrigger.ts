// Disambiguates forward evolution-card trigger phrases for the handful of
// species whose sibling evolution edges share byte-identical PokéAPI
// `evolution_details`, so `triggerPhrase()` alone renders the same prompt for
// two different expected answers (#1932).
//
// This is a pure, hand-maintained lookup keyed on the fixed (preEvoId,
// postEvoId) edge pair - not a general seeding of version/form data - because
// the affected edges are a small, known, stable set. If a future PokéAPI
// generation adds a new colliding edge, `collisionScan.test.ts` will fail and
// name the offending pre-evo/phrase so it can be added here (or, if the
// branch is genuinely undecidable in-game, added to
// `RANDOM_BRANCH_PRE_EVO_IDS` instead).

// Species IDs whose sibling evolution branches are chosen by hidden in-game
// randomness (personality value) with no PokéAPI-encodable or in-game
// condition that distinguishes them. These are intentionally left colliding -
// the card is honestly ambiguous, and either answer is correct. Consumed by
// `collisionScan.test.ts` (to exempt the edge from the no-collision
// assertion) and by the review UI (to accept either answer / caption the
// randomness).
export const RANDOM_BRANCH_PRE_EVO_IDS = new Set<number>([
  265, // Wurmple → Silcoon / Cascoon
]);

// The two sibling post-evolutions for each random-branch pre-evo, used by the
// review UI to caption the randomness ("can become Silcoon or Cascoon"). The
// English names are fallbacks only - the UI resolves each id through
// `useLocalePokemonName` so the caption renders in the active Pokémon-name
// locale (#1932). Keyed by pre-evo species id; the two forms are unordered.
export const RANDOM_BRANCH_NOTE_SPECIES: Readonly<
  Record<number, { firstId: number; firstName: string; secondId: number; secondName: string }>
> = {
  265: { firstId: 266, firstName: "Silcoon", secondId: 268, secondName: "Cascoon" },
};

// `${preEvoId}>${postEvoId}` -> clause appended to the base trigger phrase.
const DISAMBIGUATION_CLAUSES: Readonly<Record<string, string>> = {
  "790>791": "in Pokémon Sun / Ultra Sun", // Cosmoem -> Solgaleo
  "790>792": "in Pokémon Moon / Ultra Moon", // Cosmoem -> Lunala
  "52>863": "while it's a Galarian Meowth", // Meowth -> Perrserker
  "194>980": "while it's a Paldean Wooper", // Wooper -> Clodsire
};

/**
 * Appends a disambiguating clause to `base` for the fixed set of forward
 * evolution edges whose rendered trigger phrase would otherwise collide with
 * a sibling branch. All other edges (including Wurmple's, and the "default"
 * branch of each disambiguated pre-evo - e.g. Meowth -> Persian, Wooper ->
 * Quagsire) pass `base` through unchanged.
 */
export function disambiguateTriggerPhrase(
  preEvoId: number,
  postEvoId: number,
  base: string | null,
): string | null {
  const clause = DISAMBIGUATION_CLAUSES[`${preEvoId}>${postEvoId}`];
  if (clause === undefined) return base;
  if (base === null || base.length === 0) return clause;
  return `${base} ${clause}`.trim();
}
