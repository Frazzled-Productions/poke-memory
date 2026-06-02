/**
 * Content manifest signature for the offline download.
 *
 * A stable, pure hash over the sorted set of URLs that `buildPrecacheUrls`
 * produces for a given set of species IDs, folded with `SW_CACHE_VERSION`.
 * Any change to the URL set — new species, new sprite width, new cache-version
 * string — produces a different signature, making it safe to compare a
 * persisted signature against the current one to detect delta.
 *
 * Why not a real crypto hash?
 * - The URL list is large (~14 000 entries) but entirely deterministic and
 *   static per build, so a non-cryptographic hash is fine for identity checks.
 * - We use FNV-1a (32-bit) because it is simple, has no external deps, and is
 *   stable across JS engines for the same input sequence.
 * - The result is hex-encoded so it is safe to store in localStorage JSON.
 */

import { SW_CACHE_VERSION } from "./cacheStrategy";

// ─── FNV-1a 32-bit constants ────────────────────────────────────────────────
const FNV_PRIME = 0x01000193; // 16_777_619
const FNV_OFFSET_BASIS = 0x811c9dc5; // 2_166_136_261

/**
 * Compute a 32-bit FNV-1a hash of a string.
 * Returns a non-negative 32-bit integer (>>> 0 keeps it unsigned).
 */
function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply with >>> 0 to keep it within 32-bit unsigned arithmetic.
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Compute a stable content-manifest signature for the given URL list.
 *
 * The input list is sorted before hashing so the order of `buildPrecacheUrls`
 * does not affect the signature. `SW_CACHE_VERSION` is folded in as a prefix
 * so a cache-format bump also invalidates existing signatures.
 *
 * @param urls - The full sorted/unsorted list of precache URLs.
 * @returns A lowercase hex string representing the 32-bit FNV-1a hash.
 */
export function computeManifestSignature(urls: readonly string[]): string {
  const sorted = [...urls].sort();
  // Fold in the cache version as a header so a version bump alone is enough
  // to invalidate: prefix every hash run with the version string.
  const combined = SW_CACHE_VERSION + "\0" + sorted.join("\0");
  const hash = fnv1a32(combined);
  return hash.toString(16).padStart(8, "0");
}

// ─── Persisted manifest shape ────────────────────────────────────────────────

/**
 * The value written to `KEY_OFFLINE_MANIFEST` after a successful download.
 * `signature` is a hex hash over the URL set + cache version.
 * `count` is the number of species IDs that were downloaded (used to compute
 * the "N new" delta for the Update-available label without storing the full
 * URL set).
 */
export type OfflineManifest = {
  signature: string;
  count: number;
};

/**
 * Parse a raw JSON string from localStorage into an `OfflineManifest`.
 * Returns `null` when the string is missing, malformed, or has the wrong shape.
 */
export function parseOfflineManifest(raw: string | null): OfflineManifest | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.signature !== "string" || typeof p.count !== "number") return null;
  if (!Number.isFinite(p.count) || p.count < 0) return null;
  return { signature: p.signature, count: p.count };
}
