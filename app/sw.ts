/**
 * Poké Memory service worker (source).
 *
 * This file is the `swSrc` bundled by `@serwist/turbopack` via the route
 * handler at `app/sw/[path]/route.ts`. It is NOT a Next.js route itself — a
 * stray `.ts` file in `app/` is ignored by the App Router. esbuild bundles it
 * into `/sw/sw.js`, which the client registers.
 *
 * What it does:
 * - Precaches the app shell. `self.__SW_MANIFEST` is the injection point that
 *   `@serwist/turbopack` replaces at build time with the list of build-output
 *   files (JS and CSS — see the `globPatterns` in `app/sw/[path]/route.ts`).
 *   HTML documents are not precached; they are runtime-cached network-first so
 *   an offline visit still falls back to the last-known shell. With the static
 *   assets precached, an installed PWA opens offline.
 * - Runtime-caches sprites cache-first and navigations/data network-first, per
 *   the policy in `lib/pwa/cacheStrategy.ts`. Cross-origin requests (Supabase
 *   sync) are never cached, so the best-effort sync model is unchanged.
 * - Versions every cache via `SW_CACHE_VERSION`. Bumping it changes every
 *   cache name, so a deploy that needs a clean slate orphans the old caches;
 *   the `ExpirationPlugin` and the client update prompt handle the rest.
 *
 * Sync interaction: this worker only caches reads. localStorage stays the
 * source of truth and the per-grade upsert / unload beacon already tolerate
 * being offline (see docs/sync.md). No queued-write model is introduced here.
 */
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type RuntimeCaching,
} from "serwist";
import {
  CACHE_NAMES,
  SPRITE_CACHE_MAX_AGE_SECONDS,
  SPRITE_CACHE_MAX_ENTRIES,
  classifyRequest,
} from "@/lib/pwa/cacheStrategy";

/**
 * Cache-version tag. Bump this string whenever a release must discard every
 * previously cached response (e.g. an app-shell format change that would
 * otherwise be served stale). It is appended to every cache name below.
 */
const SW_CACHE_VERSION = "v1";

/**
 * Minimal typing for the service-worker global scope.
 *
 * The project `tsconfig.json` uses the `dom` lib (the app is a React app), so
 * the `webworker` lib is not loaded and `ServiceWorkerGlobalScope` is not in
 * scope. Pulling in `webworker` globally would clash with `dom` (`self`,
 * `addEventListener`, ...). Declaring only the surface this file touches keeps
 * the worker fully type-checked without that conflict. esbuild bundles this
 * file for the real worker scope at build time, where the globals do exist.
 */
interface ServiceWorkerScope {
  /** Build-time injection point replaced by @serwist/turbopack. */
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  location: { origin: string };
  skipWaiting(): Promise<void>;
  addEventListener(
    type: "message",
    listener: (event: { data?: { type?: string } }) => void,
  ): void;
}

declare const self: ServiceWorkerScope;

const versioned = (name: string) => `${name}-${SW_CACHE_VERSION}`;

/**
 * Runtime caching routes. Each `matcher` delegates to the pure
 * `classifyRequest` helper so the strategy decision is the one covered by
 * `lib/pwa/cacheStrategy.test.ts`.
 */
const runtimeCaching: RuntimeCaching[] = [
  {
    // Sprite art — immutable per URL, cache-first, large cap.
    matcher: ({ url, request }) =>
      classifyRequest(url.href, self.location.origin, request.mode).cacheName ===
      CACHE_NAMES.sprites,
    handler: new CacheFirst({
      cacheName: versioned(CACHE_NAMES.sprites),
      plugins: [
        new ExpirationPlugin({
          maxEntries: SPRITE_CACHE_MAX_ENTRIES,
          maxAgeSeconds: SPRITE_CACHE_MAX_AGE_SECONDS,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    // Next.js content-hashed build output — cache-first.
    matcher: ({ url, request }) =>
      classifyRequest(url.href, self.location.origin, request.mode).cacheName ===
      CACHE_NAMES.static,
    handler: new CacheFirst({
      cacheName: versioned(CACHE_NAMES.static),
      plugins: [
        new ExpirationPlugin({
          maxEntries: 128,
          maxAgeSeconds: 60 * 60 * 24 * 30,
        }),
      ],
    }),
  },
  {
    // Fonts — instant from cache, refreshed in the background.
    matcher: ({ url, request }) =>
      classifyRequest(url.href, self.location.origin, request.mode).cacheName ===
      CACHE_NAMES.fonts,
    handler: new StaleWhileRevalidate({
      cacheName: versioned(CACHE_NAMES.fonts),
      plugins: [
        new ExpirationPlugin({
          maxEntries: 16,
          maxAgeSeconds: 60 * 60 * 24 * 30,
        }),
      ],
    }),
  },
  {
    // Same-origin navigations and data — network-first, cache fallback offline.
    matcher: ({ url, request }) =>
      classifyRequest(url.href, self.location.origin, request.mode).cacheName ===
      CACHE_NAMES.pages,
    handler: new NetworkFirst({
      cacheName: versioned(CACHE_NAMES.pages),
      networkTimeoutSeconds: 10,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: 60 * 60 * 24 * 7,
        }),
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    // Drop precached entries from older deployments rather than serving them.
    cleanupOutdatedCaches: true,
  },
  // `skipWaiting` is intentionally false: a new worker waits until the user
  // accepts the in-app "refresh to update" prompt, which posts SKIP_WAITING.
  // This avoids swapping the app shell mid-session.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

// Honour the client's "update now" action: when the prompt's button is
// pressed, `ServiceWorkerProvider` calls `messageSkipWaiting()`, which posts a
// SKIP_WAITING message. Activating here lets the new worker take over.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

serwist.addEventListeners();
