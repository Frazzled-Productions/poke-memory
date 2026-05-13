"use client";

import { useEffect, useState } from "react";
import {
  computeStreak,
  loadStreakData,
  STREAK_UPDATED_EVENT,
} from "@/lib/streak";
import { todayString } from "@/lib/review/session";

export function StreakBadge() {
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    function refresh() {
      setStreak(computeStreak(loadStreakData(), todayString(new Date())));
    }
    refresh();
    window.addEventListener(STREAK_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(STREAK_UPDATED_EVENT, refresh);
  }, []);

  if (streak === null) return null;

  return (
    <div className="mb-2 flex items-center justify-center sm:mb-4">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        {streak === 0
          ? "Start your streak!"
          : `${streak} day${streak === 1 ? "" : "s"} streak`}
      </span>
    </div>
  );
}
