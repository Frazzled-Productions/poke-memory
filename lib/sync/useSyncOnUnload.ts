"use client";
import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";
import { pushSession } from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";

/**
 * Registers visibilitychange and pagehide listeners that push the current
 * session to the cloud when the user leaves the page.
 *
 * Fire-and-forget: does not block navigation. Errors are swallowed by
 * pushSession which is best-effort.
 *
 * Pass null for any argument to disable sync (e.g. when the user is not
 * signed in or the session is not yet loaded).
 */
export function useSyncOnUnload(
  client: SupabaseClient | null,
  userId: string | null,
  cards: ReviewableCard[] | null,
): void {
  // useRef so the in-flight guard survives effect re-runs caused by cards updates.
  const pushingRef = useRef(false);

  useEffect(() => {
    if (!client || !userId || !cards) return;

    function handleUnload(event: Event) {
      // visibilitychange fires on both hide and show; only push on hide.
      // pagehide fires before visibilityState transitions, so skip the guard there.
      if (event.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      if (!client || !userId || !cards) return;
      // Guard against concurrent calls from two rapid hide events.
      if (pushingRef.current) return;
      pushingRef.current = true;

      // Write attempt timestamp synchronously before any async work — browsers do
      // not guarantee async continuations run during pagehide/discard. Pessimistically
      // mark as failed; overwrite to success/false if the promise resolves in time.
      const now = new Date().toISOString();
      const prev = loadSyncStatus();
      saveSyncStatus({
        ...prev,
        lastPushAttemptAt: now,
        lastPushFailed: true,
      });

      void pushSession(client, userId, cards).then((ok) => {
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
  }, [client, userId, cards]);
}
