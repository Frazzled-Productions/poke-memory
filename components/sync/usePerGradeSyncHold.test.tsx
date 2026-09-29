/**
 * #2052: the undo hold in usePerGradeSync. An undoable grade sits in a separate
 * slot, is never pushed while undoable, and is committed (queue + grade-log
 * push + undo expiry) by the documented triggers. Hook tests live under
 * components/ (jsdom project).
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

import { pushSingleCard, isSyncSafe } from "@/lib/sync/cloud";
import { savePendingQueue, clearPendingQueue } from "@/lib/sync/persistence";
import { pushGradeLogEntry } from "@/lib/sync/gradeLogPush";
import { loadHeldCard, saveHeldCard, isCardPushHeld, cardPushKey, getTabId } from "@/lib/sync/heldGrade";
import { loadPendingQueue } from "@/lib/sync/persistence";
import { KEY_HELD_GRADE_PREFIX } from "@/lib/storage/keys";
import {
  usePerGradeSync,
  UNDO_HOLD_HIDDEN_GRACE_MS,
  UNDO_HOLD_MAX_MS,
} from "@/lib/sync/usePerGradeSync";
import { isCloudPushHeld, type GradeLogEntry } from "@/lib/gradelog/persistence";
import type { ReviewableCard } from "@/lib/review/session";

const CLIENT = {} as unknown as SupabaseClient;
const TAB = getTabId();
const USER = "00000000-0000-0000-0000-000000000000";

function makeCard(id: number, stability = 1): ReviewableCard {
  return {
    id,
    cardType: "name",
    subjectKey: String(id),
    state: {
      stability,
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

function makeEntry(occurredAt: number): GradeLogEntry {
  return { date: "2026-05-13", grade: 4, cardType: "name", occurredAt, subjectKey: "1" };
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

const pushed = () => vi.mocked(pushSingleCard).mock.calls.map((c) => c[2] as ReviewableCard);

describe("usePerGradeSync - undo hold (#2052)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSyncSafe).mockReturnValue(true);
    vi.mocked(loadPendingQueue).mockReturnValue([]);
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    setVisibility("visible");
    vi.useRealTimers();
  });

  it("does not push a held grade, even after the 200 ms drain window", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("returns a hold token, and null when nothing is held", () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    let held: number | null = null;
    let plain: number | null = 99;
    act(() => {
      held = result.current.enqueueGrade(makeCard(1), { hold: true });
      plain = result.current.enqueueGrade(makeCard(2));
    });
    expect(typeof held).toBe("number");
    expect(plain).toBeNull();
  });

  it("the default (non-hold) path still pushes on the 200 ms debounce (KnownPokemonQuiz)", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      result.current.enqueueGrade(makeCard(1));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushed().map((c) => c.id)).toEqual([1]);
  });

  it("persists the held card under its OWN key, never in the shared pending queue or its IDB mirror", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    const held = makeCard(1);
    act(() => {
      result.current.enqueueGrade(held, { hold: true });
    });
    // Written straight away (no debounce), so a kill right after grading is safe.
    expect(loadHeldCard(TAB)).toEqual(held);
    expect(isCardPushHeld(cardPushKey(held))).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    // The shared queue (read by pushWithFallback and the SW mirror) never sees it.
    expect(savePendingQueue).not.toHaveBeenCalled();
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("discard: never pushed, and its persisted copy and in-memory hold are dropped", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    const held = makeCard(1);
    act(() => {
      result.current.enqueueGrade(held, { hold: true });
    });
    act(() => {
      result.current.discardHeld();
    });
    expect(loadHeldCard(TAB)).toBeNull();
    expect(window.localStorage.getItem(KEY_HELD_GRADE_PREFIX + TAB)).toBeNull();
    expect(isCardPushHeld(cardPushKey(held))).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_HOLD_MAX_MS + 1000);
    });
    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(pushGradeLogEntry).not.toHaveBeenCalled();
    expect(savePendingQueue).not.toHaveBeenCalled();
  });

  it("an earlier queued state of the same card survives hold-then-discard", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    const earlier = makeCard(1, 5);
    act(() => {
      result.current.enqueueGrade(earlier); // committed, drain pending
      result.current.enqueueGrade(makeCard(1, 9), { hold: true });
      result.current.discardHeld();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushed()).toEqual([earlier]);
  });

  it("discard leaves an earlier queued card (and its persisted queue) untouched", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      result.current.enqueueGrade(makeCard(2));
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    vi.mocked(savePendingQueue).mockClear();
    act(() => {
      result.current.discardHeld();
    });
    expect(savePendingQueue).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushed().map((c) => c.id)).toEqual([2]);
  });

  it("the next grade commits the previous hold, then holds itself", async () => {
    const onCommitted = vi.fn();
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    let first: number | null = null;
    act(() => {
      first = result.current.enqueueGrade(makeCard(1), { hold: true });
      result.current.enqueueGrade(makeCard(2), { hold: true });
    });
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onCommitted).toHaveBeenCalledWith(first);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    // Only the first grade was committed and pushed; the second is still held.
    expect(pushed().map((c) => c.id)).toEqual([1]);
  });

  it("commit pushes the attached grade-log entry and releases the hold", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    const entry = makeEntry(111);
    let token: number | null = null;
    let live = false;
    act(() => {
      token = result.current.enqueueGrade(makeCard(1), { hold: true });
      live = result.current.attachHeldGradeLog(token!, entry);
    });
    expect(live).toBe(true);
    expect(pushGradeLogEntry).not.toHaveBeenCalled();
    act(() => {
      result.current.enqueueGrade(makeCard(2), { hold: true });
    });
    expect(pushGradeLogEntry).toHaveBeenCalledWith(CLIENT, USER, entry);
    expect(isCloudPushHeld(111)).toBe(false);
  });

  it("attaching to an already-committed hold pushes the entry immediately and reports undo expired", () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    let live = true;
    act(() => {
      const t = result.current.enqueueGrade(makeCard(1), { hold: true });
      result.current.enqueueGrade(makeCard(2), { hold: true }); // commits t
      live = result.current.attachHeldGradeLog(t!, makeEntry(222));
    });
    expect(live).toBe(false);
    expect(pushGradeLogEntry).toHaveBeenCalledWith(CLIENT, USER, makeEntry(222));
  });

  it("an in-step grade holds only its grade-log leg: no card push, entry pushed at commit", async () => {
    vi.mocked(isSyncSafe).mockReturnValue(false);
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    const entry = makeEntry(333);
    act(() => {
      const t = result.current.enqueueGrade(makeCard(1), { hold: true });
      result.current.attachHeldGradeLog(t!, entry);
    });
    act(() => {
      result.current.flushPending(true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("an in-step grade that is undone never pushes its grade-log entry", async () => {
    vi.mocked(isSyncSafe).mockReturnValue(false);
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      const t = result.current.enqueueGrade(makeCard(1), { hold: true });
      result.current.attachHeldGradeLog(t!, makeEntry(444));
      result.current.discardHeld();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_HOLD_MAX_MS + 1000);
    });
    expect(pushGradeLogEntry).not.toHaveBeenCalled();
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("flushPending(false) reports only committed cards and leaves the hold alone", () => {
    const onCommitted = vi.fn();
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    const held = makeCard(1);
    act(() => {
      result.current.enqueueGrade(held, { hold: true });
    });
    const snap = result.current.flushPending(false);
    expect(snap.cards).toEqual([]);
    expect(snap.gradeLog).toEqual([]);
    expect(loadHeldCard(TAB)).toEqual(held);
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("flushPending(true) (pagehide) commits: card in the queue, entry handed to the beacon, not fetched", () => {
    const onCommitted = vi.fn();
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    const held = makeCard(1);
    const entry = makeEntry(555);
    act(() => {
      const t = result.current.enqueueGrade(held, { hold: true });
      result.current.attachHeldGradeLog(t!, entry);
    });
    let snap = { cards: [] as ReviewableCard[], gradeLog: [] as GradeLogEntry[] };
    act(() => {
      snap = result.current.flushPending(true);
    });
    expect(snap.cards).toEqual([held]);
    expect(snap.gradeLog).toEqual([entry]);
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(pushGradeLogEntry).not.toHaveBeenCalled();
    expect(isCloudPushHeld(555)).toBe(false);
    // Final teardown path: no drain or persist is scheduled, and the held copy is gone.
    expect(loadHeldCard(TAB)).toBeNull();
    expect(savePendingQueue).not.toHaveBeenCalled();
  });

  it("hidden for the grace period commits and expires undo", async () => {
    const onCommitted = vi.fn();
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    act(() => setVisibility("hidden"));
    // The held copy was written at grade time; hiding must not touch the queue.
    expect(loadHeldCard(TAB)?.id).toBe(1);
    expect(savePendingQueue).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_HOLD_HIDDEN_GRACE_MS - 1);
    });
    expect(onCommitted).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onCommitted).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushed().map((c) => c.id)).toEqual([1]);
  });

  it("becoming visible again cancels the hidden-grace timer", async () => {
    const onCommitted = vi.fn();
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    act(() => setVisibility("visible"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_HOLD_HIDDEN_GRACE_MS * 2);
    });
    expect(onCommitted).not.toHaveBeenCalled();
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("hiding with nothing held does not start a timer or persist", () => {
    renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => setVisibility("hidden"));
    expect(savePendingQueue).not.toHaveBeenCalled();
    expect(clearPendingQueue).not.toHaveBeenCalled();
  });

  it("the visible-idle cap commits after UNDO_HOLD_MAX_MS", async () => {
    const onCommitted = vi.fn();
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_HOLD_MAX_MS - 1);
    });
    expect(onCommitted).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onCommitted).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushed().map((c) => c.id)).toEqual([1]);
  });

  it("unmount commits the hold (SPA navigation ends the undo window) and persists it", async () => {
    const onCommitted = vi.fn();
    const { result, unmount } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    unmount();
    expect(onCommitted).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(savePendingQueue).mock.calls.at(-1)![0] as ReviewableCard[];
    expect(saved.map((c) => c.id)).toEqual([1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushed().map((c) => c.id)).toEqual([1]);
  });

  it("null client (guest / superuser write-guard): hold is a no-op and clears the persisted queue", async () => {
    const { result } = renderHook(() => usePerGradeSync(null, null));
    let token: number | null = 1;
    act(() => {
      token = result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    expect(token).toBeNull();
    expect(clearPendingQueue).toHaveBeenCalled();
    expect(result.current.flushPending(true)).toEqual({ cards: [], gradeLog: [] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_HOLD_MAX_MS + 1000);
    });
    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(pushGradeLogEntry).not.toHaveBeenCalled();
  });

  it("sync lost mid-hold (superuser toggled): commit clears the slot but pushes nothing", async () => {
    const onCommitted = vi.fn();
    const { result, rerender } = renderHook(
      ({ client, uid }: { client: SupabaseClient | null; uid: string | null }) =>
        usePerGradeSync(client, uid, { onCommitted }),
      { initialProps: { client: CLIENT as SupabaseClient | null, uid: USER as string | null } },
    );
    act(() => {
      const t = result.current.enqueueGrade(makeCard(1), { hold: true });
      result.current.attachHeldGradeLog(t!, makeEntry(666));
    });
    rerender({ client: null, uid: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_HOLD_MAX_MS + 1000);
    });
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(pushGradeLogEntry).not.toHaveBeenCalled();
    expect(isCloudPushHeld(666)).toBe(false);
  });

  it("a drain that empties the queue leaves the held card's own copy alone", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    const held = makeCard(1);
    act(() => {
      result.current.enqueueGrade(makeCard(2)); // drains to empty
      result.current.enqueueGrade(held, { hold: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(loadHeldCard(TAB)).toEqual(held);
    for (const call of vi.mocked(savePendingQueue).mock.calls) {
      expect((call[0] as ReviewableCard[]).some((c) => c.id === 1)).toBe(false);
    }
  });

  it("commit persists the queue (with the card) before dropping the held copy", () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
      result.current.enqueueGrade(makeCard(2), { hold: true }); // commits 1
    });
    const saved = vi.mocked(savePendingQueue).mock.calls.at(-1)![0] as ReviewableCard[];
    expect(saved.map((c) => c.id)).toEqual([1]);
    expect(loadHeldCard(TAB)?.id).toBe(2);
  });

  it("commit collapses a same-key queued entry: one entry per primary key", () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      result.current.enqueueGrade(makeCard(1, 5)); // queued, undrained
      result.current.enqueueGrade(makeCard(1, 9), { hold: true });
      result.current.enqueueGrade(makeCard(2), { hold: true }); // commits the second state of 1
    });
    const saved = vi.mocked(savePendingQueue).mock.calls.at(-1)![0] as ReviewableCard[];
    expect(saved.filter((c) => c.id === 1)).toHaveLength(1);
    expect(saved.find((c) => c.id === 1)!.state.stability).toBe(9);
  });

  it("sign-out mid-hold: commit also clears the persisted held copy (no push to another account later)", () => {
    const { result, rerender } = renderHook(
      ({ client, uid }: { client: SupabaseClient | null; uid: string | null }) =>
        usePerGradeSync(client, uid),
      { initialProps: { client: CLIENT as SupabaseClient | null, uid: USER as string | null } },
    );
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    expect(loadHeldCard(TAB)).not.toBeNull();
    rerender({ client: null, uid: null });
    act(() => {
      result.current.flushPending(true);
    });
    expect(loadHeldCard(TAB)).toBeNull();
  });

  it("a hold created while the tab is already hidden arms the grace timer", async () => {
    const onCommitted = vi.fn();
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_HOLD_HIDDEN_GRACE_MS);
    });
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });
});

describe("usePerGradeSync - mount seeding (#2052)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSyncSafe).mockReturnValue(true);
    vi.mocked(loadPendingQueue).mockReturnValue([]);
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reload with a persisted held card: seeded as COMMITTED, pushed, and its own key cleared", async () => {
    saveHeldCard(makeCard(7), USER, TAB);
    renderHook(() => usePerGradeSync(CLIENT, USER));
    expect(loadHeldCard(TAB)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushed().map((c) => c.id)).toEqual([7]);
  });

  it("a non-empty persisted queue is drained on mount, not left until the next grade (S1)", async () => {
    vi.mocked(loadPendingQueue).mockReturnValue([makeCard(3)]);
    renderHook(() => usePerGradeSync(CLIENT, USER));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushed().map((c) => c.id)).toEqual([3]);
  });

  it("an empty persisted queue and no held copy schedule no drain", async () => {
    renderHook(() => usePerGradeSync(CLIENT, USER));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("guest / signed out: nothing is seeded or pushed and the held copy is left alone", async () => {
    saveHeldCard(makeCard(7), USER, TAB);
    renderHook(() => usePerGradeSync(null, null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(loadHeldCard(TAB)).not.toBeNull();
  });

  it("dedupes by key: persisted duplicates and a held copy of a queued card collapse to one push each", async () => {
    vi.mocked(loadPendingQueue).mockReturnValue([makeCard(3, 1), makeCard(3, 2), makeCard(4)]);
    saveHeldCard(makeCard(4, 8), USER, TAB);
    renderHook(() => usePerGradeSync(CLIENT, USER));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushed().map((c) => c.id).sort()).toEqual([3, 4]);
  });

  it("a live hold's copy is not seeded when the client changes mid-hold", async () => {
    const { result, rerender } = renderHook(
      ({ client }: { client: SupabaseClient }) => usePerGradeSync(client, USER),
      { initialProps: { client: CLIENT } },
    );
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    rerender({ client: {} as unknown as SupabaseClient });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(loadHeldCard(TAB)?.id).toBe(1);
  });
});
