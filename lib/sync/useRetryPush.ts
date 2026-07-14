"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadSyncStatus,
  saveSyncStatus,
  loadPendingQueue,
} from "@/lib/sync/persistence";
import { pushWithFallback } from "@/lib/sync/pushWithFallback";

export type RetryState = "idle" | "retrying" | "success" | "error";

/**
 * Push-only retry hook for recovering from a failed unload beacon.
 *
 * When lastPushFailed is true in SyncStatus, retryNow() re-pushes the
 * subset of cards that failed - without pulling from cloud first.
 * Pull-before-push is the failure mode (#293) we are moving away from;
 * this hook is deliberately push-only.
 *
 * Card selection (in priority order, #893):
 *   1. Persisted queue present → push those exact cards (most precise).
 *   2. failedCardCount > 0    → push today's reviewed cards (approximation).
 *   3. failedCardCount null   → push all reviewed cards (legacy fallback).
 *   4. failedCardCount === 0  → no-op success (clear the failed flag).
 *
 * The call site is responsible for passing client=null / userId=null when any
 * superuser flag is on (same contract as usePerGradeSync), so this hook does
 * not read useSuperuser() directly.
 */
export function useRetryPush(
  client: SupabaseClient | null,
  userId: string | null,
): { retryState: RetryState; retryNow: () => void } {
  const [retryState, setRetryState] = useState<RetryState>("idle");

  // Synchronous in-progress flag - closes the race window where two rapid
  // calls both pass the retryState === "retrying" closure check before the
  // state batch re-renders.
  const isRetryingRef = useRef(false);

  // Track the auto-reset timeout so it can be cleared on unmount.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // cancelledRef lets the async run() know it should skip state updates once
  // the component has unmounted.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const retryNow = useCallback(() => {
    if (client === null || userId === null || isRetryingRef.current) {
      return;
    }

    const status = loadSyncStatus();

    // Nothing to retry - the push-failed flag is clear.
    if (!status.lastPushFailed) {
      return;
    }

    // Structural errors (deploy/schema mismatch) cannot be resolved by retrying
    // (#1358). The SyncStatusLine banner disables the Retry button in this state
    // but we guard here too in case retryNow is called programmatically.
    if (status.structuralSyncError !== null) {
      return;
    }

    // Claim the in-progress slot before any branching so two rapid calls can't
    // both pass the guard. Cleared by the auto-reset timer in every branch.
    isRetryingRef.current = true;

    // Supersede any pending auto-reset from a previous run.
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    function scheduleReset() {
      resetTimerRef.current = setTimeout(() => {
        isRetryingRef.current = false;
        if (!cancelledRef.current) setRetryState("idle");
        resetTimerRef.current = null;
      }, 3000);
    }

    // Re-read the latest sync-status immediately before each write - a
    // concurrent useVisibilityPull could have updated lastPullAt while this
    // call was queued; spreading a stale capturedStatus would clobber it and
    // poison the per-card conflict rule on the next pull.
    function clearFailedFlag(extras: Partial<typeof status>) {
      const latest = loadSyncStatus();
      saveSyncStatus({
        ...latest,
        lastPushFailed: false,
        failedCardCount: 0,
        ...extras,
      });
    }

    // failedCardCount === 0: clear the failed flag without a network call - 
    // unless a non-empty persisted queue exists, in which case those cards
    // must be pushed even though the count signal says zero. The persisted
    // queue is the authoritative record; never abandon it on a zero-count
    // short-circuit (#893 defensive guard).
    const hasPersistedQueue = loadPendingQueue().length > 0;
    if (status.failedCardCount === 0 && !hasPersistedQueue) {
      const now = new Date().toISOString();
      clearFailedFlag({ lastPushAt: now, lastPushAttemptAt: now });
      setRetryState("success");
      scheduleReset();
      return;
    }

    setRetryState("retrying");

    const capturedClient = client;
    const capturedUserId = userId;

    async function run() {
      // Card selection, queue slimming, and the session-card heuristic all
      // live in the shared engine (#893) - this hook only translates the
      // outcome into SyncStatus writes and retry-banner state.
      const outcome = await pushWithFallback(capturedClient, capturedUserId, {
        failedCardCount: status.failedCardCount,
        isCancelled: () => cancelledRef.current,
      });

      if (outcome.kind === "cancelled") return;

      if (outcome.kind === "queue") {
        const attemptAt = new Date().toISOString();
        if (outcome.failedCards.length > 0) {
          // Partial or total failure: the engine has already slimmed the
          // persisted queue to only the cards that failed.
          const latest = loadSyncStatus();
          saveSyncStatus({ ...latest, lastPushAttemptAt: attemptAt });
          if (!cancelledRef.current) setRetryState("error");
        } else {
          clearFailedFlag({ lastPushAt: attemptAt, lastPushAttemptAt: attemptAt });
          if (!cancelledRef.current) setRetryState("success");
        }
        scheduleReset();
        return;
      }

      if (outcome.kind === "session-empty" || outcome.kind === "session-skipped") {
        // Nothing locally that could be pushed (e.g. wiped storage). Clear
        // the failed flag - there's nothing to retry from this device.
        // ("session-skipped" is unreachable here - this hook does not set
        // skipSessionWhenCountZero - but is folded in for exhaustiveness.)
        const now = new Date().toISOString();
        clearFailedFlag({ lastPushAt: now, lastPushAttemptAt: now });
        if (!cancelledRef.current) setRetryState("success");
        scheduleReset();
        return;
      }

      const attemptAt = new Date().toISOString();

      if (outcome.anyFailed) {
        // Keep lastPushFailed true; leave failedCardCount unchanged so the
        // count displayed to the user doesn't silently reset.
        const latest = loadSyncStatus();
        saveSyncStatus({ ...latest, lastPushAttemptAt: attemptAt });
        if (!cancelledRef.current) setRetryState("error");
      } else {
        clearFailedFlag({ lastPushAt: attemptAt, lastPushAttemptAt: attemptAt });
        if (!cancelledRef.current) setRetryState("success");
      }

      scheduleReset();
    }

    void run().catch((err) => {
      console.error("[retry-push] unexpected error", err);
      isRetryingRef.current = false;
      if (!cancelledRef.current) setRetryState("error");
    });
  }, [client, userId]);

  return { retryState, retryNow };
}
