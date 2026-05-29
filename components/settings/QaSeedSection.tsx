"use client";

/**
 * QA Seed section for the Developer area of the Settings page (#1326).
 *
 * Renders only when the `qaSeedMode` superuser flag is on — the parent
 * Settings page gates this component behind `flags.qaSeedMode`.
 *
 * Cloud write-guard: this component only writes to localStorage/IDB. No
 * Supabase calls are made here. The existing superuser write-guard (anyFlagOn)
 * already suppresses all cloud writes while ANY flag is on, which includes
 * qaSeedMode — verified in the PR body under "Sync write-guard".
 */

import { useState } from "react";
import { cardPanelPadded, colStack, mutedText } from "@/lib/utils/class-names";
import { applyScenario, clearSeed } from "@/lib/qa-seed/apply";
import { SCENARIO_META, type ScenarioKey } from "@/lib/qa-seed/scenarios";

type SeedStatus = "idle" | "applying" | "applied" | "clearing" | "cleared" | "error";

export function QaSeedSection() {
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>(
    SCENARIO_META[0].key,
  );
  const [status, setStatus] = useState<SeedStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleApply() {
    setStatus("applying");
    setErrorMessage(null);
    try {
      await applyScenario(selectedScenario);
      setStatus("applied");
      // Brief confirmation period then revert so the button is re-actionable.
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      console.error("[qa-seed] applyScenario failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Unknown error applying seed.",
      );
      setStatus("error");
    }
  }

  async function handleClear() {
    setStatus("clearing");
    setErrorMessage(null);
    try {
      await clearSeed();
      setStatus("cleared");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      console.error("[qa-seed] clearSeed failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Unknown error clearing seed.",
      );
      setStatus("error");
    }
  }

  const selectedMeta =
    SCENARIO_META.find((m) => m.key === selectedScenario) ?? SCENARIO_META[0];

  const isApplying = status === "applying";
  const isClearing = status === "clearing";
  const isBusy = isApplying || isClearing;

  return (
    <div className="mt-4">
      <div className={cardPanelPadded}>
        <p className="text-sm font-semibold text-foreground">QA seed</p>
        <p className={`mt-1 text-xs ${mutedText}`}>
          Inject a curated scenario payload into local storage for manual preview
          QA. Reload the page after applying to see the seeded state. Sync to the
          cloud is paused while any superuser flag is on.
        </p>

        <div className={`mt-4 ${colStack}`}>
          {/* Scenario dropdown */}
          <label
            htmlFor="qa-seed-scenario"
            className="text-xs font-medium text-foreground"
          >
            Scenario
          </label>
          <select
            id="qa-seed-scenario"
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value as ScenarioKey)}
            disabled={isBusy}
            className="w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {SCENARIO_META.map((meta) => (
              <option key={meta.key} value={meta.key}>
                {meta.label}
              </option>
            ))}
          </select>

          {/* Scenario description */}
          <p className={`text-xs ${mutedText}`} aria-live="polite">
            {selectedMeta.description}
          </p>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => { void handleApply(); }}
              disabled={isBusy}
              aria-label={`Apply QA seed scenario: ${selectedMeta.label}`}
              className="min-h-[36px] rounded-md border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {isApplying
                ? "Applying..."
                : status === "applied"
                ? "Applied - reload to see"
                : "Apply seed"}
            </button>

            <button
              type="button"
              onClick={() => { void handleClear(); }}
              disabled={isBusy}
              aria-label="Clear QA seed and restore fresh-visitor state"
              className="min-h-[36px] rounded-md border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {isClearing
                ? "Clearing..."
                : status === "cleared"
                ? "Cleared"
                : "Clear seed"}
            </button>
          </div>

          {/* Status / error feedback */}
          {status === "applied" && (
            <p
              role="status"
              aria-live="polite"
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400"
            >
              Seed applied. Reload the page to see the new state.
            </p>
          )}
          {status === "cleared" && (
            <p
              role="status"
              aria-live="polite"
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400"
            >
              Seed cleared. Reload to return to a fresh-visitor state.
            </p>
          )}
          {status === "error" && errorMessage !== null && (
            <p
              role="alert"
              className="text-xs font-medium text-red-600 dark:text-red-400"
            >
              Error: {errorMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
