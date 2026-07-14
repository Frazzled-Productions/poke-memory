"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toRoman, type Milestone } from "@/lib/journey/milestones";
import { generateMilestoneShareImage } from "@/lib/share/generateShareImage";

// ---------------------------------------------------------------------------
// Milestone string rendering
// ---------------------------------------------------------------------------

type MilestoneStrings = {
  /** Achievement-framed banner label, e.g. "Milestone reached: 100 Pokémon mastered!". */
  label: string;
  /** Localised share text for the text-share / clipboard paths. */
  shareText: string;
  /** Large text inside the share-image hero disc. */
  heroNumber: string;
  /** Short localised label beneath the hero number on the share image. */
  heroLabel: string;
};

/** The subset of the `useTranslations("journey.milestoneShare")` t function we need. */
type Translator = (
  key:
    | "bannerAllMastered"
    | "bannerGenComplete"
    | "bannerMasteryCount"
    | "shareAllMastered"
    | "shareGenComplete"
    | "shareMasteryCount"
    | "cardAllMasteredLabel"
    | "cardGenCompleteLabel"
    | "cardMasteredLabel",
  values?: Record<string, string | number>,
) => string;

/**
 * Render the user-facing strings for a structured milestone through the
 * message catalogue. `detectTopMilestone` returns data only (kind + threshold
 * or gen number); all copy lives in `journey.milestoneShare.*` so every
 * locale gets a translated banner and share text, and the mastery-count
 * branch is framed as a crossed achievement rather than a live count (#1933).
 */
function renderMilestoneStrings(
  milestone: Milestone,
  t: Translator,
): MilestoneStrings {
  switch (milestone.kind) {
    case "all-mastered":
      return {
        label: t("bannerAllMastered"),
        shareText: t("shareAllMastered"),
        heroNumber: "★",
        heroLabel: t("cardAllMasteredLabel"),
      };
    case "gen-complete": {
      // Pass both forms so each locale can pick: en uses the roman numeral
      // ("Generation I"), ja / zh use the decimal number ("第1世代").
      const args = { gen: milestone.gen, roman: toRoman(milestone.gen) };
      return {
        label: t("bannerGenComplete", args),
        shareText: t("shareGenComplete", args),
        heroNumber: "★",
        heroLabel: t("cardGenCompleteLabel", args),
      };
    }
    case "mastery-count":
      return {
        label: t("bannerMasteryCount", { threshold: milestone.threshold }),
        shareText: t("shareMasteryCount", { threshold: milestone.threshold }),
        heroNumber: String(milestone.threshold),
        heroLabel: t("cardMasteredLabel"),
      };
  }
}

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
 * Priority order:
 *   1. Web Share API file share (PNG image card) - when navigator.canShare({ files }) is truthy.
 *   2. Web Share API text share - when navigator.share is available but file-share is not.
 *   3. PNG download - when the image rendered but the Share API is unavailable.
 *   4. Clipboard text copy - last resort.
 */
export function MilestoneShareButton({ milestone }: Props) {
  const t = useTranslations("journey.milestoneShare");
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending timeout on unmount to avoid state updates after unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Nothing to show - either no milestone reached, or suppressed by
  // the superuser guard.
  if (milestone === null) return null;

  const { label, shareText, heroNumber, heroLabel } = renderMilestoneStrings(
    milestone,
    t,
  );

  function scheduleReset(nextStatus: "copied" | "error") {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setStatus(nextStatus);
    timeoutRef.current = setTimeout(() => setStatus("idle"), 2000);
  }

  async function handleShare() {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setStatus("idle");

    // Try to render the image card first.
    const blob = await generateMilestoneShareImage({ heroNumber, heroLabel }).catch(() => null);
    const file =
      blob !== null
        ? new File([blob], "poke-memory.png", { type: "image/png" })
        : null;

    const nav = typeof navigator !== "undefined" ? navigator : null;

    // --- Path 1: Web Share API with PNG file ---
    // Tracks whether the file-share capability was present. When true, we
    // attempted a share sheet - any error (including user dismissal) must
    // not open a second sheet via Path 2.
    let triedFileShare = false;
    if (file !== null && nav !== null) {
      const navExt = nav as Navigator & {
        canShare?: (data: unknown) => boolean;
        share?: (data: { files: File[] }) => Promise<void>;
      };
      if (
        typeof navExt.canShare === "function" &&
        navExt.canShare({ files: [file] }) &&
        typeof navExt.share === "function"
      ) {
        triedFileShare = true;
        try {
          await navExt.share({ files: [file] });
          return;
        } catch (err) {
          // User dismissed the sheet - stop here; do not open another sheet.
          if (err instanceof Error && err.name === "AbortError") return;
          // Any other error (e.g. OS-level failure): fall through to
          // download/clipboard, but do NOT open a second share sheet.
        }
      }
    }

    // --- Path 2: Web Share API text only ---
    // Only reached when the file-share capability was absent (canShare returned
    // false or canShare/share were not available) - i.e. a genuine capability
    // miss. If Path 1 was attempted (triedFileShare) we skip here to avoid
    // opening a second share sheet.
    if (!triedFileShare && nav !== null) {
      const navExt = nav as Navigator & {
        share?: (data: { text: string }) => Promise<void>;
      };
      if (typeof navExt.share === "function") {
        try {
          await navExt.share({ text: shareText });
          return;
        } catch {
          // Share sheet dismissed or unavailable - fall through.
        }
      }
    }

    // --- Path 3: PNG download ---
    if (file !== null && blob !== null && typeof document !== "undefined") {
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "poke-memory.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        return;
      } catch {
        // Fall through to clipboard.
      }
    }

    // --- Path 4: Clipboard text copy ---
    if (nav === null || !navigator.clipboard) {
      scheduleReset("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(shareText);
      scheduleReset("copied");
    } catch {
      scheduleReset("error");
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
        aria-label={t("shareAriaLabel", { label })}
        onClick={handleShare}
        className="rounded-lg bg-emerald-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {t("share")}
      </button>
      {status === "copied" ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
          {t("copied")}
        </p>
      ) : null}
      {status === "error" ? (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="status">
          {t("copyError")}
        </p>
      ) : null}
    </div>
  );
}
