"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useLatestRef } from "@/lib/hooks/useLatestRef";

type Props = {
  badgeName: string;
  badgeDescription: string;
  onDismiss: () => void;
};

const DISMISS_AFTER_MS = 4500;

/**
 * Self-dismissing reveal toast for newly earned gym badges (#420). Pinned
 * bottom-centre, above all other UI. The reveal moment is the whole point
 * of the secret-until-earned design - keep the visual restrained but
 * unmistakable.
 *
 * Auto-dismisses after 4.5s; user can tap/click to dismiss earlier.
 * `role="status"` so screen readers announce the badge name politely.
 *
 * `onDismiss` is read through a ref so a fresh function identity from the
 * parent re-render (very common - every grade re-renders ReviewSession)
 * does not restart the dismiss timer.
 */
export function BadgeToast({ badgeName, badgeDescription, onDismiss }: Props) {
  const t = useTranslations("badges");
  const onDismissRef = useLatestRef(onDismiss);

  useEffect(() => {
    const t = setTimeout(() => onDismissRef.current(), DISMISS_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom,0px),1rem)]"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("dismissToastAriaLabel", { name: badgeName })}
        className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-amber-300 bg-gradient-to-br from-amber-100 via-amber-50 to-rose-50 px-4 py-3 text-left shadow-lg ring-1 ring-amber-200/60 transition-transform hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-700 dark:from-amber-900/80 dark:via-amber-950/80 dark:to-rose-950/80 dark:ring-amber-800/60"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-300 text-lg font-bold text-amber-950 dark:bg-amber-400"
        >
          ★
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            Badge earned
          </span>
          <span className="text-sm font-semibold text-foreground">
            {badgeName}
          </span>
          <span className="text-xs text-zinc-600 dark:text-zinc-300">
            {badgeDescription}
          </span>
        </span>
      </button>
    </div>
  );
}
