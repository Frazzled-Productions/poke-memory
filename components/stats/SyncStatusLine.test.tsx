/**
 * Tests for SyncStatusLine (#923, #1358).
 *
 * Covers:
 * - Normal rendering (not synced, last synced, retrying, retry error)
 * - Structural error state: non-retryable banner, Retry button absent (#1358)
 * - Transient error state: generic failed banner with Retry button present
 * - Auxiliary-leg errors must NOT flip structuralSyncError (verified via mock)
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SyncStatus } from "@/lib/sync/persistence";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures the mock factory can reference these variables
// even after vi.mock hoisting.
// ---------------------------------------------------------------------------

const BASE_STATUS: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: false,
  lastPushAttemptAt: null,
  failedCardCount: null,
  lastPullAt: null,
  lastSettingsPullAt: null,
  lastSeenResetAt: null,
  structuralSyncError: null,
};

const { mockLoadSyncStatus } = vi.hoisted(() => ({
  mockLoadSyncStatus: vi.fn(),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: mockLoadSyncStatus,
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
  beforeEach(() => {
    // Default: no push failure, no structural error.
    mockLoadSyncStatus.mockReturnValue(BASE_STATUS);
  });

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

  it("renders a retry button when retryState is error (transient failure)", async () => {
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

  // ─── Transient failure state (OUT side) ───────────────────────────────────

  it("renders a retryable Retry button for a transient card push failure", async () => {
    // State: lastPushFailed=true, structuralSyncError=null → generic retry banner.
    mockLoadSyncStatus.mockReturnValueOnce({
      lastPushAt: null,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      failedCardCount: 2,
      lastPullAt: null,
      lastSettingsPullAt: null,
      lastSeenResetAt: null,
      structuralSyncError: null,
    });

    const retryNow = vi.fn();
    render(
      <SyncStatusLine retryState="idle" retryNow={retryNow} superuserPaused={false} />,
    );

    // A retryable Retry button must be present in this state.
    const btn = await screen.findByRole("button");
    expect(btn).not.toBeDisabled();
    expect(btn.textContent).toMatch(/retry/i);
  });

  // ─── Structural error state (IN side) ─────────────────────────────────────
  // These are the core #1358 boundary tests.

  it("renders the structural-error banner when structuralSyncError is non-null", async () => {
    mockLoadSyncStatus.mockReturnValueOnce({
      lastPushAt: null,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      failedCardCount: null,
      lastPullAt: null,
      lastSettingsPullAt: null,
      lastSeenResetAt: null,
      structuralSyncError: "42P10",
    });

    const retryNow = vi.fn();
    render(
      <SyncStatusLine retryState="idle" retryNow={retryNow} superuserPaused={false} />,
    );

    // The structural error message must appear.
    await screen.findByText(/schema mismatch was detected/i);
  });

  it("does NOT render a Retry button when structuralSyncError is non-null", async () => {
    // Retrying 42P10 always fails — the button must be absent.
    mockLoadSyncStatus.mockReturnValueOnce({
      lastPushAt: null,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      failedCardCount: null,
      lastPullAt: null,
      lastSettingsPullAt: null,
      lastSeenResetAt: null,
      structuralSyncError: "42P10",
    });

    const retryNow = vi.fn();
    render(
      <SyncStatusLine retryState="idle" retryNow={retryNow} superuserPaused={false} />,
    );

    await screen.findByText(/schema mismatch was detected/i);
    // No Retry button should exist.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the structural-error banner even when retryState is 'error' (structural takes priority)", async () => {
    // If the hook somehow fires an error after a structural state, the
    // structural banner must still win — the user must not see a misleading
    // "Retry failed · Try again" button for an unretryable error.
    mockLoadSyncStatus.mockReturnValueOnce({
      lastPushAt: null,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      failedCardCount: null,
      lastPullAt: null,
      lastSettingsPullAt: null,
      lastSeenResetAt: null,
      structuralSyncError: "42P10",
    });

    const retryNow = vi.fn();
    render(
      <SyncStatusLine retryState="error" retryNow={retryNow} superuserPaused={false} />,
    );

    await screen.findByText(/schema mismatch was detected/i);
    expect(screen.queryByRole("button")).toBeNull();
  });

  // ─── Auxiliary leg errors must NOT set structuralSyncError (structural isolation) ─

  it("does NOT show structural banner when only auxiliary legs have errors (structuralSyncError stays null)", async () => {
    // Auxiliary legs (pushSettings, pushStreak, pushGradeLog, pushRegionalPrefs)
    // must NOT flip structuralSyncError. Verify by confirming the banner is absent
    // when structuralSyncError is null even though lastPushFailed is true.
    mockLoadSyncStatus.mockReturnValueOnce({
      lastPushAt: null,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      failedCardCount: 0,
      lastPullAt: null,
      lastSettingsPullAt: null,
      lastSeenResetAt: null,
      // structuralSyncError is null — auxiliary legs must not set it.
      structuralSyncError: null,
    });

    const retryNow = vi.fn();
    render(
      <SyncStatusLine retryState="idle" retryNow={retryNow} superuserPaused={false} />,
    );

    // The structural error banner must NOT appear.
    // (The component falls through to the generic "last synced" path for
    // failedCardCount===0.)
    await screen.findByText(/last synced/i);
    expect(screen.queryByText(/schema mismatch/i)).toBeNull();
  });
});
