"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { loadSettings } from "@/lib/settings/persistence";
import { MIN_REVIEWS_FOR_OPTIMIZATION, optimizerCooldownRemainingMs } from "@/lib/srs/optimizer";
import { cardPanelPadded, colStack, colStackLg, mutedText, mutedTextXs, sectionLabelSm } from "@/lib/utils/class-names";
import { formatDate, todayInTimezone } from "@/lib/utils/format-date";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The optimiser page. Linked with a plain <a>: it needs its own document load
 * to be cross-origin isolated (next.config.ts headers). */
export const OPTIMISER_PAGE_PATH = "/settings/optimiser";

const disabledButtonClass =
  "mt-2 inline-flex items-center gap-2 min-h-[44px] rounded-lg bg-zinc-200 text-zinc-500 px-6 py-2 text-sm font-semibold dark:bg-zinc-800 dark:text-zinc-400";

type Props = {
  /** ISO timestamp of the last successful weight optimization, if any. */
  fsrsWeightsOptimizedAt: string | undefined;
  /** Number of grade-log entries that are eligible for optimization. */
  optimizableReviewCount: number;
  /** True when the user is signed in. */
  isSignedIn: boolean;
  /** True when any superuser flag is on - disabled while superuser is active. */
  superuserPaused: boolean;
};

export function FsrsOptimizerSection({
  fsrsWeightsOptimizedAt,
  optimizableReviewCount,
  isSignedIn,
  superuserPaused,
}: Props) {
  const t = useTranslations("settings");
  // Captured once at mount so the render body stays pure; the cooldown is a
  // coarse day-granularity countdown, so a snapshot is accurate enough.
  const [nowMs] = useState(() => Date.now());
  // The "last optimised" label is a user-facing day boundary, rendered in the
  // user's configured timezone (AGENTS.md: user-facing dates are tz-aware).
  const [tz] = useState(() => loadSettings().timezone ?? "UTC");
  const cooldownDays = useMemo(
    () => Math.ceil(optimizerCooldownRemainingMs([fsrsWeightsOptimizedAt], nowMs) / MS_PER_DAY),
    [fsrsWeightsOptimizedAt, nowMs],
  );

  const lastOptimised =
    fsrsWeightsOptimizedAt === undefined ? null : (
      <p data-testid="fsrs-optimize-last-run" className={mutedTextXs}>
        {t("optimiser.lastOptimised", {
          date: formatDate(todayInTimezone(tz, new Date(fsrsWeightsOptimizedAt)), "dmy-year", "UTC"),
        })}
      </p>
    );

  return (
    <section className={colStackLg} aria-labelledby="optimizer-heading">
      <h2 id="optimizer-heading" className={sectionLabelSm}>
        {t("optimiser.heading")}
      </h2>
      <div className={cardPanelPadded}>
        {!isSignedIn ? (
          <p data-testid="fsrs-optimize-help" className={mutedText}>
            {t("optimiser.signInPrompt")}
          </p>
        ) : superuserPaused ? (
          <div className={colStack}>
            <p className="text-sm text-foreground">{t("optimiser.intro")}</p>
            <button
              type="button"
              disabled
              data-testid="fsrs-optimize-button"
              title={t("optimiser.pausedTitle")}
              className={disabledButtonClass}
            >
              {t("optimiser.pausedButton")}
            </button>
          </div>
        ) : optimizableReviewCount < MIN_REVIEWS_FOR_OPTIMIZATION ? (
          <div className={colStack}>
            <p className="text-sm text-foreground">{t("optimiser.notEnoughIntro")}</p>
            <button type="button" disabled data-testid="fsrs-optimize-button" className={disabledButtonClass}>
              {t("optimiser.optimiseNow")}
            </button>
            <p data-testid="fsrs-optimize-help" className={mutedTextXs}>
              {t("optimiser.availableAfter", {
                min: MIN_REVIEWS_FOR_OPTIMIZATION,
                count: optimizableReviewCount,
              })}
            </p>
          </div>
        ) : cooldownDays > 0 ? (
          <div className={colStack}>
            <p className="text-sm text-foreground">{t("optimiser.intro")}</p>
            <button type="button" disabled data-testid="fsrs-optimize-button" className={disabledButtonClass}>
              {t("optimizerCooldown", { count: cooldownDays })}
            </button>
            {lastOptimised}
          </div>
        ) : (
          <div className={colStack}>
            <p className="text-sm text-foreground">{t("optimiser.intro")}</p>
            <a
              href={OPTIMISER_PAGE_PATH}
              data-testid="fsrs-optimize-link"
              className="mt-2 inline-flex min-h-[44px] items-center gap-2 self-start rounded-lg bg-foreground px-6 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            >
              {t("optimiser.optimiseNow")}
            </a>
            {lastOptimised}
          </div>
        )}
      </div>
    </section>
  );
}
