/**
 * #2052 acceptance scenarios, end to end over an in-memory fake Supabase.
 *
 * Real: usePerGradeSync (the hold), AutoSyncOnChange (the grade-log push
 * listener), appendGradeEntry / removeGradeEntry (with fake IndexedDB),
 * pushSingleCard / pushGradeLog, pullAndMerge, the session store.
 * Fake: the Supabase client (tables in memory, the migration 002 regression
 * trigger emulated on card_reviews, ON CONFLICT DO NOTHING on grade_log) and
 * the seed loader (empty seed: the merge only needs the cards we save).
 *
 * The hook test lives under components/ (jsdom project), like every hook test.
 */
import { render, renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/pokemon/seed-async", () => ({
  loadSeed: vi.fn(async () => ({ seedPokemon: [], seedEvolutionCards: [] })),
}));

const CURRENT_USER = { id: "00000000-0000-0000-0000-0000000000aa" };
const clientHolder = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ user: CURRENT_USER, supabase: clientHolder.client }),
}));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ unlocked: false, flags: {}, anyFlagOn: false, setFlag: vi.fn() }),
}));

import { AutoSyncOnChange } from "@/components/sync/AutoSyncOnChange";
import { usePerGradeSync } from "@/lib/sync/usePerGradeSync";
import { pullAndMerge } from "@/lib/sync/pullAndMerge";
import { toCloudRows } from "@/lib/sync/cloud";
import { saveSession, loadSession } from "@/lib/review/persistence";
import { DEFAULT_LIMITS, type ReviewableCard } from "@/lib/review/session";
import {
  appendGradeEntry,
  removeGradeEntry,
  loadGradeLog,
} from "@/lib/gradelog/persistence";
import { saveSyncStatus, loadSyncStatus } from "@/lib/sync/persistence";
import { nextReview, type Grade, type ReviewState } from "@/lib/srs/scheduler";
import { __resetForTests } from "@/lib/idb/db";

// ---------------------------------------------------------------------------
// In-memory fake Supabase
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeSupabase {
  cardReviews = new Map<string, Row>();
  gradeLog = new Map<number, Row>();
  /** Every card_reviews upsert that reached the "server", in order. */
  cardUpserts: Row[] = [];
  /** Upserts the emulated regression trigger rejected (SQLSTATE 23514). */
  rejections: Row[] = [];

  private cardKey = (r: Row) => `${r.card_type}|${r.subject_key}|${r.locale ?? "en"}`;

  seedCard(row: Row) {
    this.cardReviews.set(this.cardKey(row), { ...row });
  }

  from = (table: string) => {
    const rowsFor = (): Row[] =>
      table === "card_reviews"
        ? [...this.cardReviews.values()]
        : table === "grade_log"
          ? [...this.gradeLog.values()].sort(
              (a, b) => (a.occurred_at as number) - (b.occurred_at as number),
            )
          : [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: (from: number, to: number) => ({
        then: (res: (v: { data: Row[]; error: null }) => unknown) =>
          res({ data: rowsFor().slice(from, to + 1), error: null }),
      }),
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async (rows: Row | Row[], opts?: { ignoreDuplicates?: boolean }) => {
        const list = Array.isArray(rows) ? rows : [rows];
        if (table === "card_reviews") {
          for (const r of list) {
            const key = this.cardKey(r);
            const existing = this.cardReviews.get(key);
            // Migration 002 regression trigger: last_review must not move back.
            if (
              existing &&
              typeof existing.last_review === "string" &&
              typeof r.last_review === "string" &&
              r.last_review < existing.last_review
            ) {
              this.rejections.push(r);
              return { error: { code: "23514", message: "regression rejected" } };
            }
            this.cardUpserts.push({ ...r });
            this.cardReviews.set(key, { ...existing, ...r, updated_at: new Date().toISOString() });
          }
        } else if (table === "grade_log") {
          for (const r of list) {
            const at = r.occurred_at as number;
            if (this.gradeLog.has(at) && opts?.ignoreDuplicates) continue;
            this.gradeLog.set(at, { ...r });
          }
        }
        return { error: null };
      },
    };
    return builder;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function baseCard(state: ReviewState): ReviewableCard {
  // Full shape so the session store's card validation accepts it.
  return {
    id: 25,
    speciesId: 25,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: "pikachu",
    cardType: "name",
    subjectKey: "25",
    name: "pikachu",
    locale: "en",
    spriteUrl: "",
    types: ["electric"],
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
    state,
  } as unknown as ReviewableCard;
}

function preGradeState(now: Date): ReviewState {
  return {
    stability: 12,
    difficulty: 5,
    elapsedDays: 12,
    scheduledDays: 12,
    reps: 4,
    lapses: 0,
    fsrsState: "review",
    dueDate: iso(now),
    lastReview: iso(new Date(now.getTime() - 12 * DAY)),
    firstSeen: iso(new Date(now.getTime() - 40 * DAY)),
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  } as ReviewState;
}

/** The FSRS fields that define scheduling, for equality across a save/load. */
function fsrsFields(s: ReviewState) {
  return {
    stability: s.stability,
    difficulty: s.difficulty,
    reps: s.reps,
    lapses: s.lapses,
    fsrsState: s.fsrsState,
    dueDate: s.dueDate,
    lastReview: s.lastReview,
    firstSeen: s.firstSeen,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("#2052 acceptance: undo leaves no trace in the cloud", () => {
  let cloud: FakeSupabase;
  let now: Date;
  let pre: ReviewableCard;

  /** What ReviewSession.handleGrade does for a signed-in user, minus the UI. */
  async function grade(
    hook: ReturnType<typeof renderHook<ReturnType<typeof usePerGradeSync>, unknown>>,
    grade: Grade,
    from: ReviewableCard,
  ) {
    const graded = baseCard(nextReview(from.state, grade, now));
    const token = hook.result.current.enqueueGrade(graded, { hold: true });
    await saveSession({ cards: [graded], limits: DEFAULT_LIMITS });
    const appended = await appendGradeEntry(
      { date: iso(now), grade, cardType: "name", subjectKey: "25", locale: "en" },
      { holdCloudPush: token !== null },
    );
    hook.result.current.attachHeldGradeLog(token!, appended);
    return { graded, appended: appended! };
  }

  /** What ReviewSession's undo does: drop the hold, roll local back. */
  async function undo(
    hook: ReturnType<typeof renderHook<ReturnType<typeof usePerGradeSync>, unknown>>,
    appended: { occurredAt: number },
  ) {
    hook.result.current.discardHeld();
    await saveSession({ cards: [pre], limits: DEFAULT_LIMITS });
    await removeGradeEntry(appended.occurredAt);
  }

  beforeEach(async () => {
    // Close the open connection, then drop the database so no rows leak
    // between tests.
    await __resetForTests();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("poke-memory");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    window.localStorage.clear();
    now = new Date();
    pre = baseCard(preGradeState(now));
    cloud = new FakeSupabase();
    clientHolder.client = cloud as unknown as SupabaseClient;
    // The cloud already holds the pre-grade state, written 2 days ago; this
    // device pulled it 1 day ago (so local and cloud agree at the start).
    cloud.seedCard({
      ...toCloudRows([pre])[0],
      updated_at: new Date(now.getTime() - 2 * DAY).toISOString(),
    });
    saveSyncStatus({
      ...loadSyncStatus(),
      lastPullAt: new Date(now.getTime() - 1 * DAY).toISOString(),
      ownerUserId: CURRENT_USER.id,
    });
    await saveSession({ cards: [pre], limits: DEFAULT_LIMITS });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("grade -> undo -> pullAndMerge: the log lacks the entry AND the card is at its pre-grade state", async () => {
    render(<AutoSyncOnChange />);
    const hook = renderHook(() => usePerGradeSync(cloud as unknown as SupabaseClient, CURRENT_USER.id));

    const { appended } = await grade(hook, 5, pre);
    // The entry is in the LOCAL log while undoable (sidebar/stats read it)...
    expect((await loadGradeLog()).map((e) => e.occurredAt)).toEqual([appended.occurredAt]);
    await undo(hook, appended);
    // ...well past the 200 ms per-grade debounce that used to push the grade.
    await act(async () => { await sleep(400); });

    // Nothing left the device.
    expect(cloud.cardUpserts).toEqual([]);
    expect(cloud.gradeLog.size).toBe(0);

    expect(await pullAndMerge(cloud as unknown as SupabaseClient, CURRENT_USER.id)).toBe("ok");

    // AC3: the undone grade does not reappear in the local grade log.
    expect(await loadGradeLog()).toEqual([]);
    // AC2 + AC4: the card's FSRS state stays at the pre-grade values.
    const session = await loadSession();
    expect(session!.cards).toHaveLength(1);
    expect(fsrsFields(session!.cards[0].state)).toEqual(fsrsFields(pre.state));
  });

  it("grade Easy -> undo -> grade Again: the cloud sees only Again, with no rejection", async () => {
    render(<AutoSyncOnChange />);
    const hook = renderHook(() => usePerGradeSync(cloud as unknown as SupabaseClient, CURRENT_USER.id));

    const easy = await grade(hook, 5, pre);
    await undo(hook, easy.appended);
    await sleep(5); // distinct occurredAt for the second entry
    const again = await grade(hook, 1, pre);
    // Next grade / leaving the page commits the held Again.
    hook.unmount();
    await act(async () => { await sleep(400); });

    expect(cloud.rejections).toEqual([]);
    expect(cloud.cardUpserts).toHaveLength(1);
    expect(cloud.cardUpserts[0]).toMatchObject({
      subject_key: "25",
      fsrs_state: again.graded.state.fsrsState,
      stability: again.graded.state.stability,
      reps: again.graded.state.reps,
      lapses: again.graded.state.lapses,
    });
    // Only the Again grade is in the cloud grade_log.
    expect([...cloud.gradeLog.keys()]).toEqual([again.appended.occurredAt]);
    expect([...cloud.gradeLog.values()][0]).toMatchObject({ grade: 1 });
  });

  it("fast undo (entry still being appended) removes the entry and never pushes it", async () => {
    render(<AutoSyncOnChange />);
    const hook = renderHook(() => usePerGradeSync(cloud as unknown as SupabaseClient, CURRENT_USER.id));

    const graded = baseCard(nextReview(pre.state, 1, now));
    const token = hook.result.current.enqueueGrade(graded, { hold: true });
    // The persistence step (append + attach) is still in flight when the user
    // reaches for Undo; Undo awaits the chain, as ReviewSession does.
    let appended: Awaited<ReturnType<typeof appendGradeEntry>> = null;
    const chain = (async () => {
      appended = await appendGradeEntry(
        { date: iso(now), grade: 1, cardType: "name", subjectKey: "25", locale: "en" },
        { holdCloudPush: true },
      );
      hook.result.current.attachHeldGradeLog(token!, appended);
    })();
    await chain;
    hook.result.current.discardHeld();
    await removeGradeEntry(appended!.occurredAt);
    await act(async () => { await sleep(400); });

    expect(await loadGradeLog()).toEqual([]);
    expect(cloud.cardUpserts).toEqual([]);
    expect(cloud.gradeLog.size).toBe(0);
  });

  it("control: a grade that is NOT undone reaches the cloud once committed", async () => {
    render(<AutoSyncOnChange />);
    const hook = renderHook(() => usePerGradeSync(cloud as unknown as SupabaseClient, CURRENT_USER.id));

    const { appended } = await grade(hook, 4, pre);
    await act(async () => { await sleep(400); });
    expect(cloud.gradeLog.size).toBe(0); // still held
    hook.unmount();
    await act(async () => { await sleep(400); });

    expect(cloud.cardUpserts).toHaveLength(1);
    expect([...cloud.gradeLog.keys()]).toEqual([appended.occurredAt]);
  });
});
