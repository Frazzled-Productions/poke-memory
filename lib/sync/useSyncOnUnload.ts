"use client";
import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";
import { pushSession } from "@/lib/sync/cloud";

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
  useEffect(() => {
    if (!client || !userId || !cards) return;

    function handleUnload() {
      if (document.visibilityState !== "hidden") return;
      if (!client || !userId || !cards) return;
      // Fire-and-forget -- does not block navigation
      void pushSession(client, userId, cards);
    }

    window.addEventListener("visibilitychange", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("visibilitychange", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, [client, userId, cards]);
}
