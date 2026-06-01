"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { MIN_REVIEWS_FOR_OPTIMIZATION, OPTIMIZER_COOLDOWN_MS } from "@/lib/srs/optimizer";
import { cardPanelPadded, colStack, colStackLg, mutedText, mutedTextXs, sectionLabelSm } from "@/lib/utils/class-names";
import { formatDate, todayInTimezone } from "@/lib/utils/format-date";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type CooldownState = { optimizedAt: string; daysRemaining: number };

/**
 * Pure given a `nowMs` reference time — the caller captures `Date.now()` once
 * (in a lazy `useState` initialiser) so the render body itself stays
 * deterministic.
 */
function computeCooldown(
  optimizedAt: string | undefined,
  nowMs: number,
): CooldownState | null {
  if (optimizedAt === undefined) return null;
  const sinceMs = nowMs - new Date(optimizedAt).getTime();
  if (sinceMs >= OPTIMIZER_COOLDOWN_MS) return null;
  return {
    optimizedAt,
    daysRemaining: Math.ceil((OPTIMIZER_COOLDOWN_MS - sinceMs) / MS_PER_DAY),
  };
}

type OptimizerState = "idle" | "running" | "error";

type Props = {
  /** ISO timestamp of the last successful weight optimization, if any. */
  fsrsWeightsOptimizedAt: string | undefined;
  /** Number of grade-log entries that are eligible for optimization. */
  optimizableReviewCount: number;
  /** True when the user is signed in. */
  isSignedIn: boolean;
  /** True when any superuser flag is on — disabled while superuser is active. */
  superuserPaused: boolean;
  /** Called after a successful optimization with the updated optimizedAt timestamp. */
  onOptimized: (optimizedAt: string, weights: number[]) => void;
};

export function FsrsOptimizerSection({
  fsrsWeightsOptimizedAt,
  optimizableReviewCount,
  isSignedIn,
  superuserPaused,
  onOptimized,
}: Props) {
  const t = useTranslations("settings");
  const [optimizerState, setOptimizerState] = useState<OptimizerState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Capture the current time once at mount. The lazy initialiser runs outside
  // the render pass, so the render body stays pure — the cooldown is a
  // coarse day-granularity countdown, so a snapshot at mount is accurate
  // enough without a ticking timer.
  const [nowMs] = useState(() => Date.now());
  // The "last optimized" label is a user-facing day boundary, so render the
  // optimization timestamp's calendar date in the user's configured timezone
  // (AGENTS.md: user-facing dates are tz-aware via user_settings.timezone),
  // not UTC. Captured once at mount to keep the render body pure.
  const [tz] = useState(() => loadSettings().timezone ?? "UTC");
  const cooldown = useMemo(
    () => computeCooldown(fsrsWeightsOptimizedAt, nowMs),
    [fsrsWeightsOptimizedAt, nowMs],
  );

  async function handleOptimize() {
    setOptimizerState("running");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/srs/optimize", { method: "POST" });
      if (!res.ok) {
        setOptimizerState("error");
        const body = (await res.json().catch(() => null)) as
          | { error?: string; reviewCount?: number; retryAfterMs?: number; detail?: string }
          | null;
        const errorCode = body?.error;

        if (res.status === 422 && errorCode === "not_enough_reviews") {
          // The local count (subjectKey-tagged grade-log entries) can outrun the
          // cloud count (rows that have synced). Surface the server's count.
          const synced = body?.reviewCount;
          setErrorMsg(
            typeof synced === "number"
              ? `Only ${synced} reviews synced. Sync first, then try again.`
              : "Sync your reviews first, then try again.",
          );
        } else if (res.status === 422 && errorCode === "degenerate_data") {
          // The native binding rejected the data distribution — reviews exist
          // but aren't spread enough for the optimiser yet.
          const count = body?.reviewCount;
          setErrorMsg(
            typeof count === "number"
              ? `Not enough variety in your ${count} reviews yet. Keep studying and try again in a few weeks.`
              : "Not enough review variety yet. Keep studying and try again in a few weeks.",
          );
        } else if (res.status === 429) {
          const days =
            typeof body?.retryAfterMs === "number"
              ? Math.max(1, Math.ceil(body.retryAfterMs / MS_PER_DAY))
              : 7;
          setErrorMsg(t("optimizerRetryAfter", { count: days }));
        } else if (errorCode === "reviews_unavailable") {
          setErrorMsg("Couldn't load your reviews. Check your connection and try again.");
        } else if (errorCode === "service_unavailable") {
          setErrorMsg("Couldn't load your settings. Check your connection and try again.");
        } else if (errorCode === "save_failed") {
          setErrorMsg("Optimisation succeeded but couldn't be saved. Try again.");
        } else if (errorCode === "unknown") {
          // The server returned a structured unknown error — surface the status
          // code so the next opaque failure can be diagnosed from a screenshot.
          setErrorMsg(
            `Couldn't optimise (HTTP ${res.status}). Please file an issue.`,
          );
        } else {
          // Unexpected error code or missing body — include status for diagnosability.
          setErrorMsg(
            `Couldn't optimise (HTTP ${res.status}). Try again later.`,
          );
        }
        return;
      }
      const data = (await res.json()) as {
        weights: number[];
        optimizedAt: string;
        reviewCount: number;
      };
      // Merge new weights into local settings so scheduler picks them up
      // immediately without requiring a page reload.
      const current = loadSettings();
      saveSettings({
        ...current,
        fsrsWeights: data.weights,
        fsrsWeightsOptimizedAt: data.optimizedAt,
      });
      setOptimizerState("idle");
      onOptimized(data.optimizedAt, data.weights);
    } catch {
      setOptimizerState("error");
      // Network-level failure (fetch threw — no HTTP response available).
      setErrorMsg("Couldn't reach the server. Check your connection and try again.");
    }
  }

  return (
    <section className={colStackLg} aria-labelledby="optimizer-heading">
      <h2
        id="optimizer-heading"
        className={sectionLabelSm}
      >
        Personalize my schedule
      </h2>
      <div className={cardPanelPadded}>
        {!isSignedIn ? (
          /* Guest state */
          <p
            data-testid="fsrs-optimize-help"
            className={mutedText}
          >
            Sign in to enable personalized scheduling.
          </p>
        ) : superuserPaused ? (
          /* Superuser flag(s) on — paused style */
          <div className={colStack}>
            <p className="text-sm text-foreground">
              Tune scheduling to your memory using your full review history.
            </p>
            <button
              type="button"
              disabled
              data-testid="fsrs-optimize-button"
              title="Optimization is paused while a superuser flag is on."
              className="mt-2 inline-flex items-center gap-2 min-h-[44px] rounded-lg bg-zinc-200 text-zinc-500 px-6 py-2 text-sm font-semibold dark:bg-zinc-800 dark:text-zinc-400"
            >
              Sync paused (superuser)
            </button>
          </div>
        ) : optimizableReviewCount < MIN_REVIEWS_FOR_OPTIMIZATION ? (
          /* Not enough reviews yet */
          <div className={colStack}>
            <p className="text-sm text-foreground">
              We need enough review history to tune the weights meaningfully.
            </p>
            <button
              type="button"
              disabled
              data-testid="fsrs-optimize-button"
              className="mt-2 inline-flex items-center gap-2 min-h-[44px] rounded-lg bg-zinc-200 text-zinc-500 px-6 py-2 text-sm font-semibold dark:bg-zinc-800 dark:text-zinc-400"
            >
              Optimise now
            </button>
            <p
              data-testid="fsrs-optimize-help"
              className={mutedTextXs}
            >
              Available after ~200 reviews. You have {optimizableReviewCount}.
            </p>
          </div>
        ) : cooldown !== null ? (
          /* Cooldown active — show when next optimization is available */
          <div className={colStack}>
            <p className="text-sm text-foreground">
              Tune scheduling to your memory using your full review history.
            </p>
            <button
              type="button"
              disabled
              data-testid="fsrs-optimize-button"
              className="mt-2 inline-flex items-center gap-2 min-h-[44px] rounded-lg bg-zinc-200 text-zinc-500 px-6 py-2 text-sm font-semibold dark:bg-zinc-800 dark:text-zinc-400"
            >
              {t("optimizerCooldown", { count: cooldown.daysRemaining })}
            </button>
            <p
              data-testid="fsrs-optimize-last-run"
              className={mutedTextXs}
            >
              Last optimized:{" "}
              {formatDate(
                todayInTimezone(tz, new Date(cooldown.optimizedAt)),
                "dmy-year",
                "UTC",
              )}
            </p>
          </div>
        ) : (
          /* Ready to optimize */
          <div className={colStack}>
            <p className="text-sm text-foreground">
              Tune scheduling to your memory using your full review history.
            </p>
            <div className="flex flex-col gap-1" aria-live="polite">
              <button
                type="button"
                onClick={() => void handleOptimize()}
                disabled={optimizerState === "running"}
                data-testid="fsrs-optimize-button"
                aria-busy={optimizerState === "running"}
                className={`mt-2 inline-flex items-center gap-2 min-h-[44px] rounded-lg px-6 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none ${
                  optimizerState === "error"
                    ? "bg-red-500 text-white hover:opacity-80 focus-visible:ring-red-500"
                    : optimizerState === "running"
                      ? "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 cursor-wait focus-visible:ring-zinc-400"
                      : "bg-foreground text-background hover:opacity-80 focus-visible:ring-foreground"
                }`}
              >
                {optimizerState === "running" && (
                  <div
                    className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                    aria-hidden="true"
                  />
                )}
                {optimizerState === "running"
                  ? "Optimising… this may take a moment."
                  : "Optimise now"}
              </button>
              {optimizerState === "error" && errorMsg !== null && (
                <p
                  role="alert"
                  data-testid="fsrs-optimize-help"
                  className="text-xs text-red-500 dark:text-red-400"
                >
                  {errorMsg}
                </p>
              )}
              {fsrsWeightsOptimizedAt !== undefined && (
                <p
                  data-testid="fsrs-optimize-last-run"
                  className={mutedTextXs}
                >
                  Last optimized:{" "}
                  {formatDate(
                    todayInTimezone(tz, new Date(fsrsWeightsOptimizedAt)),
                    "dmy-year",
                    "UTC",
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
