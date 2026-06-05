"use client";

/**
 * DashboardSnapshotContext - memoised, shared DashboardSnapshot computation.
 *
 * Both the Stats page and the Journey page independently computed a
 * DashboardSnapshot from the same card data. This context provider memoises
 * the snapshot by identity of its inputs so any number of consumers receive
 * the same object without redundant work.
 *
 * Design: one input slot, one snapshot. Stats and Journey are different routes
 * so only one is ever mounted at a time - there is no multi-publisher
 * concurrency to solve. Each page calls useProvideDashboardSnapshotInput with
 * its full input on mount; the cleanup clears it on unmount.
 *
 * Introduced in #1139; simplified in #1151.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  computeDashboardSnapshot,
  type DashboardSnapshot,
  type DashboardSnapshotOptions,
} from "@/lib/stats/dashboard-snapshot";
import type { ReviewableCard, DailyLimits } from "@/lib/review/session";
import type { EligibilitySettings } from "@/lib/review/scope";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SnapshotInput = {
  cards: readonly ReviewableCard[];
  settings: EligibilitySettings;
  limits: DailyLimits;
  today: string;
  options?: DashboardSnapshotOptions;
};

type ContextValue = {
  snapshot: DashboardSnapshot | null;
  setInput: (input: SnapshotInput | null) => void;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const DashboardSnapshotContext = createContext<ContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DashboardSnapshotProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState<SnapshotInput | null>(null);

  const snapshot = useMemo(
    () =>
      input
        ? computeDashboardSnapshot(
            input.cards,
            input.settings,
            input.limits,
            input.today,
            input.options,
          )
        : null,
    [input],
  );

  return (
    <DashboardSnapshotContext.Provider value={{ snapshot, setInput }}>
      {children}
    </DashboardSnapshotContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Read the memoised DashboardSnapshot from the nearest provider.
 * Returns `null` while no input has been provided.
 */
export function useDashboardSnapshot(): DashboardSnapshot | null {
  const ctx = useContext(DashboardSnapshotContext);
  if (!ctx) throw new Error("useDashboardSnapshot must be used within DashboardSnapshotProvider");
  return ctx.snapshot;
}

/**
 * Push the page's snapshot input into the context on mount and clear it on
 * unmount. Each page provides its full input - no axis filtering. Both pages
 * get the full snapshot and read the axes they need from it.
 *
 * Only one page is mounted at a time (Stats and Journey are separate routes),
 * so a single input slot is always sufficient.
 */
export function useProvideDashboardSnapshotInput(input: SnapshotInput | null): void {
  const ctx = useContext(DashboardSnapshotContext);
  if (!ctx) throw new Error("useProvideDashboardSnapshotInput must be used within DashboardSnapshotProvider");
  const { setInput } = ctx;
  useEffect(() => {
    setInput(input);
    return () => setInput(null);
  }, [setInput, input]);
}
