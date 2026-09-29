/**
 * POST /api/sync grade-log leg (#2052): the pagehide beacon carries the
 * grade-log entry of a just-committed held grade. It is upserted with
 * ignoreDuplicates using the SAME column mapping as pushGradeLog, and is
 * best-effort: a grade_log failure must never change the response status.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { GRADE_LOG_CONFLICT_COLS, toGradeLogDbRow, pushGradeLog } from "@/lib/sync/gradeLog";
import type { SupabaseClient } from "@supabase/supabase-js";

const USER_ID = "user-xyz-789";

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

function setup(
  opts: {
    gradeLogError?: { code: string; message: string } | "throw";
    cardsError?: boolean | "structural";
    /** When set, grade_log upserts wait for this promise. */
    gradeLogGate?: Promise<void>;
  } = {},
) {
  const calls: { table: string; rows: unknown; options: unknown }[] = [];
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: vi.fn((table: string) => ({
      upsert: vi.fn(async (rows: unknown, options: unknown) => {
        calls.push({ table, rows, options });
        if (table === "grade_log" && opts.gradeLogGate) await opts.gradeLogGate;
        if (table === "grade_log" && opts.gradeLogError === "throw") throw new Error("boom");
        if (table === "grade_log" && opts.gradeLogError) return { error: opts.gradeLogError };
        if (table === "card_reviews" && opts.cardsError === "structural") {
          return { error: { code: "42P10", message: "no unique constraint matching ON CONFLICT" } };
        }
        if (table === "card_reviews" && opts.cardsError) return { error: { code: "XX000", message: "down" } };
        return { error: null };
      }),
    })),
  };
  vi.mocked(createClient).mockResolvedValue(client as never);
  return { calls };
}

describe("POST /api/sync - gradeLog leg (#2052)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("upserts grade_log rows with ignoreDuplicates and the shared column mapping", async () => {
    const { calls } = setup();
    const res = await POST(req({ cards: [card()], gradeLog: [ENTRY] }));
    expect(res.status).toBe(200);
    const gl = calls.find((c) => c.table === "grade_log")!;
    expect(gl.options).toEqual({ onConflict: GRADE_LOG_CONFLICT_COLS, ignoreDuplicates: true });
    expect(gl.rows).toEqual([toGradeLogDbRow(USER_ID, ENTRY as never)]);
    expect(gl.rows).toEqual([
      {
        user_id: USER_ID,
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

  it("handles a gradeLog-only beacon (in-step grade: no cards)", async () => {
    const { calls } = setup();
    const res = await POST(req({ cards: [], gradeLog: [ENTRY] }));
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.table)).toEqual(["grade_log"]);
  });

  it("is unchanged when gradeLog is absent (older clients / SW replay)", async () => {
    const { calls } = setup();
    const res = await POST(req({ cards: [card()] }));
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.table)).toEqual(["card_reviews"]);
  });

  it("a grade_log error does not change the response status (cards are the primary contract)", async () => {
    setup({ gradeLogError: { code: "XX000", message: "grade_log down" } });
    const res = await POST(req({ cards: [card()], gradeLog: [ENTRY] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("a thrown grade_log upsert does not change the response status", async () => {
    setup({ gradeLogError: "throw" });
    const res = await POST(req({ cards: [card()], gradeLog: [ENTRY] }));
    expect(res.status).toBe(200);
  });

  it("a card failure still returns 502 even when grade_log succeeded", async () => {
    setup({ cardsError: true });
    const res = await POST(req({ cards: [card()], gradeLog: [ENTRY] }));
    expect(res.status).toBe(502);
  });

  it("drops malformed entries at the boundary and skips the upsert when none remain", async () => {
    const { calls } = setup();
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
    expect(calls).toEqual([]);
  });

  it("keeps valid entries when mixed with malformed ones", async () => {
    const { calls } = setup();
    await POST(req({ cards: [], gradeLog: [{ grade: 9 }, ENTRY] }));
    const gl = calls.find((c) => c.table === "grade_log")!;
    expect(gl.rows).toHaveLength(1);
  });

  it("ignores a non-array gradeLog", async () => {
    const { calls } = setup();
    const res = await POST(req({ cards: [], gradeLog: "nope" }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("caps the number of grade_log entries accepted per request", async () => {
    const { calls } = setup();
    const many = Array.from({ length: 500 }, (_, i) => ({ ...ENTRY, occurredAt: i + 1 }));
    await POST(req({ cards: [], gradeLog: many }));
    expect((calls[0].rows as unknown[]).length).toBe(200);
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
    await pushGradeLog(client, USER_ID, [ENTRY as never]);
    expect(seen[0]).toEqual([toGradeLogDbRow(USER_ID, ENTRY as never)]);
  });

  it("rejects an unauthenticated beacon before touching grade_log", async () => {
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("no") }) },
      from: vi.fn(),
    };
    vi.mocked(createClient).mockResolvedValue(client as never);
    const res = await POST(req({ cards: [], gradeLog: [ENTRY] }));
    expect(res.status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
  });
  it("S5: the structural-error early return (409) still writes grade_log", async () => {
    const { calls } = setup({ cardsError: "structural" });
    const res = await POST(req({ cards: [card()], gradeLog: [ENTRY] }));
    expect(res.status).toBe(409);
    expect(calls.some((c) => c.table === "grade_log")).toBe(true);
  });

  it("S5: the card leg does not wait on grade_log, but the response still settles it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { calls } = setup({ gradeLogGate: gate });

    let done = false;
    const pending = POST(req({ cards: [card()], gradeLog: [ENTRY] })).then((r) => {
      done = true;
      return r;
    });
    // Cards are upserted while grade_log is still blocked...
    await vi.waitFor(() => expect(calls.some((c) => c.table === "card_reviews")).toBe(true));
    expect(done).toBe(false);
    // ...and the response completes only once grade_log has settled.
    release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.table === "grade_log")).toBe(true);
  });

  it("rejects out-of-range or malformed field values at the boundary", async () => {
    const { calls } = setup();
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
    expect(calls).toEqual([]);
  });
});
