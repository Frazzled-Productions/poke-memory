/**
 * Poké Memory service worker (source).
 *
 * This file is the `swSrc` bundled at build time by `scripts/build-sw.mjs`
 * (which reuses @serwist/build's `getFileManifestEntries` + esbuild, mirroring
 * how `@serwist/turbopack` used to bundle it via a route handler - removed in
 * #1752). It is NOT a Next.js route itself - a stray `.ts` file in `app/` is
 * ignored by the App Router. esbuild bundles it into the static asset
 * `public/sw/sw.js`, which the client registers.
 *
 * What it does:
 * - Precaches the app shell. `self.__SW_MANIFEST` is the injection point that
 *   `scripts/build-sw.mjs` replaces at build time with the list of build-output
 *   files (JS/CSS, root public assets, and Pokémon seed JSON - see the
 *   `globPatterns` in `scripts/build-sw.mjs`). With the static assets and seed
 *   data precached, an installed PWA opens instantly and the card area renders
 *   without a cold-start network round-trip. (#1803)
 * - Runtime-caches sprites cache-first and navigations/seed data
 *   stale-while-revalidate (was network-first with a 10 s timeout before #1803),
 *   per the policy in `lib/pwa/cacheStrategy.ts`. Cross-origin requests (Supabase
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
 * instead - `useOnlineReconnectSync` then handles the pull-before-push
 * sequence so the sync invariants from docs/sync.md are respected.
 */
import {
  CacheFirst,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type RuntimeCaching,
} from "serwist";
import {
  CACHE_NAMES,
  LEGACY_CRY_CACHE_NAME,
  LEGACY_SPRITE_CACHE_NAME,
  classifyRequest,
  versionedCacheName,
} from "@/lib/pwa/cacheStrategy";
import { SW_IDB_OPEN_TIMEOUT_MS, openSwIdb } from "@/lib/pwa/swIdb";

// SW_CACHE_VERSION and versionedCacheName are imported from lib/pwa/cacheStrategy.ts - 
// the single source of truth for the cache-version suffix. Both this worker and
// the offline precache orchestrator (lib/pwa/precache.ts) derive their cache
// names from that one constant so their reads and writes target the same buckets.

/**
 * IndexedDB database/store names.
 *
 * These must stay byte-identical to DB_NAME, STORE_KV, and STORE_OFFLINE_PACK
 * in lib/idb/db.ts (the single source of truth for the schema). The SW is a
 * separate esbuild bundle so it cannot import client modules directly; these
 * duplicated constants are accompanied by a comment pointing back to the
 * authoritative source.
 *
 * DB_VERSION must equal lib/idb/db.ts::DB_VERSION (currently 2).
 */
const IDB_DB_NAME = "poke-memory";  // lib/idb/db.ts::DB_NAME
const IDB_DB_VERSION = 2;           // lib/idb/db.ts::DB_VERSION
const IDB_STORE_NAME = "kv";        // lib/idb/db.ts::STORE_KV
/**
 * Object store name for the offline sprite/cry pack.
 * Must stay byte-identical to OFFLINE_IDB_STORE in lib/pwa/offlineStore.ts.
 */
const OFFLINE_PACK_STORE = "offline-pack";
/**
 * localStorage / IDB key for the persisted pending-grade queue.
 * Must stay byte-identical to KEY_PENDING_GRADE_QUEUE in lib/storage/keys.ts.
 */
const PENDING_QUEUE_KEY = "poke-memory:pending-grade-queue:v1";

/**
 * Sync tag - must stay byte-identical to BACKGROUND_SYNC_TAG in
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
  /** Build-time injection point replaced by scripts/build-sw.mjs. */
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  /**
   * Build-time version string injected by scripts/build-sw.mjs via the
   * esbuild `define` block. Value is the bare semver from package.json
   * (e.g. `"0.11.2"`). Frozen into each deployed bundle so an old
   * controlling worker always reports its own version, not the new app
   * version (#1826).
   */
  __SW_VERSION__: string;
  location: { origin: string };
  skipWaiting(): Promise<void>;
  addEventListener(
    type: "message",
    listener: (event: {
      data?: { type?: string };
      ports: readonly MessagePort[];
    }) => void,
  ): void;
  addEventListener(
    type: "sync",
    listener: (event: SyncEvent) => void,
  ): void;
  addEventListener(
    type: "push",
    listener: (event: PushEvent) => void,
  ): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: NotificationClickEvent) => void,
  ): void;
  addEventListener(
    type: "activate",
    listener: (event: { waitUntil(promise: Promise<unknown>): void }) => void,
  ): void;
  clients: {
    matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<Array<{
      postMessage(data: unknown, transfer?: Transferable[]): void;
      visibilityState?: string;
      focused?: boolean;
      url?: string;
      focus?(): Promise<unknown>;
      navigate?(url: string): Promise<unknown>;
    }>>;
    openWindow(url: string): Promise<unknown | null>;
  };
  registration: {
    sync?: { register(tag: string): Promise<void> };
    showNotification(title: string, options?: NotificationOptionsLite): Promise<void>;
  };
  indexedDB: IDBFactory;
}

/** Minimal shape of a Background Sync event. */
interface SyncEvent extends Event {
  tag: string;
  waitUntil(promise: Promise<unknown>): void;
}

/** Minimal shape of a Push event. */
interface PushEvent extends Event {
  data?: { json(): unknown; text(): string } | null;
  waitUntil(promise: Promise<unknown>): void;
}

/** Minimal shape of the notification object attached to a click event. */
interface NotificationLite {
  data?: unknown;
  close(): void;
}

/** Minimal shape of a notificationclick event. */
interface NotificationClickEvent extends Event {
  notification: NotificationLite;
  waitUntil(promise: Promise<unknown>): void;
}

/** Subset of NotificationOptions used by `showNotification`. */
interface NotificationOptionsLite {
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: unknown;
}

declare const self: ServiceWorkerScope;

/**
 * `dpl`-stripping cache-key normalisation plugin for the `/_next/image` route.
 *
 * In production on Vercel, Next.js appends `&dpl=<NEXT_DEPLOYMENT_ID>` to
 * every `/_next/image?...` request URL (confirmed in
 * `node_modules/next/dist/shared/lib/image-loader.js`, line 106):
 *
 *   return `${config.path}?url=...&w=...&q=...${src.startsWith('/') && deploymentId ? `&dpl=${deploymentId}` : ''}`;
 *
 * The offline precache orchestrator (`lib/pwa/precache.ts`) constructs URLs
 * WITHOUT `dpl`, so without this plugin a runtime `cache.match()` would fail
 * every precached sprite because the request URL has `&dpl=...` appended while
 * the stored key does not.
 *
 * Contract: `dpl` is stripped from the cache key for BOTH reads (`match`) and
 * writes (`put`). The precache writes dpl-free URLs; the runtime handler reads
 * with a dpl-stripped key. Both sides therefore normalise to the same key,
 * guaranteeing a cache hit.  The `w`, `q`, and `url` params are NOT stripped - 
 * each variant (width / quality / source) is a distinct cache entry.
 *
 * This plugin is attached ONLY to the `/_next/image` sprites route. Raw sprite
 * paths (`/sprites/pokemon/<id>.png`) and cry paths (`/cries/<id>.ogg`) do not
 * carry `dpl` and do not need normalisation.
 */
const stripDplPlugin = {
  cacheKeyWillBeUsed: ({ request }: { request: Request }): string => {
    const url = new URL(request.url);
    url.searchParams.delete("dpl");
    return url.toString();
  },
};

/**
 * Runtime caching routes. Each `matcher` delegates to the pure
 * `classifyRequest` helper so the strategy decision is the one covered by
 * `lib/pwa/cacheStrategy.test.ts`.
 */
const runtimeCaching: RuntimeCaching[] = [
  {
    // Sprites and cries - IDB-first, fall back to network.
    //
    // Root cause fix (#1803): the old CacheFirst routes put ~10,000+ sprite/cry
    // blobs into Cache Storage, making `cache.match` globally slow on WebKit
    // and hanging cold launch. The offline pack now lives in IndexedDB
    // (offline-pack store, written by lib/pwa/precache.ts). This handler reads
    // directly from IDB and falls back to a network fetch on miss, so the
    // Pack is served offline while Cache Storage stays small (just the app-shell
    // precache + navigation/data buckets).
    matcher: ({ url, request }) =>
      classifyRequest(url.href, self.location.origin, request.mode).strategy === "idb-first",
    handler: async ({ request }: { request: Request; url: URL }): Promise<Response> => {
      // Derive the IDB key as the URL pathname (relative path).
      //
      // precache.ts writes blobs via offlinePut using RELATIVE paths such as
      // `/sprites/pokemon/webp/25/320.webp` (produced by spriteVariantUrl).
      // In the SW handler, request.url is ABSOLUTE (e.g.
      // `https://pokememory.com/sprites/pokemon/webp/25/320.webp`). Using the
      // raw request.url would be a different key → every lookup would miss and
      // the offline pack would never be served. Extracting pathname normalises
      // both sides to the same relative path so the IDB lookup hits correctly.
      const key = new URL(request.url).pathname;

      try {
        // Race the IDB open + lookup against a hard timeout. The singleton
        // `openIdb()` prevents concurrent opens from blocking each other, but
        // the first open may still stall if a v1 connection is held by a tab
        // undergoing a version upgrade. Timing out guarantees sprite Responses
        // always resolve (from IDB when present, else network) and never hang.
        // (#1845 - hung promises from concurrent opens caused cards and the
        // Pokédex grid to never finish rendering in chromium e2e.)
        const idbResult = await Promise.race([
          openIdb().then((db) => idbPackGet(db, key)),
          new Promise<null>((resolveTimeout) =>
            setTimeout(() => resolveTimeout(null), SW_IDB_OPEN_TIMEOUT_MS),
          ),
        ]);
        if (idbResult) {
          return new Response(idbResult.blob, {
            status: 200,
            headers: { "Content-Type": idbResult.contentType },
          });
        }
      } catch {
        // IDB unavailable or open failed - fall through to network.
      }

      // Network fallback: fetch and return without caching. The user can
      // re-download the pack to populate IDB; runtime sprite fetches are
      // expected to be warm from the static file server anyway.
      return fetch(request);
    },
  },
  {
    // Next.js content-hashed build output - cache-first.
    matcher: ({ url, request }) =>
      classifyRequest(url.href, self.location.origin, request.mode).cacheName ===
      CACHE_NAMES.static,
    handler: new CacheFirst({
      cacheName: versionedCacheName(CACHE_NAMES.static),
      plugins: [
        new ExpirationPlugin({
          maxEntries: 128,
          maxAgeSeconds: 60 * 60 * 24 * 30,
        }),
      ],
    }),
  },
  {
    // Fonts - instant from cache, refreshed in the background.
    matcher: ({ url, request }) =>
      classifyRequest(url.href, self.location.origin, request.mode).cacheName ===
      CACHE_NAMES.fonts,
    handler: new StaleWhileRevalidate({
      cacheName: versionedCacheName(CACHE_NAMES.fonts),
      plugins: [
        new ExpirationPlugin({
          maxEntries: 16,
          maxAgeSeconds: 60 * 60 * 24 * 30,
        }),
      ],
    }),
  },
  {
    // Same-origin navigations, seed data, and other data fetches.
    //
    // Strategy: StaleWhileRevalidate (was: NetworkFirst with a 10 s timeout).
    //
    // Regression note (#1803): the prior NetworkFirst(10 s) strategy caused
    // every cold launch on the installed iOS PWA to block for up to 10 s
    // waiting for the network to return the / HTML document. The SW intercepted
    // the cold-launch navigation and gated paint on the network. Switching to
    // StaleWhileRevalidate eliminates the wait: the cached shell is returned
    // instantly from this bucket; the network response is written back in the
    // background so the next visit gets a fresh shell. Seed data files
    // (public/pokemon-data/*.json) are now also in the SW precache manifest
    // (scripts/build-sw.mjs) so they are served cache-first by the precache
    // handler before this runtime rule even fires.
    //
    // A full App Router RSC static shell precache was considered but rejected:
    // the root page uses searchParams + getTranslations and is server-rendered,
    // so no static HTML template exists at build time. SWR is the correct
    // strategy for App Router navigations where freshness can be traded for speed.
    matcher: ({ url, request }) =>
      classifyRequest(url.href, self.location.origin, request.mode).cacheName ===
      CACHE_NAMES.pages,
    handler: new StaleWhileRevalidate({
      cacheName: versionedCacheName(CACHE_NAMES.pages),
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
  // navigationPreload was previously true to reduce the SW startup latency
  // before the network request fired (a NetworkFirst optimisation). With
  // StaleWhileRevalidate the cache is read first and the response is immediate,
  // so navigation preload is unnecessary overhead. (#1803)
  navigationPreload: false,
  runtimeCaching,
});

// Honour the client's silent activator (#1162): when a SW is waiting and the
// active tab transitions to hidden, `ServiceWorkerProvider` posts a
// SKIP_WAITING message. We activate the new worker only if at most one
// window client is open - otherwise a still-foreground sibling tab would be
// swapped under the user. The client's visibility listener stays armed, so
// the next quiet moment retries naturally.
//
// Also handles GET_SW_VERSION (#1826): the Settings page queries the
// controlling worker's baked-in version so a stale-worker mismatch is
// surfaced to the user without requiring Safari Web Inspector.
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SKIP_WAITING") {
    void (async () => {
      const clients = await self.clients.matchAll({ type: "window" });
      if (clients.length <= 1) {
        await self.skipWaiting();
      }
      // Otherwise: decline silently. Another visibility tick will retry.
    })();
    return;
  }

  if (event.data.type === "GET_SW_VERSION") {
    // Reply via the MessageChannel port sent by the client. The port is
    // the first entry in event.ports; if absent (unexpected), no reply is
    // sent and the client's timeout fires naturally.
    const port = event.ports[0];
    if (port) {
      port.postMessage({ type: "SW_VERSION", version: self.__SW_VERSION__ });
    }
  }
});

/**
 * Opens the shared `poke-memory` IDB at version 2 (IDB_DB_VERSION).
 *
 * Delegates to lib/pwa/swIdb.ts::openSwIdb which provides:
 *   - A module-level singleton so concurrent sprite/cry requests share one
 *     connection instead of each opening a new one (the root cause of #1845 -
 *     multiple concurrent opens blocked each other's v1→v2 upgrade, leaving all
 *     their promises pending indefinitely and preventing cards from rendering).
 *   - An `onblocked` timeout (SW_IDB_OPEN_TIMEOUT_MS) that rejects and nulls
 *     the singleton when a stale connection elsewhere blocks the upgrade, so
 *     the sprite handler falls through to a network fetch instead of hanging.
 *   - An `onversionchange` handler that closes the connection and nulls the
 *     singleton when a future upgrade fires elsewhere.
 */
function openIdb(): Promise<IDBDatabase> {
  return openSwIdb(
    self.indexedDB,
    IDB_DB_NAME,
    IDB_DB_VERSION,
    (db, oldVersion) => {
      // kv store: create on fresh install (oldVersion < 1).
      if (oldVersion < 1 && !db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
      // offline-pack store: added at v2.
      if (!db.objectStoreNames.contains(OFFLINE_PACK_STORE)) {
        db.createObjectStore(OFFLINE_PACK_STORE);
      }
    },
  );
}

/**
 * Look up a sprite or cry blob in the IndexedDB offline-pack store.
 *
 * Returns null on miss or any IDB error - the caller falls back to network.
 * The value shape { blob: Blob; contentType: string } mirrors OfflineEntry in
 * lib/pwa/offlineStore.ts; we cannot import that module directly because
 * app/sw.ts is bundled separately by esbuild and lib/pwa/offlineStore.ts
 * contains a browser-global guard (`typeof window`) that would become a dead
 * branch in the SW scope (SW scope has no `window`). We access IDB directly
 * to avoid this coupling.
 */
async function idbPackGet(
  db: IDBDatabase,
  url: string,
): Promise<{ blob: Blob; contentType: string } | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(OFFLINE_PACK_STORE, "readonly");
      const req = tx.objectStore(OFFLINE_PACK_STORE).get(url);
      req.onsuccess = () => {
        const val: unknown = req.result;
        if (
          val &&
          typeof val === "object" &&
          "blob" in val &&
          (val as Record<string, unknown>).blob instanceof Blob &&
          "contentType" in val &&
          typeof (val as Record<string, unknown>).contentType === "string"
        ) {
          resolve(val as { blob: Blob; contentType: string });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Reads the persisted pending-grade queue from the shared `poke-memory` IDB
 * store. Returns an empty array when the key is absent or IDB is unavailable.
 *
 * The value stored by `savePendingQueue` (lib/sync/persistence.ts) is a
 * JSON-serialised `CloudRow[]` (snake_case, with appTypeToDbType applied) so
 * that the SW can POST the rows directly to /api/sync without any conversion.
 */
async function readPendingQueueFromIdb(): Promise<unknown[]> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_NAME, "readonly");
        const store = tx.objectStore(IDB_STORE_NAME);
        const getReq = store.get(PENDING_QUEUE_KEY);
        getReq.onsuccess = () => {
          // Do NOT close db here - it is a singleton shared across all callers.
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
        getReq.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  } catch {
    return [];
  }
}

/**
 * Clears the persisted pending-grade queue from IDB after a successful SW push.
 * Best-effort - errors are swallowed.
 */
async function clearPendingQueueFromIdb(): Promise<void> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_NAME, "readwrite");
        const store = tx.objectStore(IDB_STORE_NAME);
        const delReq = store.delete(PENDING_QUEUE_KEY);
        // Do NOT close db here - it is a singleton shared across all callers.
        delReq.onsuccess = () => resolve();
        delReq.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // Best-effort - swallow.
  }
}

/**
 * How long (ms) the SW waits for a window client to ACK the
 * `BACKGROUND_SYNC_REPLAY` delegation message before falling through to the
 * direct-push path. 3 s is long enough for a frozen/backgrounded tab to
 * respond but short enough not to delay grade delivery meaningfully.
 */
const CLIENT_ACK_TIMEOUT_MS = 3000;

/**
 * Background Sync handler (#1054).
 *
 * Fires when the browser reconnects after offline grading, even if every app
 * tab has been closed. The handler:
 *
 *   1. Checks for active window clients. If any are present, posts
 *      `BACKGROUND_SYNC_REPLAY` to each one via a `MessageChannel` and waits
 *      up to `CLIENT_ACK_TIMEOUT_MS` for at least one ACK. On ACK the client
 *      has committed to running the pull-before-push sequence - the SW resolves
 *      without pushing. If no ACK arrives within the timeout (client frozen /
 *      backgrounded / not yet hydrated), the handler falls through to step 2.
 *
 *   2. When no clients are active, or no client ACK'd in time, reads the
 *      pending-grade queue from IndexedDB (stored as CloudRow[] by
 *      savePendingQueue) and POSTs it directly to `/api/sync`. Auth cookies are
 *      included automatically by the browser for same-origin SW fetches. On
 *      success the IDB queue is cleared; on failure the event's `waitUntil`
 *      promise rejects ONLY for transient failures (network error, 5xx) so the
 *      browser will retry. On permanent auth failures (401 / 403) the handler
 *      resolves so the browser does not loop endlessly (#1072 B2).
 *
 * Superuser write-guard: the guard runs in the client context (the hook passes
 * null client/userId when a superuser flag is on). In this SW path there is no
 * session context to inspect, but the `/api/sync` route handler re-authenticates
 * via session cookie and returns 401 for unauthenticated calls. A QA session
 * therefore produces no cloud writes via this path either - the IDB queue is
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
        // Post to each active client via a MessageChannel so we can await an
        // explicit ACK. The client's useOnlineReconnectSync sends back an ACK
        // on the port before handling the pull-push sequence. If no client
        // ACKs within CLIENT_ACK_TIMEOUT_MS (frozen / backgrounded / not yet
        // hydrated), fall through to the direct-push path.
        const acked = await new Promise<boolean>((resolveAck) => {
          let settled = false;

          const timeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              resolveAck(false);
            }
          }, CLIENT_ACK_TIMEOUT_MS);

          for (const client of clients) {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolveAck(true);
              }
            };
            client.postMessage({ type: SW_REPLAY_MESSAGE }, [channel.port2]);
          }
        });

        if (acked) {
          // A live client has committed to running the pull-push sequence.
          return;
        }
        // No ACK - fall through to direct push below.
      }

      // Step 2: no active clients, or no client ACK'd in time - push directly
      // from the SW. The IDB queue was written as CloudRow[] by savePendingQueue
      // so no conversion is needed before POSTing to /api/sync (#1072 B1).
      const queue = await readPendingQueueFromIdb();
      if (queue.length === 0) {
        // Nothing to push; resolve so the sync event is not retried.
        return;
      }

      // POST the queue to /api/sync. The route handler authenticates via
      // session cookie (same-origin request; cookies are included by default).
      let res: Response;
      try {
        res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cards: queue }),
          credentials: "include",
        });
      } catch {
        // Network error (offline, DNS failure, etc.) - throw so the browser
        // retries the sync event when connectivity is restored.
        throw new Error("[sw-sync] network error posting to /api/sync");
      }

      if (res.status === 401 || res.status === 403) {
        // Permanent auth failure: session cookie expired, user signed out, or
        // cookie purged by ITP. Resolving (not throwing) prevents the Background
        // Sync spec from retrying indefinitely - retrying a 401 is pointless and
        // wastes battery. The queue is cleared so stale grades are not replayed
        // against a future session (#1072 B2).
        await clearPendingQueueFromIdb();
        return;
      }

      if (!res.ok) {
        // Transient server error (5xx, etc.): throw so the browser retries the
        // sync event later.
        throw new Error(`[sw-sync] /api/sync returned ${String(res.status)}`);
      }

      // All cards pushed successfully - clear the IDB queue.
      await clearPendingQueueFromIdb();
    })(),
  );
});

/**
 * Web Push handler (#1056).
 *
 * Fires when the push service delivers a message from our send-daily route
 * handler. The payload shape is small and JSON-serialised by the sender:
 *
 *   { title: string, body: string, url?: string }
 *
 * Defaults are conservative so a malformed payload from a future client
 * does not skip the visible notification - userVisibleOnly was set true at
 * subscribe time, so Chromium will surface a generic "site updated"
 * notification on our behalf if we fail to call showNotification.
 *
 * The icon and badge paths point at the existing manifest icons. `tag`
 * is fixed so a second daily notification on the same day replaces the
 * first rather than stacking - the user only needs to be told "you have
 * reviews due" once per day.
 */
self.addEventListener("push", (event) => {
  let title = "Poké Memory";
  let body = "You have Pokémon reviews waiting.";
  let url = "/";

  if (event.data) {
    try {
      const payload = event.data.json() as Partial<{
        title: string;
        body: string;
        url: string;
      }>;
      if (typeof payload.title === "string" && payload.title.length > 0) {
        title = payload.title;
      }
      if (typeof payload.body === "string" && payload.body.length > 0) {
        body = payload.body;
      }
      if (typeof payload.url === "string" && payload.url.length > 0) {
        url = payload.url;
      }
    } catch {
      // Malformed JSON - fall through with defaults so we still surface
      // a notification (Chromium will otherwise show the generic "site
      // updated" fallback because userVisibleOnly was set true).
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // /icon2 and /apple-icon are dynamic Next.js icon routes - see
      // app/icon2.tsx / app/apple-icon.tsx. The browser fetches and caches
      // them like any other image; the SW does not need to special-case them.
      icon: "/icon2",
      badge: "/icon2",
      tag: "poke-memory-daily-reminder",
      data: { url },
    }),
  );
});

/**
 * notificationclick handler. Opens Practice (or the URL embedded in the
 * payload) when the user taps the notification. Behaviour matches Web
 * standards guidance: if an existing app tab is open at the destination,
 * focus it; otherwise navigate an existing tab or open a fresh window.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data;
  const targetUrl =
    data && typeof (data as { url?: unknown }).url === "string"
      ? (data as { url: string }).url
      : "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Resolve the target URL against the SW's origin so the equality
      // check below compares like-for-like (clients expose absolute URLs).
      const absoluteTarget = new URL(targetUrl, self.location.origin).href;

      for (const client of allClients) {
        if (client.url === absoluteTarget && typeof client.focus === "function") {
          await client.focus();
          return;
        }
      }

      // No exact match - prefer to navigate an existing tab so we don't
      // stack windows. Fall back to opening a new one when navigate is
      // unavailable (Safari < 17) or no tab exists.
      const firstClient = allClients[0];
      if (firstClient && typeof firstClient.navigate === "function") {
        try {
          await firstClient.navigate(absoluteTarget);
          if (typeof firstClient.focus === "function") {
            await firstClient.focus();
          }
          return;
        } catch {
          // Fall through to openWindow.
        }
      }

      await self.clients.openWindow(absoluteTarget);
    })(),
  );
});

/**
 * Delete the old Cache Storage sprite/cry buckets on SW activate (#1803 migration).
 *
 * The offline pack moved from Cache Storage to IndexedDB. Existing users who
 * downloaded the pack before this SW deployed will have ~10,000+ entries in
 * `poke-memory-sprites-v2` / `poke-memory-cries-v2`. Those bloated buckets are
 * the exact cause of the cold-launch hang: WebKit's `cache.match` is globally
 * slow when Cache Storage has that many entries.
 *
 * This handler runs once when the new SW activates (typically on the first page
 * load after the update is installed). `waitUntil` keeps the activate event alive
 * until the deletions complete. If `caches` is unavailable (non-PWA context) the
 * call is a silent no-op.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (typeof caches === "undefined") return;
      await Promise.all([
        caches.delete(LEGACY_SPRITE_CACHE_NAME),
        caches.delete(LEGACY_CRY_CACHE_NAME),
      ]);
    })(),
  );
});

serwist.addEventListeners();
