// lib/pokemon/seed-async.ts
// Async seed loader - fetches generated-core.json + generated-chains.json from
// public/pokemon-data/ at runtime so they are NOT bundled into the boot JS.
//
// Pattern mirrors lib/pokemon/localeNames.ts: a module-singleton _cache /
// _loadPromise so concurrent callers share one in-flight fetch.
//
// Visible-error policy: on fetch failure this module THROWS (does not silently
// fall back to empty data). The React SeedContext surfaces the error so the UI
// can show a reload prompt.

import { buildSeed } from "@/lib/pokemon/seed-builder";
import type { SeedData } from "@/lib/pokemon/seed-builder";

// Re-export SeedData so consumers can import from one place.
export type { SeedData };

// ---------------------------------------------------------------------------
// Module-level singleton cache
// ---------------------------------------------------------------------------

let _cache: SeedData | null = null;
let _loadPromise: Promise<SeedData> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and build the seed data from public/pokemon-data/.
 *
 * Safe to call concurrently - only one network request pair is ever in flight.
 * On success the result is cached and returned on every subsequent call.
 *
 * On fetch failure the promise rejects with an Error describing the problem,
 * and _loadPromise is reset to null so the next call will retry.
 */
export async function loadSeed(): Promise<SeedData> {
  if (_cache !== null) return _cache;
  if (_loadPromise !== null) return _loadPromise;

  _loadPromise = (async () => {
    let coreRes: Response;
    let chainsRes: Response;
    try {
      [coreRes, chainsRes] = await Promise.all([
        fetch("/pokemon-data/generated-core.json"),
        fetch("/pokemon-data/generated-chains.json"),
      ]);
    } catch (err) {
      // Network error (offline, DNS failure, etc.)
      _loadPromise = null;
      throw new Error(
        `Seed fetch failed (network error): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!coreRes.ok) {
      _loadPromise = null;
      throw new Error(
        `Seed fetch failed: generated-core.json returned HTTP ${coreRes.status}`,
      );
    }
    if (!chainsRes.ok) {
      _loadPromise = null;
      throw new Error(
        `Seed fetch failed: generated-chains.json returned HTTP ${chainsRes.status}`,
      );
    }

    let coreData: unknown;
    let chainsData: unknown;
    try {
      [coreData, chainsData] = await Promise.all([
        coreRes.json() as Promise<unknown>,
        chainsRes.json() as Promise<unknown>,
      ]);
    } catch (err) {
      _loadPromise = null;
      throw new Error(
        `Seed parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const data = buildSeed(coreData, chainsData);
    _cache = data;
    return data;
  })();

  // _loadPromise is assigned synchronously (before any await runs), so this
  // return always hands the caller the pending Promise - never null. When the
  // IIFE rejects it resets _loadPromise = null *after* the caller has already
  // captured the reference, so the current caller still receives the rejection
  // and the next caller gets a fresh attempt. We do NOT catch here so the
  // rejection propagates correctly.
  return _loadPromise;
}

/**
 * Synchronous snapshot: returns the cached SeedData if `loadSeed()` has
 * already resolved, or null if loading has not yet completed.
 *
 * Useful for render paths that need to avoid an async boundary (e.g. checking
 * whether the seed is ready before triggering a heavy computation).
 */
export function getSeedIfLoaded(): SeedData | null {
  return _cache;
}

// ---------------------------------------------------------------------------
// Test helpers (reset module-level state between tests)
// ---------------------------------------------------------------------------

/** @internal - test use only. Resets the in-memory cache so tests are isolated. */
export function _resetSeedAsyncCache(): void {
  _cache = null;
  _loadPromise = null;
}
