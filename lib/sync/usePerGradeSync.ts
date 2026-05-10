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
 * flushPending() — returns the current unsynced queue without side effects.
 * Pass this to useSyncOnUnload so it can batch only the cards that failed
 * the per-grade path.
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

    const failed: ReviewableCard[] = [];
    await Promise.all(
      toSend.map(async (card) => {
        const ok = await pushSingleCard(c, uid, card);
        if (!ok) failed.push(card);
      }),
    );

    // Replace the queue with only the cards that failed, preserving any new
    // entries that arrived while we were awaiting.
    pendingQueueRef.current = pendingQueueRef.current.filter((card) =>
      failed.some((f) => f.id === card.id),
    );
  }, []);

  const enqueueGrade = useCallback(
    (card: ReviewableCard) => {
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
