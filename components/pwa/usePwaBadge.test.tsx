/**
 * Component tests for usePwaBadge (issue #916, fixed #1099).
 *
 * Covers:
 *   - Sets badge to the sum of new + learning + review cards when due count > 0.
 *   - Clears badge when there are no due cards.
 *   - Clears badge when session is null.
 *   - Is a no-op when the Web Badging API is unavailable.
 *   - Re-syncs when the session storage key changes (card graded).
 *   - Re-syncs when SETTINGS_SAVED_EVENT fires (e.g. timezone changed).
 *   - Clears badge on unmount.
 *   - On a fresh install, badge is capped by the daily new-card cap, not the full backlog.
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
}));

const mockLoadSettings = vi.fn().mockReturnValue({ timezone: "UTC" });
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

// buildSessionQueues and todayString are tested separately; mock them here to
// keep usePwaBadge tests isolated from the SRS scheduler.
const mockBuildSessionQueues = vi.fn().mockReturnValue({
  newQueue: [],
  learningCardIds: [],
  reviewQueue: [],
  outOfScopeLearningIds: [],
  newIntroducedToday: 0,
  reviewsDoneToday: 0,
  perType: {
    name: { newIntroducedToday: 0, reviewsDoneToday: 0 },
    evolution: { newIntroducedToday: 0, reviewsDoneToday: 0 },
    reverse: { newIntroducedToday: 0, reviewsDoneToday: 0 },
    cry: { newIntroducedToday: 0, reviewsDoneToday: 0 },
  },
});
vi.mock("@/lib/review/session", () => ({
  buildSessionQueues: (...args: unknown[]) => mockBuildSessionQueues(...args),
  todayString: vi.fn().mockReturnValue("2026-05-18"),
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

/** Helper to stub buildSessionQueues with queue arrays of the given lengths. */
function stubQueues(newLen: number, learningLen: number, reviewLen: number) {
  mockBuildSessionQueues.mockReturnValue({
    newQueue: Array.from({ length: newLen }, (_, i) => i + 1),
    learningCardIds: Array.from({ length: learningLen }, (_, i) => 1000 + i),
    reviewQueue: Array.from({ length: reviewLen }, (_, i) => 2000 + i),
    outOfScopeLearningIds: [],
    newIntroducedToday: 0,
    reviewsDoneToday: 0,
    perType: {
      name: { newIntroducedToday: 0, reviewsDoneToday: 0 },
      evolution: { newIntroducedToday: 0, reviewsDoneToday: 0 },
      reverse: { newIntroducedToday: 0, reviewsDoneToday: 0 },
      cry: { newIntroducedToday: 0, reviewsDoneToday: 0 },
    },
  });
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSetAppBadge.mockClear();
  mockClearAppBadge.mockClear();
  mockLoadSession.mockResolvedValue(null);
  mockLoadSettings.mockReturnValue({ timezone: "UTC" });
  stubQueues(0, 0, 0);
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
    stubQueues(0, 0, 0);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockClearAppBadge).toHaveBeenCalledTimes(1);
    });
    expect(mockSetAppBadge).not.toHaveBeenCalled();
  });

  it("sets badge to total due count (new + learning + review)", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      limits: {},
    });
    stubQueues(2, 1, 3);

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
    stubQueues(1, 0, 0);

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
    stubQueues(0, 0, 2);

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
    stubQueues(1, 0, 0);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(1);
    });

    // Settings change (e.g. timezone) — should re-sync.
    stubQueues(1, 2, 0);

    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(3);
    });
  });

  it("clears badge on unmount", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    stubQueues(1, 0, 0);

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
    // Fresh install with ~3600 untouched cards; the mock stands in for
    // buildSessionQueues returning a capped queue (e.g. 10 name cards).
    // Verifies the hook sums from buildSessionQueues output, not the backlog.
    const BACKLOG_SIZE = 3600;
    const DAILY_CAP = 10;

    mockLoadSession.mockResolvedValue({
      cards: Array.from({ length: BACKLOG_SIZE }, (_, i) => ({ id: i + 1 })),
      limits: {},
    });
    // buildSessionQueues returns only the capped new queue, no learning/reviews.
    stubQueues(DAILY_CAP, 0, 0);

    renderHook(() => usePwaBadge());

    await waitFor(() => {
      expect(mockSetAppBadge).toHaveBeenCalledWith(DAILY_CAP);
    });
    expect(mockSetAppBadge).not.toHaveBeenCalledWith(BACKLOG_SIZE);
  });
});
