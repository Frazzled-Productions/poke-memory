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
  // loadSyncStatus returns no structural error by default so drainQueue does
  // not short-circuit in most tests. Individual tests can override as needed.
  loadSyncStatus: vi.fn(() => ({
    lastPushAt: null,
    lastPushFailed: false,
    lastPushAttemptAt: null,
    failedCardCount: null,
    lastPullAt: null,
    lastSettingsPullAt: null,
    lastSeenResetAt: null,
    structuralSyncError: null,
  })),
  savePendingQueue: vi.fn(),
  clearPendingQueue: vi.fn(),
}));

vi.mock("@/lib/sync/structuralError", () => ({
  hasStructuralProbeBeenAttempted: vi.fn(() => false),
  markStructuralProbeAttempted: vi.fn(),
  resetStructuralProbe: vi.fn(),
  markStructuralSyncError: vi.fn(),
  clearStructuralSyncError: vi.fn(),
  getStructuralSyncError: vi.fn(() => null),
}));

import { pushSingleCard, isSyncSafe } from "@/lib/sync/cloud";
import { markPushSucceeded, markPushFailed, loadSyncStatus } from "@/lib/sync/persistence";
import { hasStructuralProbeBeenAttempted, markStructuralProbeAttempted } from "@/lib/sync/structuralError";
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

  it("fires markPushFailed exactly once even after 5 consecutive failures (not on 4th or 5th)", async () => {
    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    // 5 all-failure drains — threshold is 3, so markPushFailed should fire only
    // on drain 3 (the === transition), not on drains 4 or 5.
    await drainNTimes(result.current.enqueueGrade, 5);

    expect(vi.mocked(markPushFailed)).toHaveBeenCalledTimes(1);
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

// ─── Superuser write-guard (#754) ─────────────────────────────────────────────
//
// ReviewSession.tsx passes null client/userId to usePerGradeSync when
// anyFlagOn is true (the superuser write-guard). These tests verify that the
// hook's null short-circuit actually suppresses every cloud-write path, so a
// future refactor cannot silently re-enable writes during a QA session.

describe("usePerGradeSync — superuser write-guard (null client/userId)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(isSyncSafe).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call pushSingleCard when ReviewSession passes null client (superuser guarded)", async () => {
    // Simulates ReviewSession.tsx: syncClient = null when anyFlagOn is true.
    const { result } = renderHook(() => usePerGradeSync(null, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("does not call pushSingleCard when ReviewSession passes null userId (superuser guarded)", async () => {
    // Simulates ReviewSession.tsx: syncUserId = null when anyFlagOn is true.
    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, null));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("does not call pushSingleCard when both client and userId are null (superuser guarded)", async () => {
    // The canonical superuser-guarded call: both are null simultaneously.
    const { result } = renderHook(() => usePerGradeSync(null, null));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
      result.current.enqueueGrade(makeCard(2));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
    expect(vi.mocked(markPushFailed)).not.toHaveBeenCalled();
  });
});

// ─── Structural-error hook-integration tests (#1358 FIX 5) ───────────────────
//
// These tests verify the hook-level wiring for structural errors — the paths
// between drainQueue and the structuralError.ts / persistence.ts markers. The
// raw function behaviour (markStructuralSyncError firing) is covered in
// cloud.test.ts; these tests cover the hook's short-circuit and probe logic.

describe("usePerGradeSync — structural error: drain marks structural immediately and persists queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(isSyncSafe).mockReturnValue(true);
    // Default: no structural error already set.
    vi.mocked(loadSyncStatus).mockReturnValue({
      lastPushAt: null,
      lastPushFailed: false,
      lastPushAttemptAt: null,
      failedCardCount: null,
      lastPullAt: null,
      lastSettingsPullAt: null,
      lastSeenResetAt: null,
      structuralSyncError: null,
    });
    vi.mocked(hasStructuralProbeBeenAttempted).mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("when a push causes a structural error, drain persists the queue and does NOT call markPushSucceeded", async () => {
    // pushSingleCard returns false (structural error side-effect already recorded
    // in cloud.ts; here we simulate loadSyncStatus returning the structural error
    // after the push, which is what the hook checks).
    vi.mocked(pushSingleCard).mockResolvedValue(false);
    // After the push, structuralSyncError is now set (simulating markStructuralSyncError
    // having been called by cloud.ts during the push).
    vi.mocked(loadSyncStatus)
      .mockReturnValueOnce({ lastPushAt: null, lastPushFailed: false, lastPushAttemptAt: null, failedCardCount: null, lastPullAt: null, lastSettingsPullAt: null, lastSeenResetAt: null, structuralSyncError: null })  // first call: pre-push check
      .mockReturnValue({ lastPushAt: null, lastPushFailed: true, lastPushAttemptAt: null, failedCardCount: null, lastPullAt: null, lastSettingsPullAt: null, lastSeenResetAt: null, structuralSyncError: "42P10" }); // post-push check

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => { result.current.enqueueGrade(makeCard(1)); });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The queue should be persisted (grades survive until deploy fix).
    const { savePendingQueue } = await import("@/lib/sync/persistence");
    expect(vi.mocked(savePendingQueue)).toHaveBeenCalled();
    // Success path must NOT be reached on a structural error.
    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
  });

  it("when structuralSyncError is already set and probe not attempted, drain allows ONE probe attempt", async () => {
    // Structural error already in persisted status — but probe not yet attempted.
    vi.mocked(loadSyncStatus).mockReturnValue({
      lastPushAt: null,
      lastPushFailed: true,
      lastPushAttemptAt: null,
      failedCardCount: null,
      lastPullAt: null,
      lastSettingsPullAt: null,
      lastSeenResetAt: null,
      structuralSyncError: "42P10",
    });
    vi.mocked(hasStructuralProbeBeenAttempted).mockReturnValue(false);
    vi.mocked(pushSingleCard).mockResolvedValue(true); // probe succeeds!

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => { result.current.enqueueGrade(makeCard(1)); });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The probe was attempted — markStructuralProbeAttempted should have been called.
    expect(vi.mocked(markStructuralProbeAttempted)).toHaveBeenCalledTimes(1);
    // The push was attempted (probe runs).
    expect(pushSingleCard).toHaveBeenCalledTimes(1);
    // On probe success, markPushSucceeded is called (clear the error banner).
    expect(vi.mocked(markPushSucceeded)).toHaveBeenCalledTimes(1);
  });

  it("when structuralSyncError is set AND probe already attempted, drain short-circuits (no push)", async () => {
    vi.mocked(loadSyncStatus).mockReturnValue({
      lastPushAt: null,
      lastPushFailed: true,
      lastPushAttemptAt: null,
      failedCardCount: null,
      lastPullAt: null,
      lastSettingsPullAt: null,
      lastSeenResetAt: null,
      structuralSyncError: "42P10",
    });
    // Probe already attempted this session.
    vi.mocked(hasStructuralProbeBeenAttempted).mockReturnValue(true);

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => { result.current.enqueueGrade(makeCard(1)); });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Short-circuits — pushSingleCard must NOT be called.
    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
    expect(vi.mocked(markPushFailed)).not.toHaveBeenCalled();
  });
});
