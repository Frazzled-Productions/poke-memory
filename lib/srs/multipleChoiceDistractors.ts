import type { SeedPokemon } from "@/lib/pokemon/seed";
import { fnv1a, fnv1aUint32 } from "@/lib/utils/fnv1a";

/**
 * Selects 3 name-card distractors for a multiple-choice question.
 *
 * Strategy (in priority order, filling slots greedily):
 *   1. Same-generation Pokémon that are not the target.
 *   2. Any remaining Pokémon from the pool.
 *
 * Same-generation distractors make the question meaningfully harder than a
 * random grab: the user must distinguish between species they would encounter
 * around the same time, which is the most realistic confusion surface.
 *
 * Deterministic: same `targetId` + same `seed` always returns the same set.
 * This keeps the options stable across re-renders and learning-step replays.
 *
 * Only default-form species (`isDefaultForm === true`) are used as
 * distractors to avoid presenting confusing alternate-form names like
 * "Alolan Raichu" when the user is learning base-species names.
 *
 * @param targetId   The species ID of the card being asked.
 * @param target     The seed entry for the target species.
 * @param pool       The full SEED_POKEMON roster.
 * @param seed       A stable per-card string (e.g. the card's composite id).
 * @returns          Exactly 3 distractor SeedPokemon (fewer only if the pool
 *                   cannot supply 3 non-target entries after filtering).
 */
export function pickMcDistractors(
  targetId: number,
  target: SeedPokemon,
  pool: readonly SeedPokemon[],
  seed: string,
): SeedPokemon[] {
  // Only default forms make good named distractors.
  const defaultForms = pool.filter((p) => p.isDefaultForm && p.id !== targetId);

  const seedHash = fnv1a(seed + String(targetId));

  function deterministicSort(arr: SeedPokemon[]): SeedPokemon[] {
    return arr
      .map((p) => ({ p, key: fnv1aUint32(p.id, seedHash) }))
      .sort((a, b) => a.key - b.key || a.p.id - b.p.id)
      .map(({ p }) => p);
  }

  const sameGen = defaultForms.filter(
    (p) => p.generation !== null && p.generation === target.generation,
  );
  const otherGen = defaultForms.filter(
    (p) => p.generation === null || p.generation !== target.generation,
  );

  const shuffledSameGen = deterministicSort(sameGen);
  const shuffledOtherGen = deterministicSort(otherGen);

  const ordered = [...shuffledSameGen, ...shuffledOtherGen];
  return ordered.slice(0, 3);
}

/**
 * Produces all 4 option entries (correct + 3 distractors) in a shuffled order.
 * The shuffle is deterministic given the same `seed` — stable across re-renders.
 *
 * Returns an array of `{ pokemon, isCorrect }` tuples ready to map into buttons.
 */
export function buildMcOptions(
  targetId: number,
  target: SeedPokemon,
  pool: readonly SeedPokemon[],
  seed: string,
): Array<{ pokemon: SeedPokemon; isCorrect: boolean }> {
  const distractors = pickMcDistractors(targetId, target, pool, seed);

  const all = [
    { pokemon: target, isCorrect: true },
    ...distractors.map((d) => ({ pokemon: d, isCorrect: false })),
  ];

  // Shuffle the four options deterministically so the correct answer is not
  // always in the first position. Use a separate hash pass keyed on "options"
  // so the shuffle differs from the distractor-selection hash. Only 4 distinct
  // FNV inputs (idx 0–3) are needed here — the narrow range is intentional and
  // the keys are distinct by construction (unique idx values).
  const optionSeedHash = fnv1a("options:" + seed + String(targetId));
  return all
    .map((item, idx) => ({ item, key: fnv1aUint32(idx, optionSeedHash) }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}
