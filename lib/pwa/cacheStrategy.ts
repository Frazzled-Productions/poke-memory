/**
 * Service-worker runtime caching policy - pure, framework-free classification.
 *
 * The service worker itself (`app/sw.ts`) imports {@link classifyRequest} to
 * decide which caching strategy to apply to a given request. Keeping the
 * decision logic here, away from the `serwist` runtime objects, makes it unit
 * testable in the `node` vitest project without a DOM or a service-worker
 * global scope.
 *
 * Strategies (named after their `serwist` handler counterparts):
 *
 * - `cache-first` - serve from cache, only hit the network on a miss. Used
 *                     for immutable, content-addressed assets: Next.js build
 *                     output under `/_next/static/**`. These never change for
 *                     a given URL, so a cached copy is always correct.
 * - `stale-while-revalidate` - serve the cached copy immediately and refresh
 *                     it in the background. Used for navigations, seed data,
 *                     fonts, and other assets where instant render matters more
 *                     than freshness. This is the cold-launch strategy: the
 *                     first visit fetches from the network; every subsequent
 *                     cold launch is served instantly from cache while a
 *                     background fetch updates the cached shell (see #1803).
 * - `network-first` - try the network, fall back to cache when offline. No
 *                     longer used for navigations; retained as a strategy type
 *                     for any future asset class that needs it.
 * - `network-only` - never cache. Used for cross-origin requests (e.g. the
 *                     Supabase sync endpoint) so offline reads never return a
 *                     stale cloud response and sync semantics are unchanged.
 * - `idb-first` - serve from IndexedDB, fall back to network. Used for
 *                     sprites (`/sprites/`) and cries (`/cries/`). The offline
 *                     pack is stored in IndexedDB rather than Cache Storage
 *                     (#1803 root cause fix): WebKit's `cache.match` becomes
 *                     globally slow with ~10,000+ Cache Storage entries,
 *                     hanging cold launch. IndexedDB handles large blob counts
 *                     without this penalty.
 *
 * Asset buckets
 * -------------
 * - **Sprites** and **Cries**: offline pack now lives in IndexedDB
 *   (`poke-memory` DB, `offline-pack` store). The SW intercepts `/sprites/`
 *   and `/cries/` requests, looks them up in IDB, and falls back to network.
 *   The old `poke-memory-sprites-v2` / `poke-memory-cries-v2` Cache Storage
 *   buckets are deleted on SW activate (migration for existing users).
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
 * and reads from the SW's handlers always target the same buckets.
 */
export const SW_CACHE_VERSION = "v2";

/**
 * Append the cache-version suffix to a base cache name.
 *
 * Example: `versionedCacheName("poke-memory-static")` → `"poke-memory-static-v2"`.
 *
 * Callers should always use this helper rather than constructing the versioned
 * name by hand so that a version bump is a single-line change.
 */
export const versionedCacheName = (name: string): string => `${name}-${SW_CACHE_VERSION}`;

export type CacheStrategy =
  | "cache-first"
  | "network-first"
  | "stale-while-revalidate"
  | "network-only"
  | "idb-first";

/** Named cache buckets, one per asset class, so each can expire independently. */
export const CACHE_NAMES = {
  static: "poke-memory-static",
  fonts: "poke-memory-fonts",
  pages: "poke-memory-pages",
} as const;

export type CacheName = (typeof CACHE_NAMES)[keyof typeof CACHE_NAMES];

/**
 * Legacy Cache Storage bucket names for the sprite and cry packs.
 *
 * These buckets were used before #1803's IndexedDB migration. They are kept
 * here as constants so:
 *  1. The SW activate handler can delete them for existing users.
 *  2. The "Delete offline cache" flow in OfflineSection can sweep them.
 *
 * Do NOT use these as write targets. The offline pack now lives in IndexedDB.
 */
export const LEGACY_SPRITE_CACHE_NAME = "poke-memory-sprites-v2";
export const LEGACY_CRY_CACHE_NAME = "poke-memory-cries-v2";

const FONT_EXTENSION = /\.(?:woff2?|ttf|otf|eot)$/i;

/**
 * Classify a same-origin path into a caching strategy.
 *
 * This helper is intentionally path-only so that {@link classifyRequest} can
 * call it once for the raw request path and again for the decoded `url` query
 * param of `/_next/image` requests - without duplicating the rule set and
 * without risking infinite recursion (it never calls back into
 * `classifyRequest`).
 *
 * @param path  The pathname component of a same-origin URL (e.g. `/sprites/pokemon/25.png`).
 * @returns     A classification result, or `null` when no specific rule
 *              matches (caller should fall back to the pages bucket).
 */
function classifyPath(path: string): { strategy: CacheStrategy; cacheName?: CacheName } | null {
  // API routes - never cache. Responses are authenticated and often carry
  // sensitive data (e.g. the GDPR review-history CSV from /api/export).
  // Caching them would persist personal data in Cache Storage after sign-out
  // and risk serving a stale or wrong-user response on a shared profile.
  // This rule must precede all other same-origin rules so that /api/**
  // is never routed into the pages bucket by the fallthrough at the bottom
  // of classifyRequest (#1858 F9).
  if (path.startsWith("/api/")) {
    return { strategy: "network-only" };
  }

  // Self-hosted sprite art - served from IndexedDB when present (offline pack),
  // falling back to network on miss. The SW handles the IDB lookup directly;
  // Cache Storage is no longer used for sprites.
  if (path.startsWith("/sprites/")) {
    return { strategy: "idb-first" };
  }

  // Self-hosted cry audio - same IndexedDB strategy as sprites.
  if (path.startsWith("/cries/")) {
    return { strategy: "idb-first" };
  }

  // Next.js build output is content-hashed, so a URL never changes meaning.
  if (path.startsWith("/_next/static/")) {
    return { strategy: "cache-first", cacheName: CACHE_NAMES.static };
  }

  // Fonts - render instantly from cache, refreshed in the background.
  if (FONT_EXTENSION.test(path)) {
    return { strategy: "stale-while-revalidate", cacheName: CACHE_NAMES.fonts };
  }

  // Pokémon seed data (generated-core.json, generated-chains.json, etc.) -
  // precached at build time by the SW manifest glob (scripts/build-sw.mjs) and
  // served stale-while-revalidate so cold launch reads from the precache
  // instantly. The precache handler intercepts these before the runtime rules
  // run, so this rule is a fallback for any seed file not yet in the precache
  // (e.g. the first SW install before the precache is populated).
  if (path.startsWith("/pokemon-data/")) {
    return { strategy: "stale-while-revalidate", cacheName: CACHE_NAMES.pages };
  }

  return null;
}

/**
 * Classify a request into a runtime caching strategy.
 *
 * Handles the `/_next/image` optimiser path by decoding the `url` query param
 * and re-applying the classification rules to the underlying asset path. This
 * ensures optimised sprite variants (requested as `/_next/image?url=%2Fsprites%2F...`)
 * route to the `idb-first` strategy rather than the pages bucket, so
 * offline practice correctly serves cached sprites from IndexedDB.
 *
 * One level of indirection only - the decoded `url` is classified via
 * {@link classifyPath}, not via a recursive `classifyRequest` call, so there
 * is no possibility of a recursion bomb.
 *
 * @param url        The fully-qualified request URL.
 * @param origin     The app's own origin (e.g. `https://pokememory.com`).
 *                   Cross-origin requests are never cached.
 * @param requestMode The Fetch API request `mode` - `"navigate"` for top-level
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
  // intact - an offline read can never return a stale cloud response.
  if (parsed.origin !== origin) {
    return { strategy: "network-only" };
  }

  const path = parsed.pathname;

  // `/_next/image` is the Next.js image-optimisation endpoint. The browser
  // requests `/_next/image?url=%2Fsprites%2F...` rather than the raw asset
  // path, so the path-based rules below would not match. Decode the `url`
  // query param and re-classify against the underlying asset path so that
  // optimised sprite variants still use the idb-first strategy.
  //
  // Only one level of indirection: we call `classifyPath`, not `classifyRequest`,
  // so there is no recursion risk.
  if (path === "/_next/image") {
    const rawParam = parsed.searchParams.get("url");
    if (rawParam !== null) {
      let innerParsed: URL | null = null;
      try {
        innerParsed = new URL(decodeURIComponent(rawParam), origin);
      } catch {
        // Malformed url param - fall through to pages bucket.
      }
      // Same-origin guard: only route to an immutable-asset bucket when the
      // decoded source URL belongs to our own origin.
      if (innerParsed !== null && innerParsed.origin === origin) {
        const innerResult = classifyPath(innerParsed.pathname);
        if (innerResult !== null) {
          return innerResult;
        }
      }
    }
    // Non-sprite optimiser request - fall through to the pages bucket below.
  }

  // Apply path-based classification for all other same-origin paths.
  const pathResult = classifyPath(path);
  if (pathResult !== null) {
    return pathResult;
  }

  // Top-level navigations - stale-while-revalidate so the cached app shell is
  // served instantly on cold launch (no 5-10 s network gate), with a background
  // fetch updating the cached version for the next visit. (#1803)
  //
  // Regression note: the prior strategy was NetworkFirst(networkTimeoutSeconds:
  // 10). That caused every cold launch on the installed iOS PWA to block for up
  // to 10 s waiting for the network to return the / HTML document before
  // anything painted. The root cause is that the SW intercepted the navigation
  // and refused to serve a cached shell until the network responded. Switching to
  // stale-while-revalidate eliminates the wait: the cached shell is returned
  // instantly from the pages cache bucket; the network response is used to
  // refresh the cache in the background. This does NOT change offline behaviour -
  // an offline user still gets the last-known cached shell. A full App Router RSC
  // static shell precache was considered but rejected: the root page uses
  // searchParams + getTranslations and is server-rendered, so no static HTML
  // template exists at build time. SWR is the correct strategy for App Router
  // navigations where freshness can be traded for speed.
  if (requestMode === "navigate") {
    return { strategy: "stale-while-revalidate", cacheName: CACHE_NAMES.pages };
  }

  // Everything else same-origin (data fetches, RSC payloads) - stale-while-
  // revalidate for fast response; the background refresh keeps data current.
  return { strategy: "stale-while-revalidate", cacheName: CACHE_NAMES.pages };
}

/**
 * Whether a request URL should be runtime-cached at all. A thin wrapper around
 * {@link classifyRequest} for call sites that only need a yes/no answer.
 */
export function shouldCache(url: string, origin: string, requestMode?: RequestMode): boolean {
  return classifyRequest(url, origin, requestMode).strategy !== "network-only";
}
