"use client";

import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pullAndMerge } from "@/lib/sync/pullAndMerge";

/**
 * One-shot pull of cloud state when a user signs in (or when a tab loads
 * cold while already signed in). Without this, a fresh device sees the
 * locally-built seed session as "all new cards" until the user manually
 * syncs or hides the tab ≥ 30 s on a non-blocked route.
 *
 * Fires once per `userId` transition into a non-null value. Re-renders with
 * the same userId are ignored. Signing out (userId → null) resets the ref so
 * a subsequent sign-in - even as the same user - re-pulls.
 *
 * No duplicate pulls with `useVisibilityPull`: that hook fires only when the
 * tab transitions from hidden ≥ 30 s back to visible, and its `hiddenAt` ref
 * starts at null on every mount - so a cold load (this hook's trigger) cannot
 * satisfy its precondition.
 *
 * Best-effort: `pullAndMerge` swallows all errors and returns a string status.
 */
export function useSignInPull(
  client: SupabaseClient | null,
  userId: string | null,
  /**
   * When true, the locale push-back inside `pullAndMerge` is suppressed.
   * Pulls (reads) remain enabled regardless - same contract as every other
   * write-guarded hook. Pass `anyFlagOn` from `useSuperuser()`.
   */
  superuserPaused = false,
): void {
  const lastPulledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!client || !userId) {
      lastPulledRef.current = null;
      return;
    }
    if (lastPulledRef.current === userId) return;
    lastPulledRef.current = userId;
    void pullAndMerge(client, userId, superuserPaused);
  }, [client, userId, superuserPaused]);
}
