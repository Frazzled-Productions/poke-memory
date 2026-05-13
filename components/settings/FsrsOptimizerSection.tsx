"use client";

import { useState } from "react";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { MIN_REVIEWS_FOR_OPTIMIZATION } from "@/lib/srs/optimizer";

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysUntilOptimizeAvailable(optimizedAt: string): number | null {
  const sinceMs = Date.now() - new Date(optimizedAt).getTime();
  if (sinceMs >= COOLDOWN_MS) return null;
  return Math.ceil((COOLDOWN_MS - sinceMs) / MS_PER_DAY);
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
  const [optimizerState, setOptimizerState] = useState<OptimizerState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleOptimize() {
    setOptimizerState("running");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/srs/optimize", { method: "POST" });
      if (!res.ok) {
        setOptimizerState("error");
        // The local count (cardId-tagged grade-log entries) can outrun the
        // cloud count (rows that have synced). When the server gates us out,
        // surface its count instead of the generic try-again message.
        if (res.status === 422) {
          const body = (await res.json().catch(() => null)) as
            | { reviewCount?: number }
            | null;
          const synced = body?.reviewCount;
          setErrorMsg(
            typeof synced === "number"
              ? `Only ${synced} reviews synced. Sync first, then try again.`
              : "Sync your reviews first, then try again.",
          );
        } else if (res.status === 429) {
          const body = (await res.json().catch(() => null)) as
            | { retryAfterMs?: number }
            | null;
          const days = body?.retryAfterMs
            ? Math.ceil(body.retryAfterMs / MS_PER_DAY)
            : 7;
          setErrorMsg(`Try again in ${days} day${days === 1 ? "" : "s"}.`);
        } else {
          setErrorMsg("Couldn't optimize — try again later.");
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
      setErrorMsg("Couldn't optimize — try again later.");
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="optimizer-heading">
      <h2
        id="optimizer-heading"
        className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        Personalize my schedule
      </h2>
      <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        {!isSignedIn ? (
          /* Guest state */
          <p
            data-testid="fsrs-optimize-help"
            className="text-sm text-zinc-500 dark:text-zinc-400"
          >
            Sign in to enable personalized scheduling.
          </p>
        ) : superuserPaused ? (
          /* Superuser flag(s) on — paused style */
          <div className="flex flex-col gap-2">
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
        ) : fsrsWeightsOptimizedAt !== undefined &&
          daysUntilOptimizeAvailable(fsrsWeightsOptimizedAt) !== null ? (
          /* Cooldown active — show when next optimization is available */
          <div className="flex flex-col gap-2">
            <p className="text-sm text-foreground">
              Tune scheduling to your memory using your full review history.
            </p>
            <button
              type="button"
              disabled
              data-testid="fsrs-optimize-button"
              className="mt-2 inline-flex items-center gap-2 min-h-[44px] rounded-lg bg-zinc-200 text-zinc-500 px-6 py-2 text-sm font-semibold dark:bg-zinc-800 dark:text-zinc-400"
            >
              Next optimization in {daysUntilOptimizeAvailable(fsrsWeightsOptimizedAt)} days
            </button>
            <p
              data-testid="fsrs-optimize-last-run"
              className="text-xs text-zinc-500 dark:text-zinc-400"
            >
              Last optimized:{" "}
              {new Date(fsrsWeightsOptimizedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        ) : optimizableReviewCount < MIN_REVIEWS_FOR_OPTIMIZATION ? (
          /* Not enough reviews yet */
          <div className="flex flex-col gap-2">
            <p className="text-sm text-foreground">
              We need enough review history to tune the weights meaningfully.
            </p>
            <button
              type="button"
              disabled
              data-testid="fsrs-optimize-button"
              className="mt-2 inline-flex items-center gap-2 min-h-[44px] rounded-lg bg-zinc-200 text-zinc-500 px-6 py-2 text-sm font-semibold dark:bg-zinc-800 dark:text-zinc-400"
            >
              Optimize now
            </button>
            <p
              data-testid="fsrs-optimize-help"
              className="text-xs text-zinc-500 dark:text-zinc-400"
            >
              Available after ~200 reviews. You have {optimizableReviewCount}.
            </p>
          </div>
        ) : (
          /* Ready to optimize */
          <div className="flex flex-col gap-2">
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
                  ? "Optimizing… this may take a moment."
                  : "Optimize now"}
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
                  className="text-xs text-zinc-500 dark:text-zinc-400"
                >
                  Last optimized:{" "}
                  {new Date(fsrsWeightsOptimizedAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
