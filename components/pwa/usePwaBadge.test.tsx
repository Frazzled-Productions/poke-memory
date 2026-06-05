/**
 * Component tests for usePwaBadge (issue #916, fixed #1099, #1108, #1134, #1137).
 *
 * Covers:
 *   - Sets badge to the total due count when cards are due.
 *   - Clears badge when there are no due cards.
 *   - Clears badge when session is null.
 *   - Is a no-op when the Web Badging API is unavailable.
 *   - Re-syncs when the session storage key changes (card graded).
 *   - Re-syncs when SETTINGS_SAVED_EVENT fires (e.g. timezone changed).
 *   - Re-syncs when SESSION_CHANGED_EVENT fires (IDB write on WebKit - #1134).
 *   - Clears badge on unmount.
 *   - On a fresh install, badge is capped by the daily new-card cap, not the full backlog.
 *   - Delegates queue computation to computeQueueCount (#1137).
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockLoadSession = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/review/persistence", () => ({
  loadSession: () => mockLoadSession(),
  STORAGE_KEY: "poke-memory:review-session:v1",
  SESSION_CHANGED_EVENT: "poke-memory:session-changed",
}));

const mockLoadSettings = vi.fn().mockReturnValue({
  timezone: "UTC",
  evolutionCardsEnabled: true,
  reverseEvolutionCardsEnabled: false,
  cryCardsEnabled: false,
  alternateFormsEnabled: false,
  practiceScope: { gens: [], types: [], presets: [], games: [] },
});
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

vi.mock("@/lib/review/session", () => ({
  todayString: vi.fn().mockReturnValue("2026-05-18"),
}));

// computeQueueCount is the shared helper (#1137). Mock it here to keep
// usePwaBadge tests isolated from the queue-building logic.
const mockComputeQueueCount = vi.fn().mockReturnValue({
  newCount: 0,
  learningCount: 0,
  reviewCount: 0,
  totalCount: 0,
});
vi.mock("@/lib/stats/dashboard-snapshot", () => ({
  computeQueueCount: (...args: unknown[]) => mockComputeQueueCount(...args),
}));

let sessionVersion = 0;
vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn(() => sessionVersion),
}));

// ---------------------------------------------------------------------------

import { usePwaBadge } from "./usePwaBadge";

// ---------------------------------------------------------------------------
// Badge API mocks
// ---------------------------------------------------------------------------

const mockSetAppBadge = vi.fn().mockResolvedValue(undefined);
const mockClearAppBadge = vi.fn().mockResolvedValue(undefined);

function installBadgeApi() {
  Object.defineProperty(navigator, "setAppBadge", {
    value: mockSetAppBadge,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "clearAppBadge", {
    value: mockClearAppBadge,
    configurable: true,
    writable: true,
  });
}

function removeBadgeApi() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic prototype manipulation in tests
  delete (navigator as any).setAppBadge;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (navigator as any).clearAppBadge;
}

/** Helper to stub computeQueueCount with the given total. */
function stubQueueCount(total: number) {
  const newCount = total;
  mockComputeQueueCount.mockReturnValue({
    newCount,
    learningCount: 0,
    reviewCount: 0,
    totalCount: total,
  });
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSetAppBadge.mockClear();
  mockClearAppBadge.mockClear();
  mockLoadSession.mockResolvedValue(null);
  mockLoadSettings.mockReturnValue({
    timezone: "UTC",
    evolutionCardsEnabled: true,
    reverseEvolutionCardsEnabled: false,
    cryCardsEnabled: false,
    alternateFormsEnabled: false,
    practiceScope: { gens: [], types: [], presets: [], games: [] },
  });
  mockComputeQueueCount.mockReturnValue({
    newCount: 0,
    learningCount: 0,
    reviewCount: 0,
    totalCount: 0,
  });
  sessionVersion = 0;
  installBadgeApi();
});

afterEach(() => {
  removeBadgeApi();
});

// ---------------------------------------------------------------------------

describe("usePwaBadge", () => {
  it("clears badge when session is null", async () => {
    mockLoadSession.mockResolvedValue(null);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockClearAppBadge).toHaveBeenCalledTimes(1);
    });
    expect(mockSetAppBadge).not.toHaveBeenCalled();
  });

  it("clears badge when there are no due cards", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    stubQueueCount(0);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockClearAppBadge).toHaveBeenCalledTimes(1);
    });
    expect(mockSetAppBadge).not.toHaveBeenCalled();
  });

  it("sets badge to the total due count from computeQueueCount", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }, { id: 2 }, { id: 3 }],
      limits: {},
    });
    stubQueueCount(6);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(6);
    });
    expect(mockClearAppBadge).not.toHaveBeenCalled();
  });

  it("is a no-op when the Web Badging API is unavailable", async () => {
    removeBadgeApi();

    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    stubQueueCount(1);

    // Should not throw.
    const { unmount } = renderHook(() => usePwaBadge());

    // Wait a tick to ensure async path has run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(mockSetAppBadge).not.toHaveBeenCalled();
    expect(mockClearAppBadge).not.toHaveBeenCalled();
    unmount();
  });

  it("re-syncs when the session storage key increments", async () => {
    // First render: no cards due.
    mockLoadSession.mockResolvedValue(null);
    const { rerender } = renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockClearAppBadge).toHaveBeenCalledTimes(1);
    });

    // Simulate a card review: session key bumps, session now has due cards.
    sessionVersion = 1;
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    stubQueueCount(2);

    rerender();

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(2);
    });
  });

  it("re-syncs when SETTINGS_SAVED_EVENT fires", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    stubQueueCount(1);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(1);
    });

    // Settings change (e.g. timezone) - should re-sync.
    stubQueueCount(3);

    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(3);
    });
  });

  it("re-syncs when SESSION_CHANGED_EVENT fires (WebKit IDB write - #1134)", async () => {
    // Simulates WebKit: loadSession returns null initially, then returns cards
    // after an IDB write. The hook must re-run `sync` when the CustomEvent fires.
    mockLoadSession.mockResolvedValue(null);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockClearAppBadge).toHaveBeenCalledTimes(1);
    });

    // IDB write completes: session now has cards due.
    mockLoadSession.mockResolvedValue({ cards: [{ id: 1 }], limits: {} });
    stubQueueCount(4);

    act(() => {
      window.dispatchEvent(new CustomEvent("poke-memory:session-changed"));
    });

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(4);
    });
  });

  it("clears badge on unmount", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    stubQueueCount(1);

    const { unmount } = renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(1);
    });

    mockClearAppBadge.mockClear();
    unmount();

    await waitFor(() => {
      expect(mockClearAppBadge).toHaveBeenCalledTimes(1);
    });
  });

  it("badge is capped at the daily new-card limit on a fresh install", async () => {
    // Verifies the hook passes the session to computeQueueCount - which applies
    // the cap - rather than summing the raw backlog directly.
    const BACKLOG_SIZE = 3600;
    const DAILY_CAP = 10;

    mockLoadSession.mockResolvedValue({
      cards: Array.from({ length: BACKLOG_SIZE }, (_, i) => ({ id: i + 1 })),
      limits: {},
    });
    stubQueueCount(DAILY_CAP);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(DAILY_CAP);
    });
    expect(mockSetAppBadge).not.toHaveBeenCalledWith(BACKLOG_SIZE);
  });

  it("passes session cards, settings, limits, and today to computeQueueCount", async () => {
    // Verifies the hook wires all four arguments to the shared helper so filters
    // (directions, alternate forms, scope) are respected.
    const cards = [{ id: 1 }, { id: 2 }];
    const limits = { name: { maxNewPerDay: 5, maxReviewsPerDay: 20 } };
    mockLoadSession.mockResolvedValue({ cards, limits });
    stubQueueCount(2);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockComputeQueueCount).toHaveBeenCalledWith(
        cards,
        expect.objectContaining({ evolutionCardsEnabled: true }),
        limits,
        expect.any(String), // today
        expect.any(String), // active locale (#1562)
      );
    });
  });
});
