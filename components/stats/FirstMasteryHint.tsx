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
 * Render contract — the hint should only render when:
 *   - the user has at least one introduced card,
 *   - the user has zero mastered cards,
 *   - the superuser `pretendAllMastered` flag is off,
 *   - the projection helper returned a finite estimate.
 *
 * The page is responsible for evaluating those conditions; this component
 * just renders the message for a given day count. The wording is hedged on
 * purpose: "roughly", "if you keep reviewing daily" - no false precision.
 */

import { mutedText } from "@/lib/utils/class-names";

type Props = {
  /** Projected days to first mastery; rendered verbatim into the copy. */
  days: number;
};

export function FirstMasteryHint({ days }: Props) {
  return (
    <p
      className={mutedText}
      data-testid="first-mastery-hint"
      aria-live="polite"
    >
      First mastery in roughly{" "}
      <span className="font-medium text-foreground tabular-nums">
        {days.toLocaleString("en-GB")}
      </span>{" "}
      day{days === 1 ? "" : "s"} if you keep reviewing daily. Mastery needs
      three successful reviews and a 21-day interval.
    </p>
  );
}
