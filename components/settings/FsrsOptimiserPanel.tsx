"use client";

/**
 * The FSRS optimiser page (D7 of openspec/changes/move-to-cloudflare): fits
 * per-user weights in this browser with the wasm binding in a Web Worker, then
 * saves them through the settings push. Signed-in only; paused while any
 * superuser flag is on (sync write-guard, docs/superuser.md); needs a
 * cross-origin-isolated page (next.config.ts headers for /settings/optimiser).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { pullGradeLog } from "@/lib/sync/gradeLog";
import { pullSettings, pushSettings } from "@/lib/sync/settings";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";
import {
  countOptimizableReviews,
  gradeLogToOptimizerItems,
  MIN_REVIEWS_FOR_OPTIMIZATION,
  optimizerCooldownRemainingMs,
} from "@/lib/srs/optimizer";
import {
  isOptimiserSupported,
  OptimiserError,
  runOptimiserInWorker,
} from "@/lib/srs/optimiser/runInWorker";
import { cardPanelPadded, colStack, colStackLg, mutedText, mutedTextXs, pageTitle } from "@/lib/utils/class-names";
import { formatDate, todayInTimezone } from "@/lib/utils/format-date";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Loaded = {
  entries: GradeLogEntry[];
  count: number;
  /** The latest "last optimised" across this device and the cloud. */
  optimizedAt: string | undefined;
  cooldownMs: number;
};

type Run =
  | { kind: "idle" }
  | { kind: "fitting"; percent: number | null }
  | { kind: "saving" }
  | { kind: "success" }
  | { kind: "error"; reason: "not_enough_data" | "failed" | "save"; detail?: string };

const buttonClass =
  "inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg bg-foreground px-6 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2";

// Cross-origin isolation is fixed for the life of the document.
const subscribeNever = () => () => {};

function latest(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function FsrsOptimiserPanel() {
  const t = useTranslations("settings");
  const { user, loading: authLoading, supabase } = useAuth();
  const { anyFlagOn } = useSuperuser();
  // Feature detection reads browser globals: null on the server render.
  const supported = useSyncExternalStore(subscribeNever, isOptimiserSupported, () => null);
  const [tz] = useState(() => loadSettings().timezone ?? "UTC");
  const [loaded, setLoaded] = useState<Loaded | "error" | null>(null);
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  // The guard is re-checked after the fit, in case a flag went on meanwhile.
  const pausedRef = useRef(anyFlagOn);
  useEffect(() => {
    pausedRef.current = anyFlagOn;
  }, [anyFlagOn]);

  const userId = user?.id ?? null;
  const canLoad = userId !== null && supabase !== null && !anyFlagOn && supported === true;

  useEffect(() => {
    if (!canLoad || userId === null || supabase === null) return;
    let cancelled = false;
    void Promise.all([pullGradeLog(supabase, userId), pullSettings(supabase, userId)]).then(
      ([entries, cloud]) => {
        if (cancelled) return;
        if (entries === null) {
          setLoaded("error");
          return;
        }
        const optimizedAt = latest(loadSettings().fsrsWeightsOptimizedAt, cloud?.fsrsWeightsOptimizedAt);
        setLoaded({
          entries,
          count: countOptimizableReviews(entries),
          optimizedAt,
          cooldownMs: optimizerCooldownRemainingMs([optimizedAt], Date.now()),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canLoad, userId, supabase, reloadKey]);

  async function handleOptimise(data: Loaded) {
    if (userId === null || supabase === null) return;
    setRun({ kind: "fitting", percent: null });
    let weights: number[];
    try {
      weights = await runOptimiserInWorker(gradeLogToOptimizerItems(data.entries), {
        onProgress: (current, total) =>
          setRun({ kind: "fitting", percent: total > 0 ? Math.floor((current / total) * 100) : null }),
      });
    } catch (err) {
      const reason = err instanceof OptimiserError ? err.reason : "failed";
      const detail = err instanceof Error ? err.message : undefined;
      console.error("[optimiser] fit failed", detail);
      setRun({ kind: "error", reason, detail });
      return;
    }
    // Superuser write-guard: no cloud write while any flag is on.
    if (pausedRef.current) {
      setRun({ kind: "idle" });
      return;
    }
    setRun({ kind: "saving" });
    const patch = { fsrsWeights: weights, fsrsWeightsOptimizedAt: new Date().toISOString() };
    if (!(await pushSettings(supabase, userId, patch))) {
      setRun({ kind: "error", reason: "save" });
      return;
    }
    // Local copy so the scheduler picks the weights up straight away.
    saveSettings({ ...loadSettings(), ...patch });
    setRun({ kind: "success" });
  }

  function lastOptimisedLine(iso: string) {
    return (
      <p data-testid="fsrs-optimiser-last-run" className={mutedTextXs}>
        {t("optimiser.lastOptimised", {
          date: formatDate(todayInTimezone(tz, new Date(iso)), "dmy-year", "UTC"),
        })}
      </p>
    );
  }

  function body() {
    if (authLoading || supported === null) {
      return <p className={mutedText}>{t("optimiser.page.loading")}</p>;
    }
    if (user === null || supabase === null) {
      return <p className={mutedText} data-testid="fsrs-optimiser-signed-out">{t("optimiser.page.signedOut")}</p>;
    }
    if (anyFlagOn) {
      return <p className={mutedText} data-testid="fsrs-optimiser-paused">{t("optimiser.page.paused")}</p>;
    }
    if (!supported) {
      return <p className={mutedText} data-testid="fsrs-optimiser-unsupported">{t("optimiser.page.unsupported")}</p>;
    }
    if (loaded === null) {
      return <p className={mutedText}>{t("optimiser.page.loading")}</p>;
    }
    if (loaded === "error") {
      return (
        <div className={colStack}>
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("optimiser.page.errorLoad")}</p>
          <button type="button" className={buttonClass} onClick={() => {
              setLoaded(null);
              setReloadKey((k) => k + 1);
            }}>
            {t("optimiser.page.tryAgain")}
          </button>
        </div>
      );
    }
    if (run.kind === "fitting" || run.kind === "saving") {
      return (
        <div className={colStack} aria-live="polite" aria-busy="true" data-testid="fsrs-optimiser-running">
          <p className="flex items-center gap-2 text-sm text-foreground">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            {run.kind === "saving" ? t("optimiser.page.saving") : t("optimiser.page.fitting")}
          </p>
          {run.kind === "fitting" && run.percent !== null && (
            <>
              <progress className="w-full" max={100} value={run.percent} />
              <p className={mutedTextXs}>{t("optimiser.page.progress", { percent: run.percent })}</p>
            </>
          )}
        </div>
      );
    }
    if (run.kind === "success") {
      return (
        <p role="status" className="text-sm text-foreground" data-testid="fsrs-optimiser-success">
          {t("optimiser.page.success")}
        </p>
      );
    }
    if (loaded.count < MIN_REVIEWS_FOR_OPTIMIZATION) {
      return (
        <p className={mutedText} data-testid="fsrs-optimiser-not-enough">
          {t("optimiser.page.notEnough", { count: loaded.count, min: MIN_REVIEWS_FOR_OPTIMIZATION })}
        </p>
      );
    }
    if (loaded.cooldownMs > 0 && loaded.optimizedAt !== undefined) {
      return (
        <div className={colStack} data-testid="fsrs-optimiser-cooldown">
          <p className="text-sm text-foreground">
            {t("optimizerCooldown", { count: Math.ceil(loaded.cooldownMs / MS_PER_DAY) })}
          </p>
          {lastOptimisedLine(loaded.optimizedAt)}
        </div>
      );
    }
    return (
      <div className={colStack}>
        <p className="text-sm text-foreground">{t("optimiser.page.ready", { count: loaded.count })}</p>
        {run.kind === "error" && (
          <div role="alert" className="flex flex-col gap-1" data-testid="fsrs-optimiser-error">
            <p className="text-sm text-red-600 dark:text-red-400">
              {run.reason === "not_enough_data"
                ? t("optimiser.page.errorNotEnoughData")
                : run.reason === "save"
                  ? t("optimiser.page.errorSave")
                  : t("optimiser.page.errorFailed")}
            </p>
            {run.reason === "failed" && run.detail && (
              <p className={mutedTextXs}>{t("optimiser.page.errorDetail", { detail: run.detail })}</p>
            )}
          </div>
        )}
        <button
          type="button"
          className={buttonClass}
          data-testid="fsrs-optimiser-run"
          onClick={() => void handleOptimise(loaded)}
        >
          {run.kind === "error" ? t("optimiser.page.tryAgain") : t("optimiser.optimiseNow")}
        </button>
        {loaded.optimizedAt !== undefined && lastOptimisedLine(loaded.optimizedAt)}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className={`w-full max-w-3xl ${colStackLg}`}>
        {/* A full document load: the settings page is not cross-origin isolated. */}
        <a href="/settings" className={`${mutedText} underline underline-offset-2 hover:opacity-70`}>
          {t("optimiser.page.backToSettings")}
        </a>
        <h1 className={pageTitle}>{t("optimiser.heading")}</h1>
        <p className={mutedText}>{t("optimiser.page.description")}</p>
        <div className={cardPanelPadded}>{body()}</div>
      </div>
    </div>
  );
}
