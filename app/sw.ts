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
 * Background Sync (#1054): handles the `poke-memory:grade-sync` sync event.
 * When the device reconnects after offline grading, the browser fires a `sync`
 * event in this worker even if every app tab is closed. The handler reads the
 * persisted pending-grade queue from IndexedDB (the same `poke-memory/kv` store
 * used by `lib/idb/db.ts`) and replays it against `/api/sync`. If active window
 * clients are present, the handler posts `BACKGROUND_SYNC_REPLAY` to them
 * instead — `useOnlineReconnectSync` then handles the pull-before-push
 * sequence so the sync invariants from docs/sync.md are respected.
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

/** IndexedDB database/store names — must match lib/idb/db.ts exactly. */
const IDB_DB_NAME = "poke-memory";
const IDB_STORE_NAME = "kv";
/**
 * localStorage / IDB key for the persisted pending-grade queue.
 * Must stay byte-identical to KEY_PENDING_GRADE_QUEUE in lib/storage/keys.ts.
 */
const PENDING_QUEUE_KEY = "poke-memory:pending-grade-queue:v1";

/**
 * Sync tag — must stay byte-identical to BACKGROUND_SYNC_TAG in
 * lib/sync/backgroundSync.ts.
 */
const BACKGROUND_SYNC_TAG = "poke-memory:grade-sync";

/**
 * Message type sent to active window clients when the `sync` event fires while
 * the app is open. Must stay byte-identical to SW_REPLAY_MESSAGE in
 * lib/sync/backgroundSync.ts.
 */
const SW_REPLAY_MESSAGE = "BACKGROUND_SYNC_REPLAY";

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
  addEventListener(
    type: "sync",
    listener: (event: SyncEvent) => void,
  ): void;
  clients: {
    matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<Array<{
      postMessage(data: unknown): void;
      visibilityState?: string;
    }>>;
  };
  registration: {
    sync?: { register(tag: string): Promise<void> };
  };
  indexedDB: IDBFactory;
}

/** Minimal shape of a Background Sync event. */
interface SyncEvent extends Event {
  tag: string;
  waitUntil(promise: Promise<unknown>): void;
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

/**
 * Reads the persisted pending-grade queue from the shared `poke-memory` IDB
 * store. Returns an empty array when the key is absent or IDB is unavailable.
 * Uses raw indexedDB API because the `lib/idb/db.ts` wrapper guards on
 * `typeof window === "undefined"` and is therefore not callable from the SW.
 */
async function readPendingQueueFromIdb(): Promise<unknown[]> {
  return new Promise((resolve) => {
    try {
      const request = self.indexedDB.open(IDB_DB_NAME, 1);
      request.onerror = () => resolve([]);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        try {
          const tx = db.transaction(IDB_STORE_NAME, "readonly");
          const store = tx.objectStore(IDB_STORE_NAME);
          const getReq = store.get(PENDING_QUEUE_KEY);
          getReq.onsuccess = () => {
            db.close();
            const raw: unknown = getReq.result;
            if (typeof raw !== "string") {
              resolve([]);
              return;
            }
            try {
              const parsed: unknown = JSON.parse(raw);
              resolve(Array.isArray(parsed) ? parsed : []);
            } catch {
              resolve([]);
            }
          };
          getReq.onerror = () => { db.close(); resolve([]); };
        } catch {
          db.close();
          resolve([]);
        }
      };
    } catch {
      resolve([]);
    }
  });
}

/**
 * Clears the persisted pending-grade queue from IDB after a successful SW push.
 * Best-effort — errors are swallowed.
 */
async function clearPendingQueueFromIdb(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = self.indexedDB.open(IDB_DB_NAME, 1);
      request.onerror = () => resolve();
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        try {
          const tx = db.transaction(IDB_STORE_NAME, "readwrite");
          const store = tx.objectStore(IDB_STORE_NAME);
          const delReq = store.delete(PENDING_QUEUE_KEY);
          delReq.onsuccess = () => { db.close(); resolve(); };
          delReq.onerror = () => { db.close(); resolve(); };
        } catch {
          db.close();
          resolve();
        }
      };
    } catch {
      resolve();
    }
  });
}

/**
 * Background Sync handler (#1054).
 *
 * Fires when the browser reconnects after offline grading, even if every app
 * tab has been closed. The handler:
 *
 *   1. Checks for active window clients. If any are present, posts
 *      `BACKGROUND_SYNC_REPLAY` to each one and returns — the mounted
 *      `useOnlineReconnectSync` hook handles the pull-before-push sequence so
 *      the sync invariants from docs/sync.md are respected and no concurrent
 *      push occurs.
 *
 *   2. When no clients are active (the app is closed), reads the pending-grade
 *      queue from IndexedDB and POSTs it to `/api/sync`. Auth cookies are
 *      included automatically by the browser for same-origin SW fetches.
 *      On success the IDB queue is cleared; on failure the event's `waitUntil`
 *      promise rejects, so the browser will retry the `sync` event later.
 *
 * Superuser write-guard: the guard runs in the client context (the hook passes
 * null client/userId when a superuser flag is on). In this SW path there is no
 * session context to inspect, but the `/api/sync` route handler re-authenticates
 * via session cookie and returns 401 for unauthenticated calls. A QA session
 * therefore produces no cloud writes via this path either — the IDB queue is
 * cleared by `enqueueGrade` (which calls `clearPendingQueue` when superuser is
 * active) before the tab is closed, so the queue is empty when the SW fires.
 */
self.addEventListener("sync", (event) => {
  if (event.tag !== BACKGROUND_SYNC_TAG) return;

  event.waitUntil(
    (async () => {
      // Step 1: delegate to any active window clients so they can honour the
      // pull-before-push invariant. Using `includeUncontrolled: false` ensures
      // we only message clients that are controlled by this worker (i.e. loaded
      // from the same origin and SW scope).
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: false });
      if (clients.length > 0) {
        // Post to all active clients — the first one to process the message
        // will run the catch-up. The `useOnlineReconnectSync` in-flight guard
        // prevents concurrent runs within the same client.
        for (const client of clients) {
          client.postMessage({ type: SW_REPLAY_MESSAGE });
        }
        // Return without pushing from the SW — the client handles it.
        return;
      }

      // Step 2: no active clients — push directly from the SW.
      const queue = await readPendingQueueFromIdb();
      if (queue.length === 0) {
        // Nothing to push; resolve so the sync event is not retried.
        return;
      }

      // POST the queue to /api/sync. The route handler authenticates via
      // session cookie (same-origin request; cookies are included by default).
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards: queue }),
        credentials: "include",
      });

      if (!res.ok) {
        // Non-2xx from the server: reject so the browser retries the sync.
        throw new Error(`[sw-sync] /api/sync returned ${String(res.status)}`);
      }

      // All cards pushed successfully — clear the IDB queue.
      await clearPendingQueueFromIdb();
    })(),
  );
});

serwist.addEventListeners();
