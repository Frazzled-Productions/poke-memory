/**
 * Service-worker runtime caching policy — pure, framework-free classification.
 *
 * The service worker itself (`app/sw.ts`) imports {@link classifyRequest} to
 * decide which caching strategy to apply to a given request. Keeping the
 * decision logic here, away from the `serwist` runtime objects, makes it unit
 * testable in the `node` vitest project without a DOM or a service-worker
 * global scope.
 *
 * Strategies (named after their `serwist` handler counterparts):
 *
 * - `cache-first`   — serve from cache, only hit the network on a miss. Used
 *                     for immutable, content-addressed assets: sprites under
 *                     `public/sprites/**`, cries under `public/cries/**`, and
 *                     Next.js build output under `/_next/static/**`. These
 *                     never change for a given URL, so a cached copy is always
 *                     correct and an offline practice session can render every
 *                     sprite and play every cry.
 * - `network-first` — try the network, fall back to cache when offline. Used
 *                     for navigations and same-origin data so a connected user
 *                     always sees fresh content but an offline user still gets
 *                     the last-known app shell.
 * - `stale-while-revalidate` — serve the cached copy immediately and refresh
 *                     it in the background. Used for fonts and other static
 *                     assets where instant render matters more than freshness.
 * - `network-only`  — never cache. Used for cross-origin requests (e.g. the
 *                     Supabase sync endpoint) so offline reads never return a
 *                     stale cloud response and sync semantics are unchanged.
 *
 * Asset buckets
 * -------------
 * - **Sprites** (`poke-memory-sprites-v2`): self-hosted official-artwork PNGs
 *   under `/sprites/pokemon/<id>.png`, plus the `/_next/image`-optimised
 *   variants the browser requests at runtime (8 width breakpoints per sprite,
 *   ~9,225 entries total when the full offline pack is downloaded). The entry
 *   cap must exceed the offline pack size — see {@link SPRITE_CACHE_MAX_ENTRIES}.
 * - **Cries** (`poke-memory-cries-v2`): self-hosted OGG audio under
 *   `/cries/<id>.ogg`, one file per species (~1,025 entries plus regional forms).
 * - **Static** (`poke-memory-static-v2`): content-hashed Next.js build output
 *   under `/_next/static/`.
 * - **Fonts** (`poke-memory-fonts-v2`): web fonts (woff2/woff/ttf/otf/eot).
 * - **Pages** (`poke-memory-pages-v2`): navigations, RSC payloads, data
 *   requests, and any asset that does not match a more-specific bucket.
 */

/**
 * Cache-version suffix used by the service worker.
 *
 * Bumping this value changes every derived cache name (see {@link versionedCacheName}),
 * which causes the browser to treat all previously cached responses as stale and
 * re-fetch them from the network. Only bump when a deploy must discard every
 * prior cached response (e.g. a format change that would otherwise be served stale).
 *
 * THIS CONSTANT IS THE SINGLE SOURCE OF TRUTH.  Both the service worker
 * (`app/sw.ts`) and the offline precache orchestrator (`lib/pwa/precache.ts`)
 * derive their cache names from this value so that writes from `precache.ts`
 * and reads from the SW's `CacheFirst` handler always target the same bucket.
 */
export const SW_CACHE_VERSION = "v2";

/**
 * Append the cache-version suffix to a base cache name.
 *
 * Example: `versionedCacheName("poke-memory-sprites")` → `"poke-memory-sprites-v2"`.
 *
 * Callers should always use this helper rather than constructing the versioned
 * name by hand so that a version bump is a single-line change.
 */
export const versionedCacheName = (name: string): string => `${name}-${SW_CACHE_VERSION}`;

export type CacheStrategy =
  | "cache-first"
  | "network-first"
  | "stale-while-revalidate"
  | "network-only";

/** Named cache buckets, one per asset class, so each can expire independently. */
export const CACHE_NAMES = {
  sprites: "poke-memory-sprites",
  cries: "poke-memory-cries",
  static: "poke-memory-static",
  fonts: "poke-memory-fonts",
  pages: "poke-memory-pages",
} as const;

export type CacheName = (typeof CACHE_NAMES)[keyof typeof CACHE_NAMES];

/**
 * Maximum entries for the sprite cache bucket.
 *
 * The offline-download feature (#1168) writes ~9,225 sprite URLs into this
 * bucket: 8 `/_next/image` optimised-width variants + 1 raw `/sprites/pokemon/<id>.png`
 * per species, across ~1,025 species. The cap must comfortably exceed that
 * pack size so that `ExpirationPlugin` does not evict offline-downloaded
 * sprites as the user practises — culled entries become permanent cache misses
 * and broken images for the remainder of an offline session.
 *
 * 12,000 gives ~30 % headroom above the ~9,225-entry offline pack, leaving
 * room for additional evolution/alt-form art and organic runtime caching
 * without triggering LRU eviction. The opt-in 166 MB offline download already
 * implies the user accepted the storage cost.
 */
export const SPRITE_CACHE_MAX_ENTRIES = 12_000;

/** Sprite art is immutable per URL; keep it for a long time. */
export const SPRITE_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

/**
 * Up to 1025 species cries plus regional forms — cap generously.
 * Mirrors the sprite cap since the species count is the same.
 */
export const CRY_CACHE_MAX_ENTRIES = 1300;

/** Cry audio is immutable per URL; keep it as long as sprite art. */
export const CRY_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

const FONT_EXTENSION = /\.(?:woff2?|ttf|otf|eot)$/i;

/**
 * Classify a same-origin path into a caching strategy.
 *
 * This helper is intentionally path-only so that {@link classifyRequest} can
 * call it once for the raw request path and again for the decoded `url` query
 * param of `/_next/image` requests — without duplicating the rule set and
 * without risking infinite recursion (it never calls back into
 * `classifyRequest`).
 *
 * @param path  The pathname component of a same-origin URL (e.g. `/sprites/pokemon/25.png`).
 * @returns     A classification result, or `null` when no specific rule
 *              matches (caller should fall back to the pages bucket).
 */
function classifyPath(path: string): { strategy: CacheStrategy; cacheName: CacheName } | null {
  // Self-hosted sprite art — immutable per URL. Cache-first so an offline
  // practice session renders every card.
  if (path.startsWith("/sprites/")) {
    return { strategy: "cache-first", cacheName: CACHE_NAMES.sprites };
  }

  // Self-hosted cry audio — immutable per URL. Cache-first so offline practice
  // can play every cry without a network request.
  if (path.startsWith("/cries/")) {
    return { strategy: "cache-first", cacheName: CACHE_NAMES.cries };
  }

  // Next.js build output is content-hashed, so a URL never changes meaning.
  if (path.startsWith("/_next/static/")) {
    return { strategy: "cache-first", cacheName: CACHE_NAMES.static };
  }

  // Fonts — render instantly from cache, refresh in the background.
  if (FONT_EXTENSION.test(path)) {
    return { strategy: "stale-while-revalidate", cacheName: CACHE_NAMES.fonts };
  }

  return null;
}

/**
 * Classify a request into a runtime caching strategy.
 *
 * Handles the `/_next/image` optimiser path by decoding the `url` query param
 * and re-applying the classification rules to the underlying asset path. This
 * ensures optimised sprite variants (requested as `/_next/image?url=%2Fsprites%2F...`)
 * route to the sprites cache rather than the network-first pages bucket, so
 * offline practice correctly serves cached sprites.
 *
 * One level of indirection only — the decoded `url` is classified via
 * {@link classifyPath}, not via a recursive `classifyRequest` call, so there
 * is no possibility of a recursion bomb.
 *
 * @param url        The fully-qualified request URL.
 * @param origin     The app's own origin (e.g. `https://pokememory.com`).
 *                   Cross-origin requests are never cached.
 * @param requestMode The Fetch API request `mode` — `"navigate"` for top-level
 *                   document navigations. Optional; defaults to a non-navigation.
 */
export function classifyRequest(
  url: string,
  origin: string,
  requestMode?: RequestMode,
): { strategy: CacheStrategy; cacheName?: CacheName } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // An unparseable URL is never cached.
    return { strategy: "network-only" };
  }

  // Cross-origin requests (Supabase sync, GitHub avatars, analytics) bypass the
  // cache entirely. This keeps the best-effort sync model in docs/sync.md
  // intact — an offline read can never return a stale cloud response.
  if (parsed.origin !== origin) {
    return { strategy: "network-only" };
  }

  const path = parsed.pathname;

  // `/_next/image` is the Next.js image-optimisation endpoint. The browser
  // requests `/_next/image?url=%2Fsprites%2F...` rather than the raw asset
  // path, so the path-based rules below would not match. Decode the `url`
  // query param and re-classify against the underlying asset path so that
  // optimised sprite variants still land in the sprites cache.
  //
  // Only one level of indirection: we call `classifyPath`, not `classifyRequest`,
  // so there is no recursion risk. Cross-origin optimiser URLs (e.g. GitHub
  // avatars) resolve to `null` from `classifyPath` and fall through to the
  // pages bucket — which is fine, because the outer cross-origin guard above
  // has already handled the case where the *request itself* is cross-origin;
  // here the request is same-origin (`/_next/image` is served by our app) but
  // the underlying image source may be external.
  if (path === "/_next/image") {
    const rawParam = parsed.searchParams.get("url");
    if (rawParam !== null) {
      let innerParsed: URL | null = null;
      try {
        innerParsed = new URL(decodeURIComponent(rawParam), origin);
      } catch {
        // Malformed url param — fall through to pages bucket.
      }
      // Same-origin guard: only route to an immutable-asset bucket when the
      // decoded source URL belongs to our own origin. A future `remotePatterns`
      // entry whose path happens to start with `/sprites/` or `/cries/` must
      // not be mis-classified into our local sprite or cry bucket. Cross-origin
      // optimiser URLs (e.g. GitHub avatars, external CDNs) fall through to
      // the pages bucket — they are already handled as network-first there,
      // which is the correct behaviour for mutable remote assets.
      if (innerParsed !== null && innerParsed.origin === origin) {
        const innerResult = classifyPath(innerParsed.pathname);
        if (innerResult !== null) {
          return innerResult;
        }
      }
    }
    // Non-sprite optimiser request (other same-origin assets, cross-origin
    // image sources) — fall through to the pages bucket below.
  }

  // Apply path-based classification for all other same-origin paths.
  const pathResult = classifyPath(path);
  if (pathResult !== null) {
    return pathResult;
  }

  // Top-level navigations — network-first so a connected user gets fresh
  // pages, an offline user falls back to the cached app shell.
  if (requestMode === "navigate") {
    return { strategy: "network-first", cacheName: CACHE_NAMES.pages };
  }

  // Everything else same-origin (data fetches, RSC payloads) — network-first.
  return { strategy: "network-first", cacheName: CACHE_NAMES.pages };
}

/**
 * Whether a request URL should be runtime-cached at all. A thin wrapper around
 * {@link classifyRequest} for call sites that only need a yes/no answer.
 */
export function shouldCache(url: string, origin: string, requestMode?: RequestMode): boolean {
  return classifyRequest(url, origin, requestMode).strategy !== "network-only";
}
