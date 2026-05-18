"use client";

import { useState } from "react";
import type { Milestone } from "@/lib/journey/milestones";

type Props = {
  /**
   * The top milestone to surface, or `null` to render nothing.
   *
   * Pass `null` when any superuser flag is active so fake mastery
   * cannot produce a real share card (#917).
   */
  milestone: Milestone | null;
};

/**
 * Milestone share banner. Appears on the Journey page when the user
 * crosses a round-number mastery threshold or completes a generation.
 *
 * Uses the Web Share API on devices that support it; falls back to
 * writing the share text to the clipboard with a transient confirmation.
 */
export function MilestoneShareButton({ milestone }: Props) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  // Nothing to show — either no milestone reached, or suppressed by
  // the superuser guard.
  if (milestone === null) return null;

  const { label, shareText } = milestone;

  async function handleShare() {
    setStatus("idle");
    const canShare =
      typeof navigator !== "undefined" &&
      typeof (navigator as Navigator & { share?: unknown }).share === "function";
    if (canShare) {
      try {
        await (
          navigator as Navigator & {
            share: (data: { text: string }) => Promise<void>;
          }
        ).share({ text: shareText });
        return;
      } catch {
        // Share sheet dismissed or unavailable — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  return (
    <div
      data-testid="milestone-share-banner"
      className="flex flex-col items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center dark:border-emerald-800 dark:bg-emerald-950/30"
    >
      <p className="text-base font-semibold text-emerald-800 dark:text-emerald-300">
        {label}
      </p>
      <button
        type="button"
        aria-label={`Share milestone: ${label}`}
        onClick={handleShare}
        className="rounded-lg bg-emerald-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        Share
      </button>
      {status === "copied" ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
          Copied to clipboard
        </p>
      ) : null}
      {status === "error" ? (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="status">
          Couldn&apos;t copy. Please try again.
        </p>
      ) : null}
    </div>
  );
}
