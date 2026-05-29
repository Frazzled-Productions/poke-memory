"use client";

import { useState, useEffect } from "react";
import { cardPanelPadded } from "@/lib/utils/class-names";
import { cn } from "@/lib/utils/cn";
import { SCENARIOS, SCENARIO_BY_SLUG } from "@/lib/qa-seed/scenarios";
import { applySeedScenario, clearSeedScenario } from "@/lib/qa-seed/apply";
import { KEY_QA_SEED_ACTIVE } from "@/lib/storage/keys";

type ApplyStatus =
  | { kind: "idle" }
  | { kind: "applying" }
  | { kind: "done"; scenarioLabel: string }
  | { kind: "cleared" }
  | { kind: "error"; message: string };

/**
 * QA seed panel shown inside the superuser Developer section (#1326).
 *
 * Lets a developer inject a named scenario payload into IndexedDB so a fresh
 * preview can exercise data-dependent behaviour (per-locale FSRS reset,
 * optimiser, Pasture). Local-only: sync write-guard on SuperuserContext
 * suppresses all cloud writes while any superuser flag is on.
 *
 * Usage: select a scenario from the dropdown, click "Apply seed". The page
 * must be reloaded after seeding to pick up the new IDB state. A "Clear seed"
 * button removes the session and grade-log from IDB.
 */
export function QaSeedSection() {
  const [selectedSlug, setSelectedSlug] = useState<string>(SCENARIOS[0]?.slug ?? "");
  const [status, setStatus] = useState<ApplyStatus>({ kind: "idle" });
  // Slug of the currently active scenario, persisted in localStorage (not IDB) and restored on mount.
  const [activeSeedSlug, setActiveSeedSlug] = useState<string | null>(null);

  // Restore the active-seed indicator from localStorage on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY_QA_SEED_ACTIVE);
      setActiveSeedSlug(stored ?? null);
    } catch {
      // Private browsing / storage quota — non-fatal.
    }
  }, []);

  const selectedScenario = SCENARIOS.find((s) => s.slug === selectedSlug);

  async function handleApply() {
    if (!selectedScenario) return;
    const confirmed = window.confirm(
      `Apply "${selectedScenario.label}" QA seed?\n\n` +
        "This will overwrite your current local review session. " +
        "Reload the page after applying to see the seeded state. " +
        "Sync is paused (superuser mode) so no cloud data is affected.",
    );
    if (!confirmed) return;

    setStatus({ kind: "applying" });
    try {
      const payload = selectedScenario.build();
      await applySeedScenario(payload, selectedScenario.slug);
      setActiveSeedSlug(selectedScenario.slug);
      setStatus({ kind: "done", scenarioLabel: selectedScenario.label });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error applying seed.";
      setStatus({ kind: "error", message });
    }
  }

  async function handleClear() {
    const confirmed = window.confirm(
      "Clear QA seed data?\n\n" +
        "This removes your local review session and grade log. " +
        "You will start as a fresh visitor after reloading. " +
        "Cloud data (if you are signed in) is unaffected.",
    );
    if (!confirmed) return;

    setStatus({ kind: "applying" });
    try {
      await clearSeedScenario();
      setActiveSeedSlug(null);
      setStatus({ kind: "cleared" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error clearing seed.";
      setStatus({ kind: "error", message });
    }
  }

  return (
    <div
      data-testid="qa-seed-section"
      className={cn("mt-4", cardPanelPadded)}
      role="group"
      aria-labelledby="qa-seed-heading"
    >
      <p
        id="qa-seed-heading"
        className="text-sm font-medium text-foreground"
      >
        QA seed
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Inject a named test-data scenario into local storage. Reload the page
        after applying. Sync is paused (superuser mode) so no cloud data is
        affected.
      </p>

      {/* Active seed indicator */}
      {activeSeedSlug !== null && (
        <p
          data-testid="qa-seed-active-indicator"
          className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400"
        >
          Active seed:{" "}
          <span className="font-semibold">
            {SCENARIO_BY_SLUG.get(activeSeedSlug)?.label ?? activeSeedSlug}
          </span>
        </p>
      )}

      {/* Scenario picker */}
      <div className="mt-3 flex flex-col gap-2">
        <label
          htmlFor="qa-seed-scenario-select"
          className="block text-xs font-medium text-foreground"
        >
          Scenario
        </label>
        <select
          id="qa-seed-scenario-select"
          value={selectedSlug}
          onChange={(e) => {
            setSelectedSlug(e.target.value);
            setStatus({ kind: "idle" });
          }}
          className="rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
        >
          {SCENARIOS.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.label}
            </option>
          ))}
        </select>

        {/* Selected scenario description */}
        {selectedScenario && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {selectedScenario.description}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { void handleApply(); }}
          disabled={status.kind === "applying" || !selectedScenario}
          className="min-h-[36px] rounded-md border border-amber-400 bg-amber-50 px-4 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
          aria-label={`Apply QA seed: ${selectedScenario?.label ?? "no scenario selected"}`}
        >
          {status.kind === "applying" ? "Applying..." : "Apply seed"}
        </button>

        <button
          type="button"
          onClick={() => { void handleClear(); }}
          disabled={status.kind === "applying"}
          className="min-h-[36px] rounded-md border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          aria-label="Clear QA seed data"
        >
          Clear seed
        </button>
      </div>

      {/* Status feedback */}
      {status.kind === "done" && (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        >
          Seed applied: {status.scenarioLabel}. Reload the page to see the seeded state.
        </p>
      )}
      {status.kind === "cleared" && (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        >
          Seed cleared. Reload the page to start as a fresh visitor.
        </p>
      )}
      {status.kind === "error" && (
        <p
          role="alert"
          className="mt-3 text-xs font-medium text-red-600 dark:text-red-400"
        >
          Error: {status.message}
        </p>
      )}

      {/* Usage hint */}
      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
        To clear: click &quot;Clear seed&quot; and reload, or turn off superuser mode (which
        offers to restore cloud state for signed-in users, or wipe local state
        for guests).
      </p>
    </div>
  );
}
