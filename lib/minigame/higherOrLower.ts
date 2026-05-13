import type { SeedPokemon } from "@/lib/pokemon/seed";
import type { ReviewableCard } from "@/lib/review/session";

export type StatKey =
  | "hp"
  | "attack"
  | "defense"
  | "specialAttack"
  | "specialDefense"
  | "speed";

export const BASE_STATS: ReadonlyArray<{ key: StatKey; label: string }> =
  Object.freeze([
    { key: "hp", label: "HP" },
    { key: "attack", label: "Attack" },
    { key: "defense", label: "Defense" },
    { key: "specialAttack", label: "Sp. Atk" },
    { key: "specialDefense", label: "Sp. Def" },
    { key: "speed", label: "Speed" },
  ]);

export function getStatValue(p: SeedPokemon, stat: StatKey): number {
  return p.stats[stat];
}

/**
 * Picks two distinct Pokémon and a random stat for one round.
 * `rng` is injected so tests can drive deterministic sequences without
 * reaching into module state.
 */
export function pickPair(
  seenPokemon: SeedPokemon[],
  rng: () => number = Math.random,
): { left: SeedPokemon; right: SeedPokemon; stat: StatKey } {
  if (seenPokemon.length < 2) {
    throw new Error("pickPair requires at least 2 seen Pokémon");
  }

  const leftIdx = Math.floor(rng() * seenPokemon.length);
  let rightIdx: number;
  do {
    rightIdx = Math.floor(rng() * seenPokemon.length);
  } while (rightIdx === leftIdx);

  const statIdx = Math.floor(rng() * BASE_STATS.length);

  return {
    left: seenPokemon[leftIdx],
    right: seenPokemon[rightIdx],
    stat: BASE_STATS[statIdx].key,
  };
}

/**
 * Returns whether the guess is correct. Ties are always correct — there
 * is no wrong answer when the values are equal.
 */
export function scoreGuess(
  left: SeedPokemon,
  right: SeedPokemon,
  stat: StatKey,
  guess: "left" | "right",
): { correct: boolean; tie: boolean } {
  const leftVal = getStatValue(left, stat);
  const rightVal = getStatValue(right, stat);

  if (leftVal === rightVal) {
    return { correct: true, tie: true };
  }

  const higherIsLeft = leftVal > rightVal;
  const correct = guess === "left" ? higherIsLeft : !higherIsLeft;
  return { correct, tie: false };
}

/**
 * Returns the subset of `seedPokemon` that the user has seen (at least one
 * card graded), deduped by Pokémon ID.
 *
 * Card type to Pokémon ID mapping:
 *   - "name"               → card.id  (NameReviewCard extends SeedPokemon, so id === pokemonId)
 *   - "reverse"            → card.pokemonId
 *   - "cry"                → card.pokemonId
 *   - "evolution"          → card.preEvoId and card.postEvoId
 *   - "reverse-evolution"  → card.preEvoId and card.postEvoId (same edge, prompt flipped)
 */
export function getSeenPokemon(
  cards: ReviewableCard[],
  seedPokemon: readonly SeedPokemon[],
): SeedPokemon[] {
  const seenIds = new Set<number>();

  for (const card of cards) {
    if (card.state.firstSeen === null) continue;

    if (card.cardType === "name") {
      seenIds.add(card.id);
    } else if (card.cardType === "reverse" || card.cardType === "cry") {
      seenIds.add(card.pokemonId);
    } else if (
      card.cardType === "evolution" ||
      card.cardType === "reverse-evolution"
    ) {
      seenIds.add(card.preEvoId);
      seenIds.add(card.postEvoId);
    }
  }

  return seedPokemon.filter((p) => seenIds.has(p.id));
}
