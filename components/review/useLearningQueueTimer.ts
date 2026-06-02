"use client";

/**
 * useLearningQueueTimer
 *
 * Schedules a `setTimeout` to fire a re-render callback when the earliest
 * pending learning-queue entry becomes due. Extracted from ReviewSession (#1520)
 * to make the timer logic independently testable.
 *
 * Cleans up the previous timeout on every `learningQueue` change to avoid
 * double-firing.
 */

import { useEffect, useRef } from "react";

export interface LearningQueueEntry {
  cardId: number;
  dueAt: number;
}

/**
 * Fires `onDue` after a `setTimeout` aligned to the earliest future-due
 * entry in `learningQueue`. The callback triggers a re-render in
 * ReviewSession so the now-due learning card is picked up.
 *
 * No-op when `learningQueue` is empty or all entries are already due.
 */
export function useLearningQueueTimer(
  learningQueue: LearningQueueEntry[],
  onDue: () => void,
): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const now = Date.now();
    const futureDue = learningQueue.filter((e) => e.dueAt > now);
    if (futureDue.length === 0) return;

    const earliest = Math.min(...futureDue.map((e) => e.dueAt));
    const delay = Math.max(0, earliest - now);

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      // Fire the callback — ReviewSession passes `() => setLearningQueue(q => [...q])`
      // which forces a re-render so the now-due card is picked up. Bumping the array
      // reference re-runs this effect, which is harmless: the newly-due entry is
      // filtered out of `futureDue`, and any remaining future entries chain onto
      // the next setTimeout.
      onDue();
    }, delay);

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // onDue is a stable callback provided by ReviewSession (an inline arrow
    // that calls setLearningQueue). Re-running on `onDue` identity change would
    // reset timers spuriously; ReviewSession creates it as a stable closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learningQueue]);
}
