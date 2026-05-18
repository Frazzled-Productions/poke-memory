/**
 * Smoke tests for SyncStatusLine (#923).
 *
 * Verifies that the component renders without throwing and that
 * useLocalStorageKey is called (line 20 in SyncStatusLine.tsx), which is the
 * previously-uncovered instrumented line flagged by the diff-coverage gate.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before component import so hoisting works.
// ---------------------------------------------------------------------------

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({
    lastPushAt: null,
    lastPushFailed: false,
    lastPushAttemptAt: null,
    failedCardCount: null,
    lastPullAt: null,
    lastSettingsPullAt: null,
    lastSeenResetAt: null,
  })),
  saveSyncStatus: vi.fn(),
  STORAGE_KEY: "poke-memory:sync-status:v1",
}));

vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn(() => 0),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { SyncStatusLine } from "@/components/stats/SyncStatusLine";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncStatusLine", () => {
  it("renders without throwing and calls useLocalStorageKey with the sync status key", () => {
    const retryNow = vi.fn();

    render(
      <SyncStatusLine
        retryState="idle"
        retryNow={retryNow}
        superuserPaused={false}
      />,
    );

    // useLocalStorageKey must have been called — this is the line the gate needs.
    expect(useLocalStorageKey).toHaveBeenCalledWith("poke-memory:sync-status:v1");
  });

  it("renders 'Not synced yet.' when no push has ever completed", async () => {
    const retryNow = vi.fn();

    render(
      <SyncStatusLine
        retryState="idle"
        retryNow={retryNow}
        superuserPaused={false}
      />,
    );

    // The component reads loadSyncStatus inside a useEffect; wait for the
    // resulting state update to be flushed by React.
    await screen.findByText("Not synced yet.");
  });

  it("renders 'Retrying…' while retryState is retrying", async () => {
    const retryNow = vi.fn();

    render(
      <SyncStatusLine
        retryState="retrying"
        retryNow={retryNow}
        superuserPaused={false}
      />,
    );

    await screen.findByText("Retrying…");
  });

  it("renders a retry button when retryState is error", async () => {
    const retryNow = vi.fn();

    render(
      <SyncStatusLine
        retryState="error"
        retryNow={retryNow}
        superuserPaused={false}
      />,
    );

    await screen.findByRole("button", { name: /retry failed/i });
  });
});
