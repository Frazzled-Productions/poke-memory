import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/sync/cloud", () => ({
  pushSingleCard: vi.fn(),
  isSyncSafe: vi.fn(() => true),
}));

vi.mock("@/lib/sync/persistence", () => ({
  markPushSucceeded: vi.fn(),
  markPushFailed: vi.fn(),
}));

import { pushSingleCard, isSyncSafe } from "@/lib/sync/cloud";
import { markPushSucceeded, markPushFailed } from "@/lib/sync/persistence";
import { usePerGradeSync } from "@/lib/sync/usePerGradeSync";
import type { ReviewableCard } from "@/lib/review/session";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = "00000000-0000-0000-0000-000000000000";

function makeCard(id: number): ReviewableCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default" as const,
    formSlug: null,
    displayName: `pokemon-${id}`,
    cardType: "name" as const,
    subjectKey: String(id),
    name: `pokemon-${id}`,
    spriteUrl: "",
    types: ["normal"],
    stats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    flavorText: "",
    flavorTexts: [""],
    evolutionChain: [],
    height: 1,
    weight: 1,
    baseExperience: 1,
    genus: "",
    generation: "generation-i" as const,
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: {
      stability: 1,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      fsrsState: "review" as const,
      dueDate: "2026-05-14",
      lastReview: "2026-05-13",
      firstSeen: "2026-05-12",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("usePerGradeSync — markPushSucceeded wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(isSyncSafe).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls markPushSucceeded once per debounce flush when all cards succeed", async () => {
    vi.mocked(pushSingleCard).mockResolvedValue(true);

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
      result.current.enqueueGrade(makeCard(2));
    });

    // Fire the 200 ms debounce timer and let the async drain settle.
    await act(async () => {
      vi.advanceTimersByTime(200);
      // Drain the promise chain from pushSingleCard.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pushSingleCard).toHaveBeenCalledTimes(2);
    // Only one markPushSucceeded call per flush, not per card.
    expect(vi.mocked(markPushSucceeded)).toHaveBeenCalledTimes(1);
  });

  it("calls markPushSucceeded when only some cards succeed (partial success)", async () => {
    vi.mocked(pushSingleCard)
      .mockResolvedValueOnce(true)  // card 1 succeeds
      .mockResolvedValueOnce(false); // card 2 fails

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
      result.current.enqueueGrade(makeCard(2));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    // anySucceeded is true so the timestamp must be stamped.
    expect(vi.mocked(markPushSucceeded)).toHaveBeenCalledTimes(1);
  });

  it("does not call markPushSucceeded when all cards fail", async () => {
    vi.mocked(pushSingleCard).mockResolvedValue(false);

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
  });

  it("does not enqueue or call markPushSucceeded when client is null", async () => {
    const { result } = renderHook(() => usePerGradeSync(null, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
  });

  it("does not call markPushSucceeded when the card is not sync-safe", async () => {
    vi.mocked(isSyncSafe).mockReturnValue(false);

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
  });
});

// ─── Consecutive-failure threshold tests ──────────────────────────────────────

/** Helper: simulate N all-failure drains on a single card. */
async function drainNTimes(
  enqueueGrade: (card: ReviewableCard) => void,
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    act(() => {
      enqueueGrade(makeCard(1));
    });
    // Flush the debounce timer and the async drain.
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

describe("usePerGradeSync — consecutive-failure banner (#606)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(isSyncSafe).mockReturnValue(true);
    vi.mocked(pushSingleCard).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call markPushFailed before the threshold (2 failures)", async () => {
    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    await drainNTimes(result.current.enqueueGrade, 2);

    expect(vi.mocked(markPushFailed)).not.toHaveBeenCalled();
  });

  it("calls markPushFailed exactly once when the threshold (3) is reached", async () => {
    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    await drainNTimes(result.current.enqueueGrade, 3);

    expect(vi.mocked(markPushFailed)).toHaveBeenCalledTimes(1);
    // failedCardCount should match the pending queue length (1 card).
    expect(vi.mocked(markPushFailed)).toHaveBeenCalledWith(1);
  });

  it("resets the counter and does not call markPushFailed after a success", async () => {
    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    // 2 failures — below threshold.
    await drainNTimes(result.current.enqueueGrade, 2);

    // One success — resets counter.
    vi.mocked(pushSingleCard).mockResolvedValueOnce(true);
    act(() => { result.current.enqueueGrade(makeCard(2)); });
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    // 2 more failures — still below threshold since counter was reset.
    vi.mocked(pushSingleCard).mockResolvedValue(false);
    await drainNTimes(result.current.enqueueGrade, 2);

    expect(vi.mocked(markPushFailed)).not.toHaveBeenCalled();
  });

  it("calls markPushSucceeded (not markPushFailed) when a success follows failures", async () => {
    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    // 2 failures, then a success in the same hook instance.
    await drainNTimes(result.current.enqueueGrade, 2);

    vi.mocked(pushSingleCard).mockResolvedValueOnce(true);
    act(() => { result.current.enqueueGrade(makeCard(1)); });
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(markPushFailed)).not.toHaveBeenCalled();
    expect(vi.mocked(markPushSucceeded)).toHaveBeenCalledTimes(1);
  });
});
