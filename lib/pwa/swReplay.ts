/**
 * Background Sync replay for the service worker (#1054, #2209).
 *
 * Extracted from app/sw.ts so the real handler can be unit-tested without a
 * ServiceWorkerGlobalScope, in the same way as lib/pwa/swIdb.ts. app/sw.ts
 * keeps the `sync` listener and passes in its own clients, fetch and IndexedDB
 * queue access.
 *
 * `replayPendingGrades` runs when the browser reconnects after offline grading,
 * even if every app tab has been closed:
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
 *      resolves so the browser does not loop endlessly (#1072 B2). A 400 or 409
 *      also resolves, because the same body cannot succeed, but keeps the queue
 *      (#2209).
 *
 * Superuser write-guard: the guard runs in the client context (the hook passes
 * null client/userId when a superuser flag is on). In this SW path there is no
 * session context to inspect, but the `/api/sync` route handler re-authenticates
 * via session cookie and returns 401 for unauthenticated calls. A QA session
 * therefore produces no cloud writes via this path either - the IDB queue is
 * cleared by `enqueueGrade` (which calls `clearPendingQueue` when superuser is
 * active) before the tab is closed, so the queue is empty when the SW fires.
 */

import { SW_REPLAY_MESSAGE } from "@/lib/sync/backgroundSync";

/**
 * How long (ms) the SW waits for a window client to ACK the
 * `BACKGROUND_SYNC_REPLAY` delegation message before falling through to the
 * direct-push path. 3 s is long enough for a frozen/backgrounded tab to
 * respond but short enough not to delay grade delivery meaningfully.
 */
export const CLIENT_ACK_TIMEOUT_MS = 3000;

/** What the handler needs from the worker scope. */
export type SwReplayDeps = {
  clients: {
    matchAll(options: { type: string; includeUncontrolled: boolean }): Promise<
      ReadonlyArray<{ postMessage(data: unknown, transfer: Transferable[]): void }>
    >;
  };
  fetch(url: string, init: RequestInit): Promise<Pick<Response, "ok" | "status">>;
  /** Reads the IndexedDB copy of the pending-grade queue; [] when absent. */
  readQueue(): Promise<unknown[]>;
  /** Clears the IndexedDB copy only: a worker cannot reach localStorage. */
  clearQueue(): Promise<void>;
};

export async function replayPendingGrades(deps: SwReplayDeps): Promise<void> {
  // Step 1: delegate to any active window clients so they can honour the
  // pull-before-push invariant. Using `includeUncontrolled: false` ensures
  // we only message clients that are controlled by this worker (i.e. loaded
  // from the same origin and SW scope).
  const clients = await deps.clients.matchAll({ type: "window", includeUncontrolled: false });

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
  const queue = await deps.readQueue();
  if (queue.length === 0) {
    // Nothing to push; resolve so the sync event is not retried.
    return;
  }

  // POST the queue to /api/sync. The route handler authenticates via
  // session cookie (same-origin request; cookies are included by default).
  let res: Pick<Response, "ok" | "status">;
  try {
    res = await deps.fetch("/api/sync", {
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
    await deps.clearQueue();
    return;
  }

  if (res.status === 400 || res.status === 409) {
    // Permanent for this body: /api/sync returns 400 for an invalid payload and
    // 409 for a structural error, which it says not to retry. Resolve so the
    // browser stops, but keep the queue, as the app's own 409 path does: the
    // grades are not in the cloud, and a 409 can clear with a deploy (#2209).
    return;
  }

  if (!res.ok) {
    // Transient server error (5xx, etc.): throw so the browser retries the
    // sync event later.
    throw new Error(`[sw-sync] /api/sync returned ${String(res.status)}`);
  }

  // All cards pushed successfully - clear the IDB queue.
  await deps.clearQueue();
}
