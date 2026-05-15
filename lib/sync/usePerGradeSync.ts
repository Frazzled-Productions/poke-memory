"use client";
import { useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";
import { pushSingleCard, isSyncSafe } from "@/lib/sync/cloud";
import { markPushSucceeded, markPushFailed } from "@/lib/sync/persistence";

/** Number of consecutive all-failure drains before the banner is shown. */
const FAILURE_THRESHOLD = 3;

/**
 * Debounced per-grade sync hook. Returns { enqueueGrade, flushPending }.
 *
 * enqueueGrade(card) — fire-and-forget. Adds the card to the pending queue
 * and arms a 200 ms debounce. When the timer fires, all queued cards are
 * upserted one at a time; successes are drained, failures stay queued for
 * the next grade or the unload safety-net.
 *
 * flushPending() — returns a snapshot of the current unsynced queue; does not
 * modify the queue or cancel any pending timer. Pass this to useSyncOnUnload
 * so it can batch only the cards that failed the per-grade path.
 *
 * Guest-mode guard runs on every enqueueGrade call — safe across sign-in
 * state changes mid-session.
 */
export function usePerGradeSync(
  client: SupabaseClient | null,
  userId: string | null,
): { enqueueGrade: (card: ReviewableCard) => void; flushPending: () => ReviewableCard[] } {
  const pendingQueueRef = useRef<ReviewableCard[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest client/userId accessible inside the debounce closure without
  // adding them as effect dependencies.
  const clientRef = useRef(client);
  const userIdRef = useRef(userId);
  clientRef.current = client;
  userIdRef.current = userId;
  // Counts consecutive all-failure drains. Reset to 0 on any partial success.
  // When it reaches FAILURE_THRESHOLD, markPushFailed is called so the banner
  // appears (#606).
  const consecutiveFailuresRef = useRef(0);

  const drainQueue = useCallback(async () => {
    const c = clientRef.current;
    const uid = userIdRef.current;
    if (!c || !uid) return;

    const toSend = [...pendingQueueRef.current];
    if (toSend.length === 0) return;
    const sentIds = new Set(toSend.map((card) => card.id));

    // No in-flight guard here — concurrent drains produce idempotent upserts,
    // so the only shared-state risk is the pendingQueueRef filter below writing
    // on stale read. That outcome is benign: each drain removes its own sentIds
    // independently, so no grade is permanently lost. A guard would add
    // complexity without a meaningful correctness benefit.
    const results = await Promise.all(
      toSend.map(async (card) => {
        const ok = await pushSingleCard(c, uid, card);
        return { card, ok };
      }),
    );
    const failedIds = new Set(results.filter((r) => !r.ok).map((r) => r.card.id));

    // Keep a card in the queue if it wasn't part of this drain (a newer grade
    // arrived during the await window) or if it was sent but failed. If two
    // concurrent drains both attempted the same card, the queue entry at
    // filter-time reflects the latest enqueued state — the newest version
    // survives either way.
    pendingQueueRef.current = pendingQueueRef.current.filter(
      (card) => !sentIds.has(card.id) || failedIds.has(card.id),
    );

    // Update lastPushAt once per debounce flush if at least one card succeeded.
    // Called here (not per-card) so concurrent drains produce at most one write
    // per flush rather than N writes for N cards.
    //
    // Any-success (not all-success) is deliberate (#473): a partial-success
    // debounced push still moved the cloud forward, so the "Last synced"
    // indicator should advance. This differs from the unload path, which
    // flags failure whenever any card failed. See lib/sync/persistence.ts
    // `markPushSucceeded` JSDoc for the full semantics rationale.
    const anySucceeded = results.some((r) => r.ok);
    if (anySucceeded) {
      consecutiveFailuresRef.current = 0;
      markPushSucceeded();
    } else {
      // All cards failed this drain. Increment the consecutive-failure counter
      // and surface the banner after FAILURE_THRESHOLD attempts (#606). A single
      // network blip should not show the banner; three consecutive all-failure
      // drains strongly suggests the push channel is broken.
      //
      // Use === (not >=) so markPushFailed fires exactly once per failure
      // episode — only on the transition from threshold-1 to threshold. When
      // failures resume after a successful drain resets the counter, the next
      // === hit naturally re-fires.
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current === FAILURE_THRESHOLD) {
        markPushFailed(pendingQueueRef.current.length);
      }
    }
  }, []);

  const enqueueGrade = useCallback(
    (card: ReviewableCard) => {
      // If the user signs out within the 200 ms debounce window the guard exits
      // early and this grade is not synced. The unload safety-net also bails
      // because client/userId are null by then. Accepted best-effort loss.
      if (!clientRef.current || !userIdRef.current) return;

      // Skip in-step cards entirely — they are not safe to write to the cloud
      // until they graduate (lastReview set). Enqueuing them would cause
      // pushSingleCard to return false and keep them in the retry queue forever.
      if (!isSyncSafe(card)) return;

      // Replace existing entry for this card or append.
      const queue = pendingQueueRef.current;
      const idx = queue.findIndex((c) => c.id === card.id);
      if (idx >= 0) {
        queue[idx] = card;
      } else {
        queue.push(card);
      }

      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void drainQueue();
      }, 200);
    },
    [drainQueue],
  );

  const flushPending = useCallback((): ReviewableCard[] => {
    return [...pendingQueueRef.current];
  }, []);

  return { enqueueGrade, flushPending };
}
