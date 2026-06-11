/**
 * Offline precache orchestrator.
 *
 * Iterates every sprite and cry URL for every Pokémon in the seed and
 * populates the IndexedDB offline-pack store so practice sessions work
 * without a network connection.
 *
 * Storage change (#1803 root cause fix): sprites and cries are now stored in
 * IndexedDB (via `lib/pwa/offlineStore.ts`) instead of Cache Storage. When the
 * pack was in Cache Storage, WebKit's `cache.match` became globally slow with
 * ~10,000+ entries, hanging cold launch even though the app-shell precache is
 * tiny. Moving the pack to IndexedDB keeps Cache Storage small so cold-launch
 * serving is always fast.
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
 *  - Each URL is checked with `offlineHas` before fetching - already-cached
 *    assets are skipped, making the operation idempotent and resumable.
 *  - Fetches are bounded to CONCURRENCY at a time to avoid hammering the server.
 *  - An AbortSignal can cancel the loop mid-way; the summary reflects what
 *    was completed before cancellation.
 */

import { offlineHas, offlinePut } from "./offlineStore";
import { KEY_OFFLINE_DOWNLOADED_AT } from "@/lib/storage/keys";
import { spriteVariantUrl } from "@/lib/sprites/url";

/** Bounded concurrency for parallel fetches. */
const CONCURRENCY = 6;

/**
 * Expected total size of the offline pack (sprites + cries) in bytes.
 *
 * Derived from the `downloadDescription` copy ("About 166 MB") and the
 * post-trim accounting in OFFLINE_PRECACHE_WIDTHS JSDoc (~59.7 MB sprites +
 * ~6 MB cries = ~66 MB raw file bytes on disk, but IndexedDB storage overhead
 * and browser padding mean the on-device quota cost is higher). The 166 MB
 * figure is the observed Quota cost on a typical iOS device (WebKit inflates
 * the quota accounting relative to actual file bytes).
 *
 * Used by the pre-flight quota check in `downloadController.ts` to compare
 * against the remaining storage headroom before starting a download.
 */
export const OFFLINE_PACK_EXPECTED_BYTES = 166 * 1024 * 1024; // 166 MB

/**
 * Safety buffer added on top of `OFFLINE_PACK_EXPECTED_BYTES` when checking
 * available storage headroom. This reserves room for concurrent card-progress
 * saves (`saveSession`) so they do not hit QuotaExceededError while the pack
 * is being written.
 *
 * 20 MB is generous: a full `saveSession` snapshot is a few KB. The buffer
 * exists to absorb rounding errors in the estimate, pack size growth, and any
 * other origin storage (FSRS state, settings) that is already present.
 */
export const OFFLINE_SAVE_BUFFER_BYTES = 20 * 1024 * 1024; // 20 MB

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
 * build-time source for the WebP seed script.
 *
 * All sprite paths start with `/sprites/` so the SW's IDB handler (in
 * `app/sw.ts`) intercepts them and serves from IndexedDB when present.
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
 * Determine the content-type for a URL based on its extension.
 * Used when storing blobs in IndexedDB so the SW can reconstruct a Response.
 */
function contentTypeForUrl(url: string): string {
  if (url.endsWith(".webp")) return "image/webp";
  if (url.endsWith(".png")) return "image/png";
  if (url.endsWith(".ogg")) return "audio/ogg";
  return "application/octet-stream";
}

/**
 * Fetch a single URL and persist its body to the IndexedDB offline-pack store.
 *
 * Returns `'skipped'` when the entry already exists in IndexedDB.
 * Returns `'failed'` when the network request returns a non-ok response or
 *   IndexedDB is unavailable.
 * Returns `{ result: 'downloaded', bytes: number }` when the entry was freshly
 *   fetched and stored, with the real byte size from the Content-Length header
 *   (or the blob size as a fallback when the header is absent).
 */
async function fetchAndStore(
  url: string,
  signal: AbortSignal,
): Promise<"skipped" | "failed" | { result: "downloaded"; bytes: number }> {
  // Idempotency check - skip already-stored entries.
  try {
    const exists = await offlineHas(url);
    if (exists) return "skipped";
  } catch {
    // IDB check failure is non-fatal; proceed to fetch.
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

  // Determine the content-type before consuming the body.
  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ??
    contentTypeForUrl(url);

  // Read the real byte size. Content-Length is present on same-origin static
  // files (sprites, cries). If absent, derive from the blob after reading.
  const contentLength = response.headers.get("content-length");
  let bytes: number;

  if (contentLength !== null && contentLength !== "") {
    bytes = parseInt(contentLength, 10);
    if (!Number.isFinite(bytes) || bytes < 0) bytes = 0;

    // Read the body as a blob and store it.
    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      return "failed";
    }

    try {
      await offlinePut(url, { blob, contentType });
    } catch {
      return "failed";
    }
  } else {
    // No Content-Length - read the blob first to get the size.
    let blob: Blob;
    try {
      blob = await response.blob();
      bytes = blob.size;
    } catch {
      return "failed";
    }

    try {
      await offlinePut(url, { blob, contentType });
    } catch {
      return "failed";
    }
  }

  return { result: "downloaded", bytes };
}

/**
 * Precache every sprite and cry for the supplied species IDs.
 *
 * Progress is reported via `onProgress` after each completed URL.
 * When `signal` is aborted the loop stops and returns a partial summary.
 *
 * Safe to call multiple times - already-stored URLs are skipped.
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

      let result: "skipped" | "failed" | { result: "downloaded"; bytes: number };
      try {
        result = await fetchAndStore(url, signal ?? new AbortController().signal);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        result = "failed";
      }

      if (typeof result === "object" && result.result === "downloaded") {
        downloaded++;
        // Real bytes from Content-Length header (or blob fallback).
        bytesSoFar += result.bytes;
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
