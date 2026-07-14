"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  loadSettings,
  saveSettings,
  SETTINGS_SAVED_EVENT,
} from "@/lib/settings/persistence";
import {
  EARN_INTERVAL_DAYS,
  MAX_BALANCE,
  type StreakProtection,
} from "@/lib/streak";
import { cn } from "@/lib/utils/cn";
import { cardPanel, colStack, mutedText, sectionHeadingSm } from "@/lib/utils/class-names";
import { formatDate, type DateFormat } from "@/lib/utils/format-date";

type Props = {
  /** Date format used to render the most recent spend entry. */
  dateFormat: DateFormat;
  /** IANA timezone for rendering the spend-date label. */
  timezone: string;
};

// eventLabel is resolved via useTranslations inside StreakProtectionCard.

/**
 * Streak-protection summary for the Stats page (#1227, #1233).
 *
 * Surfaces the current token balance, a short explanation of how tokens are
 * earned and spent, a capped recent-events list (last 3), and a one-time
 * banner the first time the user sees an earn-and-spend-same-day event.
 * Reads `streakProtection` from `user_settings` and listens for settings-saved
 * events so the panel refreshes when a token is earned, spent, or pulled from
 * the cloud.
 */
export function StreakProtectionCard({ dateFormat, timezone }: Props) {
  const t = useTranslations("stats.streakProtection");
  const [state, setState] = useState<StreakProtection | null>(null);

  useEffect(() => {
    function refresh() {
      // Defensive ?? null covers test mocks that omit the field; in
      // production `loadSettings` always returns a validated record.
      setState(loadSettings().streakProtection ?? null);
    }
    refresh();
    window.addEventListener(SETTINGS_SAVED_EVENT, refresh);
    return () => {
      window.removeEventListener(SETTINGS_SAVED_EVENT, refresh);
    };
  }, []);

  if (state === null) return null;

  const balance = state.balance;
  const lastSpend = state.spendDates.length > 0
    ? state.spendDates[state.spendDates.length - 1]
    : null;
  const daysUntilNext = Math.max(
    0,
    EARN_INTERVAL_DAYS - state.daysSinceLastEarn,
  );

  // Most recent earned-and-spent event (newest last in the array).
  const events = state.protectionEvents ?? [];
  const latestEarnAndSpent = [...events]
    .reverse()
    .find((e) => e.kind === "earned-and-spent");

  const showBanner =
    latestEarnAndSpent !== undefined &&
    state.lastAcknowledgedProtectionEventDate !== latestEarnAndSpent.date;

  function dismissBanner() {
    if (latestEarnAndSpent === undefined) return;
    const settings = loadSettings();
    saveSettings({
      ...settings,
      streakProtection: {
        ...settings.streakProtection,
        lastAcknowledgedProtectionEventDate: latestEarnAndSpent.date,
      },
    });
  }

  // Last 3 events, most recent first.
  const recentEvents = [...events].reverse().slice(0, 3);

  return (
    <section
      aria-labelledby="streak-protection-heading"
      data-testid="streak-protection-card"
    >
      <h2
        id="streak-protection-heading"
        className={`mb-3 ${sectionHeadingSm}`}
      >
        {t("heading")}
      </h2>
      <div className={cn(colStack, cardPanel)}>
        {showBanner && (
          <div
            role="status"
            data-testid="streak-protection-earn-spend-banner"
            className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            <span>
              {t("earnAndSpentBanner")}
            </span>
            <button
              type="button"
              onClick={dismissBanner}
              aria-label={t("dismissAriaLabel")}
              className="shrink-0 rounded text-amber-600 hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 dark:text-amber-400 dark:hover:text-amber-200"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex items-baseline gap-2">
          <span
            className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400"
            aria-label={t("tokensRemaining", { count: balance })}
          >
            {balance}
          </span>
          <span className={mutedText}>
            {t("tokenCount", { count: balance })}
            {balance >= MAX_BALANCE ? t("tokenMax") : ""}
          </span>
        </div>
        {/* Streak line removed: ProfileStatusBar carries streak on all routes
            (#1490 de-dup). The full token balance, earn rate, and event history
            below are kept - those are Stats-specific context. */}
        <p className={cn("text-xs", mutedText)}>
          {t("earnDescription", { earnInterval: EARN_INTERVAL_DAYS, maxBalance: MAX_BALANCE })}
        </p>
        {balance < MAX_BALANCE && (
          <p className={cn("text-xs", mutedText)}>
            {daysUntilNext === EARN_INTERVAL_DAYS
              ? t("nextTokenStart")
              : t("nextTokenCount", { count: daysUntilNext })}
          </p>
        )}
        {lastSpend !== null && (
          <p
            className={cn("text-xs", mutedText)}
            data-testid="streak-protection-last-spend"
          >
            {t("streakPreserved", { date: formatDate(lastSpend, dateFormat, timezone) })}{" "}
            {t("tokensRemaining", { count: balance })}.
          </p>
        )}
        {recentEvents.length > 0 && (
          <div
            className="mt-1"
            data-testid="streak-protection-recent-events"
          >
            <p className={cn("mb-1 text-xs font-medium", mutedText)}>
              {t("recentProtectionHeading")}
            </p>
            <ul className="flex flex-col gap-0.5">
              {recentEvents.map((event, index) => {
                const eventKindLabel =
                  event.kind === "earned" ? t("eventEarned")
                  : event.kind === "spent" ? t("eventUsed")
                  : t("eventEarnedAndUsed");
                return (
                  <li
                    key={`${event.date}-${index}`}
                    className={cn("text-xs", mutedText)}
                  >
                    {formatDate(event.date, dateFormat, timezone)} -{" "}
                    {eventKindLabel}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
