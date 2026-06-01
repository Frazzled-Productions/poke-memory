"use client";

/**
 * ProfileStatusBar — a slim, read-only status band rendered in `app/layout.tsx`
 * directly below `<Nav>`, showing streak, protection-token balance, and mastery
 * at a glance on every route.
 *
 * Responsive behaviour:
 *   - Desktop (md+): visible on ALL routes including Practice.
 *   - Mobile (<md): hidden on the Practice route (/) because `StreakBadge` on
 *     that page already carries streak/token/milestone inline and screen space
 *     is tight (#1086/#1087). Visible on all other mobile routes.
 *
 * De-dup: the token pip has been removed from `StreakBadge` (Practice) and the
 * streak line has been removed from `StreakProtectionCard` (Stats) — the bar
 * carries those signals on all non-Practice surfaces (and on Practice desktop).
 * The milestone countdown on Practice and the full protection card on Stats are
 * kept intact.
 *
 * Read-only: no cloud writes. The sync write-guard is not engaged.
 * Future interactive controls must accept the standard `superuserPaused` prop.
 *
 * Owner: ui-coder. Part 2/3 of the profile status bar (#1490).
 */

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useProfileStatus } from "@/lib/profile/useProfileStatus";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Height of the bar in CSS — kept as a named constant so the skeleton and
 *  the populated bar share the same fixed height, preventing layout shift. */
const BAR_HEIGHT_CLASS = "h-9";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProfileStatusBar() {
  const t = useTranslations("profileStatus");
  const pathname = usePathname();
  const { streak, tokenBalance, masteryCount, totalSpecies, masteryPercent } =
    useProfileStatus();

  // Mobile-only Practice hide: on small viewports the Practice page (/) already
  // carries streak/token in the inline StreakBadge. Desktop always shows the bar.
  const isPracticePage = pathname === "/";

  // Pre-mount guard: all profileStatus values are null until after the first
  // client render (see useProfileStatus). Render a fixed-height skeleton so the
  // layout height is reserved and there is no shift when the bar populates.
  if (
    streak === null ||
    tokenBalance === null ||
    masteryCount === null ||
    totalSpecies === null ||
    masteryPercent === null
  ) {
    return (
      <div
        aria-hidden="true"
        className={`${BAR_HEIGHT_CLASS} w-full border-b border-zinc-100 bg-background dark:border-zinc-900 ${isPracticePage ? "hidden md:block" : ""}`}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const streakAriaLabel =
    streak === 0
      ? t("startStreakChipAriaLabel")
      : t("streakChipAriaLabel", { count: streak });

  const masteryAriaLabel =
    masteryCount === 0
      ? t("masteryZeroAriaLabel", { total: totalSpecies })
      : t("masteryChipAriaLabel", { mastered: masteryCount, total: totalSpecies });

  const barAriaLabel = t("barAriaLabel");

  return (
    <div
      role="status"
      aria-live="off"
      aria-label={barAriaLabel}
      // Mobile Practice: hide. Desktop: always visible.
      className={`w-full border-b border-zinc-100 bg-background dark:border-zinc-900 ${isPracticePage ? "hidden md:block" : ""}`}
    >
      <div
        className={`mx-auto flex ${BAR_HEIGHT_CLASS} max-w-5xl items-center gap-4 px-4`}
      >
        {/* Streak chip */}
        <span
          aria-label={streakAriaLabel}
          className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"
        >
          <span aria-hidden="true">🔥</span>
          <span>
            {streak === 0
              ? t("startStreakLabel")
              : t("streakLabel", { count: streak })}
          </span>
        </span>

        {/* Token chip — hidden when balance is 0 */}
        {tokenBalance >= 1 && (
          <span
            aria-label={t("tokenChipAriaLabel", { count: tokenBalance })}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400"
          >
            <span aria-hidden="true">🛡</span>
            <span>{t("tokenLabel", { count: tokenBalance })}</span>
          </span>
        )}

        {/* Mastery chip — always visible; zero state uses encouraging label */}
        <span
          aria-label={masteryAriaLabel}
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
        >
          <span aria-hidden="true">✓</span>
          <span>
            {t("masteryLabel", {
              mastered: masteryCount,
              total: totalSpecies,
              pct: masteryPercent,
            })}
          </span>
        </span>
      </div>
    </div>
  );
}
