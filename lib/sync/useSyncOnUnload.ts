"use client";
import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";
import { pushSession } from "@/lib/sync/cloud";
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
 * Fire-and-forget: does not block navigation. Errors are swallowed by
 * pushSession which is best-effort.
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
  const clientRef = useRef(client);
  const userIdRef = useRef(userId);
  clientRef.current = client;
  userIdRef.current = userId;
  const getUnsyncedRef = useRef(getUnsynced);
  getUnsyncedRef.current = getUnsynced;

  useEffect(() => {
    if (!client || !userId) return;

    function handleUnload(event: Event) {
      // visibilitychange fires on both hide and show; only push on hide.
      if (event.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      // Read from refs so a sign-out that races with unload uses the current
      // (null) values rather than stale closed-over props.
      const c = clientRef.current;
      const uid = userIdRef.current;
      if (!c || !uid) return;
      if (pushingRef.current) return;

      const unsynced = getUnsyncedRef.current();
      if (unsynced.length === 0) return;

      pushingRef.current = true;

      // Write attempt timestamp synchronously before any async work — browsers
      // do not guarantee async continuations run during pagehide/discard.
      const now = new Date().toISOString();
      const prev = loadSyncStatus();
      saveSyncStatus({
        ...prev,
        lastPushAttemptAt: now,
        lastPushFailed: true,
        // Upper bound: pushSession doesn't report partial batch successes, so we
        // may overstate the residual if any batch succeeded before a later one failed.
        failedCardCount: unsynced.length,
      });

      void pushSession(c, uid, unsynced).then((ok) => {
        const current = loadSyncStatus();
        saveSyncStatus({
          ...current,
          lastPushAt: ok ? new Date().toISOString() : current.lastPushAt,
          lastPushFailed: !ok,
          failedCardCount: ok ? 0 : unsynced.length,
        });
      }).finally(() => {
        // Runs even if the component unmounted. The localStorage write above is
        // harmless (global store, not component state); pushingRef reset is a
        // no-op on a stale ref but prevents double-push if the page survives.
        pushingRef.current = false;
      });
    }

    window.addEventListener("visibilitychange", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("visibilitychange", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, [client, userId]);
}
