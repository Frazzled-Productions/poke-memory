"use client";

/**
 * LanguageBreakdown — per-enrolled-language mastery summary on the Journey page.
 *
 * Renders a "Languages" section showing, for each enrolled learning locale
 * (when more than one is enrolled), the language endonym, per-locale mastery
 * count, and per-locale best review day.
 *
 * Gate: only renders when `languagesEnabled && learningLocales.length > 1`.
 * A single-locale user (the common case) never sees this section.
 */

import { useMemo } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { usePokemonLocaleContext } from "@/lib/i18n/PokemonLocaleContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { computeStats } from "@/lib/stats/derive";
import { bestReviewDayForLocale } from "@/lib/stats/records";
import { LOCALE_ENDONYMS, type AppLocale } from "@/i18n/locales";
import type { ReviewableCard } from "@/lib/review/session";
import type { GradeLog } from "@/lib/gradelog/persistence";
import { cn } from "@/lib/utils/cn";
import { mutedText } from "@/lib/utils/class-names";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type LanguageBreakdownProps = {
  cards: readonly ReviewableCard[];
  gradeLog: GradeLog;
  today: string;
  masteryRepetitions: number;
};

// ---------------------------------------------------------------------------
// Sub-component: a single row for one locale
// ---------------------------------------------------------------------------

type LanguageRowProps = {
  locale: AppLocale;
  masteredCount: number;
  bestDay: number;
};

function LanguageRow({ locale, masteredCount, bestDay }: LanguageRowProps) {
  const t = useTranslations("journey.languageBreakdown");
  const format = useFormatter();

  const endonym = LOCALE_ENDONYMS[locale];
  const isEnglish = locale === "en";

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3">
      <span className="text-sm font-medium text-foreground">
        {isEnglish ? (
          endonym
        ) : (
          <span lang={locale}>{endonym}</span>
        )}
      </span>
      <span className="tabular-nums text-sm text-emerald-600 dark:text-emerald-400">
        {t("masteredCount", { count: masteredCount })}
      </span>
      <span className={cn("tabular-nums text-sm", mutedText)}>
        {bestDay > 0
          ? t("bestDay", { count: format.number(bestDay) })
          : t("noBestDay")}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner component — rendered only when the gate passes
// ---------------------------------------------------------------------------

type LanguageBreakdownInnerProps = LanguageBreakdownProps & {
  learningLocales: AppLocale[];
  forceAllMastered: boolean;
};

function LanguageBreakdownInner({
  cards,
  gradeLog,
  today,
  masteryRepetitions,
  learningLocales,
  forceAllMastered,
}: LanguageBreakdownInnerProps) {
  const t = useTranslations("journey.languageBreakdown");

  const localeStats = useMemo(() => {
    return learningLocales.map((locale) => {
      const stats = computeStats(
        cards,
        today,
        /* strugglingLimit */ 10,
        masteryRepetitions,
        forceAllMastered,
        locale,
      );
      // Best-day always reflects real review history regardless of
      // forceAllMastered — pretend-mastery doesn't alter actual review counts.
      const bestDay = bestReviewDayForLocale(gradeLog, locale);
      return { locale, mastered: stats.mastered, bestDay };
    });
  }, [cards, today, masteryRepetitions, forceAllMastered, gradeLog, learningLocales]);

  return (
    <section aria-labelledby="lang-breakdown-heading">
      <h2
        id="lang-breakdown-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        {t("heading")}
      </h2>
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <ul
          role="list"
          aria-label={t("heading")}
          className="text-sm"
        >
          {localeStats.map(({ locale, mastered, bestDay }, idx) => (
            <li
              key={locale}
              className={
                idx < localeStats.length - 1
                  ? "border-b border-zinc-100 dark:border-zinc-800/60"
                  : ""
              }
            >
              <LanguageRow
                locale={locale}
                masteredCount={mastered}
                bestDay={bestDay}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component — applies the render gate
// ---------------------------------------------------------------------------

export function LanguageBreakdown(props: LanguageBreakdownProps) {
  const { languagesEnabled, learningLocales } = usePokemonLocaleContext();
  const { flags } = useSuperuser();

  // Gate: only show when the languages feature is on and >1 locale is enrolled.
  if (!languagesEnabled || learningLocales.length <= 1) {
    return null;
  }

  return (
    <LanguageBreakdownInner
      {...props}
      learningLocales={learningLocales}
      forceAllMastered={flags.pretendAllMastered}
    />
  );
}
