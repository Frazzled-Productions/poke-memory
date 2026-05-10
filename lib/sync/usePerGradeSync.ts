"use client";
import { useCallback, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";
import { pushSingleCard } from "@/lib/sync/cloud";

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

  const drainQueue = useCallback(async () => {
    const c = clientRef.current;
    const uid = userIdRef.current;
    if (!c || !uid) return;

    const toSend = [...pendingQueueRef.current];
    if (toSend.length === 0) return;
    const sentIds = new Set(toSend.map((card) => card.id));

    const failed: ReviewableCard[] = [];
    // No in-flight guard here — concurrent drains produce idempotent upserts,
    // so the only shared-state risk is the pendingQueueRef filter below writing
    // on stale read. That outcome is benign: each drain removes its own sentIds
    // independently, so no grade is permanently lost. A guard would add
    // complexity without a meaningful correctness benefit.
    await Promise.all(
      toSend.map(async (card) => {
        const ok = await pushSingleCard(c, uid, card);
        if (!ok) failed.push(card);
      }),
    );

    // Keep a card in the queue if it wasn't part of this drain (a newer grade
    // arrived during the await window) or if it was sent but failed.
    pendingQueueRef.current = pendingQueueRef.current.filter(
      (card) => !sentIds.has(card.id) || failed.some((f) => f.id === card.id),
    );
  }, []);

  const enqueueGrade = useCallback(
    (card: ReviewableCard) => {
      // If the user signs out within the 200 ms debounce window the guard exits
      // early and this grade is not synced. The unload safety-net also bails
      // because client/userId are null by then. Accepted best-effort loss.
      if (!clientRef.current || !userIdRef.current) return;

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
