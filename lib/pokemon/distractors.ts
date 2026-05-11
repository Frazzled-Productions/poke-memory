import type { SeedPokemon } from "@/lib/pokemon/seed";

const FNV_PRIME = 16777619;
const FNV_OFFSET = 2166136261;

function fnv1a(s: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/**
 * Returns `count` deterministic distractors from `pool`, excluding `targetId`.
 *
 * Same `targetId` + same `seed` always produces the same result — stable
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

  const keyed = candidates.map((p) => {
    let hash = seedHash;
    hash ^= p.id & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (p.id >>> 8) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (p.id >>> 16) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (p.id >>> 24) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    return { p, key: hash };
  });

  keyed.sort((a, b) => a.key - b.key || a.p.id - b.p.id);
  return keyed.slice(0, count).map((k) => k.p);
}
