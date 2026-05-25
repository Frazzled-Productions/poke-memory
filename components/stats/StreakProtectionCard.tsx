"use client";

import { useEffect, useState } from "react";
import {
  loadSettings,
  SETTINGS_SAVED_EVENT,
} from "@/lib/settings/persistence";
import {
  EARN_INTERVAL_DAYS,
  MAX_BALANCE,
  type StreakProtection,
} from "@/lib/streak";
import { cn } from "@/lib/utils/cn";
import { cardPanel, mutedText } from "@/lib/utils/class-names";
import { formatDate, type DateFormat } from "@/lib/utils/format-date";

type Props = {
  /** Date format used to render the most recent spend entry. */
  dateFormat: DateFormat;
  /** IANA timezone for rendering the spend-date label. */
  timezone: string;
};

/**
 * Streak-protection summary for the Stats page (#1227).
 *
 * Surfaces the current token balance, a short explanation of how tokens are
 * earned and spent, and a one-line history entry for the most recent spend.
 * Reads `streakProtection` from `user_settings` and listens for settings-saved
 * events so the panel refreshes when a token is earned, spent, or pulled from
 * the cloud.
 */
export function StreakProtectionCard({ dateFormat, timezone }: Props) {
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

  return (
    <section
      aria-labelledby="streak-protection-heading"
      data-testid="streak-protection-card"
    >
      <h2
        id="streak-protection-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Streak protection
      </h2>
      <div className={cn("flex flex-col gap-2", cardPanel)}>
        <div className="flex items-baseline gap-2">
          <span
            className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400"
            aria-label={
              balance === 1 ? "1 protection token" : `${balance} protection tokens`
            }
          >
            {balance}
          </span>
          <span className={mutedText}>
            {balance === 1 ? "token" : "tokens"}
            {balance >= MAX_BALANCE ? " (max)" : ""}
          </span>
        </div>
        <p className={cn("text-xs", mutedText)}>
          Tokens cover one missed day, automatically. Earn one for every{" "}
          {EARN_INTERVAL_DAYS} consecutive review days, up to {MAX_BALANCE}.
        </p>
        {balance < MAX_BALANCE && (
          <p className={cn("text-xs", mutedText)}>
            {daysUntilNext === EARN_INTERVAL_DAYS
              ? `Review today to start earning your next token.`
              : `Next token in ${daysUntilNext} review day${daysUntilNext === 1 ? "" : "s"}.`}
          </p>
        )}
        {lastSpend !== null && (
          <p
            className={cn("text-xs", mutedText)}
            data-testid="streak-protection-last-spend"
          >
            Streak preserved on {formatDate(lastSpend, dateFormat, timezone)}.{" "}
            {balance === 1 ? "1 token remaining" : `${balance} tokens remaining`}.
          </p>
        )}
      </div>
    </section>
  );
}
