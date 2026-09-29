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
import {
  usePerGradeSync,
  UNDO_HOLD_HIDDEN_GRACE_MS,
  UNDO_HOLD_MAX_MS,
} from "@/lib/sync/usePerGradeSync";
import { isCloudPushHeld, type GradeLogEntry } from "@/lib/gradelog/persistence";
import type { ReviewableCard } from "@/lib/review/session";

const CLIENT = {} as unknown as SupabaseClient;
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

  it("persists the held card locally (durability) but not into the push queue", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    const saved = vi.mocked(savePendingQueue).mock.calls.at(-1)![0] as ReviewableCard[];
    expect(saved.map((c) => c.id)).toEqual([1]);
    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("discard: never pushed, and the persisted queue is re-saved without the held card", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    vi.mocked(clearPendingQueue).mockClear();
    vi.mocked(savePendingQueue).mockClear();
    act(() => {
      result.current.discardHeld();
    });
    // Empty queue + no held card: the persisted key is cleared, not rewritten.
    expect(clearPendingQueue).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_HOLD_MAX_MS + 1000);
    });
    expect(pushSingleCard).not.toHaveBeenCalled();
    expect(pushGradeLogEntry).not.toHaveBeenCalled();
    // The discarded card is never persisted again.
    for (const call of vi.mocked(savePendingQueue).mock.calls) {
      expect((call[0] as ReviewableCard[]).length).toBe(0);
    }
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

  it("discard keeps an earlier queued card in the persisted queue", () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      result.current.enqueueGrade(makeCard(2));
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    vi.mocked(savePendingQueue).mockClear();
    act(() => {
      result.current.discardHeld();
    });
    const saved = vi.mocked(savePendingQueue).mock.calls.at(-1)![0] as ReviewableCard[];
    expect(saved.map((c) => c.id)).toEqual([2]);
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
    const snap = result.current.flushPending(false);
    expect(snap.heldCards).toEqual([]);
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

  it("flushPending(false) reports the held card without committing it", () => {
    const onCommitted = vi.fn();
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    const held = makeCard(1);
    act(() => {
      result.current.enqueueGrade(held, { hold: true });
    });
    const snap = result.current.flushPending(false);
    expect(snap.cards).toEqual([]);
    expect(snap.gradeLog).toEqual([]);
    expect(snap.heldCards).toEqual([held]);
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
    let snap = { cards: [] as ReviewableCard[], gradeLog: [] as GradeLogEntry[], heldCards: [] as ReviewableCard[] };
    act(() => {
      snap = result.current.flushPending(true);
    });
    expect(snap.cards).toEqual([held]);
    expect(snap.gradeLog).toEqual([entry]);
    expect(snap.heldCards).toEqual([]);
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(pushGradeLogEntry).not.toHaveBeenCalled();
    expect(isCloudPushHeld(555)).toBe(false);
  });

  it("hidden for the grace period commits and expires undo", async () => {
    const onCommitted = vi.fn();
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER, { onCommitted }));
    act(() => {
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    act(() => setVisibility("hidden"));
    // Held card persisted the moment the tab hides.
    const saved = vi.mocked(savePendingQueue).mock.calls.at(-1)![0] as ReviewableCard[];
    expect(saved.map((c) => c.id)).toEqual([1]);
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
    expect(result.current.flushPending(true)).toEqual({ cards: [], gradeLog: [], heldCards: [] });
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

  it("a drain that empties the queue does not wipe the held card's persisted copy", async () => {
    const { result } = renderHook(() => usePerGradeSync(CLIENT, USER));
    act(() => {
      result.current.enqueueGrade(makeCard(2)); // drains to empty
      result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    vi.mocked(clearPendingQueue).mockClear();
    vi.mocked(savePendingQueue).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(clearPendingQueue).not.toHaveBeenCalled();
    const saved = vi.mocked(savePendingQueue).mock.calls.at(-1)![0] as ReviewableCard[];
    expect(saved.map((c) => c.id)).toEqual([1]);
  });
});
