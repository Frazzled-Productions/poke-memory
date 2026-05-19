/**
 * Component tests for useDocumentTitleBadge (issue #1062).
 *
 * Covers:
 *   - Sets document.title with a `(N)` prefix when cards are due.
 *   - Strips the prefix when there are no due cards.
 *   - Clears prefix when session is null.
 *   - Preserves the base route title (does not replace it).
 *   - Re-syncs when the session storage key changes (card graded).
 *   - Re-syncs when SETTINGS_SAVED_EVENT fires (e.g. timezone changed).
 *   - Clears prefix on unmount.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must match the pattern in usePwaBadge.test.tsx
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

const mockBuildQueueCounters = vi.fn().mockReturnValue({
  newCount: 0,
  learningCount: 0,
  reviewCount: 0,
});
vi.mock("@/lib/review/session", () => ({
  buildQueueCounters: (...args: unknown[]) => mockBuildQueueCounters(...args),
  todayString: vi.fn().mockReturnValue("2026-05-19"),
}));

let sessionVersion = 0;
vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn(() => sessionVersion),
}));

// ---------------------------------------------------------------------------

import { useDocumentTitleBadge } from "./useDocumentTitleBadge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns document.title with any `(N)` prefix stripped. */
function baseTitle(): string {
  return document.title.replace(/^\(\d+\)\s*/, "");
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLoadSession.mockResolvedValue(null);
  mockLoadSettings.mockReturnValue({ timezone: "UTC" });
  mockBuildQueueCounters.mockReturnValue({
    newCount: 0,
    learningCount: 0,
    reviewCount: 0,
  });
  sessionVersion = 0;
  document.title = "Poké Memory";
});

afterEach(() => {
  // Restore a clean title after each test.
  document.title = "Poké Memory";
});

// ---------------------------------------------------------------------------

describe("useDocumentTitleBadge", () => {
  it("removes any prefix when session is null", async () => {
    document.title = "(3) Poké Memory";
    mockLoadSession.mockResolvedValue(null);

    renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("Poké Memory");
    });
  });

  it("removes prefix when there are no due cards", async () => {
    document.title = "(5) Poké Memory";
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    mockBuildQueueCounters.mockReturnValue({
      newCount: 0,
      learningCount: 0,
      reviewCount: 0,
    });

    renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("Poké Memory");
    });
  });

  it("prefixes document.title with (N) when cards are due", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }, { id: 2 }, { id: 3 }],
      limits: {},
    });
    mockBuildQueueCounters.mockReturnValue({
      newCount: 2,
      learningCount: 1,
      reviewCount: 3,
    });

    renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("(6) Poké Memory");
    });
  });

  it("preserves the base route title when prefixing", async () => {
    document.title = "Poké Memory - Learn every Pokémon";
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    mockBuildQueueCounters.mockReturnValue({
      newCount: 0,
      learningCount: 0,
      reviewCount: 4,
    });

    renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("(4) Poké Memory - Learn every Pokémon");
    });
  });

  it("re-syncs when the session storage key increments", async () => {
    // First render: no cards due.
    mockLoadSession.mockResolvedValue(null);
    const { rerender } = renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("Poké Memory");
    });

    // Simulate a card review: session key bumps, session now has due cards.
    sessionVersion = 1;
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    mockBuildQueueCounters.mockReturnValue({
      newCount: 0,
      learningCount: 0,
      reviewCount: 2,
    });

    rerender();

    await waitFor(() => {
      expect(document.title).toBe("(2) Poké Memory");
    });
  });

  it("clears prefix when count drops to zero after grading", async () => {
    // Start with cards due.
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    mockBuildQueueCounters.mockReturnValue({
      newCount: 1,
      learningCount: 0,
      reviewCount: 0,
    });

    const { rerender } = renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("(1) Poké Memory");
    });

    // Grade the card: session key bumps, no cards left.
    sessionVersion = 1;
    mockBuildQueueCounters.mockReturnValue({
      newCount: 0,
      learningCount: 0,
      reviewCount: 0,
    });

    rerender();

    await waitFor(() => {
      expect(document.title).toBe("Poké Memory");
    });
  });

  it("re-syncs when SETTINGS_SAVED_EVENT fires", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    mockBuildQueueCounters.mockReturnValue({
      newCount: 1,
      learningCount: 0,
      reviewCount: 0,
    });

    renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("(1) Poké Memory");
    });

    // Settings change (e.g. timezone) → more cards in scope.
    mockBuildQueueCounters.mockReturnValue({
      newCount: 1,
      learningCount: 2,
      reviewCount: 0,
    });

    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await waitFor(() => {
      expect(document.title).toBe("(3) Poké Memory");
    });
  });

  it("clears prefix on unmount", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    mockBuildQueueCounters.mockReturnValue({
      newCount: 1,
      learningCount: 0,
      reviewCount: 0,
    });

    const { unmount } = renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("(1) Poké Memory");
    });

    unmount();

    expect(document.title).toBe("Poké Memory");
  });
});
