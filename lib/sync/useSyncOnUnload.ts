"use client";
import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";
import { buildBeaconPayload } from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus, savePendingQueue, clearPendingQueue } from "@/lib/sync/persistence";
import { markStructuralSyncError } from "@/lib/sync/structuralError";
import { useLatestRef } from "@/lib/hooks/useLatestRef";
import { registerBackgroundSync } from "@/lib/sync/backgroundSync";

/**
 * Registers visibilitychange and pagehide listeners that push any unsynced
 * cards to the cloud when the user leaves the page.
 *
 * getUnsynced() is called at unload time to retrieve the cards that the
 * per-grade sync path did not yet successfully push. When it returns an empty
 * array the unload push is skipped entirely, keeping this hook as a safety-net
 * rather than a full resync.
 *
 * Pass null for client or userId to disable sync (e.g. guest mode).
 *
 * Two transport paths (#581):
 *   - visibilitychange: page still alive, `fetch` with `keepalive: true`. The
 *     response is observable, so a non-2xx is treated as a sync failure and
 *     the unsynced queue stays intact for the next retry.
 *   - pagehide: page being torn down, no time to await. Falls back to
 *     `navigator.sendBeacon` - fire-and-forget, response code invisible to
 *     the sender. Best-effort.
 *
 * Both paths are fire-and-forget from the caller's perspective: navigation
 * is never blocked.
 *
 * Background Sync fallback (#1054): when a push fails (sendBeacon rejected by
 * the browser, or the fetch+keepalive path returned a non-2xx), this hook
 * registers the `poke-memory:grade-sync` Background Sync tag. On supporting
 * browsers (Chromium on Android), the service worker will replay the persisted
 * queue when connectivity returns - even if every app tab has been closed by
 * then. On unsupported browsers this registration is a no-op; the existing
 * `useOnlineReconnectSync` on-reconnect path remains the fallback.
 */
export function useSyncOnUnload(
  client: SupabaseClient | null,
  userId: string | null,
  getUnsynced: () => ReviewableCard[],
): void {
  // useRef so the in-flight guard survives effect re-runs.
  const pushingRef = useRef(false);
  // Use refs for all values read inside handleUnload so the handler always sees
  // the latest values even if sign-out races with a visibilitychange/pagehide
  // event before the effect cleanup can remove the listeners.
  const userIdRef = useLatestRef(userId);
  const getUnsyncedRef = useLatestRef(getUnsynced);

  useEffect(() => {
    if (!client || !userId) return;

    function handleUnload(event: Event) {
      // visibilitychange fires on both hide and show; only push on hide.
      if (event.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      // Read from ref so a sign-out that races with unload uses the current
      // (null) value rather than the stale closed-over prop.
      const uid = userIdRef.current;
      if (!uid) return;
      if (pushingRef.current) return;

      const unsynced = getUnsyncedRef.current();
      if (unsynced.length === 0) return;

      pushingRef.current = true;
      const now = new Date().toISOString();
      const prev = loadSyncStatus();

      // Persist the unsynced cards to localStorage BEFORE attempting the
      // beacon / fetch. The per-grade debounce (500 ms) and the enqueue
      // cleanup may not have fired yet when the page hides, so at this point
      // the pending queue in localStorage could be empty even though
      // pendingQueueRef (in-memory) has cards. Persisting here ensures that
      // if the beacon fails AND the OS kills the page before the 500 ms
      // debounce or the React cleanup effect runs, the cards are available for
      // useOnlineReconnectSync and useRetryPush on the next app open (#1288).
      // Only write when the queue is non-empty - clearPendingQueue is called
      // after a successful push, so we must not overwrite that with stale data.
      savePendingQueue(unsynced);

      const payload = buildBeaconPayload(unsynced);

      if (event.type === "pagehide") {
        // Final shutdown: only sendBeacon survives. We can't observe the
        // server's response, so the client trusts the browser's "queued"
        // boolean. A 502 from the server is invisible here - that is the
        // documented limitation of this path; the visibilitychange route is
        // the one that closes the loop on partial failures.
        const queued = navigator.sendBeacon("/api/sync", payload);
        saveSyncStatus({
          ...prev,
          lastPushAttemptAt: now,
          lastPushFailed: !queued,
          failedCardCount: queued ? 0 : unsynced.length,
          ...(queued && { lastPushAt: now }),
        });
        if (queued) {
          // Beacon accepted by the browser - clear the IDB mirror so the SW
          // does not re-push grades that already left this device (#1072 concern).
          // Best-effort: fire and forget. The IDB mirror is only a safety-net for
          // the all-tabs-closed path; the sendBeacon response is not observable,
          // so we trust the browser's "queued" boolean here.
          clearPendingQueue();
        } else {
          // When the beacon could not be queued (offline or SW declined), register
          // a Background Sync tag so the SW can replay the persisted queue after
          // the app is closed and connectivity is restored. Best-effort: fire and
          // forget, never block unload.
          void registerBackgroundSync();
        }
        pushingRef.current = false;
        return;
      }

      // visibilitychange path: page is still alive, use fetch+keepalive so
      // the response status is observable.
      void (async () => {
        try {
          const res = await fetch("/api/sync", {
            method: "POST",
            body: payload,
            keepalive: true,
          });
          const ok = res.ok;

          if (!ok && res.status === 409) {
            // 409 = structural_error from route.ts. Read the body to extract
            // the SQLSTATE code and persist it immediately so the banner appears
            // on the next page load without waiting for FAILURE_THRESHOLD drains
            // (#1358 FIX 4). Best-effort: if body parsing fails, the generic
            // failure path below still records lastPushFailed.
            //
            // Note: the sendBeacon / pagehide path CANNOT read the server
            // response (the browser's sendBeacon API is fire-and-forget). This
            // fix applies only to the visibilitychange path, which uses
            // fetch+keepalive and CAN observe the response. The pagehide
            // limitation is documented as expected.
            try {
              const body = (await res.json()) as { error?: string; code?: string };
              if (body.error === "structural_error" && typeof body.code === "string") {
                markStructuralSyncError(body.code);
              }
            } catch {
              // Body parse failed - fall through to the generic failure path.
            }
          }

          // Re-read the persisted status after markStructuralSyncError may have
          // written to localStorage (409 path), so a stale `prev` snapshot does
          // not overwrite the just-written structuralSyncError back to null.
          saveSyncStatus({
            ...loadSyncStatus(),
            lastPushAttemptAt: now,
            lastPushFailed: !ok,
            failedCardCount: ok ? 0 : unsynced.length,
            ...(ok && { lastPushAt: now }),
          });
          if (ok) {
            // Successful fetch - clear the IDB mirror so the SW does not
            // re-push grades that are already in the cloud (#1072 concern).
            clearPendingQueue();
          } else {
            // Register Background Sync when the fetch failed so the SW can
            // replay once connectivity is restored (even if the tab is then closed).
            void registerBackgroundSync();
          }
        } catch {
          // Network blip, abort, or page torn down before fetch resolved.
          // Treat as failure so the next page mount retries.
          //
          // Re-read rather than spreading stale `prev` so concurrent writes
          // (e.g. pullAndMerge updating lastPullAt, or a push drain updating
          // structuralSyncError) are not clobbered (F33 / #1856). Mirror the
          // success path above which already uses loadSyncStatus().
          saveSyncStatus({
            ...loadSyncStatus(),
            lastPushAttemptAt: now,
            lastPushFailed: true,
            failedCardCount: unsynced.length,
          });
          // Register Background Sync for the catch path (network offline).
          void registerBackgroundSync();
        } finally {
          pushingRef.current = false;
        }
      })();
    }

    window.addEventListener("visibilitychange", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("visibilitychange", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, [client, userId]);
}
