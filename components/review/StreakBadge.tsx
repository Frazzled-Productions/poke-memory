"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  computeStreak,
  effectiveStreakDates,
  loadStreakData,
  STREAK_UPDATED_EVENT,
} from "@/lib/streak";
import { runStreakProtection } from "@/lib/streak/runProtection";
import { findPendingMilestone } from "@/lib/streak/milestones";
import { todayString } from "@/lib/review/session";
import {
  loadSettings,
  saveSettings,
  SETTINGS_SAVED_EVENT,
} from "@/lib/settings/persistence";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { MilestoneCelebration } from "@/components/streak/MilestoneCelebration";

export function StreakBadge() {
  const t = useTranslations("review");
  const [streak, setStreak] = useState<number | null>(null);
  const [pendingMilestone, setPendingMilestone] = useState<number | null>(null);
  const { flags, setFlag } = useSuperuser();

  // Recompute streak and milestone-to-fire whenever the underlying data
  // changes. Reads `loadSettings()` fresh inside the callback so a dismiss
  // (which writes `seenStreakMilestones`) is reflected on the next event.
  useEffect(() => {
    function refresh() {
      // Load settings before computing `today` so the protection pass and
      // streak computation both honour the user's timezone — the streakDates
      // set is populated in the user's local tz (see ReviewSession), so a
      // UTC `today` would cause off-by-one boundary errors at high offsets.
      const settings = loadSettings();
      const today = todayString(new Date(), settings.timezone ?? "UTC");
      // Run the streak-protection step before computing the streak so a token
      // spend (if any) bridges yesterday's gap. The step is idempotent across
      // same-day calls.
      runStreakProtection(today);
      const s = computeStreak(
        effectiveStreakDates(
          loadStreakData(),
          settings.streakProtection?.spendDates ?? [],
        ),
        today,
      );
      setStreak(s);
      const seen = settings.seenStreakMilestones;
      if (flags.forceNextStreakMilestone) {
        // QA cheat: fire the smallest un-seen milestone regardless of actual
        // streak. Picks from STREAK_MILESTONES via findPendingMilestone with
        // a very large effective streak so all milestones are "reached".
        setPendingMilestone(findPendingMilestone(Number.MAX_SAFE_INTEGER, seen));
      } else {
        setPendingMilestone(findPendingMilestone(s, seen));
      }
    }
    refresh();
    window.addEventListener(STREAK_UPDATED_EVENT, refresh);
    window.addEventListener(SETTINGS_SAVED_EVENT, refresh);
    return () => {
      window.removeEventListener(STREAK_UPDATED_EVENT, refresh);
      window.removeEventListener(SETTINGS_SAVED_EVENT, refresh);
    };
  }, [flags.forceNextStreakMilestone]);

  const dismissMilestone = useCallback(() => {
    if (pendingMilestone === null) return;
    setPendingMilestone(null);
    if (flags.forceNextStreakMilestone) {
      // QA fire: do not persist the milestone as seen — the user hasn't
      // genuinely reached it. Just self-clear the flag so QA gets exactly
      // one forced fire per toggle.
      void setFlag("forceNextStreakMilestone", false);
      return;
    }
    const current = loadSettings();
    if (!current.seenStreakMilestones.includes(pendingMilestone)) {
      saveSettings({
        ...current,
        seenStreakMilestones: [
          ...current.seenStreakMilestones,
          pendingMilestone,
        ],
      });
    }
  }, [pendingMilestone, flags.forceNextStreakMilestone, setFlag]);

  if (streak === null) return null;

  return (
    <>
      <div className="mb-2 flex items-center justify-center sm:mb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          {streak === 0
            ? "Start your streak!"
            : t("streakDays", { count: streak })}
        </span>
      </div>
      {pendingMilestone !== null && (
        <MilestoneCelebration
          key={pendingMilestone}
          milestone={pendingMilestone}
          onDismiss={dismissMilestone}
        />
      )}
    </>
  );
}
