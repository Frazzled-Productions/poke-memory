"use client";

import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pullAndMerge } from "@/lib/sync/pullAndMerge";
import { useLatestRef } from "@/lib/hooks/useLatestRef";
import { pushSingleCard, isSyncSafe } from "@/lib/sync/cloud";
import {
  loadSyncStatus,
  markPushSucceeded,
  savePendingQueue,
  loadPendingQueue,
  clearPendingQueue,
} from "@/lib/sync/persistence";
import { resetStructuralProbe } from "@/lib/sync/structuralError";
import { loadSession } from "@/lib/review/persistence";
import { todayString } from "@/lib/review/session";
import { SW_REPLAY_MESSAGE } from "@/lib/sync/backgroundSync";

/**
 * Listens for the browser `online` event and automatically performs a
 * pull-then-push catch-up when the device reconnects.
 *
 * Ordering (respects the pull-before-push invariant from docs/sync.md):
 *   1. `pullAndMerge` — brings local state up to date with cloud.
 *   2. Push any cards that failed the per-grade path while offline.
 *
 * Card selection and success semantics mirror `useRetryPush` exactly (#893):
 *   - `lastPushFailed` false → only the pull runs; no push leg.
 *   - Persisted queue non-empty → push those exact cards (most precise).
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
 * Background Sync delegation (#1054): the service worker posts a
 * `BACKGROUND_SYNC_REPLAY` message when the `sync` event fires while at least
 * one window client is active. This hook listens for that message and triggers
 * the same pull-then-push logic, preventing a concurrent push from both the SW
 * and the running app.
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
  const clientRef = useLatestRef(client);
  const userIdRef = useLatestRef(userId);

  // In-flight guard: prevents concurrent reconnect handlers from running
  // simultaneously (e.g. rapid on/off/on network flaps, or the SW message and
  // the online event firing at the same time).
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
        // Reset the session-scoped structural-error probe guard (#1358 FIX 3).
        // The 'online' event signals that connectivity was lost and has now
        // returned — a deploy fix is more likely to have landed during the
        // outage than during continuous operation. Resetting the guard lets the
        // next drainQueue attempt serve as a fresh self-heal probe.
        resetStructuralProbe();

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

        // Re-read client/userId from refs so a sign-out that races with this
        // async run uses current values.
        const pushClient = clientRef.current;
        const pushUid = userIdRef.current;
        if (!pushClient || !pushUid) return;

        // Prefer the persisted queue when it is non-empty (#893). The persisted
        // queue contains the exact cards `usePerGradeSync` had not yet delivered,
        // so it is always more precise than the session-card heuristic below.
        const persistedQueue = loadPendingQueue();
        if (persistedQueue.length > 0) {
          const queueResults = await Promise.allSettled(
            persistedQueue.map((card) => pushSingleCard(pushClient, pushUid, card)),
          );

          const failedCards = persistedQueue.filter((_, i) => {
            const r = queueResults[i];
            return r.status === "rejected" || (r.status === "fulfilled" && !r.value);
          });

          if (failedCards.length > 0) {
            // Partial or total failure: slim the persisted queue to only the
            // cards that failed so the next retry does not re-push cards that
            // already reached the cloud (#893 partial-success slimming).
            savePendingQueue(failedCards);
            console.warn("[online-reconnect] some persisted-queue cards failed to push; will retry on next grade or reconnect");
          } else {
            // All persisted-queue cards succeeded — clear both the failure signal
            // and the persisted queue so stale data does not accumulate.
            markPushSucceeded();
            clearPendingQueue();
          }
          return;
        }

        // No persisted queue: fall back to the session-card heuristic.
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

    // Handle BACKGROUND_SYNC_REPLAY messages from the service worker (#1054).
    // When the SW's `sync` event fires while the app is open, the SW posts this
    // message via a MessageChannel so it can await an explicit ACK before
    // deciding whether to fall through to the direct-push path. This hook
    // replies on the transferred port immediately (ACK = "I'm handling it") and
    // then runs the pull-push sequence. If the reply races the SW timeout, the
    // SW may push directly in parallel — the upsert is idempotent so that is
    // safe (#1072 B3).
    function handleSwMessage(event: MessageEvent<unknown>) {
      const data = event.data as Record<string, unknown> | null;
      if (typeof data !== "object" || data === null || data["type"] !== SW_REPLAY_MESSAGE) return;

      // Send ACK on the MessageChannel port transferred by the SW, if present.
      // The ACK tells the SW a live client is committed to running the sequence,
      // so the SW does not fall through to its own direct-push path.
      const port = event.ports?.[0];
      if (port) {
        port.postMessage({ type: "ACK" });
      }

      void handleOnline();
    }

    window.addEventListener("online", handleOnline);
    // Capture the serviceWorker reference at registration time so the cleanup
    // closure uses the same object — the property may become undefined later in
    // tests (afterEach teardown) before cleanup runs.
    const swContainer =
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker
        : null;
    if (swContainer) {
      swContainer.addEventListener("message", handleSwMessage);
    }
    return () => {
      window.removeEventListener("online", handleOnline);
      if (swContainer) {
        swContainer.removeEventListener("message", handleSwMessage);
      }
    };
  }, []); // empty deps — handler always reads from refs
}
