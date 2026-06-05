import type { SeedPokemon } from "@/lib/pokemon/seed";
import { fnv1a, fnv1aUint32 } from "@/lib/utils/fnv1a";

/**
 * Returns `count` deterministic distractors from `pool`, excluding `targetId`.
 *
 * Same `targetId` + same `seed` always produces the same result - stable
 * across re-renders for a given card. Pass a per-card unique value (e.g. the
 * card's composite ID as a string) so each card gets different distractors.
 *
 * If pool has fewer than `count` non-target entries, all of them are returned
 * without throwing.
 */
export function pickDistractors(
  targetId: number,
  pool: readonly SeedPokemon[],
  count: number,
  seed: string,
): SeedPokemon[] {
  const candidates = pool.filter((p) => p.id !== targetId);
  if (candidates.length <= count) return [...candidates];

  const seedHash = fnv1a(seed + String(targetId));

  const keyed = candidates.map((p) => ({
    p,
    key: fnv1aUint32(p.id, seedHash),
  }));

  keyed.sort((a, b) => a.key - b.key || a.p.id - b.p.id);
  return keyed.slice(0, count).map((k) => k.p);
}
