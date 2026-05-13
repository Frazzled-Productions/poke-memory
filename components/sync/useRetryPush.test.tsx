import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useRetryPush } from "@/lib/sync/useRetryPush";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/sync/cloud", () => ({
  pushSingleCard: vi.fn(),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(),
}));

vi.mock("@/lib/review/session", () => ({
  todayString: vi.fn(() => "2026-05-13"),
}));

import { pushSingleCard } from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { loadSession } from "@/lib/review/persistence";
import type { SyncStatus } from "@/lib/sync/persistence";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = "00000000-0000-0000-0000-000000000000";

const LIMITS = {
  name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
  reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
};

function makeCard(id: number, lastReview: string | null) {
  return {
    id,
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
      stability: lastReview ? 1 : 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: lastReview ? 1 : 0,
      reps: lastReview ? 1 : 0,
      lapses: 0,
      fsrsState: (lastReview ? "review" : "new") as "new" | "review",
      dueDate: "2026-05-14",
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
  lastPushAttemptAt: "2026-05-13T10:00:00.000Z",
  failedCardCount: 2,
  lastPullAt: null,
};

const OK_STATUS: SyncStatus = {
  lastPushAt: "2026-05-13T10:00:00.000Z",
  lastPushFailed: false,
  lastPushAttemptAt: "2026-05-13T10:00:00.000Z",
  failedCardCount: 0,
  lastPullAt: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useRetryPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. No-op when lastPushFailed is false
  it("is a no-op when lastPushFailed is false", () => {
    vi.mocked(loadSyncStatus).mockReturnValue(OK_STATUS);
    vi.mocked(loadSession).mockReturnValue(null);

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(saveSyncStatus).not.toHaveBeenCalled();
    expect(result.current.retryState).toBe("idle");
  });

  // 2a. No-op when client is null
  it("is a no-op when client is null", () => {
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);
    vi.mocked(loadSession).mockReturnValue(null);

    const { result } = renderHook(() => useRetryPush(null, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(result.current.retryState).toBe("idle");
  });

  // 2b. No-op when userId is null
  it("is a no-op when userId is null", () => {
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);
    vi.mocked(loadSession).mockReturnValue(null);

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, null));

    act(() => {
      result.current.retryNow();
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(result.current.retryState).toBe("idle");
  });

  // 3. Pushes today's reviewed cards and clears lastPushFailed on all-success
  it("pushes today's reviewed cards and clears lastPushFailed on all-success", async () => {
    // failedCardCount > 0 → push only today's cards
    vi.mocked(loadSyncStatus).mockReturnValue({
      ...FAILED_STATUS,
      failedCardCount: 1,
    });
    const todayCard = makeCard(1, "2026-05-13"); // matches todayString mock → included
    const oldCard = makeCard(2, "2026-05-10");    // older date → excluded
    const newCard = makeCard(3, null);             // never reviewed → excluded
    vi.mocked(loadSession).mockReturnValue({ cards: [todayCard, oldCard, newCard], limits: LIMITS });
    vi.mocked(pushSingleCard).mockResolvedValue(true);

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("success");
    });

    // Only the today card should have been pushed.
    expect(pushSingleCard).toHaveBeenCalledTimes(1);
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, todayCard);

    // SyncStatus must be cleared.
    const saved = vi.mocked(saveSyncStatus).mock.calls.at(-1)?.[0];
    expect(saved).toMatchObject({
      lastPushFailed: false,
      failedCardCount: 0,
    });
    expect(saved?.lastPushAt).toBeTruthy();
  });

  // 4. Leaves lastPushFailed true when at least one push returns false
  it("leaves lastPushFailed true when at least one push returns false", async () => {
    vi.mocked(loadSyncStatus).mockReturnValue({
      ...FAILED_STATUS,
      failedCardCount: 2,
    });
    const card1 = makeCard(1, "2026-05-13");
    const card2 = makeCard(2, "2026-05-13");
    vi.mocked(loadSession).mockReturnValue({ cards: [card1, card2], limits: LIMITS });
    // First card succeeds, second fails.
    vi.mocked(pushSingleCard)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("error");
    });

    // The failure-path saveSyncStatus call re-reads the latest sync status and
    // only updates lastPushAttemptAt — lastPushFailed: true / failedCardCount: 2
    // are preserved from whatever the latest read returned.
    expect(vi.mocked(saveSyncStatus)).toHaveBeenCalled();
    const lastSaved = vi.mocked(saveSyncStatus).mock.calls.at(-1)?.[0];
    expect(lastSaved?.lastPushFailed).toBe(true);
    expect(lastSaved?.failedCardCount).toBe(2);
  });

  // 6. Day-boundary fall-back: positive failedCardCount but today-filter is empty.
  it("falls back to all reviewed cards when failedCardCount > 0 but no cards were reviewed today", async () => {
    // Beacon failed yesterday at 23:59; user returns the next day. The
    // today-filter matches nothing — we must NOT silently clear the failure.
    vi.mocked(loadSyncStatus).mockReturnValue({
      ...FAILED_STATUS,
      failedCardCount: 3,
    });
    const yesterday = makeCard(1, "2026-05-12");
    const older = makeCard(2, "2026-04-01");
    const fresh = makeCard(3, null);
    vi.mocked(loadSession).mockReturnValue({
      cards: [yesterday, older, fresh],
      limits: LIMITS,
    });
    vi.mocked(pushSingleCard).mockResolvedValue(true);

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("success");
    });

    // Both reviewed cards must have been pushed via the fall-back path.
    expect(pushSingleCard).toHaveBeenCalledTimes(2);
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, yesterday);
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, older);
    expect(pushSingleCard).not.toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, fresh);
  });

  // 7. Concurrent lastPullAt update: a background pull lands while a retry is
  //    in flight. The final save must use the freshly-pulled lastPullAt, not
  //    the snapshot from retryNow() entry.
  it("preserves a lastPullAt update that lands during the retry", async () => {
    const initialStatus = { ...FAILED_STATUS, failedCardCount: 1, lastPullAt: "2026-05-13T09:00:00.000Z" };
    const updatedStatus = { ...initialStatus, lastPullAt: "2026-05-13T11:00:00.000Z" };
    // First read at retryNow() entry, second read inside clearFailedFlag after pushes.
    vi.mocked(loadSyncStatus)
      .mockReturnValueOnce(initialStatus)
      .mockReturnValue(updatedStatus);
    const card = makeCard(1, "2026-05-13");
    vi.mocked(loadSession).mockReturnValue({ cards: [card], limits: LIMITS });
    vi.mocked(pushSingleCard).mockResolvedValue(true);

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("success");
    });

    const saved = vi.mocked(saveSyncStatus).mock.calls.at(-1)?.[0];
    expect(saved?.lastPullAt).toBe("2026-05-13T11:00:00.000Z");
    expect(saved?.lastPushFailed).toBe(false);
  });

  // 5. failedCardCount === null: pushes all reviewed cards (any lastReview !== null)
  it("pushes all reviewed cards when failedCardCount is null (legacy / full-session failure)", async () => {
    vi.mocked(loadSyncStatus).mockReturnValue({
      ...FAILED_STATUS,
      failedCardCount: null,
    });
    const reviewedOld = makeCard(1, "2026-04-01");
    const reviewedToday = makeCard(2, "2026-05-13");
    const notReviewed = makeCard(3, null);
    vi.mocked(loadSession).mockReturnValue({
      cards: [reviewedOld, reviewedToday, notReviewed],
      limits: LIMITS,
    });
    vi.mocked(pushSingleCard).mockResolvedValue(true);

    const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.retryNow();
    });

    await waitFor(() => {
      expect(result.current.retryState).toBe("success");
    });

    // Both reviewed cards pushed; new card skipped.
    expect(pushSingleCard).toHaveBeenCalledTimes(2);
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, reviewedOld);
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, reviewedToday);
    expect(pushSingleCard).not.toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, notReviewed);

    const saved = vi.mocked(saveSyncStatus).mock.calls.at(-1)?.[0];
    expect(saved).toMatchObject({
      lastPushFailed: false,
      failedCardCount: 0,
    });
  });

  // Auto-reset: success state reverts to idle after 3 seconds.
  // Uses fake timers locally; real timers restored in afterEach.
  describe("auto-reset after 3 s", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-resets from success to idle after 3 s", async () => {
      vi.mocked(loadSyncStatus).mockReturnValue({
        ...FAILED_STATUS,
        failedCardCount: 0,
      });
      vi.mocked(loadSession).mockReturnValue(null);

      const { result } = renderHook(() => useRetryPush(FAKE_CLIENT, FAKE_USER));

      act(() => {
        result.current.retryNow();
      });

      // failedCardCount === 0 goes through the synchronous success path.
      expect(result.current.retryState).toBe("success");

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.retryState).toBe("idle");
    });
  });
});
