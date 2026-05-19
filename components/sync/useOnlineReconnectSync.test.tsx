/**
 * Tests for useOnlineReconnectSync (#875).
 *
 * The hook listens for the browser `online` event and performs a
 * pull-then-push catch-up:
 *   1. `pullAndMerge` — brings local state up to date with cloud.
 *   2. Push reviewed cards that failed offline (mirrors useRetryPush selection).
 *
 * File lives under components/ (not lib/) because it calls renderHook, which
 * requires jsdom — the vitest jsdom project covers components/**\/*.test.tsx.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/sync/pullAndMerge", () => ({
  pullAndMerge: vi.fn(),
}));

vi.mock("@/lib/sync/cloud", () => ({
  pushSingleCard: vi.fn(),
  isSyncSafe: vi.fn(() => true),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(),
  markPushSucceeded: vi.fn(),
  loadPendingQueue: vi.fn(() => []),
  clearPendingQueue: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(),
}));

vi.mock("@/lib/review/session", () => ({
  todayString: vi.fn(() => "2026-05-17"),
}));

vi.mock("@/lib/sync/backgroundSync", () => ({
  SW_REPLAY_MESSAGE: "BACKGROUND_SYNC_REPLAY",
}));

import { pullAndMerge } from "@/lib/sync/pullAndMerge";
import { pushSingleCard, isSyncSafe } from "@/lib/sync/cloud";
import { loadSyncStatus, markPushSucceeded } from "@/lib/sync/persistence";
import { loadSession } from "@/lib/review/persistence";
import type { SyncStatus } from "@/lib/sync/persistence";
import { useOnlineReconnectSync } from "@/lib/sync/useOnlineReconnectSync";
import { SW_REPLAY_MESSAGE } from "@/lib/sync/backgroundSync";

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
      stability: lastReview ? 1 : 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: lastReview ? 1 : 0,
      reps: lastReview ? 1 : 0,
      lapses: 0,
      fsrsState: (lastReview ? "review" : "new") as "new" | "review",
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

const NO_FAILURE_STATUS: SyncStatus = {
  lastPushAt: "2026-05-17T10:00:00.000Z",
  lastPushFailed: false,
  lastPushAttemptAt: "2026-05-17T10:00:00.000Z",
  failedCardCount: 0,
  lastPullAt: null,
  lastSettingsPullAt: null,
  lastSeenResetAt: null,
};

const FAILED_STATUS: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: true,
  lastPushAttemptAt: "2026-05-17T10:00:00.000Z",
  failedCardCount: 2,
  lastPullAt: null,
  lastSettingsPullAt: null,
  lastSeenResetAt: null,
};

function fireOnline() {
  window.dispatchEvent(new Event("online"));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useOnlineReconnectSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSyncSafe).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 1. No-op when client is null (guest / superuser write-guard).
  it("does not pull or push when client is null", async () => {
    renderHook(() => useOnlineReconnectSync(null, FAKE_USER));

    act(() => fireOnline());
    await Promise.resolve();

    expect(pullAndMerge).not.toHaveBeenCalled();
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  // 2. No-op when userId is null (guest / superuser write-guard).
  it("does not pull or push when userId is null", async () => {
    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, null));

    act(() => fireOnline());
    await Promise.resolve();

    expect(pullAndMerge).not.toHaveBeenCalled();
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  // 3. Always pulls on reconnect when authenticated.
  it("calls pullAndMerge on reconnect when authenticated", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(NO_FAILURE_STATUS);
    vi.mocked(loadSession).mockResolvedValue(null);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => {
      expect(pullAndMerge).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER);
    });
  });

  // 4. When lastPushFailed is false, skips the push leg entirely.
  it("skips push when lastPushFailed is false", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(NO_FAILURE_STATUS);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => expect(pullAndMerge).toHaveBeenCalledTimes(1));
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  // 5. When pull fails, skips push (pull-before-push invariant).
  it("aborts push when pullAndMerge returns error", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("error");

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => expect(pullAndMerge).toHaveBeenCalledTimes(1));
    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(loadSyncStatus).not.toHaveBeenCalled();
  });

  // 6. When lastPushFailed is true, pushes today's reviewed cards.
  it("pushes today's reviewed cards when lastPushFailed is true and failedCardCount > 0", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);
    const todayCard = makeCard(1, "2026-05-17");  // today -> included
    const oldCard = makeCard(2, "2026-05-10");    // old -> excluded
    const newCard = makeCard(3, null);             // never reviewed -> excluded
    vi.mocked(loadSession).mockResolvedValue({ cards: [todayCard, oldCard, newCard], limits: LIMITS });
    vi.mocked(pushSingleCard).mockResolvedValue(true);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => expect(pushSingleCard).toHaveBeenCalledTimes(1));
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, todayCard);
    expect(markPushSucceeded).toHaveBeenCalledTimes(1);
  });

  // 7. Day-boundary fall-back: failedCardCount > 0 but today-filter is empty.
  it("falls back to all reviewed cards when failedCardCount > 0 but no cards reviewed today", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue({ ...FAILED_STATUS, failedCardCount: 3 });
    const yesterdayCard = makeCard(1, "2026-05-16");
    const olderCard = makeCard(2, "2026-04-01");
    vi.mocked(loadSession).mockResolvedValue({ cards: [yesterdayCard, olderCard], limits: LIMITS });
    vi.mocked(pushSingleCard).mockResolvedValue(true);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => expect(pushSingleCard).toHaveBeenCalledTimes(2));
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, yesterdayCard);
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, olderCard);
  });

  // 8. failedCardCount is null: push all reviewed cards (legacy / full-session failure).
  it("pushes all reviewed cards when failedCardCount is null", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue({ ...FAILED_STATUS, failedCardCount: null });
    const reviewed1 = makeCard(1, "2026-04-01");
    const reviewed2 = makeCard(2, "2026-05-17");
    const notReviewed = makeCard(3, null);
    vi.mocked(loadSession).mockResolvedValue({
      cards: [reviewed1, reviewed2, notReviewed],
      limits: LIMITS,
    });
    vi.mocked(pushSingleCard).mockResolvedValue(true);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => expect(pushSingleCard).toHaveBeenCalledTimes(2));
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, reviewed1);
    expect(pushSingleCard).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, reviewed2);
    expect(pushSingleCard).not.toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, notReviewed);
    expect(markPushSucceeded).toHaveBeenCalledTimes(1);
  });

  // 9. Does not call markPushSucceeded when all push attempts fail.
  it("does not call markPushSucceeded when all push attempts fail", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);
    const todayCard = makeCard(1, "2026-05-17");
    vi.mocked(loadSession).mockResolvedValue({ cards: [todayCard], limits: LIMITS });
    vi.mocked(pushSingleCard).mockResolvedValue(false);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => expect(pushSingleCard).toHaveBeenCalledTimes(1));
    expect(markPushSucceeded).not.toHaveBeenCalled();
  });

  // 10. Partial success: when some cards succeed and some fail, lastPushFailed
  //     must stay true — markPushSucceeded must NOT be called.
  it("does not call markPushSucceeded on partial push success (some cards failed)", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(FAILED_STATUS);
    const card1 = makeCard(1, "2026-05-17");
    const card2 = makeCard(2, "2026-05-17");
    vi.mocked(loadSession).mockResolvedValue({
      cards: [card1, card2],
      limits: LIMITS,
    });
    // First card succeeds, second fails — partial success.
    vi.mocked(pushSingleCard)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline());

    await waitFor(() => expect(pushSingleCard).toHaveBeenCalledTimes(2));
    // The failure signal must survive so the retry banner stays visible.
    expect(markPushSucceeded).not.toHaveBeenCalled();
  });

  // 11. In-flight guard: a second online event before the first handler completes
  //     does not start a concurrent run.
  it("ignores a second online event while a catch-up is already in flight", async () => {
    let resolvePull!: (v: "ok") => void;
    const stallPromise = new Promise<"ok">((r) => { resolvePull = r; });
    vi.mocked(pullAndMerge).mockReturnValueOnce(stallPromise);
    vi.mocked(loadSyncStatus).mockReturnValue(NO_FAILURE_STATUS);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => fireOnline()); // first fire — stalls
    act(() => fireOnline()); // second fire — should be ignored

    // Resolve the stalled pull.
    resolvePull("ok");
    await waitFor(() => expect(pullAndMerge).toHaveBeenCalledTimes(1));

    // Only one pull despite two events.
    expect(pullAndMerge).toHaveBeenCalledTimes(1);
  });

  // 12. Listener is removed on unmount — no calls after cleanup.
  it("removes the online listener on unmount", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(NO_FAILURE_STATUS);

    const { unmount } = renderHook(() =>
      useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER),
    );

    unmount();
    act(() => fireOnline());
    await Promise.resolve();

    expect(pullAndMerge).not.toHaveBeenCalled();
  });

  // ─── Background Sync SW message listener (#1054) ───────────────────────────
  //
  // When the SW fires a `sync` event while the app is open, it posts a
  // BACKGROUND_SYNC_REPLAY message to delegate the push to the running hook
  // (so the pull-before-push invariant is respected and no concurrent push
  // occurs from both the SW and the app).
  //
  // jsdom does not expose `navigator.serviceWorker`, so each test stubs it with
  // a real EventTarget so `addEventListener` / `removeEventListener` work.
});

describe("useOnlineReconnectSync — Background Sync SW message listener (#1054)", () => {
  // jsdom does not have navigator.serviceWorker; stub a real EventTarget so
  // the hook can attach its message listener.
  let swTarget: EventTarget;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSyncSafe).mockReturnValue(true);
    swTarget = new EventTarget();
    Object.defineProperty(navigator, "serviceWorker", {
      value: swTarget,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  it("responds to BACKGROUND_SYNC_REPLAY message from the SW the same way as an online event", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(NO_FAILURE_STATUS);
    vi.mocked(loadSession).mockResolvedValue(null);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      swTarget.dispatchEvent(new MessageEvent("message", {
        data: { type: SW_REPLAY_MESSAGE },
      }));
    });

    await waitFor(() => {
      expect(pullAndMerge).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER);
    });
  });

  it("ignores SW messages with unknown type", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(NO_FAILURE_STATUS);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      swTarget.dispatchEvent(new MessageEvent("message", {
        data: { type: "UNKNOWN_MESSAGE" },
      }));
    });

    await Promise.resolve();
    expect(pullAndMerge).not.toHaveBeenCalled();
  });

  it("ignores SW messages with non-object data", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(NO_FAILURE_STATUS);

    renderHook(() => useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      swTarget.dispatchEvent(new MessageEvent("message", { data: "BACKGROUND_SYNC_REPLAY" }));
    });

    await Promise.resolve();
    expect(pullAndMerge).not.toHaveBeenCalled();
  });

  it("removes the SW message listener on unmount", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");
    vi.mocked(loadSyncStatus).mockReturnValue(NO_FAILURE_STATUS);

    const { unmount } = renderHook(() =>
      useOnlineReconnectSync(FAKE_CLIENT, FAKE_USER),
    );

    unmount();

    act(() => {
      swTarget.dispatchEvent(new MessageEvent("message", {
        data: { type: SW_REPLAY_MESSAGE },
      }));
    });

    await Promise.resolve();
    expect(pullAndMerge).not.toHaveBeenCalled();
  });
});
