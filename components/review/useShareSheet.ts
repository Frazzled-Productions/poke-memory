"use client";

/**
 * useShareSheet
 *
 * Derives the daily-share parts and formatted text from session-grade state.
 * Extracted from ReviewSession (#1520) to make it independently testable.
 *
 * Returns `null` for both values when the session has no grades (nothing to share).
 */

import { useMemo } from "react";
import { todayString } from "@/lib/review/session";
import { formatDailySummary, type DailySummaryParts } from "@/lib/review/share";
import { computeStreak, effectiveStreakDates, loadStreakData } from "@/lib/streak";
import { loadSettings } from "@/lib/settings/persistence";
import type { Grade } from "@/lib/review/session";

export interface UseShareSheetResult {
  shareParts: DailySummaryParts | null;
  shareText: string | null;
}

/**
 * Derives `shareParts` and `shareText` from the current session's grade
 * sequence, new-card count, mastered count, and timezone. The displayed date
 * uses the user's timezone (a calendar label), while streak lookup stays on
 * the UTC `today` the streak data is keyed by.
 *
 * Returns both as `null` when `sessionGradeSeq` is empty (nothing to share).
 */
export function useShareSheet(
  sessionGradeSeq: Grade[],
  newCardsThisSession: number,
  masteredThisSession: number,
  timezone: string,
): UseShareSheetResult {
  return useMemo(() => {
    if (sessionGradeSeq.length === 0) {
      return { shareParts: null, shareText: null };
    }

    const today = todayString(new Date());
    const todayTz = todayString(new Date(), timezone);

    const shareParts: DailySummaryParts = {
      date: todayTz,
      // Use protection-aware streak (#1227) so a preserved day is reflected
      // in the daily summary the user shares. Defensive ?? covers test mocks
      // that omit the field.
      streak: computeStreak(
        effectiveStreakDates(
          loadStreakData(),
          loadSettings().streakProtection?.spendDates ?? [],
        ),
        today,
      ),
      reviewed: sessionGradeSeq.length,
      newCards: newCardsThisSession,
      mastered: masteredThisSession,
      gradeSequence: sessionGradeSeq,
    };

    return {
      shareParts,
      shareText: formatDailySummary(shareParts),
    };
  // Re-derive when any input changes. timezone is stable after session load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionGradeSeq, newCardsThisSession, masteredThisSession, timezone]);
}
