"use client";

/**
 * LanguageBreakdown — per-enrolled-language mastery summary on the Stats page.
 *
 * Renders a "Languages" card showing, for each enrolled learning locale
 * (when more than one is enrolled): the language endonym, total card count,
 * mastery percentage, and last review date for that locale.
 *
 * Gate: only renders when `languagesEnabled && learningLocales.length > 1`.
 * A single-locale user (the common case) never sees this section.
 *
 * Issue: #1619
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { usePokemonLocaleContext } from "@/lib/i18n/PokemonLocaleContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { computeStats } from "@/lib/stats/derive";
import { lastReviewForLocale } from "@/lib/stats/mastery-species-events";
import { formatDate, type DateFormat } from "@/lib/utils/format-date";
import { LOCALE_ENDONYMS, type AppLocale } from "@/i18n/locales";
import type { ReviewableCard } from "@/lib/review/session";
import { cn } from "@/lib/utils/cn";
import { mutedText } from "@/lib/utils/class-names";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type LanguageBreakdownProps = {
  cards: readonly ReviewableCard[];
  today: string;
  masteryRepetitions: number;
  dateFormat: DateFormat;
  timezone: string;
};

// ---------------------------------------------------------------------------
// Sub-component: a single row for one locale
// ---------------------------------------------------------------------------

type LanguageRowProps = {
  locale: AppLocale;
  totalCards: number;
  masteryPct: number;
  lastReview: string | null;
  dateFormat: DateFormat;
  timezone: string;
};

function LanguageRow({
  locale,
  totalCards,
  masteryPct,
  lastReview,
  dateFormat,
  timezone,
}: LanguageRowProps) {
  const t = useTranslations("stats.languageBreakdown");

  const endonym = LOCALE_ENDONYMS[locale];
  const isEnglish = locale === "en";

  const lastReviewText =
    lastReview !== null
      ? t("lastReview", { date: formatDate(lastReview, dateFormat, timezone) })
      : t("neverReviewed");

  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-4">
      <span className="text-sm font-medium text-foreground">
        {isEnglish ? (
          endonym
        ) : (
          <span lang={locale}>{endonym}</span>
        )}
      </span>
      <span className={cn("tabular-nums text-sm", mutedText)}>
        {t("cardCount", { count: totalCards })}
      </span>
      <span className="tabular-nums text-sm text-emerald-600 dark:text-emerald-400">
        {t("mastery", { pct: masteryPct })}
      </span>
      <span className={cn("tabular-nums text-xs", mutedText)}>
        {lastReviewText}
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
  today,
  masteryRepetitions,
  dateFormat,
  timezone,
  learningLocales,
  forceAllMastered,
}: LanguageBreakdownInnerProps) {
  const t = useTranslations("stats.languageBreakdown");

  const localeData = useMemo(() => {
    return learningLocales.map((locale) => {
      const stats = computeStats(
        cards,
        today,
        /* strugglingLimit */ 10,
        masteryRepetitions,
        forceAllMastered,
        locale,
      );
      const totalCards = stats.totalCards;
      const masteryPct =
        totalCards > 0
          ? Math.round((stats.mastered / totalCards) * 100)
          : 0;
      const lastReview = lastReviewForLocale(cards, locale);
      return { locale, totalCards, masteryPct, lastReview };
    });
  }, [cards, today, masteryRepetitions, forceAllMastered, learningLocales]);

  return (
    <section aria-labelledby="stats-lang-breakdown-heading">
      <h2
        id="stats-lang-breakdown-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        {t("heading")}
      </h2>
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <ul
          role="list"
          aria-label={t("listAriaLabel")}
          className="text-sm"
        >
          {localeData.map(({ locale, totalCards, masteryPct, lastReview }, idx) => (
            <li
              key={locale}
              className={
                idx < localeData.length - 1
                  ? "border-b border-zinc-100 dark:border-zinc-800/60"
                  : ""
              }
            >
              <LanguageRow
                locale={locale}
                totalCards={totalCards}
                masteryPct={masteryPct}
                lastReview={lastReview}
                dateFormat={dateFormat}
                timezone={timezone}
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
