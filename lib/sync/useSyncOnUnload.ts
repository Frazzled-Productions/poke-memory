"use client";
import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";
import { buildBeaconPayload } from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";

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
 *     `navigator.sendBeacon` — fire-and-forget, response code invisible to
 *     the sender. Best-effort.
 *
 * Both paths are fire-and-forget from the caller's perspective: navigation
 * is never blocked.
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
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const getUnsyncedRef = useRef(getUnsynced);
  getUnsyncedRef.current = getUnsynced;

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
      const payload = buildBeaconPayload(unsynced);

      if (event.type === "pagehide") {
        // Final shutdown: only sendBeacon survives. We can't observe the
        // server's response, so the client trusts the browser's "queued"
        // boolean. A 502 from the server is invisible here — that is the
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
          saveSyncStatus({
            ...prev,
            lastPushAttemptAt: now,
            lastPushFailed: !ok,
            failedCardCount: ok ? 0 : unsynced.length,
            ...(ok && { lastPushAt: now }),
          });
        } catch {
          // Network blip, abort, or page torn down before fetch resolved.
          // Treat as failure so the next page mount retries.
          saveSyncStatus({
            ...prev,
            lastPushAttemptAt: now,
            lastPushFailed: true,
            failedCardCount: unsynced.length,
          });
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
