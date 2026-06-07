/**
 * Offline precache orchestrator.
 *
 * Iterates every sprite and cry URL for every Pokémon in the seed and
 * populates the service-worker runtime caches so practice sessions work
 * without a network connection.
 *
 * Strategy:
 *  - Sprites are cached as pre-generated static WebP files at every render
 *    width used by the app. The browser fetches these directly from
 *    `/sprites/pokemon/webp/<id>/<width>.webp` - the `/_next/image` endpoint
 *    is no longer used for sprites. Raw PNGs (`/sprites/pokemon/<id>.png`) are
 *    no longer precached: the Pokédex grid switched to the 64 px WebP variant
 *    in #1740, and nothing else requests the raw PNGs at runtime.
 *  - Cries are cached once at their canonical /cries/<id>.ogg URL.
 *  - Each URL is checked with `cache.match` before fetching - already-cached
 *    assets are skipped, making the operation idempotent and resumable.
 *  - Fetches are bounded to CONCURRENCY at a time to avoid hammering the server.
 *  - An AbortSignal can cancel the loop mid-way; the summary reflects what
 *    was completed before cancellation.
 */

import { CACHE_NAMES, versionedCacheName } from "./cacheStrategy";
import { KEY_OFFLINE_DOWNLOADED_AT } from "@/lib/storage/keys";
import { GENERATED_SPRITE_WIDTHS } from "@/lib/sprites/imageLoaderHelpers";
import { spriteVariantUrl } from "@/lib/sprites/url";

/** Bounded concurrency for parallel fetches. */
const CONCURRENCY = 6;

/**
 * All pre-generated WebP render widths. These match the folder names under
 * `public/sprites/pokemon/webp/<id>/`. Imported directly from the loader
 * helpers so the two stay in sync automatically.
 */
const SPRITE_RENDER_WIDTHS: readonly number[] = GENERATED_SPRITE_WIDTHS;

/**
 * localStorage key that records the timestamp of the last completed download.
 *
 * Canonical definition lives in `lib/storage/keys.ts`; re-exported here for
 * backwards-compatibility so existing callers can import from either location.
 */
export const OFFLINE_DOWNLOADED_AT_KEY = KEY_OFFLINE_DOWNLOADED_AT;

export type PrecacheProgress = {
  done: number;
  total: number;
  bytesSoFar: number;
};

export type PrecacheSummary = {
  totalRequested: number;
  downloaded: number;
  skipped: number;
  failed: number;
};

type PrecacheOptions = {
  ids: number[];
  onProgress?: (progress: PrecacheProgress) => void;
  signal?: AbortSignal;
};

/**
 * Build the full list of URLs to populate for a given set of species IDs.
 *
 * For each ID we produce:
 *  - Pre-generated static WebP sprite paths at each render width
 *    (`/sprites/pokemon/webp/<id>/<width>.webp`) - served as static files,
 *    no `/_next/image` endpoint involvement.
 *  - The cry audio URL (`/cries/<id>.ogg`), if present in the seed.
 *
 * Raw PNG paths (`/sprites/pokemon/<id>.png`) are intentionally excluded:
 * the Pokédex grid switched to the 64 px WebP variant in #1740, so nothing
 * requests the PNGs at runtime. The PNG files remain in `public/` as the
 * build-time source for the WebP seed script. The `/sprites/` CacheFirst
 * route in `cacheStrategy.ts` remains unchanged - PNGs are still cacheable
 * on demand if anything ever requests them.
 *
 * All sprite paths start with `/sprites/` so `classifyRequest` in
 * `cacheStrategy.ts` routes them to the sprites cache bucket via the
 * `classifyPath` prefix rule.
 */
export function buildPrecacheUrls(ids: number[]): string[] {
  const urls: string[] = [];

  for (const id of ids) {
    // Pre-generated WebP variants - one per render width.
    for (const w of SPRITE_RENDER_WIDTHS) {
      urls.push(spriteVariantUrl(id, w));
    }

    // Cry audio.
    urls.push(`/cries/${id}.ogg`);
  }

  return urls;
}

/**
 * Fetch and cache a single URL.
 *
 * Opens the appropriate cache bucket based on the URL path:
 *  - /sprites/... (WebP variants and raw PNGs) → versioned sprites cache
 *  - /cries/...                                → versioned cries cache
 *
 * The versioned names (e.g. "poke-memory-sprites-v2") are derived from
 * `versionedCacheName` - the same helper used by the service worker's
 * `CacheFirst` route handlers - so writes from this function always land in
 * the exact bucket the SW reads from.
 *
 * Returns `'skipped'` when the entry already exists in the cache.
 * Returns `'failed'`  when the network request returns a non-ok response.
 * Returns `'downloaded'` when the entry was freshly fetched and stored.
 */
async function fetchAndCache(
  url: string,
  signal: AbortSignal,
): Promise<"downloaded" | "skipped" | "failed"> {
  // Determine which cache bucket this URL belongs to and derive the versioned
  // name so the precache writes match the SW's CacheFirst reads exactly.
  const isCry = url.startsWith("/cries/");
  const cacheName = isCry
    ? versionedCacheName(CACHE_NAMES.cries)
    : versionedCacheName(CACHE_NAMES.sprites);

  let cache: Cache;
  try {
    cache = await caches.open(cacheName);
  } catch {
    // caches API unavailable (non-HTTPS, non-SW context, etc.)
    return "failed";
  }

  // Idempotency check - skip already-cached entries.
  try {
    const existing = await cache.match(url);
    if (existing !== undefined) return "skipped";
  } catch {
    // Match failure is non-fatal; proceed to fetch.
  }

  // Fetch with the AbortSignal so cancellation propagates.
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return "failed";
  }

  if (!response.ok) return "failed";

  try {
    await cache.put(url, response);
  } catch {
    return "failed";
  }

  return "downloaded";
}

/**
 * Precache every sprite and cry for the supplied species IDs.
 *
 * Progress is reported via `onProgress` after each completed URL.
 * When `signal` is aborted the loop stops and returns a partial summary.
 *
 * Safe to call multiple times - already-cached URLs are skipped.
 */
export async function precacheAll(options: PrecacheOptions): Promise<PrecacheSummary> {
  const { ids, onProgress, signal } = options;
  const urls = buildPrecacheUrls(ids);
  const total = urls.length;

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let bytesSoFar = 0;

  // Process URLs with bounded concurrency.
  let index = 0;

  async function worker(): Promise<void> {
    while (index < urls.length) {
      // Check for cancellation before starting each fetch.
      if (signal?.aborted) return;

      const url = urls[index++];
      if (url === undefined) return;

      let result: "downloaded" | "skipped" | "failed";
      try {
        result = await fetchAndCache(url, signal ?? new AbortController().signal);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        result = "failed";
      }

      if (result === "downloaded") {
        downloaded++;
        // Rough byte estimate: sprites ~25 KB, cries ~15 KB.
        bytesSoFar += url.startsWith("/cries/") ? 15_000 : 25_000;
      } else if (result === "skipped") {
        skipped++;
      } else {
        failed++;
      }

      const done = downloaded + skipped + failed;
      onProgress?.({ done, total, bytesSoFar });
    }
  }

  // Launch CONCURRENCY workers simultaneously.
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  return { totalRequested: total, downloaded, skipped, failed };
}
