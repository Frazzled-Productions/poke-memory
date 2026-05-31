"use client";

import { useEffect, useState } from "react";
import {
  computeStreak,
  effectiveStreakDates,
  loadStreakData,
  STREAK_UPDATED_EVENT,
} from "@/lib/streak";
import { STREAK_MILESTONES, POST_365_INTERVAL } from "@/lib/streak/milestones";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { todayString } from "@/lib/review/session";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";

/**
 * Shape returned by `useStreakNavState`. All values are null until the hook
 * has read persisted state after mount (avoids an SSR hydration mismatch).
 */
export type StreakNavState = {
  /** Current streak in days. null = not yet loaded. */
  streak: number | null;
  /** Token balance (0..3). null = not yet loaded. */
  tokenBalance: number | null;
  /**
   * Days until the next milestone target, or null when no countdown should
   * be shown. Null when:
   * - Not yet loaded.
   * - The user is at streak 0 (no meaningful target to show).
   * - `forceNextStreakMilestone` is on (the imminent celebration on Practice
   *   is the signal; showing a countdown would confuse the UX).
   * - The next milestone is already reached (let Practice fire the celebration).
   */
  daysToNextMilestone: number | null;
};

/**
 * Returns the next milestone strictly above `streak`. Pure helper; no state.
 */
export function nextMilestoneAbove(streak: number): number | null {
  // Walk the static array first.
  for (const m of STREAK_MILESTONES) {
    if (m > streak) return m;
  }
  // Post-365 extension: first post-365 milestone above `streak`.
  const lastStatic = STREAK_MILESTONES[STREAK_MILESTONES.length - 1]; // 365
  const firstPost = lastStatic + POST_365_INTERVAL; // 465
  for (let m = firstPost; ; m += POST_365_INTERVAL) {
    if (m > streak) return m;
  }
}

/**
 * Read-only hook that exposes current streak, token balance, and days-to-
 * next-milestone for the persistent nav `StreakNavChip`.
 *
 * Reads from persisted state on mount and re-reads on `STREAK_UPDATED_EVENT`
 * and `SETTINGS_SAVED_EVENT` so the chip stays in sync with Practice (which
 * writes those events after grading). Does NOT call `runStreakProtection` -
 * that responsibility stays in `StreakBadge`.
 *
 * Returns all-null until after the first client render so the chip renders
 * nothing server-side (avoids a hydration mismatch since persisted state is
 * browser-only).
 */
export function useStreakNavState(): StreakNavState {
  const [state, setState] = useState<StreakNavState>({
    streak: null,
    tokenBalance: null,
    daysToNextMilestone: null,
  });
  const { flags } = useSuperuser();

  useEffect(() => {
    function refresh() {
      const settings = loadSettings();
      const today = todayString(new Date(), settings.timezone ?? "UTC");
      const streak = computeStreak(
        effectiveStreakDates(
          loadStreakData(),
          settings.streakProtection?.spendDates ?? [],
        ),
        today,
      );
      const tokenBalance = settings.streakProtection?.balance ?? 0;

      // Compute days-to-next-milestone countdown. Suppressed when:
      // - streak is 0 (no run to celebrate yet)
      // - forceNextStreakMilestone is on (Practice celebration is imminent)
      let daysToNextMilestone: number | null = null;
      if (streak > 0 && !flags.forceNextStreakMilestone) {
        const next = nextMilestoneAbove(streak);
        if (next !== null) {
          const distance = next - streak;
          // distance is always > 0 (nextMilestoneAbove is strictly above streak)
          if (distance > 0) {
            daysToNextMilestone = distance;
          }
        }
      }

      setState({ streak, tokenBalance, daysToNextMilestone });
    }

    refresh();
    window.addEventListener(STREAK_UPDATED_EVENT, refresh);
    window.addEventListener(SETTINGS_SAVED_EVENT, refresh);
    return () => {
      window.removeEventListener(STREAK_UPDATED_EVENT, refresh);
      window.removeEventListener(SETTINGS_SAVED_EVENT, refresh);
    };
  // Re-bind when forceNextStreakMilestone toggles so suppression takes effect.
  }, [flags.forceNextStreakMilestone]);

  return state;
}
