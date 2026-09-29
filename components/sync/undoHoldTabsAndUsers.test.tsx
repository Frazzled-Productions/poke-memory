/**
 * #2052 review: the persisted held copy is per tab and per user.
 *
 *  - Two tabs: a tab that mounts usePerGradeSync must never seed (push) or delete
 *    a copy a LIVE other tab still owns; each tab's copy has its own key.
 *  - A leftover is seeded only by the same tab (a reload ends the undo window)
 *    or once older than the longest a live hold can last.
 *  - A copy belonging to another user is never pushed under the current one.
 *
 * Two "tabs" are simulated with two hook instances that read different
 * sessionStorage tab ids at mount and share localStorage.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/sync/cloud", () => ({
  pushSingleCard: vi.fn(async () => "ok"),
  isSyncSafe: vi.fn(() => true),
}));
vi.mock("@/lib/sync/persistence", () => ({
  markPushSucceeded: vi.fn(),
  markPushFailed: vi.fn(),
  loadSyncStatus: vi.fn(() => ({ structuralSyncError: null })),
  loadPendingQueue: vi.fn(() => []),
  savePendingQueue: vi.fn(),
  clearPendingQueue: vi.fn(),
}));
vi.mock("@/lib/sync/structuralError", () => ({
  hasStructuralProbeBeenAttempted: vi.fn(() => false),
  markStructuralProbeAttempted: vi.fn(),
}));
vi.mock("@/lib/sync/gradeLogPush", () => ({
  pushGradeLogEntry: vi.fn(async () => undefined),
}));

import { pushSingleCard } from "@/lib/sync/cloud";
import { usePerGradeSync } from "@/lib/sync/usePerGradeSync";
import {
  HELD_COPY_STALE_MS,
  cardPushKey,
  getTabId,
  heldCardPushKeys,
  loadHeldCard,
  saveHeldCard,
} from "@/lib/sync/heldGrade";
import { KEY_HELD_GRADE_PREFIX, KEY_TAB_ID } from "@/lib/storage/keys";
import type { ReviewableCard } from "@/lib/review/session";

const CLIENT = {} as unknown as SupabaseClient;
const USER = "00000000-0000-0000-0000-00000000000a";
const OTHER_USER = "00000000-0000-0000-0000-00000000000b";

function makeCard(id: number): ReviewableCard {
  return {
    id,
    cardType: "name",
    subjectKey: String(id),
    locale: "en",
    state: {
      stability: 1,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      fsrsState: "review",
      dueDate: "2026-05-14",
      lastReview: "2026-05-13",
      firstSeen: "2026-05-12",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  } as unknown as ReviewableCard;
}

const pushedIds = () =>
  vi.mocked(pushSingleCard).mock.calls.map((c) => (c[2] as ReviewableCard).id);

/** Mounts the hook as a given tab (tab id is read once, at mount). */
function mountAsTab(tab: string, user: string | null = USER) {
  window.sessionStorage.setItem(KEY_TAB_ID, tab);
  return renderHook(() => usePerGradeSync(user ? CLIENT : null, user));
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("undo hold: per-tab and per-user held copies (#2052)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a second tab mounting does not push or delete a live hold of the first tab", async () => {
    const a = mountAsTab("tab-A");
    act(() => {
      a.result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    expect(loadHeldCard("tab-A")?.id).toBe(1);

    // Tab B (any signed-in mount, e.g. KnownPokemonQuiz) comes up.
    mountAsTab("tab-B");
    await advance(1000);

    expect(pushedIds()).toEqual([]);
    expect(loadHeldCard("tab-A")?.id).toBe(1);

    // Tab A can still undo, and nothing was ever pushed.
    act(() => {
      a.result.current.discardHeld();
    });
    await advance(UNDO_CAP);
    expect(pushedIds()).toEqual([]);
    expect(loadHeldCard("tab-A")).toBeNull();
  });

  it("two tabs holding at once keep separate copies; one tab's Undo leaves the other's", async () => {
    const a = mountAsTab("tab-A");
    const b = mountAsTab("tab-B");
    act(() => {
      a.result.current.enqueueGrade(makeCard(1), { hold: true });
      b.result.current.enqueueGrade(makeCard(2), { hold: true });
    });
    expect(loadHeldCard("tab-A")?.id).toBe(1);
    expect(loadHeldCard("tab-B")?.id).toBe(2);
    expect(window.localStorage.getItem(KEY_HELD_GRADE_PREFIX + "tab-A")).not.toBe(
      window.localStorage.getItem(KEY_HELD_GRADE_PREFIX + "tab-B"),
    );

    act(() => {
      a.result.current.discardHeld();
    });
    expect(loadHeldCard("tab-A")).toBeNull();
    expect(loadHeldCard("tab-B")?.id).toBe(2);
  });

  it("a stale foreign copy (older than cap + grace) is seeded and pushed", async () => {
    saveHeldCard(makeCard(5), USER, "tab-gone");
    vi.setSystemTime(Date.now() + HELD_COPY_STALE_MS + 1);

    mountAsTab("tab-B");
    await advance(250);

    expect(pushedIds()).toEqual([5]);
    expect(loadHeldCard("tab-gone")).toBeNull();
  });

  it("a foreign copy just inside the stale window is left alone", async () => {
    saveHeldCard(makeCard(5), USER, "tab-live");
    vi.setSystemTime(Date.now() + HELD_COPY_STALE_MS - 1000);

    mountAsTab("tab-B");
    await advance(250);

    expect(pushedIds()).toEqual([]);
    expect(loadHeldCard("tab-live")?.id).toBe(5);
  });

  it("a same-tab reload seeds its own leftover immediately, however fresh", async () => {
    saveHeldCard(makeCard(6), USER, "tab-A");

    mountAsTab("tab-A"); // the reloaded tab keeps its sessionStorage id
    await advance(250);

    expect(pushedIds()).toEqual([6]);
    expect(loadHeldCard("tab-A")).toBeNull();
  });

  it("another user's copy is never pushed under the current user, even from this tab or when stale", async () => {
    saveHeldCard(makeCard(7), OTHER_USER, "tab-A");
    saveHeldCard(makeCard(8), OTHER_USER, "tab-gone");
    vi.setSystemTime(Date.now() + HELD_COPY_STALE_MS + 1);

    mountAsTab("tab-A", USER);
    await advance(250);

    expect(pushedIds()).toEqual([]);
    // Left for the account-switch guard to archive / wipe, and for its owner to seed.
    expect(loadHeldCard("tab-A")?.id).toBe(7);
    expect(loadHeldCard("tab-gone")?.id).toBe(8);
  });

  it("the owning user is seeded once they sign back in", async () => {
    saveHeldCard(makeCard(7), OTHER_USER, "tab-A");

    mountAsTab("tab-A", OTHER_USER);
    await advance(250);

    expect(pushedIds()).toEqual([7]);
  });

  it("a malformed held record is discarded, not pushed", async () => {
    window.localStorage.setItem(KEY_HELD_GRADE_PREFIX + "junk", "{not json");
    window.localStorage.setItem(KEY_HELD_GRADE_PREFIX + "partial", JSON.stringify({ userId: USER }));

    mountAsTab("tab-B");
    await advance(250);

    expect(pushedIds()).toEqual([]);
    expect(window.localStorage.getItem(KEY_HELD_GRADE_PREFIX + "junk")).toBeNull();
    expect(window.localStorage.getItem(KEY_HELD_GRADE_PREFIX + "partial")).toBeNull();
  });

  it("a live own hold's record is not seeded when the client changes mid-hold, but a stale foreign one is", async () => {
    saveHeldCard(makeCard(9), USER, "tab-gone");
    vi.setSystemTime(Date.now() + HELD_COPY_STALE_MS + 1);
    window.sessionStorage.setItem(KEY_TAB_ID, "tab-A");
    const { result, rerender } = renderHook(
      ({ client }: { client: SupabaseClient }) => usePerGradeSync(client, USER),
      { initialProps: { client: CLIENT } },
    );
    await advance(250);
    expect(pushedIds()).toEqual([9]); // stale foreign seeded on first mount
    vi.mocked(pushSingleCard).mockClear();

    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    rerender({ client: {} as unknown as SupabaseClient });
    await advance(250);

    expect(pushedIds()).toEqual([]);
    expect(loadHeldCard("tab-A")?.id).toBe(1);
  });

  it("heldCardPushKeys covers a live foreign copy, ignores a stale one, and includes in-memory holds", () => {
    saveHeldCard(makeCard(3), USER, "tab-live");
    expect(heldCardPushKeys().has(cardPushKey(makeCard(3)))).toBe(true);

    vi.setSystemTime(Date.now() + HELD_COPY_STALE_MS + 1);
    expect(heldCardPushKeys().has(cardPushKey(makeCard(3)))).toBe(false);
  });

  it("getTabId is stable within a tab and different across tabs", () => {
    window.sessionStorage.clear();
    const first = getTabId();
    expect(getTabId()).toBe(first);
    window.sessionStorage.clear();
    expect(getTabId()).not.toBe(first);
  });
});

// The hold's own cap; long enough that any timer-based commit would have fired.
const UNDO_CAP = 301_000;
