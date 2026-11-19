/**
 * POST /api/sync grade-log leg (#2052): the pagehide beacon carries the
 * grade-log entry of a just-committed held grade. It is upserted with
 * ignoreDuplicates using the SAME column mapping as pushGradeLog, and is
 * best-effort: a grade_log failure must never change the response status.
 * Runs against the D1 test database through forUser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

const { getCloudflareContext, requireAuth } = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth }));

import { POST } from "./route";
import { toGradeLogDbRow, pushGradeLog } from "@/lib/sync/gradeLog";
import type { SupabaseClient } from "@supabase/supabase-js";
import { forUser } from "@/lib/db/scope";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { spyD1, type SpiedD1, type SpyHooks } from "@/lib/db/testing/spyD1";

const ENTRY = {
  occurredAt: 1_700_000_000_000,
  date: "2026-05-13",
  grade: 4,
  cardType: "name",
  subjectKey: "25",
  locale: "ja",
  learningStep: 1,
  stepStartedAt: 1_699_999_999_000,
};

function card() {
  return {
    card_type: "name",
    subject_key: "1",
    stability: 1.5,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 3,
    reps: 1,
    lapses: 0,
    fsrs_state: "review",
    due_date: "2026-05-20",
    last_review: "2026-05-17",
    first_seen: "2026-05-17",
  };
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let d1: SqliteD1;
let db: SpiedD1;
let alice: string;
let bob: string;
let sessionUser: string | null;

function installDb(hooks: SpyHooks = {}) {
  db = spyD1(d1, hooks);
  getCloudflareContext.mockResolvedValue({ env: { DB: db }, ctx: { waitUntil: vi.fn() } });
}

/** Fails or holds back the statements of one table. */
function failTable(table: string, error: Error) {
  installDb({
    before: (s) => {
      if (s.table === table) throw error;
    },
  });
}

const tables = () => db.calls.map((c) => c.table);
const gradeLogOf = (userId: string) => forUser(d1, userId).select("grade_log", { order: [{ column: "occurred_at" }] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
  sessionUser = alice;
  installDb();
  requireAuth.mockImplementation(async () =>
    sessionUser ? { user: { id: sessionUser } } : NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
  );
});
afterEach(() => {
  d1.close();
  vi.restoreAllMocks();
});

describe("POST /api/sync - gradeLog leg (#2052)", () => {
  it("writes grade_log rows with the shared column mapping", async () => {
    const res = await POST(req({ cards: [card()], gradeLog: [ENTRY] }));
    expect(res.status).toBe(200);
    expect(await gradeLogOf(alice)).toEqual([
      {
        id: expect.any(String),
        user_id: alice,
        occurred_at: ENTRY.occurredAt,
        entry_date: "2026-05-13",
        card_type: "name",
        grade: 4,
        subject_key: "25",
        locale: "ja",
        learning_step: 1,
        step_started_at: 1_699_999_999_000,
      },
    ]);
  });

  it("ignores duplicates: a resent entry neither fails nor changes the stored row", async () => {
    await POST(req({ cards: [], gradeLog: [ENTRY] }));
    const res = await POST(req({ cards: [], gradeLog: [{ ...ENTRY, grade: 1 }] }));
    expect(res.status).toBe(200);
    expect((await gradeLogOf(alice)).map((r) => r.grade)).toEqual([4]);
  });

  it("handles a gradeLog-only beacon (in-step grade: no cards)", async () => {
    const res = await POST(req({ cards: [], gradeLog: [ENTRY] }));
    expect(res.status).toBe(200);
    expect(tables()).toEqual(["grade_log"]);
  });

  it("is unchanged when gradeLog is absent (older clients / SW replay)", async () => {
    const res = await POST(req({ cards: [card()] }));
    expect(res.status).toBe(200);
    expect(tables()).toEqual(["card_reviews"]);
  });

  it("a grade_log error does not change the response status (cards are the primary contract)", async () => {
    failTable("grade_log", new Error("D1_ERROR: grade_log down"));
    const res = await POST(req({ cards: [card()], gradeLog: [ENTRY] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("a card failure still returns 502 even when grade_log succeeded", async () => {
    failTable("card_reviews", new Error("D1_ERROR: down"));
    vi.useFakeTimers();
    try {
      const pending = POST(req({ cards: [card()], gradeLog: [ENTRY] }));
      await vi.runAllTimersAsync();
      expect((await pending).status).toBe(502);
    } finally {
      vi.useRealTimers();
    }
    expect(await gradeLogOf(alice)).toHaveLength(1);
  });

  it("drops malformed entries at the boundary and skips the write when none remain", async () => {
    const res = await POST(
      req({
        cards: [],
        gradeLog: [
          null,
          "x",
          { ...ENTRY, occurredAt: "nope" },
          { ...ENTRY, grade: 3 },
          { ...ENTRY, cardType: "bogus" },
          { ...ENTRY, subjectKey: 5 },
          { ...ENTRY, subjectKey: undefined },
          { ...ENTRY, locale: 7 },
          { ...ENTRY, learningStep: "1" },
          { ...ENTRY, stepStartedAt: "soon" },
          { ...ENTRY, date: 20260513 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(db.calls).toEqual([]);
  });

  it("keeps valid entries when mixed with malformed ones", async () => {
    await POST(req({ cards: [], gradeLog: [{ grade: 9 }, ENTRY] }));
    expect(await gradeLogOf(alice)).toHaveLength(1);
  });

  it("ignores a non-array gradeLog", async () => {
    const res = await POST(req({ cards: [], gradeLog: "nope" }));
    expect(res.status).toBe(200);
    expect(db.calls).toEqual([]);
  });

  it("caps the number of grade_log entries accepted per request", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...ENTRY, occurredAt: i + 1 }));
    await POST(req({ cards: [], gradeLog: many }));
    expect(await gradeLogOf(alice)).toHaveLength(200);
  });

  it("shares the column mapping with pushGradeLog (no drift between the two paths)", async () => {
    const seen: unknown[] = [];
    const client = {
      from: () => ({
        upsert: async (rows: unknown) => {
          seen.push(rows);
          return { error: null };
        },
      }),
    } as unknown as SupabaseClient;
    await pushGradeLog(client, alice, [ENTRY as never]);
    expect(seen[0]).toEqual([toGradeLogDbRow(alice, ENTRY as never)]);
  });

  it("rejects an unauthenticated beacon before touching grade_log", async () => {
    sessionUser = null;
    const res = await POST(req({ cards: [], gradeLog: [ENTRY] }));
    expect(res.status).toBe(401);
    expect(db.calls).toEqual([]);
  });

  it("S5: the structural-error early return (409) still writes grade_log", async () => {
    failTable("card_reviews", new Error("D1_ERROR: no such column: x"));
    const res = await POST(req({ cards: [card()], gradeLog: [ENTRY] }));
    expect(res.status).toBe(409);
    expect(await gradeLogOf(alice)).toHaveLength(1);
  });

  it("S5: the card leg does not wait on grade_log, but the response still settles it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    installDb({
      before: async (s) => {
        if (s.table === "grade_log") await gate;
      },
    });

    let done = false;
    const pending = POST(req({ cards: [card()], gradeLog: [ENTRY] })).then((r) => {
      done = true;
      return r;
    });
    // Cards are written while grade_log is still held back...
    await vi.waitFor(() => expect(tables()).toContain("card_reviews"));
    expect(done).toBe(false);
    // ...and the response completes only once grade_log has settled.
    release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await gradeLogOf(alice)).toHaveLength(1);
  });

  it("rejects out-of-range or malformed field values at the boundary", async () => {
    await POST(
      req({
        cards: [],
        gradeLog: [
          { ...ENTRY, occurredAt: 1.5 },
          { ...ENTRY, occurredAt: Number.MAX_SAFE_INTEGER + 2 },
          { ...ENTRY, date: "29/09/2026" },
          { ...ENTRY, locale: "xx" },
          { ...ENTRY, locale: "e".repeat(500) },
          { ...ENTRY, learningStep: 1.5 },
          { ...ENTRY, stepStartedAt: 1.5 },
          { ...ENTRY, subjectKey: "" },
          { ...ENTRY, subjectKey: "k".repeat(500) },
        ],
      }),
    );
    expect(db.calls).toEqual([]);
  });

  it("two users: user B's beacon writes only B's grade log, even naming A's id", async () => {
    await POST(req({ cards: [], gradeLog: [ENTRY] }));
    sessionUser = bob;
    await POST(req({ cards: [], gradeLog: [{ ...ENTRY, user_id: alice, occurredAt: ENTRY.occurredAt + 1 }] }));
    expect((await gradeLogOf(alice)).map((r) => r.occurred_at)).toEqual([ENTRY.occurredAt]);
    expect((await gradeLogOf(bob)).map((r) => [r.user_id, r.occurred_at])).toEqual([[bob, ENTRY.occurredAt + 1]]);
  });
});
