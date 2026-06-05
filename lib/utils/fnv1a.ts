export const FNV_PRIME = 16777619;
export const FNV_OFFSET = 2166136261;

export function fnv1a(s: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/**
 * FNV-1a over the four bytes of a 32-bit unsigned integer, little-endian
 * (LSB first). Accepts an optional `seed` so callers can chain multiple
 * integers into one hash - pass the result of a previous `fnv1aUint32` (or
 * `fnv1a`) call as the seed to continue the same hash run.
 *
 * Byte order: low byte first (id & 0xff, then id >>> 8, etc.), matching the
 * inline blocks previously copy-pasted in `lib/pokemon/distractors.ts` and
 * `lib/review/session.ts`.
 *
 * Returns an unsigned 32-bit integer (always >= 0).
 */
export function fnv1aUint32(n: number, seed: number = FNV_OFFSET): number {
  let hash = seed;
  hash ^= n & 0xff;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= (n >>> 8) & 0xff;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= (n >>> 16) & 0xff;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= (n >>> 24) & 0xff;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  return hash;
}
