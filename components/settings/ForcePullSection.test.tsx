/**
 * Component tests for ForcePullSection (moved from Stats to Settings in #1732 / #1729).
 *
 * Covers idle / pulling / success / error states and the pull action wiring,
 * restoring coverage that was deleted when ForcePullSection moved from
 * app/stats/page.tsx.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { ForcePullSection } from "@/components/settings/ForcePullSection";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/pokemon/SeedContext", () => ({
  useSeed: () => ({ seed: null, error: null, retry: vi.fn() }),
}));

// Cloud sync helpers - each is a vi.fn() we control per test.
const { mockPullSession } = vi.hoisted(() => ({
  mockPullSession: vi.fn(),
}));

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: mockPullSession,
  applyCloudAuthoritative: vi.fn(() => []),
  maxCloudUpdatedAt: vi.fn(() => null),
}));

vi.mock("@/lib/sync/settings", () => ({
  pullSettingsWithTimestamp: vi.fn().mockResolvedValue(null),
  pullRegionalPrefs: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/sync/streak", () => ({
  pullStreak: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/sync/gradeLog", () => ({
  pullGradeLog: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({
    masteryRepetitions: 3,
    retentionTarget: 0.9,
    evolutionCardsEnabled: false,
    reverseEvolutionCardsEnabled: false,
    cryCardsEnabled: false,
    alternateFormsEnabled: false,
    pokemonNameLocale: "en",
    practiceScope: {},
    earnedBadges: [],
    streakProtection: { spendDates: [] },
  })),
  saveSettings: vi.fn(),
}));

vi.mock("@/lib/streak/persistence", () => ({
  saveStreakData: vi.fn(),
}));

vi.mock("@/lib/gradelog/persistence", () => ({
  saveGradeLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn().mockResolvedValue({ ok: true }),
  bumpSessionStorageKey: vi.fn(),
  STORAGE_KEY: "poke-memory:review-session:v1",
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({})),
  saveSyncStatus: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_SUPABASE = {} as import("@supabase/supabase-js").SupabaseClient;
const MOCK_USER_ID = "user-abc-123";

function defaultProps() {
  return {
    supabase: MOCK_SUPABASE,
    userId: MOCK_USER_ID,
  };
}

// Suppress window.confirm in tests; the handler gates on `confirmed`.
function mockConfirm(value: boolean) {
  vi.stubGlobal("confirm", vi.fn(() => value));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ForcePullSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm(true);
  });

  // ── Idle state ─────────────────────────────────────────────────────────────

  it("idle: renders the restore button and description", () => {
    renderWithIntl(<ForcePullSection {...defaultProps()} />);
    expect(
      screen.getByRole("button", { name: /Force pull from cloud/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Use this if your stats look wrong/i),
    ).toBeInTheDocument();
  });

  it("idle: button is enabled", () => {
    renderWithIntl(<ForcePullSection {...defaultProps()} />);
    expect(
      screen.getByRole("button", { name: /Force pull from cloud/i }),
    ).not.toBeDisabled();
  });

  it("idle: no status message visible", () => {
    renderWithIntl(<ForcePullSection {...defaultProps()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ── Confirm cancelled ──────────────────────────────────────────────────────

  it("does not pull when the user cancels the confirm dialog", async () => {
    mockConfirm(false);
    mockPullSession.mockResolvedValue([]);
    renderWithIntl(<ForcePullSection {...defaultProps()} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Force pull from cloud/i }),
    );
    expect(mockPullSession).not.toHaveBeenCalled();
  });

  // ── Pulling state ──────────────────────────────────────────────────────────

  it("pulling: button shows loading text and is disabled while pulling", async () => {
    // Make the pull never resolve so we can assert mid-pull state.
    mockPullSession.mockReturnValue(new Promise(() => undefined));
    renderWithIntl(<ForcePullSection {...defaultProps()} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Force pull from cloud/i }),
    );
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Pulling from cloud/i });
      expect(btn).toBeDisabled();
    });
  });

  // ── Success state ──────────────────────────────────────────────────────────

  it("success: shows success message after a successful pull", async () => {
    // pullSession returns empty rows (no cloud data to apply).
    mockPullSession.mockResolvedValue([]);
    renderWithIntl(<ForcePullSection {...defaultProps()} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Force pull from cloud/i }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Done/i);
  });

  // ── Error state ────────────────────────────────────────────────────────────

  it("error: shows error message when pullSession returns null", async () => {
    // pullSession returns null when no cloud rows exist / auth fails.
    mockPullSession.mockResolvedValue(null);
    renderWithIntl(<ForcePullSection {...defaultProps()} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Force pull from cloud/i }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Pull failed/i);
  });

  it("error: shows error message when pullSession throws", async () => {
    mockPullSession.mockRejectedValue(new Error("Network error"));
    renderWithIntl(<ForcePullSection {...defaultProps()} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Force pull from cloud/i }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Pull failed/i);
  });
});
