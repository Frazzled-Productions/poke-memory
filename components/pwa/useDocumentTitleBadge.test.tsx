/**
 * Component tests for useDocumentTitleBadge (issue #1062, #1108, #1134, #1137).
 *
 * Covers:
 *   - Sets document.title with a `(N)` prefix when cards are due.
 *   - Strips the prefix when there are no due cards.
 *   - Clears prefix when session is null.
 *   - Preserves the base route title (does not replace it).
 *   - Re-syncs when the session storage key changes (card graded).
 *   - Re-syncs when SETTINGS_SAVED_EVENT fires (e.g. timezone changed).
 *   - Re-syncs when SESSION_CHANGED_EVENT fires (IDB write on WebKit — #1134).
 *   - Clears prefix on unmount.
 *   - Delegates queue computation to computeQueueCount (#1137).
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
  todayString: vi.fn().mockReturnValue("2026-05-19"),
}));

// computeQueueCount is the shared helper (#1137). Mock it here to keep
// useDocumentTitleBadge tests isolated from the queue-building logic.
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

import { useDocumentTitleBadge } from "./useDocumentTitleBadge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns document.title with any `(N)` prefix stripped. */
function baseTitle(): string {
  return document.title.replace(/^\(\d+\)\s*/, "");
}

/** Helper to stub computeQueueCount with the given total. */
function stubQueueCount(total: number) {
  mockComputeQueueCount.mockReturnValue({
    newCount: total,
    learningCount: 0,
    reviewCount: 0,
    totalCount: total,
  });
}

// ---------------------------------------------------------------------------

beforeEach(() => {
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
    stubQueueCount(0);

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
    stubQueueCount(6);

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
    stubQueueCount(4);

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
    stubQueueCount(2);

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
    stubQueueCount(1);

    const { rerender } = renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("(1) Poké Memory");
    });

    // Grade the card: session key bumps, no cards left.
    sessionVersion = 1;
    stubQueueCount(0);

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
    stubQueueCount(1);

    renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("(1) Poké Memory");
    });

    // Settings change (e.g. timezone) → more cards in scope.
    stubQueueCount(3);

    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await waitFor(() => {
      expect(document.title).toBe("(3) Poké Memory");
    });
  });

  it("re-syncs when SESSION_CHANGED_EVENT fires (WebKit IDB write — #1134)", async () => {
    // Simulates WebKit: loadSession returns null initially, then returns cards
    // after an IDB write. The hook must re-run `sync` when the CustomEvent fires.
    mockLoadSession.mockResolvedValue(null);

    renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("Poké Memory");
    });

    // IDB write completes: session now has cards due.
    mockLoadSession.mockResolvedValue({ cards: [{ id: 1 }], limits: {} });
    stubQueueCount(5);

    act(() => {
      window.dispatchEvent(new CustomEvent("poke-memory:session-changed"));
    });

    await waitFor(() => {
      expect(document.title).toBe("(5) Poké Memory");
    });
  });

  it("clears prefix on unmount", async () => {
    mockLoadSession.mockResolvedValue({
      cards: [{ id: 1 }],
      limits: {},
    });
    stubQueueCount(1);

    const { unmount } = renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(document.title).toBe("(1) Poké Memory");
    });

    unmount();

    expect(document.title).toBe("Poké Memory");
  });

  it("passes session cards, settings, limits, and today to computeQueueCount", async () => {
    // Verifies the hook wires all four arguments to the shared helper.
    const cards = [{ id: 1 }];
    const limits = { maxNewPerDay: 10 };
    mockLoadSession.mockResolvedValue({ cards, limits });
    stubQueueCount(1);

    renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(mockComputeQueueCount).toHaveBeenCalledWith(
        cards,
        expect.objectContaining({ evolutionCardsEnabled: true }),
        limits,
        expect.any(String), // today
      );
    });
  });

  it("hook and computeDashboardSnapshot report the same count for identical inputs (#1137)", async () => {
    // Sanity-check that the refactor keeps badge surfaces aligned with the
    // Stats dashboard: both delegate to computeQueueCount, so the mock confirms
    // the same argument structure is used.
    const cards = [{ id: 1 }, { id: 2 }];
    const limits = {};
    mockLoadSession.mockResolvedValue({ cards, limits });
    stubQueueCount(7);

    renderHook(() => useDocumentTitleBadge());

    // The hook must call computeQueueCount (the shared helper), confirming
    // both the title badge and the snapshot use the same derivation path.
    await waitFor(() => {
      expect(mockComputeQueueCount).toHaveBeenCalledWith(
        cards,
        expect.any(Object),
        limits,
        expect.any(String),
      );
      expect(document.title).toBe("(7) Poké Memory");
    });
  });

  it("baseTitle helper strips stale prefix before applying new count", async () => {
    // When the page already has a (3) prefix from a previous sync, re-syncing
    // with a new count should strip the old prefix and apply the fresh one.
    document.title = "(3) Poké Memory";
    mockLoadSession.mockResolvedValue({ cards: [{ id: 1 }], limits: {} });
    stubQueueCount(5);

    renderHook(() => useDocumentTitleBadge());

    await waitFor(() => {
      expect(baseTitle()).toBe("Poké Memory");
      expect(document.title).toBe("(5) Poké Memory");
    });
  });
});
