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
  // Keep a stable ref to getUnsynced so the effect doesn't re-register
  // listeners on every render (the function identity changes each render).
  const getUnsyncedRef = useRef(getUnsynced);
  getUnsyncedRef.current = getUnsynced;

  useEffect(() => {
    if (!client || !userId) return;

    function handleUnload(event: Event) {
      // visibilitychange fires on both hide and show; only push on hide.
      if (event.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      if (!client || !userId) return;
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
      });

      void pushSession(client, userId, unsynced).then((ok) => {
        const current = loadSyncStatus();
        saveSyncStatus({
          ...current,
          lastPushAt: ok ? new Date().toISOString() : current.lastPushAt,
          lastPushFailed: !ok,
        });
      }).finally(() => {
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
