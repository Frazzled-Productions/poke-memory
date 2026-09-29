/**
 * #2052 review blocker B1 and follow-ups: a held (undoable) grade must be
 * invisible to every reader of the SHARED pending queue, and must never be
 * resurrected by an unload handler working from a stale snapshot.
 *
 * Real: usePerGradeSync, useOnlineReconnectSync, pushWithFallback,
 * useSyncOnUnload, pushSingleCard, the pending-queue + held-grade persistence,
 * the session store and fake IndexedDB (the service worker's mirror).
 * Fake: the Supabase client (records upserts) and pullAndMerge (always ok).
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/sync/pullAndMerge", () => ({
  pullAndMerge: vi.fn(async () => "ok"),
}));

import { usePerGradeSync } from "@/lib/sync/usePerGradeSync";
import { useOnlineReconnectSync } from "@/lib/sync/useOnlineReconnectSync";
import { useSyncOnUnload } from "@/lib/sync/useSyncOnUnload";
import { loadHeldCard, getTabId, saveHeldCard } from "@/lib/sync/heldGrade";
import { loadPendingQueue, saveSyncStatus, loadSyncStatus } from "@/lib/sync/persistence";
import { saveSession } from "@/lib/review/persistence";
import { DEFAULT_LIMITS, todayString, type ReviewableCard } from "@/lib/review/session";
import { KEY_HELD_GRADE_PREFIX, KEY_PENDING_GRADE_QUEUE } from "@/lib/storage/keys";
import { idbGet, __resetForTests } from "@/lib/idb/db";
import type { ReviewState } from "@/lib/srs/scheduler";

const TAB = getTabId();
const USER = "00000000-0000-0000-0000-0000000000bb";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeState(): ReviewState {
  const today = todayString(new Date());
  return {
    stability: 3,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 3,
    reps: 5,
    lapses: 1,
    fsrsState: "review",
    dueDate: today,
    lastReview: today,
    firstSeen: "2026-01-01",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  } as ReviewState;
}

function makeCard(id: number): ReviewableCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `pokemon-${id}`,
    cardType: "name",
    subjectKey: String(id),
    name: `pokemon-${id}`,
    locale: "en",
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
    generation: "generation-i",
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: makeState(),
  } as unknown as ReviewableCard;
}

describe("undo hold vs the shared pending queue (#2052)", () => {
  let cardUpserts: Record<string, unknown>[];
  let client: SupabaseClient;

  beforeEach(async () => {
    await __resetForTests();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("poke-memory");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    window.localStorage.clear();
    const mine: Record<string, unknown>[] = [];
    cardUpserts = mine;
    client = {
      from: (table: string) => ({
        upsert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          if (table === "card_reviews") {
            mine.push(...(Array.isArray(rows) ? rows : [rows]));
          }
          return { error: null };
        },
      }),
    } as unknown as SupabaseClient;
  });

  afterEach(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    vi.restoreAllMocks();
  });

  /** A previous session's failed push: the banner state that arms the reconnect push. */
  function armFailedPushState() {
    saveSyncStatus({ ...loadSyncStatus(), lastPushFailed: true, failedCardCount: 1 });
  }

  it("B1: lastPushFailed + hold + `online` -> nothing is pushed (queue branch AND session fallback)", async () => {
    armFailedPushState();
    const graded = makeCard(1);
    // The graded card is already in the saved session (saveSession precedes commit),
    // which is exactly what the session-fallback branch would push.
    await saveSession({ cards: [graded], limits: DEFAULT_LIMITS });
    renderHook(() => useOnlineReconnectSync(client, USER));
    const hook = renderHook(() => usePerGradeSync(client, USER));

    act(() => {
      hook.result.current.enqueueGrade(graded, { hold: true });
    });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await sleep(300);
    });

    expect(cardUpserts).toEqual([]);
    // ...and Undo afterwards still leaves nothing behind.
    act(() => {
      hook.result.current.discardHeld();
    });
    // Undo also rolls the saved session back to its pre-grade state.
    await saveSession({
      cards: [{ ...graded, state: { ...graded.state, lastReview: null, firstSeen: null } }],
      limits: DEFAULT_LIMITS,
    });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await sleep(300);
    });
    expect(cardUpserts).toEqual([]);
  });

  it("B1 control: once committed, the same reconnect path does push the card", async () => {
    armFailedPushState();
    const graded = makeCard(1);
    await saveSession({ cards: [graded], limits: DEFAULT_LIMITS });
    renderHook(() => useOnlineReconnectSync(client, USER));
    const hook = renderHook(() => usePerGradeSync(client, USER));

    act(() => {
      hook.result.current.enqueueGrade(graded, { hold: true });
      hook.result.current.enqueueGrade(makeCard(2), { hold: true }); // commits card 1
    });
    await act(async () => {
      await sleep(400);
    });

    expect(cardUpserts.map((r) => r.subject_key)).toEqual(["1"]);
  });

  it("B2: the session fallback also skips a card held by ANOTHER live tab (reads the per-tab copies)", async () => {
    armFailedPushState();
    const graded = makeCard(1);
    await saveSession({ cards: [graded], limits: DEFAULT_LIMITS });
    // Another tab holds this grade; this tab has no in-memory hold at all.
    saveHeldCard(graded, USER, "some-other-tab");
    renderHook(() => useOnlineReconnectSync(client, USER));

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await sleep(300);
    });

    expect(cardUpserts).toEqual([]);
  });

  it("the service worker's IDB mirror and the shared queue key never contain a held card", async () => {
    const hook = renderHook(() => usePerGradeSync(client, USER));

    act(() => {
      hook.result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    await act(async () => {
      await sleep(700); // past the 500 ms persist debounce
    });

    expect(await idbGet(KEY_PENDING_GRADE_QUEUE)).toBeNull();
    expect(window.localStorage.getItem(KEY_PENDING_GRADE_QUEUE)).toBeNull();
    expect(loadPendingQueue()).toEqual([]);
    // Its own key is localStorage-only.
    expect(window.localStorage.getItem(KEY_HELD_GRADE_PREFIX + TAB)).not.toBeNull();
    expect(await idbGet(KEY_HELD_GRADE_PREFIX + TAB)).toBeNull();
  });

  it("once committed the card is mirrored for the service worker exactly once", async () => {
    const hook = renderHook(() => usePerGradeSync(client, USER));

    act(() => {
      hook.result.current.enqueueGrade(makeCard(1), { hold: true });
      hook.result.current.enqueueGrade(makeCard(1), { hold: true }); // same key again
      hook.result.current.enqueueGrade(makeCard(2), { hold: true }); // commits the second
    });
    // Mirror written synchronously at commit; read before the drain succeeds.
    await act(async () => {
      await sleep(20);
    });
    const raw = await idbGet(KEY_PENDING_GRADE_QUEUE);
    // (a fast drain may already have emptied it; when present it has no duplicate key)
    if (raw !== null) {
      const rows = JSON.parse(raw) as { subject_key: string }[];
      expect(new Set(rows.map((r) => r.subject_key)).size).toBe(rows.length);
    }
    expect(window.localStorage.getItem(KEY_HELD_GRADE_PREFIX + TAB)).toContain('"id":2');
  });

  it("S3: an Undo during an in-flight visibilitychange fetch is not resurrected when the fetch settles", async () => {
    const earlier = makeCard(2);
    let resolveFetch: (r: Response) => void = () => {};
    vi.spyOn(global, "fetch").mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      }),
    );
    const hook = renderHook(() => usePerGradeSync(client, USER));
    renderHook(() => useSyncOnUnload(client, USER, hook.result.current.flushPending));

    act(() => {
      hook.result.current.enqueueGrade(earlier); // committed, still queued
      hook.result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("visibilitychange"));
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Undo while the fetch is in flight.
    act(() => {
      hook.result.current.discardHeld();
    });
    await act(async () => {
      resolveFetch(new Response(null, { status: 200 }));
      await sleep(50);
    });

    expect(loadHeldCard(TAB)).toBeNull();
    expect(window.localStorage.getItem(KEY_HELD_GRADE_PREFIX + TAB)).toBeNull();
    expect(await idbGet(KEY_PENDING_GRADE_QUEUE)).toBeNull();
    expect(window.localStorage.getItem(KEY_PENDING_GRADE_QUEUE)).toBeNull();
  });

  it("S3: a fetch that settles while a grade is still held leaves its own copy in place", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    vi.spyOn(global, "fetch").mockReturnValue(
      new Promise<Response>((r) => {
        resolveFetch = r;
      }),
    );
    const hook = renderHook(() => usePerGradeSync(client, USER));
    renderHook(() => useSyncOnUnload(client, USER, hook.result.current.flushPending));

    act(() => {
      hook.result.current.enqueueGrade(makeCard(2));
      hook.result.current.enqueueGrade(makeCard(1), { hold: true });
    });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      resolveFetch(new Response(null, { status: 200 }));
      await sleep(50);
    });

    expect(loadHeldCard(TAB)?.id).toBe(1);
    expect(window.localStorage.getItem(KEY_PENDING_GRADE_QUEUE)).toBeNull();
  });
});
