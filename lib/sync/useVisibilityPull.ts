"use client";

import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pullAndMerge } from "@/lib/sync/pullAndMerge";

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
): void {
  const hiddenAtRef = useRef<number | null>(null);
  const clientRef = useRef(client);
  const userIdRef = useRef(userId);
  const pathnameRef = useRef(pathname);

  // Keep refs current on every render without re-registering the listener.
  clientRef.current = client;
  userIdRef.current = userId;
  pathnameRef.current = pathname;

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

      const hiddenAt = hiddenAtRef.current;
      if (hiddenAt === null) return;

      const gapMs = Date.now() - hiddenAt;
      if (gapMs < HIDDEN_THRESHOLD_MS) return;

      hiddenAtRef.current = null;

      void pullAndMerge(cl, uid);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []); // empty deps — handler always reads from refs
}
