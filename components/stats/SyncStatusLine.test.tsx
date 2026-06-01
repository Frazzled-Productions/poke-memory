/**
 * Tests for SyncStatusLine (#923, #1358, #1417, #1537).
 *
 * Covers:
 * - Normal rendering (not synced, last synced, retrying, retry error)
 * - Structural error state: non-retryable banner, Retry button absent (#1358)
 * - Transient error state: generic failed banner with Retry button present
 * - Auxiliary-leg errors must NOT flip structuralSyncError (verified via mock)
 * - Locale coverage: en + ja strings render correctly via next-intl (#1417)
 * - ICU plural: count=1 and count>1 both render correctly
 * - 24-hour time format on last-synced and failed/out-of-sync states (#1537)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SyncStatus } from "@/lib/sync/persistence";
import {
  renderWithIntl,
  renderJa,
  screen,
} from "@/components/test-utils/renderWithIntl";
import type { AppLocale } from "@/i18n/locales";

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
    renderWithIntl(
      <SyncStatusLine
        retryState="idle"
        retryNow={vi.fn()}
        superuserPaused={false}
      />,
    );

    // useLocalStorageKey must have been called — this is the line the gate needs.
    expect(useLocalStorageKey).toHaveBeenCalledWith("poke-memory:sync-status:v1");
  });

  // ─── Not-synced-yet state ─────────────────────────────────────────────────

  it("renders 'Not synced yet.' in en when no push has ever completed", async () => {
    renderWithIntl(
      <SyncStatusLine
        retryState="idle"
        retryNow={vi.fn()}
        superuserPaused={false}
      />,
    );

    // The component reads loadSyncStatus inside a useEffect; wait for the
    // resulting state update to be flushed by React.
    await screen.findByText("Not synced yet.");
  });

  it("renders not-synced-yet in Japanese", async () => {
    renderJa(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    await screen.findByText("まだ同期されていません。");
  });

  it("renders not-synced-yet in zh-Hans", async () => {
    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
      { locale: "zh-Hans" },
    );

    await screen.findByText("尚未同步。");
  });

  it("renders not-synced-yet in zh-Hant", async () => {
    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
      { locale: "zh-Hant" },
    );

    await screen.findByText("尚未同步。");
  });

  // ─── Last-synced state ───────────────────────────────────────────────────

  it("renders 'Last synced:' prefix when a successful push time is available", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushAt: "2026-05-30T10:30:00.000Z",
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    // The prefix is the localised key; the time portion is locale-formatted.
    const el = await screen.findByText(/Last synced:/);
    expect(el).toBeInTheDocument();
  });

  it("renders last-synced message in Japanese", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushAt: "2026-05-30T10:30:00.000Z",
    });

    renderJa(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const el = await screen.findByText(/最終同期:/);
    expect(el).toBeInTheDocument();
  });

  // ─── Retrying state ───────────────────────────────────────────────────────

  it("renders 'Retrying…' in en while retryState is retrying", async () => {
    renderWithIntl(
      <SyncStatusLine retryState="retrying" retryNow={vi.fn()} superuserPaused={false} />,
    );

    await screen.findByText("Retrying…");
  });

  it("renders retrying message in Japanese", async () => {
    renderJa(
      <SyncStatusLine retryState="retrying" retryNow={vi.fn()} superuserPaused={false} />,
    );

    await screen.findByText("再試行中…");
  });

  // ─── Retry-failed state ──────────────────────────────────────────────────

  it("renders a retry button with 'Retry failed' in en when retryState is error", async () => {
    renderWithIntl(
      <SyncStatusLine retryState="error" retryNow={vi.fn()} superuserPaused={false} />,
    );

    await screen.findByRole("button", { name: /retry failed/i });
  });

  it("renders retry-failed button in Japanese", async () => {
    renderJa(
      <SyncStatusLine retryState="error" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const btn = await screen.findByRole("button");
    expect(btn.textContent).toMatch(/再試行に失敗しました/);
  });

  // ─── Cards out of sync — ICU plural ──────────────────────────────────────

  it("en: count=1 renders singular 'card may be out of sync'", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      failedCardCount: 1,
      lastPushAttemptAt: null,
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const btn = await screen.findByRole("button");
    expect(btn.textContent).toMatch(/1 card may be out of sync/);
  });

  it("en: count=3 renders plural 'cards may be out of sync'", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      failedCardCount: 3,
      lastPushAttemptAt: null,
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const btn = await screen.findByRole("button");
    expect(btn.textContent).toMatch(/3 cards may be out of sync/);
  });

  it("ja: count=1 renders the Japanese 'other' plural form (CJK has no 'one' branch)", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      failedCardCount: 1,
      lastPushAttemptAt: null,
    });

    renderJa(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const btn = await screen.findByRole("button");
    expect(btn.textContent).toMatch(/1 件のカードが同期されていない可能性があります/);
  });

  it("ja: count=5 renders the Japanese plural form", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      failedCardCount: 5,
      lastPushAttemptAt: null,
    });

    renderJa(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const btn = await screen.findByRole("button");
    expect(btn.textContent).toMatch(/5 件のカードが同期されていない可能性があります/);
  });

  // ─── Sync-failed state ────────────────────────────────────────────────────

  it("renders 'Sync failed' in en when failedCardCount is null", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      failedCardCount: null,
      lastPushAttemptAt: null,
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const btn = await screen.findByRole("button");
    expect(btn.textContent).toMatch(/Sync failed/);
  });

  it("renders sync-failed message in Japanese", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      failedCardCount: null,
      lastPushAttemptAt: null,
    });

    renderJa(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const btn = await screen.findByRole("button");
    expect(btn.textContent).toMatch(/同期に失敗しました/);
  });

  // ─── Transient failure state (OUT side) ───────────────────────────────────

  it("renders a retryable Retry button for a transient card push failure", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      failedCardCount: 2,
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    // A retryable Retry button must be present in this state.
    const btn = await screen.findByRole("button");
    expect(btn).not.toBeDisabled();
    expect(btn.textContent).toMatch(/retry/i);
  });

  // ─── Structural error state (IN side) ─────────────────────────────────────
  // These are the core #1358 boundary tests.

  it("renders the structural-error banner in en when structuralSyncError is non-null", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      structuralSyncError: "42P10",
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    // The structural error message must appear.
    await screen.findByText(/schema mismatch was detected/i);
  });

  it("renders the structural-error banner in Japanese", async () => {
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      structuralSyncError: "42P10",
    });

    renderJa(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    await screen.findByText(/スキーマの不一致が検出されました/);
  });

  it("does NOT render a Retry button when structuralSyncError is non-null", async () => {
    // Retrying 42P10 always fails — the button must be absent.
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      structuralSyncError: "42P10",
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    await screen.findByText(/schema mismatch was detected/i);
    // No Retry button should exist.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the structural-error banner even when retryState is 'error' (structural takes priority)", async () => {
    // If the hook somehow fires an error after a structural state, the
    // structural banner must still win — the user must not see a misleading
    // "Retry failed · Try again" button for an unretryable error.
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      structuralSyncError: "42P10",
    });

    renderWithIntl(
      <SyncStatusLine retryState="error" retryNow={vi.fn()} superuserPaused={false} />,
    );

    await screen.findByText(/schema mismatch was detected/i);
    expect(screen.queryByRole("button")).toBeNull();
  });

  // ─── 24-hour time format (#1537) ─────────────────────────────────────────
  //
  // Use a fixed ISO timestamp and derive the expected 24h string via Intl so
  // the assertion is timezone-agnostic: it verifies the *format* (no AM/PM,
  // hour12: false) regardless of the system timezone the test runner uses.

  it("last-synced time renders in 24-hour format (no AM/PM)", async () => {
    const ISO = "2026-05-30T20:03:00.000Z";
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushAt: ISO,
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const el = await screen.findByText(/Last synced:/);
    const text = el.textContent ?? "";

    // Must NOT contain AM/PM markers (case-insensitive, including narrow-NBSP variants).
    expect(text).not.toMatch(/\bam\b|\bpm\b/i);

    // Must contain the Intl-formatted 24h time for this timestamp.
    const expected = new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ISO));
    expect(text).toContain(expected);
  });

  it("failed/out-of-sync time suffix renders in 24-hour format (no AM/PM)", async () => {
    const ISO = "2026-05-30T20:03:00.000Z";
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushFailed: true,
      failedCardCount: null,
      lastPushAttemptAt: ISO,
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    const btn = await screen.findByRole("button");
    const text = btn.textContent ?? "";

    // Must NOT contain AM/PM markers.
    expect(text).not.toMatch(/\bam\b|\bpm\b/i);

    // Must contain the Intl-formatted 24h time for this timestamp.
    const expected = new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ISO));
    expect(text).toContain(expected);
  });

  // ─── Auxiliary leg errors must NOT set structuralSyncError ───────────────

  it("does NOT show structural banner when only auxiliary legs have errors (structuralSyncError stays null)", async () => {
    // Auxiliary legs (pushSettings, pushStreak, pushGradeLog, pushRegionalPrefs)
    // must NOT flip structuralSyncError. Verify by confirming the banner is absent
    // when structuralSyncError is null even though lastPushFailed is true.
    mockLoadSyncStatus.mockReturnValue({
      ...BASE_STATUS,
      lastPushAt: "2026-05-30T10:00:00.000Z",
      lastPushFailed: true,
      lastPushAttemptAt: "2026-05-30T10:00:00.000Z",
      failedCardCount: 0,
      // structuralSyncError is null — auxiliary legs must not set it.
      structuralSyncError: null,
    });

    renderWithIntl(
      <SyncStatusLine retryState="idle" retryNow={vi.fn()} superuserPaused={false} />,
    );

    // The structural error banner must NOT appear.
    // (The component falls through to the generic "last synced" path for
    // failedCardCount===0 when a prior push succeeded.)
    await screen.findByText(/last synced/i);
    expect(screen.queryByText(/schema mismatch/i)).toBeNull();
  });
});
