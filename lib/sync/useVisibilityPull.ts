"use client";

import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pullAndMerge } from "@/lib/sync/pullAndMerge";
import { useLatestRef } from "@/lib/hooks/useLatestRef";
import { isSessionActive } from "@/lib/review/sessionActive";

// Routes where an in-progress review session makes a mid-visit pull confusing.
const BLOCKED_ROUTES = ["/"];

const HIDDEN_THRESHOLD_MS = 30_000;

/**
 * Registers a visibilitychange listener that pulls cloud state into localStorage
 * when the tab becomes visible after being hidden for ≥ 30 seconds, the user is
 * signed in, and the current route is not in the blocked list.
 *
 * Uses refs for all values read inside the handler so the listener never
 * captures a stale closure and never needs to be re-registered on re-render
 * (same pattern as useSyncOnUnload).
 */
export function useVisibilityPull(
  client: SupabaseClient | null,
  userId: string | null,
  pathname: string,
  /**
   * When true, the locale push-back inside `pullAndMerge` is suppressed.
   * Pulls (reads) remain enabled regardless - same contract as every other
   * write-guarded hook. Pass `anyFlagOn` from `useSuperuser()`.
   */
  superuserPaused = false,
): void {
  const hiddenAtRef = useRef<number | null>(null);
  const clientRef = useLatestRef(client);
  const userIdRef = useLatestRef(userId);
  const pathnameRef = useLatestRef(pathname);
  const superuserPausedRef = useLatestRef(superuserPaused);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }

      // Tab became visible.
      const uid = userIdRef.current;
      const cl = clientRef.current;
      if (!uid || !cl) return;

      if (BLOCKED_ROUTES.includes(pathnameRef.current)) return;

      // Don't pull while a review session is mounted regardless of route
      // (#1163). The session can be on any path (e.g. an embedded study
      // surface in the future), so the route-block above is no longer
      // sufficient on its own. The session-active flag is the single source
      // of truth shared with the silent SW activator (#1162).
      if (isSessionActive()) return;

      const hiddenAt = hiddenAtRef.current;
      if (hiddenAt === null) return;

      const gapMs = Date.now() - hiddenAt;
      if (gapMs < HIDDEN_THRESHOLD_MS) return;

      hiddenAtRef.current = null;

      void pullAndMerge(cl, uid, superuserPausedRef.current);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []); // empty deps - handler always reads from refs
}
