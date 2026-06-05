"use client";

/**
 * Time-to-first-mastery hint surfaced on the Stats page (#1083).
 *
 * Mastery requires `reps >= masteryRepetitions && scheduledDays >= 21`, which
 * is typically a 3-6 week wall for a new user. Without an explicit signal,
 * the "0 mastered" headline reads as broken right when motivation is
 * weakest. This component renders a small, hedged line near the scheduling
 * controls projecting roughly when the first mastery will land.
 *
 * Render contract - the hint should only render when:
 *   - the user has at least one introduced card,
 *   - the user has zero mastered cards,
 *   - the superuser `pretendAllMastered` flag is off,
 *   - the projection helper returned a finite estimate.
 *
 * The page is responsible for evaluating those conditions; this component
 * just renders the message for a given day count. The wording is hedged on
 * purpose: "roughly", "if you keep reviewing daily" - no false precision.
 *
 * Note: spellOutSmall (English-only "one"/"two"/etc.) was removed in #1408.
 * ICU plural formatting handles both count text and locale-aware number
 * rendering via the `#` placeholder.
 */

import { useTranslations } from "next-intl";
import { mutedText } from "@/lib/utils/class-names";

type Props = {
  /** Projected days to first mastery; rendered verbatim into the copy. */
  days: number;
  /** Mastery threshold: number of successful reviews required. Matches the
   *  `masteryRepetitions` user setting so a non-default value in Settings is
   *  reflected in the hint. */
  masteryReps: number;
  /** Mastery threshold: scheduled-interval floor in days (currently always
   *  `MASTERY_INTERVAL_DAYS`, but threaded through so the copy can never drift
   *  from the constant). */
  masteryDays: number;
};

export function FirstMasteryHint({ days, masteryReps, masteryDays }: Props) {
  const t = useTranslations("stats");
  return (
    <p
      className={mutedText}
      data-testid="first-mastery-hint"
      aria-live="polite"
    >
      First mastery in roughly{" "}
      <span className="font-medium text-foreground tabular-nums">
        {t("firstMasteryDays", { count: days })}
      </span>{" "}
      if you keep reviewing daily. Mastery needs{" "}
      {t("masterySuccessfulReviews", { count: masteryReps })} and a{" "}
      {masteryDays}-day interval.
    </p>
  );
}
