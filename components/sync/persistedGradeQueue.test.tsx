/**
 * Tests for the persisted pending-grade queue feature (#893).
 *
 * Covers four behavioural requirements:
 *   1. Queue persists to localStorage across a simulated remount.
 *   2. Persisted queue is preferred over the session-card heuristic on reconnect.
 *   3. Queue is cleared from localStorage after a fully successful push.
 *   4. Queue is not persisted or replayed during a superuser session (null
 *      client/userId → clearPendingQueue on every enqueueGrade call).
 *
 * File lives under components/ (not lib/) because it calls renderHook, which
 * requires jsdom - the vitest jsdom project covers components/**\/*.test.tsx.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Module mocks ──────────────────────────────────────────────────────────────
//
// We mock the persistence module for hook-level tests but need the real
// savePendingQueue / loadPendingQueue / clearPendingQueue for localStorage
// round-trip tests. Those round-trip tests import from persistence directly
// without going through the hook, so there is no conflict.

vi.mock("@/lib/sync/cloud", () => ({
  pushSingleCard: vi.fn(),
  isSyncSafe: vi.fn(() => true),
  // popStructuralErrorCode returns null by default so drainQueue does not
  // call markStructuralSyncError in tests not testing that path.
  popStructuralErrorCode: vi.fn(() => null),
}));

vi.mock("@/lib/sync/persistence", () => ({
  markPushSucceeded: vi.fn(),
  markPushFailed: vi.fn(),
  markStructuralSyncError: vi.fn(),
  savePendingQueue: vi.fn(),
  clearPendingQueue: vi.fn(),
  loadPendingQueue: vi.fn(() => []),
  // Return a status with no structural error so drainQueue does not
  // short-circuit (#1358) in tests that aren't testing that path.
  loadSyncStatus: vi.fn(() => ({
    lastPushAt: null,
    lastPushFailed: false,
    lastPushAttemptAt: null,
    failedCardCount: null,
    lastPullAt: null,
    lastSettingsPullAt: null,
    lastSeenResetAt: null,
    structuralSyncError: null,
    ownerUserId: null,
  })),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/sync/pullAndMerge", () => ({
  pullAndMerge: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(),
}));

vi.mock("@/lib/review/session", () => ({
  todayString: vi.fn(() => "2026-05-17"),
}));

import { pushSingleCard, isSyncSafe } from "@/lib/sync/cloud";
import {
  markPushSucceeded,
  markPushFailed,
  savePendingQueue,
  clearPendingQueue,
  loadPendingQueue,
  loadSyncStatus,
  saveSyncStatus,
} from "@/lib/sync/persistence";
import { pullAndMerge } from "@/lib/sync/pullAndMerge";
import { loadSession } from "@/lib/review/persistence";
import type { SyncStatus } from "@/lib/sync/persistence";
import { usePerGradeSync } from "@/lib/sync/usePerGradeSync";
import { useRetryPush } from "@/lib/sync/useRetryPush";
import { useOnlineReconnectSync } from "@/lib/sync/useOnlineReconnectSync";
import type { ReviewableCard } from "@/lib/review/session";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = "00000000-0000-0000-0000-000000000000";

const LIMITS = {
  name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
  reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
};

function makeCard(id: number, lastReview = "2026-05-17"): ReviewableCard {
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
      dueDate: "2026-05-18",
      lastReview,
      firstSeen: lastReview,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };
}

const FAILED_STATUS: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: true,
  lastPushAttemptAt: "2026-05-17T10:00:00.000Z",
  failedCardCount: 2,
  lastPullAt: null,
  lastSettingsPullAt: null,
  lastSeenResetAt: null,
  structuralSyncError: null,
  ownerUserId: null,
};

function fireOnline() {
  window.dispatchEvent(new Event("online"));
}

// ─── Part 1: usePerGradeSync - queue persistence ───────────────────────────────

describe("usePerGradeSync - persisted queue (#893)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(isSyncSafe).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls savePendingQueue after the persist debounce fires", async () => {
    vi.mocked(pushSingleCard).mockResolvedValue("failed");

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    // Persist debounce is 500 ms; advance past it.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(vi.mocked(savePendingQueue)).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 1 })]),
    );
  });

  it("calls savePendingQueue with the current queue snapshot on each burst", async () => {
    vi.mocked(pushSingleCard).mockResolvedValue("failed");

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
      result.current.enqueueGrade(makeCard(2));
      result.current.enqueueGrade(makeCard(3));
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // All three cards should be in the persisted queue.
    const savedArg = vi.mocked(savePendingQueue).mock.calls.at(-1)?.[0] as ReviewableCard[];
    expect(savedArg).toHaveLength(3);
    const ids = savedArg.map((c) => c.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
  });

  it("calls clearPendingQueue after a fully successful drain", async () => {
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    // Fire the push debounce (200 ms) and let promises settle.
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(clearPendingQueue)).toHaveBeenCalledTimes(1);
  });

  it("does not call clearPendingQueue when all pushes fail", async () => {
    vi.mocked(pushSingleCard).mockResolvedValue("failed");

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(clearPendingQueue)).not.toHaveBeenCalled();
    // savePendingQueue should be called with the remaining failed cards.
    expect(vi.mocked(savePendingQueue)).toHaveBeenCalled();
  });

  // ─── Superuser guard ─────────────────────────────────────────────────────────
  // When client/userId are null (superuser write-guard), enqueueGrade must
  // call clearPendingQueue and never savePendingQueue. This ensures a QA
  // session never leaves fake card state behind in localStorage.

  it("calls clearPendingQueue (not savePendingQueue) when client is null (superuser guard)", async () => {
    // Simulates ReviewSession.tsx passing null client when anyFlagOn is true.
    const { result } = renderHook(() => usePerGradeSync(null, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(vi.mocked(clearPendingQueue)).toHaveBeenCalled();
    expect(vi.mocked(savePendingQueue)).not.toHaveBeenCalled();
    expect(vi.mocked(pushSingleCard)).not.toHaveBeenCalled();
  });

  it("calls clearPendingQueue (not savePendingQueue) when userId is null (superuser guard)", async () => {
    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, null));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(vi.mocked(clearPendingQueue)).toHaveBeenCalled();
    expect(vi.mocked(savePendingQueue)).not.toHaveBeenCalled();
    expect(vi.mocked(pushSingleCard)).not.toHaveBeenCalled();
  });

  // ─── Persist-timer cleanup on unmount ────────────────────────────────────────
  // When the component unmounts with a pending persist debounce, the timer must
  // be flushed synchronously (writing the current snapshot) rather than dropped
  // (#893 timer cleanup). This prevents the case where a tab force-kill after
  // unmount loses the last snapshot.

  it("flushes the persist debounce synchronously on unmount (#893 timer cleanup)", async () => {
    vi.mocked(pushSingleCard).mockResolvedValue("failed");

    const { result, unmount } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    // Do NOT advance timers - the persist debounce has not fired yet.
    // Unmounting should flush it synchronously.
    act(() => {
      unmount();
    });

    // savePendingQueue must have been called on unmount with card 1.
    expect(vi.mocked(savePendingQueue)).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 1 })]),
    );
  });

  it("does not call savePendingQueue on unmount when no persist timer is pending", async () => {
    vi.mocked(pushSingleCard).mockResolvedValue("failed");

    const { unmount } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    // Unmount without enqueuing anything.
    act(() => {
      unmount();
    });

    // No timer was pending, so no flush should have occurred.
    expect(vi.mocked(savePendingQueue)).not.toHaveBeenCalled();
  });
});

// ─── Part 2: useRetryPush - persisted queue preferred over heuristic ───────────

describe("useRetryPush - prefers persisted queue when non-empty (#893)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes persisted-queue cards instead of the session-card heuristic", async () => {
    // Persisted queue has card 42; session has card 99. Only card 42 should be pushed.
    const persistedCard = makeCard(42);
    const sessionCard = makeCard(99);
    vi.mocked(loadPendingQueue).mockReturnValue([persistedCard]);
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);
    vi.mocked(loadSession).mockResolvedValue({ cards: [sessionCard], limits: LIMITS });
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("success");
    });

    expect(pushSingleCard).toHaveBeenCalledTimes(1);
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, persistedCard);
    expect(pushSingleCard).not.toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, sessionCard);
  });

  it("calls clearPendingQueue after all persisted-queue cards succeed", async () => {
    const persistedCard = makeCard(1);
    vi.mocked(loadPendingQueue).mockReturnValue([persistedCard]);
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("success");
    });

    expect(vi.mocked(clearPendingQueue)).toHaveBeenCalledTimes(1);
    // The failed flag must be cleared in SyncStatus too.
    const saved = vi.mocked(saveSyncStatus).mock.calls.at(-1)?.[0];
    expect(saved?.lastPushFailed).toBe(false);
  });

  it("does not call clearPendingQueue when some persisted-queue cards fail", async () => {
    const persistedCard1 = makeCard(1);
    const persistedCard2 = makeCard(2);
    vi.mocked(loadPendingQueue).mockReturnValue([persistedCard1, persistedCard2]);
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);
    vi.mocked(pushSingleCard)
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("failed");

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("error");
    });

    expect(vi.mocked(clearPendingQueue)).not.toHaveBeenCalled();
  });

  it("slims the persisted queue to failed cards only on partial success (#893)", async () => {
    // Card 1 succeeds, card 2 fails. Only card 2 should remain in the persisted queue.
    const persistedCard1 = makeCard(1);
    const persistedCard2 = makeCard(2);
    vi.mocked(loadPendingQueue).mockReturnValue([persistedCard1, persistedCard2]);
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);
    vi.mocked(pushSingleCard)
      .mockResolvedValueOnce("ok")      // card 1 succeeds
      .mockResolvedValueOnce("failed"); // card 2 fails

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("error");
    });

    // savePendingQueue must be called with only the failed card (card 2).
    expect(vi.mocked(savePendingQueue)).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 2 })]),
    );
    const savedArg = vi.mocked(savePendingQueue).mock.calls.at(-1)?.[0] as ReviewableCard[];
    expect(savedArg).toHaveLength(1);
    expect(savedArg[0].id).toBe(2);
  });

  it("does not abandon a non-empty persisted queue when failedCardCount is 0 (#893 defensive guard)", async () => {
    // failedCardCount === 0 normally triggers a no-op early exit. When the
    // persisted queue is non-empty those cards must still be pushed.
    const persistedCard = makeCard(5);
    vi.mocked(loadPendingQueue).mockReturnValue([persistedCard]);
    vi.mocked(loadSyncStatus).mockReturnValue({ ...FAILED_STATUS, failedCardCount: 0 });
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("success");
    });

    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, persistedCard);
  });

  it("falls back to the session-card heuristic when the persisted queue is empty", async () => {
    // Empty persisted queue - hook must use the heuristic.
    vi.mocked(loadPendingQueue).mockReturnValue([]);
    vi.mocked(loadSyncStatus).mockReturnValue({ ...FAILED_STATUS, failedCardCount: 1 });
    const todayCard = makeCard(7, "2026-05-17");
    vi.mocked(loadSession).mockResolvedValue({ cards: [todayCard], limits: LIMITS });
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("success");
    });

    // Should have gone through the heuristic path and pushed today's card.
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, todayCard);
  });
});

// ─── Part 3: useOnlineReconnectSync - persisted queue preferred ────────────────

describe("useOnlineReconnectSync - prefers persisted queue when non-empty (#893)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSyncSafe).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pushes persisted-queue cards instead of the session-card heuristic", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);

    const persistedCard = makeCard(42);
    const sessionCard = makeCard(99, "2026-05-17");
    vi.mocked(loadPendingQueue).mockReturnValue([persistedCard]);
    vi.mocked(loadSession).mockResolvedValue({ cards: [sessionCard], limits: LIMITS });
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => {
      expect(pushSingleCard).toHaveBeenCalledTimes(1);
    });

    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, persistedCard);
    expect(pushSingleCard).not.toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, sessionCard);
  });

  it("calls clearPendingQueue and markPushSucceeded when all persisted-queue cards succeed", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);

    const persistedCard = makeCard(1);
    vi.mocked(loadPendingQueue).mockReturnValue([persistedCard]);
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => {
      expect(markPushSucceeded).toHaveBeenCalledTimes(1);
    });

    expect(vi.mocked(clearPendingQueue)).toHaveBeenCalledTimes(1);
  });

  it("does not call markPushSucceeded when some persisted-queue cards fail", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);

    const persistedCard1 = makeCard(1);
    const persistedCard2 = makeCard(2);
    vi.mocked(loadPendingQueue).mockReturnValue([persistedCard1, persistedCard2]);
    vi.mocked(pushSingleCard)
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("failed");

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => {
      expect(pushSingleCard).toHaveBeenCalledTimes(2);
    });

    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
    expect(vi.mocked(clearPendingQueue)).not.toHaveBeenCalled();
  });

  it("slims the persisted queue to failed cards only on partial success (#893)", async () => {
    // Card 1 succeeds, card 2 fails. Only card 2 should remain in the queue.
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);

    const persistedCard1 = makeCard(1);
    const persistedCard2 = makeCard(2);
    vi.mocked(loadPendingQueue).mockReturnValue([persistedCard1, persistedCard2]);
    vi.mocked(pushSingleCard)
      .mockResolvedValueOnce("ok")      // card 1 succeeds
      .mockResolvedValueOnce("failed"); // card 2 fails

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => {
      expect(pushSingleCard).toHaveBeenCalledTimes(2);
    });

    // savePendingQueue must be called with only the failed card (card 2).
    expect(vi.mocked(savePendingQueue)).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 2 })]),
    );
    const savedArg = vi.mocked(savePendingQueue).mock.calls.at(-1)?.[0] as ReviewableCard[];
    expect(savedArg).toHaveLength(1);
    expect(savedArg[0].id).toBe(2);
    // Success flag must not be set and the full queue must not be cleared.
    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
    expect(vi.mocked(clearPendingQueue)).not.toHaveBeenCalled();
  });

  it("falls back to the session-card heuristic when the persisted queue is empty", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue({ ...FAILED_STATUS, failedCardCount: 1 });
    vi.mocked(loadPendingQueue).mockReturnValue([]);

    const todayCard = makeCard(7, "2026-05-17");
    vi.mocked(loadSession).mockResolvedValue({ cards: [todayCard], limits: LIMITS });
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => {
      expect(pushSingleCard).toHaveBeenCalledTimes(1);
    });

    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, todayCard);
  });

  // Superuser guard: when client/userId are null, nothing is pushed - including
  // persisted-queue cards. The guard is enforced at the top of handleOnline
  // (not here in the hook; OnlineReconnectSync.tsx passes null when superuser),
  // so this test validates the contract the hook exposes to its call site.
  it("does not replay the persisted queue when client is null (superuser guard)", async () => {
    vi.mocked(loadPendingQueue).mockReturnValue([makeCard(42)]);

    renderHook(() => useOnlineReconnectSync(null, FAKE_USER));

    act(() => fireOnline());
    await Promise.resolve();

    expect(pullAndMerge).not.toHaveBeenCalled();
    expect(pushSingleCard).not.toHaveBeenCalled();
  });
});

// ─── Part 4: usePerGradeSync - mount rehydration (F2 / #1856) ─────────────────
//
// A force-killed tab leaves a non-empty persisted queue with lastPushFailed=false.
// Without rehydration the first successful drain in the new session calls
// clearPendingQueue() and silently discards those grades.

describe("usePerGradeSync - mount rehydration from persisted queue (F2 / #1856)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(isSyncSafe).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds the in-memory queue from the persisted queue on mount when signed in", async () => {
    // Persisted queue has one card from a previous (force-killed) session.
    const orphanCard = makeCard(77);
    vi.mocked(loadPendingQueue).mockReturnValue([orphanCard]);
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    // Trigger the push debounce to drain the seeded queue.
    await act(async () => {
      // Enqueue a fresh card to arm the push timer.
      result.current.enqueueGrade(makeCard(88));
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both the orphan (77) and the new card (88) should have been pushed.
    const pushed = vi.mocked(pushSingleCard).mock.calls.map(([, , c]) => (c as ReviewableCard).id);
    expect(pushed).toContain(77);
    expect(pushed).toContain(88);
  });

  it("does not seed from the persisted queue when client is null (guest / superuser)", () => {
    const orphanCard = makeCard(77);
    vi.mocked(loadPendingQueue).mockReturnValue([orphanCard]);

    // Mount with null client - rehydration must be skipped entirely.
    renderHook(() => usePerGradeSync(null, FAKE_USER));

    // loadPendingQueue may be called during the seed effect; but since client
    // is null the effect should exit before doing anything with the result.
    // We verify this by checking pushSingleCard was never called.
    act(() => { vi.advanceTimersByTime(500); });

    expect(vi.mocked(pushSingleCard)).not.toHaveBeenCalled();
  });

  it("evicts a 23514-rejected card from the queue (does not retry forever) (F23 / #1856)", async () => {
    vi.mocked(loadPendingQueue).mockReturnValue([]);
    // First push returns rejected; second (re-enqueue) would return ok.
    vi.mocked(pushSingleCard).mockResolvedValue("rejected");

    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    // After a rejected drain, the card should be evicted: the queue is empty
    // so clearPendingQueue (not savePendingQueue) should have been called.
    expect(vi.mocked(clearPendingQueue)).toHaveBeenCalled();
    // The banner (markPushFailed) must NOT have been set for a rejection.
    expect(vi.mocked(markPushFailed)).not.toHaveBeenCalled();
  });
});
