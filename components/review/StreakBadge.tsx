"use client";

import { useEffect, useState } from "react";
import { computeStreak, loadStreakData } from "@/lib/streak";
import { todayString } from "@/lib/review/session";

export function StreakBadge() {
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    setStreak(computeStreak(loadStreakData(), todayString(new Date())));
  }, []);

  if (streak === null) return null;

  return (
    <div className="mb-4 flex items-center justify-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        {streak === 0
          ? "Start your streak!"
          : `${streak} day${streak === 1 ? "" : "s"} streak`}
      </span>
    </div>
  );
}
