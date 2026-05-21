/**
 * Offline precache orchestrator.
 *
 * Iterates every sprite and cry URL for every Pokémon in the seed and
 * populates the service-worker runtime caches so practice sessions work
 * without a network connection.
 *
 * Strategy:
 *  - Sprites are cached at every render width used by the app so
 *    `next/image` serves optimised variants from the cache (not the network).
 *    The raw /sprites/... path is also cached for the Pokédex-grid exemption
 *    which uses a plain <img>.
 *  - Cries are cached once at their canonical /cries/<id>.ogg URL.
 *  - Each URL is checked with `cache.match` before fetching — already-cached
 *    assets are skipped, making the operation idempotent and resumable.
 *  - Fetches are bounded to CONCURRENCY at a time to avoid hammering the server.
 *  - An AbortSignal can cancel the loop mid-way; the summary reflects what
 *    was completed before cancellation.
 */

import { CACHE_NAMES } from "./cacheStrategy";
import {
  PRACTICE_SPRITE_SIZE,
  PICKER_SPRITE_SIZE,
  POKEDEX_GRID_SPRITE_SIZE,
  POKEDEX_DETAIL_SPRITE_SIZE,
  POKEDEX_NODE_SPRITE_SIZE,
  POKEDEX_FORM_SPRITE_SIZE,
  PASTURE_SPRITE_SIZE,
  STATS_SPRITE_SIZE,
} from "@/lib/sprites/sizes";

/** Bounded concurrency for parallel fetches — mirrors Next.js image optimiser. */
const CONCURRENCY = 6;

/** All render widths used across app surfaces. Deduped. */
const SPRITE_RENDER_WIDTHS: number[] = Array.from(
  new Set([
    PRACTICE_SPRITE_SIZE,
    PICKER_SPRITE_SIZE,
    POKEDEX_DETAIL_SPRITE_SIZE,
    POKEDEX_FORM_SPRITE_SIZE,
    POKEDEX_GRID_SPRITE_SIZE,
    POKEDEX_NODE_SPRITE_SIZE,
    PASTURE_SPRITE_SIZE,
    STATS_SPRITE_SIZE,
  ]),
);

/** localStorage key that records the timestamp of the last completed download. */
export const OFFLINE_DOWNLOADED_AT_KEY = "poke-memory:offline-downloaded-at";

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
 *  - Optimised sprite variant URLs at each render width
 *    (`/_next/image?url=%2Fsprites%2Fpokemon%2F<id>.png&w=<w>&q=75`)
 *  - The raw sprite path for the Pokédex-grid <img> exemption
 *    (`/sprites/pokemon/<id>.png`)
 *  - The cry audio URL (`/cries/<id>.ogg`), if present in the seed
 *    (callers pass only IDs that have a cry, or all IDs — we skip null
 *    cries implicitly by always including the URL and letting the fetch
 *    result in a 404 which is counted as failed, not downloaded)
 *
 * The raw sprite and cry URLs go to the sprites / cries SW cache buckets via
 * the service-worker `classifyRequest` rules that are already in place from
 * #1166. The /_next/image variant URLs also route to the sprites bucket
 * because `classifyRequest` decodes the `url` param and classifies the
 * underlying path.
 */
export function buildPrecacheUrls(ids: number[]): string[] {
  const urls: string[] = [];

  for (const id of ids) {
    // Optimised sprite variants — one per render width.
    const rawSpritePath = `/sprites/pokemon/${id}.png`;
    for (const w of SPRITE_RENDER_WIDTHS) {
      urls.push(
        `/_next/image?url=${encodeURIComponent(rawSpritePath)}&w=${w}&q=75`,
      );
    }

    // Raw sprite path for the Pokédex-grid <img> exemption.
    urls.push(rawSpritePath);

    // Cry audio.
    urls.push(`/cries/${id}.ogg`);
  }

  return urls;
}

/**
 * Fetch and cache a single URL.
 *
 * Opens the appropriate cache bucket based on the URL path:
 *  - /_next/image variants and raw /sprites/... → sprites cache
 *  - /cries/...                                 → cries cache
 *
 * Returns `'skipped'` when the entry already exists in the cache.
 * Returns `'failed'`  when the network request returns a non-ok response.
 * Returns `'downloaded'` when the entry was freshly fetched and stored.
 */
async function fetchAndCache(
  url: string,
  signal: AbortSignal,
): Promise<"downloaded" | "skipped" | "failed"> {
  // Determine which cache bucket this URL belongs to.
  const isCry = url.startsWith("/cries/");
  const cacheName = isCry ? CACHE_NAMES.cries : CACHE_NAMES.sprites;

  let cache: Cache;
  try {
    cache = await caches.open(cacheName);
  } catch {
    // caches API unavailable (non-HTTPS, non-SW context, etc.)
    return "failed";
  }

  // Idempotency check — skip already-cached entries.
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
 * Safe to call multiple times — already-cached URLs are skipped.
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
