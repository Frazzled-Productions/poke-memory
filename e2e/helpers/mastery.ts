/**
 * Shared mastery-seed helpers for E2E specs.
 *
 * Since #1234, a species is mastered only when BOTH the name card AND the
 * paired reverse card pass the FSRS mastery gate (reps >= 3 AND
 * scheduledDays >= 21). Any test that asserts mastery-driven UI (Pasture
 * entries, milestone banners, journey badge hints) must seed both legs.
 */

/** Numeric offset added to a Pokémon ID to produce its reverse-card ID. */
export const REVERSE_ID_OFFSET = 2_000_000;

/**
 * A minimal mastered reverse card paired with a mastered name card.
 *
 * Since #1234, filterMastered requires BOTH the name card AND the paired
 * reverse card to pass the FSRS mastery gate before a species is counted
 * as mastered. Seed this alongside every masteredCard entry that should
 * contribute to the mastery count.
 *
 * The reverse-card ID is REVERSE_ID_OFFSET + pokémonId.
 */
export function masteredReverseCard(pokemonId: number) {
  return {
    id: REVERSE_ID_OFFSET + pokemonId,
    cardType: "reverse",
    pokemonId,
    speciesId: pokemonId,
    name: `Pokemon ${pokemonId}`,
    spriteUrl: `/sprites/pokemon/${pokemonId}.png`,
    state: {
      stability: 30,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 28,
      reps: 4,
      lapses: 0,
      fsrsState: "review",
      dueDate: "2026-06-10",
      lastReview: "2026-05-13",
      firstSeen: "2026-03-01",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };
}
