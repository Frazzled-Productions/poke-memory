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
import {
  StreakChip,
  TokenChip,
  MasteryChip,
} from "@/components/profile/StatusChips";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

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

  const barAriaLabel = t("barAriaLabel");

  return (
    // A named landmark region, NOT a live region: the bar loads once and is
    // passive, so it should be navigable by assistive tech but never announced
    // on navigation (role="status" would imply aria-live="polite"). #1490.
    <div
      role="region"
      aria-label={barAriaLabel}
      // Mobile Practice: hide. Desktop: always visible.
      className={`w-full border-b border-zinc-100 bg-background dark:border-zinc-900 ${isPracticePage ? "hidden md:block" : ""}`}
    >
      <div
        className={`mx-auto flex ${BAR_HEIGHT_CLASS} max-w-5xl items-center justify-center gap-3 px-4`}
      >
        {/* Order: streak · mastery · token. Mastery is always rendered (stable
            anchor); the token chip appears/disappears on the trailing edge so
            mastery never shifts position. Shared StatusChips keep this identical
            to the inline StreakBadge group (single-source convention). */}
        <StreakChip streak={streak} />
        <MasteryChip
          masteryCount={masteryCount}
          totalSpecies={totalSpecies}
          masteryPercent={masteryPercent}
        />
        <TokenChip tokenBalance={tokenBalance} />
        {/* Learning-language switcher — renders only when the languages Labs
            flag is on (gated inside the component). Interactive pill, distinct
            from the passive status chips. */}
        <LanguageSwitcher />
      </div>
    </div>
  );
}
