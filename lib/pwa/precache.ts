/**
 * Offline precache orchestrator.
 *
 * Iterates every sprite and cry URL for every Pokémon in the seed and
 * populates the service-worker runtime caches so practice sessions work
 * without a network connection.
 *
 * Strategy:
 *  - Sprites are cached as pre-generated static WebP files at a curated
 *    subset of render widths - those actually used by offline-reachable
 *    surfaces. The browser fetches these directly from
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
import { spriteVariantUrl } from "@/lib/sprites/url";

/** Bounded concurrency for parallel fetches. */
const CONCURRENCY = 6;

/**
 * The subset of pre-generated WebP widths actually needed for offline use.
 *
 * All 10 widths are generated on disk by `npm run seed:sprites` (see
 * `GENERATED_SPRITE_WIDTHS` in `lib/sprites/imageLoaderHelpers.ts`); this
 * list is deliberately narrower - it contains only the widths whose
 * offline-reachable surfaces would request them.
 *
 * Kept (9 widths - rationale per surface):
 *   32  - `FAVOURITE_MASCOT_SPRITE_SIZE`: nav mascot badge, visible on every page.
 *   40  - `POKEDEX_NODE_SPRITE_SIZE`: Pokédex detail evo-chain nodes; Journey EvolutionWall.
 *   48  - `STATS_SPRITE_SIZE`: Stats "worst cards" list; Journey CloseToMastery.
 *   56  - `PASTURE_SPRITE_SIZE`: Pasture tile sprites.
 *   64  - `POKEDEX_GRID_SPRITE_SIZE`: Pokédex grid; Settings mascot; Onboarding quiz.
 *  120  - `POKEDEX_FORM_SPRITE_SIZE`: Pokédex alt-form blocks; HigherOrLower minigame;
 *          also the #1787 grid-retina srcset (1× 64 → 2× 120).
 *  150  - `PICKER_SPRITE_SIZE`: SpritePicker four-tile grid in Practice.
 *  192  - `POKEDEX_DETAIL_SPRITE_SIZE`: Pokédex detail main sprite;
 *          also the #1787 grid-retina srcset (3× 64 → 3× 192).
 *  320  - `PRACTICE_SPRITE_SIZE`: review flip cards (name, cry, evolution, reverse).
 *
 * Dropped (1 width):
 *  180  - `THEME_WATERMARK_SPRITE_SIZE`: decorative background sprite only. The
 *          watermark renders at low opacity as pure chrome; its absence offline
 *          has zero impact on app functionality. Saves ~7.8 MB of precache.
 *
 * Size impact (#1789):
 *   Pre-trim  (all 10 widths + cries): ~67.5 MB actual file bytes
 *                                      (~96 MB by `du`, which counts 4 KB blocks).
 *   Post-trim (these 9 widths + cries): ~59.7 MB actual file bytes.
 *
 * Do NOT change this list to add a new generated width without also auditing
 * whether the new width's surface is offline-reachable. If it is reachable,
 * add it here too; if not, leave it out. Changes here grow every user's
 * offline download by ~1025 × (size per width).
 */
export const OFFLINE_PRECACHE_WIDTHS: readonly number[] = [
  32,  // FAVOURITE_MASCOT_SPRITE_SIZE
  40,  // POKEDEX_NODE_SPRITE_SIZE
  48,  // STATS_SPRITE_SIZE
  56,  // PASTURE_SPRITE_SIZE
  64,  // POKEDEX_GRID_SPRITE_SIZE
  120, // POKEDEX_FORM_SPRITE_SIZE (+ #1787 grid-retina 2×)
  150, // PICKER_SPRITE_SIZE
  192, // POKEDEX_DETAIL_SPRITE_SIZE (+ #1787 grid-retina 3×)
  320, // PRACTICE_SPRITE_SIZE
];

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
    // Pre-generated WebP variants - one per offline-reachable render width.
    // OFFLINE_PRECACHE_WIDTHS is a strict subset of GENERATED_SPRITE_WIDTHS;
    // see its declaration for the rationale and size accounting.
    for (const w of OFFLINE_PRECACHE_WIDTHS) {
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
