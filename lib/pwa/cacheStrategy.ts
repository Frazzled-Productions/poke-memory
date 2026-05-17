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
 *                     `public/sprites/**` and Next.js build output under
 *                     `/_next/static/**`. These never change for a given URL,
 *                     so a cached copy is always correct and an offline
 *                     practice session can render every sprite.
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
 */
export type CacheStrategy =
  | "cache-first"
  | "network-first"
  | "stale-while-revalidate"
  | "network-only";

/** Named cache buckets, one per asset class, so each can expire independently. */
export const CACHE_NAMES = {
  sprites: "poke-memory-sprites",
  static: "poke-memory-static",
  fonts: "poke-memory-fonts",
  pages: "poke-memory-pages",
} as const;

export type CacheName = (typeof CACHE_NAMES)[keyof typeof CACHE_NAMES];

/** Up to 1025 species sprites plus evolution art — cap generously. */
export const SPRITE_CACHE_MAX_ENTRIES = 1300;

/** Sprite art is immutable per URL; keep it for a long time. */
export const SPRITE_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

const FONT_EXTENSION = /\.(?:woff2?|ttf|otf|eot)$/i;

/**
 * Classify a request into a runtime caching strategy.
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

  // Self-hosted sprite art — immutable per URL. Cache-first so an offline
  // practice session renders every card.
  if (path.startsWith("/sprites/")) {
    return { strategy: "cache-first", cacheName: CACHE_NAMES.sprites };
  }

  // Next.js build output is content-hashed, so a URL never changes meaning.
  if (path.startsWith("/_next/static/")) {
    return { strategy: "cache-first", cacheName: CACHE_NAMES.static };
  }

  // Fonts — render instantly from cache, refresh in the background.
  if (FONT_EXTENSION.test(path)) {
    return { strategy: "stale-while-revalidate", cacheName: CACHE_NAMES.fonts };
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
