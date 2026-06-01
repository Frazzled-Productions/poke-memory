"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

export type ProtectionToastKind = "earned" | "spent" | "earned-and-spent";

type Props = {
  kind: ProtectionToastKind;
  /** Current streak length — used in the spend/earned-and-spent message. */
  streakCount: number;
  onDismiss: () => void;
};

const DISMISS_AFTER_MS = 5000;

/**
 * Self-dismissing toast for streak-protection token events (#1438).
 *
 * Rendered when a token is earned, spent, or both in the same step.
 * Fires from `StreakBadge` which already runs `runStreakProtection` on mount
 * and on every STREAK_UPDATED_EVENT / SETTINGS_SAVED_EVENT.
 *
 * Uses `role="status"` / aria-live="polite" so screen readers announce
 * the message without interrupting current speech.
 *
 * `onDismiss` is read through a ref so that a fresh function identity from
 * the parent re-render does not restart the auto-dismiss timer.
 */
export function ProtectionToast({ kind, streakCount, onDismiss }: Props) {
  const t = useTranslations("review");

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  let heading: string;
  let message: string;
  if (kind === "earned") {
    heading = t("tokenEarnedHeading");
    message = t("tokenEarned");
  } else if (kind === "earned-and-spent") {
    heading = t("tokenEarnedHeading");
    message = t("tokenEarnedAndSpent", { count: streakCount });
  } else {
    heading = t("tokenSpentHeading");
    message = t("tokenSpent", { count: streakCount });
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom,0px),1rem)]"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("tokenToastDismiss")}
        className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-sky-300 bg-gradient-to-br from-sky-100 via-sky-50 to-indigo-50 px-4 py-3 text-left shadow-lg ring-1 ring-sky-200/60 transition-transform hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-sky-700 dark:from-sky-900/80 dark:via-sky-950/80 dark:to-indigo-950/80 dark:ring-sky-800/60"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-200 text-lg dark:bg-sky-700"
        >
          🛡
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
            {heading}
          </span>
          <span className="text-sm text-zinc-700 dark:text-zinc-200">
            {message}
          </span>
        </span>
      </button>
    </div>
  );
}
