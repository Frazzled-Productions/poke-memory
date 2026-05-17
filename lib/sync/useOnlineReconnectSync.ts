"use client";

import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pullAndMerge } from "@/lib/sync/pullAndMerge";
import { pushSingleCard, isSyncSafe } from "@/lib/sync/cloud";
import { loadSyncStatus, markPushSucceeded } from "@/lib/sync/persistence";
import { loadSession } from "@/lib/review/persistence";
import { todayString } from "@/lib/review/session";

/**
 * Listens for the browser `online` event and automatically performs a
 * pull-then-push catch-up when the device reconnects.
 *
 * Ordering (respects the pull-before-push invariant from docs/sync.md):
 *   1. `pullAndMerge` — brings local state up to date with cloud.
 *   2. Push any cards that failed the per-grade path while offline.
 *
 * Card selection and success semantics mirror `useRetryPush` exactly:
 *   - `lastPushFailed` false → only the pull runs; no push leg.
 *   - `failedCardCount === 0` → skip the push leg.
 *   - `failedCardCount > 0` → push today's reviewed cards (falling back to all
 *     reviewed cards when the today-filter is empty).
 *   - `failedCardCount` null → push all reviewed cards.
 * On PARTIAL success (some cards failed), `lastPushFailed` is kept `true` so
 * the retry banner remains visible — `markPushSucceeded` is only called when
 * every card push succeeded.
 *
 * The call site is responsible for passing `client=null` / `userId=null` when
 * any superuser flag is on (same contract as `usePerGradeSync` and
 * `useRetryPush`), so this hook does not read `useSuperuser()` directly.
 *
 * This hook is best-effort: errors are swallowed with `console.warn` and never
 * flip the overall sync status into the error state.
 */
export function useOnlineReconnectSync(
  client: SupabaseClient | null,
  userId: string | null,
): void {
  // Use refs so the event handler always sees the latest values without
  // needing to be re-registered on every re-render.
  const clientRef = useRef(client);
  const userIdRef = useRef(userId);
  clientRef.current = client;
  userIdRef.current = userId;

  // In-flight guard: prevents concurrent reconnect handlers from running
  // simultaneously (e.g. rapid on/off/on network flaps).
  const runningRef = useRef(false);

  useEffect(() => {
    async function handleOnline() {
      const c = clientRef.current;
      const uid = userIdRef.current;

      // Guest mode or superuser write-guard: no cloud operations.
      if (!c || !uid) return;
      if (runningRef.current) return;
      runningRef.current = true;

      try {
        // Step 1: Pull-before-push — bring local state up to date. If pull
        // fails, abort: pushing without knowing cloud state risks clobbering
        // cloud progress (the exact failure mode of incident #293).
        const pullResult = await pullAndMerge(c, uid);
        if (pullResult === "error") {
          console.warn("[online-reconnect] pull failed; skipping push catch-up");
          return;
        }

        // Step 2: Push any cards that were queued offline.
        const status = loadSyncStatus();
        if (!status.lastPushFailed) {
          // Per-grade path is healthy; no catch-up push needed.
          return;
        }

        const session = await loadSession();
        const allReviewed = (session?.cards ?? []).filter(
          (card) => card.state.lastReview !== null && isSyncSafe(card),
        );

        if (status.failedCardCount === 0) {
          // failedCardCount is explicitly 0 — nothing to re-push.
          return;
        }

        let cardsToRetry = allReviewed;
        if (status.failedCardCount !== null && status.failedCardCount > 0) {
          // Positive count: push today's reviewed cards (approximation of the
          // cards the per-grade path failed to deliver). Fall back to all
          // reviewed cards when the today-filter is empty (e.g. user returns
          // the next day after going offline).
          const today = todayString(new Date());
          const todayOnly = allReviewed.filter(
            (card) => card.state.lastReview === today,
          );
          cardsToRetry = todayOnly.length > 0 ? todayOnly : allReviewed;
        }

        if (cardsToRetry.length === 0) return;

        // Re-read client/userId from refs so a sign-out that races with this
        // async run uses current values.
        const pushClient = clientRef.current;
        const pushUid = userIdRef.current;
        if (!pushClient || !pushUid) return;

        const results = await Promise.allSettled(
          cardsToRetry.map((card) => pushSingleCard(pushClient, pushUid, card)),
        );

        const anyFailed = results.some(
          (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value),
        );

        if (anyFailed) {
          // Keep lastPushFailed true so the retry banner stays visible and the
          // next reconnect / manual retry attempt can re-push the missing cards.
          // Mirrors useRetryPush semantics: only clear the flag when every card
          // succeeded (partial success still means the user's data is not fully
          // in the cloud).
          console.warn("[online-reconnect] some cards failed to push after reconnect; will retry on next grade or page reload");
        } else {
          // All cards succeeded — safe to clear the failure signal.
          markPushSucceeded();
        }
      } catch (err) {
        // Best-effort — never surface as a user-visible sync error.
        console.warn("[online-reconnect] unexpected error during reconnect catch-up", err);
      } finally {
        runningRef.current = false;
      }
    }

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, []); // empty deps — handler always reads from refs
}
