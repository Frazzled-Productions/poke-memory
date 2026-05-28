/**
 * Component tests for useCardClass (issue #1282).
 *
 * Covers:
 *   - Returns "pending" until session loads.
 *   - Returns "locked" for a missing session (null).
 *   - Returns "locked" when the session has no matching card.
 *   - Delegates to classifyCard with masteryRepetitions from settings.
 *   - Returns "learning" for an introduced, non-mastered card.
 *   - Returns "mastered" for a card that passes the mastery gate.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must precede the import of the module under test.
// ---------------------------------------------------------------------------

const mockLoadSession = vi.fn();
vi.mock("@/lib/review/persistence", () => ({
  loadSession: () => mockLoadSession(),
}));

const mockLoadSettings = vi.fn();
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
}));

const mockClassifyCard = vi.fn();
vi.mock("@/lib/stats/derive", () => ({
  classifyCard: (...args: unknown[]) => mockClassifyCard(...args),
}));

// ---------------------------------------------------------------------------

import { useCardClass } from "@/lib/review/useCardClass";
import type { ReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: "2026-05-28",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

/** A minimal name card as the hook expects: id + cardType + state. */
function makeNameCard(id: number, stateOverrides: Partial<ReviewState> = {}) {
  return {
    id,
    cardType: "name" as const,
    state: makeState(stateOverrides),
  };
}

function makeSettings(masteryRepetitions = 3) {
  return { masteryRepetitions };
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLoadSession.mockReset();
  mockLoadSettings.mockReset();
  mockClassifyCard.mockReset();
});

// ---------------------------------------------------------------------------

describe("useCardClass", () => {
  it('returns "pending" synchronously before the async load completes', () => {
    // loadSession never resolves during this test — use a Promise that
    // stays pending so we can inspect the synchronous initial value.
    mockLoadSession.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useCardClass(1));

    expect(result.current).toBe("pending");
  });

  it('returns "locked" when loadSession resolves to null', async () => {
    mockLoadSession.mockResolvedValue(null);

    const { result } = renderHook(() => useCardClass(1));

    await waitFor(() => {
      expect(result.current).toBe("locked");
    });
    // loadSettings must not be called when there is no session.
    expect(mockLoadSettings).not.toHaveBeenCalled();
  });

  it('returns "locked" when the session exists but has no matching card', async () => {
    // Session has card id=99 but the hook is asked about id=1.
    mockLoadSession.mockResolvedValue({
      cards: [makeNameCard(99)],
      limits: {},
    });
    mockLoadSettings.mockReturnValue(makeSettings());

    const { result } = renderHook(() => useCardClass(1));

    await waitFor(() => {
      expect(result.current).toBe("locked");
    });
    // classifyCard should not be called — card not found.
    expect(mockClassifyCard).not.toHaveBeenCalled();
  });

  it("delegates to classifyCard with masteryRepetitions from settings", async () => {
    const card = makeNameCard(42);
    mockLoadSession.mockResolvedValue({ cards: [card], limits: {} });
    mockLoadSettings.mockReturnValue(makeSettings(5));
    mockClassifyCard.mockReturnValue("learning");

    const { result } = renderHook(() => useCardClass(42));

    await waitFor(() => {
      expect(result.current).toBe("learning");
    });

    expect(mockClassifyCard).toHaveBeenCalledWith(card, 5);
  });

  it('returns "learning" when classifyCard returns "learning"', async () => {
    const card = makeNameCard(7, { lastReview: "2026-05-27", reps: 1 });
    mockLoadSession.mockResolvedValue({ cards: [card], limits: {} });
    mockLoadSettings.mockReturnValue(makeSettings(3));
    mockClassifyCard.mockReturnValue("learning");

    const { result } = renderHook(() => useCardClass(7));

    await waitFor(() => {
      expect(result.current).toBe("learning");
    });
  });

  it('returns "mastered" when classifyCard returns "mastered"', async () => {
    const card = makeNameCard(25, {
      lastReview: "2026-04-01",
      reps: 3,
      scheduledDays: 30,
    });
    mockLoadSession.mockResolvedValue({ cards: [card], limits: {} });
    mockLoadSettings.mockReturnValue(makeSettings(3));
    mockClassifyCard.mockReturnValue("mastered");

    const { result } = renderHook(() => useCardClass(25));

    await waitFor(() => {
      expect(result.current).toBe("mastered");
    });
  });

  it("ignores non-name cards when looking up by id", async () => {
    // A reverse card with the same id should NOT be used; the hook explicitly
    // filters cardType === "name".
    const reverseCard = {
      id: 10,
      cardType: "reverse" as const,
      state: makeState({ lastReview: "2026-05-27", reps: 5, scheduledDays: 30 }),
    };
    mockLoadSession.mockResolvedValue({ cards: [reverseCard], limits: {} });
    mockLoadSettings.mockReturnValue(makeSettings());

    const { result } = renderHook(() => useCardClass(10));

    await waitFor(() => {
      // No name card with id=10 → locked.
      expect(result.current).toBe("locked");
    });
    expect(mockClassifyCard).not.toHaveBeenCalled();
  });
});
