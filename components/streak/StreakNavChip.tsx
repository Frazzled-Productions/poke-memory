"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useStreakNavState } from "@/lib/streak/useStreakNavState";
import { MAX_BALANCE } from "@/lib/streak/tokens";

/**
 * Persistent nav chip that surfaces the current streak count, token balance
 * (when >= 1), and days-to-next-milestone countdown.
 *
 * Renders as a `<Link href="/stats">` so tapping it routes to the full Stats
 * page where the StreakProtectionCard lives.
 *
 * Returns null until persisted state has loaded (after mount) to avoid a
 * hydration mismatch.
 */
export function StreakNavChip() {
  const t = useTranslations("nav");
  const { streak, tokenBalance, daysToNextMilestone } = useStreakNavState();

  // Wait for hydration.
  if (streak === null || tokenBalance === null) return null;

  // Build the accessible aria-label with all available information.
  const streakLabel =
    streak === 0 ? t("streakChip.startStreakLabel") : t("streakChip.streakLabel", { count: streak });
  const tokenPart =
    tokenBalance >= 1 ? " " + t("streakChip.tokenLabel", { count: tokenBalance }) : "";
  const milestonePart =
    daysToNextMilestone !== null
      ? " " + t("streakChip.milestoneLabel", { count: daysToNextMilestone })
      : "";
  const ariaLabel = streakLabel + tokenPart + milestonePart;

  // Visual representation — abbreviated to keep the chip compact.
  const streakVisual =
    streak === 0
      ? t("streakChip.startStreak")
      : t("streakChip.streak", { count: streak });

  return (
    <Link
      href="/stats"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1 [@media(hover:hover)]:hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:[@media(hover:hover)]:hover:bg-amber-900/50"
    >
      <span aria-hidden="true">{"🔥"}</span>
      <span>{streakVisual}</span>
      {tokenBalance >= 1 && (
        <span
          aria-hidden="true"
          className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-700 px-1 text-[10px] font-semibold text-amber-50 dark:bg-amber-400 dark:text-amber-900"
        >
          {Math.min(tokenBalance, MAX_BALANCE)}
        </span>
      )}
      {daysToNextMilestone !== null && (
        <span
          aria-hidden="true"
          className="text-amber-500 dark:text-amber-500"
        >
          {t("streakChip.milestoneBadge", { count: daysToNextMilestone })}
        </span>
      )}
    </Link>
  );
}
