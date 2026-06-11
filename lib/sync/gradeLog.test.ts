import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeGradeLog, pullGradeLog, pushGradeLog, GRADE_LOG_CONFLICT_COLS } from "./gradeLog";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";

function makeClientWithUpsert(error: null | object = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ upsert });
  return { client: { from } as unknown as SupabaseClient, upsert, from };
}

function makeClientWithOrderedSelect(data: unknown, error: null | object = null) {
  // The chain is: select → eq → order → range(from, to)
  // fetchAllPages calls .range(from, to) as the terminal method.
  // Return data with length < pageSize (1000) so fetchAllPages stops after one call.
  const range = vi.fn().mockResolvedValue({ data, error });
  const orderBuilder = { range };
  const order = vi.fn().mockReturnValue(orderBuilder);
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, order, range };
}

function makeEntry(occurredAt: number, overrides: Partial<GradeLogEntry> = {}): GradeLogEntry {
  return {
    occurredAt,
    date: "2026-05-12",
    grade: 4,
    cardType: "name",
    ...overrides,
  };
}

describe("mergeGradeLog", () => {
  it("unions local and cloud entries by occurredAt", () => {
    const result = mergeGradeLog(
      [makeEntry(10), makeEntry(20)],
      [makeEntry(20), makeEntry(30)],
    );
    expect(result.map((e) => e.occurredAt)).toEqual([10, 20, 30]);
  });

  it("local wins when timestamps collide (stable tiebreaker)", () => {
    const result = mergeGradeLog(
      [makeEntry(10, { grade: 5 })],
      [makeEntry(10, { grade: 1 })],
    );
    expect(result).toHaveLength(1);
    expect(result[0].grade).toBe(5);
  });

  it("returns sorted ascending", () => {
    const result = mergeGradeLog(
      [makeEntry(30), makeEntry(10)],
      [makeEntry(20)],
    );
    expect(result.map((e) => e.occurredAt)).toEqual([10, 20, 30]);
  });

  it("returns [] when both inputs are empty", () => {
    expect(mergeGradeLog([], [])).toEqual([]);
  });
});

describe("pushGradeLog", () => {
  it("upserts entries with the correct cloud row shape and ignoreDuplicates", async () => {
    const { client, upsert, from } = makeClientWithUpsert();
    const entries = [
      makeEntry(100, { date: "2026-05-12", grade: 4, cardType: "name" }),
      makeEntry(101, { date: "2026-05-12", grade: 1, cardType: "evolution" }),
    ];
    const ok = await pushGradeLog(client, "user-1", entries);
    expect(ok).toBe(true);
    expect(from).toHaveBeenCalledWith("grade_log");
    expect(upsert).toHaveBeenCalledWith(
      [
        { user_id: "user-1", occurred_at: 100, entry_date: "2026-05-12", card_type: "name", grade: 4, subject_key: null, locale: "en", learning_step: null, step_started_at: null },
        { user_id: "user-1", occurred_at: 101, entry_date: "2026-05-12", card_type: "evolution", grade: 1, subject_key: null, locale: "en", learning_step: null, step_started_at: null },
      ],
      { onConflict: GRADE_LOG_CONFLICT_COLS, ignoreDuplicates: true },
    );
  });

  it("includes subject_key in the upsert row when set", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const entries = [makeEntry(200, { date: "2026-05-12", grade: 4, cardType: "name", subjectKey: "42" })];
    await pushGradeLog(client, "u", entries);
    const row = (upsert.mock.calls[0][0] as { subject_key: string | null }[])[0];
    expect(row.subject_key).toBe("42");
  });

  it("pushes cry entries (filter removed after migration 009)", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const entries = [makeEntry(300, { date: "2026-05-12", grade: 4, cardType: "cry" })];
    const ok = await pushGradeLog(client, "u", entries);
    expect(ok).toBe(true);
    expect(upsert).toHaveBeenCalled();
  });

  it("pushes reverse-evolution entries (filter removed after migration 009)", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const entries = [makeEntry(400, { date: "2026-05-12", grade: 4, cardType: "reverse-evolution" })];
    const ok = await pushGradeLog(client, "u", entries);
    expect(ok).toBe(true);
    expect(upsert).toHaveBeenCalled();
  });

  it("returns true without a network call when entries is empty", async () => {
    const { client, upsert } = makeClientWithUpsert();
    expect(await pushGradeLog(client, "u", [])).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns false on supabase error", async () => {
    const { client } = makeClientWithUpsert({ message: "boom" });
    expect(await pushGradeLog(client, "u", [makeEntry(1)])).toBe(false);
  });
});

describe("pullGradeLog", () => {
  it("returns entries mapped from cloud rows", async () => {
    const { client } = makeClientWithOrderedSelect([
      { occurred_at: 200, entry_date: "2026-05-12", card_type: "name", grade: 4, subject_key: null },
      { occurred_at: 201, entry_date: "2026-05-12", card_type: "reverse", grade: 5, subject_key: null },
    ]);
    const result = await pullGradeLog(client, "u");
    expect(result).toEqual([
      { occurredAt: 200, date: "2026-05-12", cardType: "name", grade: 4, locale: "en" },
      { occurredAt: 201, date: "2026-05-12", cardType: "reverse", grade: 5, locale: "en" },
    ]);
  });

  it("maps subject_key from cloud rows to subjectKey on the entry", async () => {
    const { client } = makeClientWithOrderedSelect([
      { occurred_at: 300, entry_date: "2026-05-12", card_type: "name", grade: 4, subject_key: "42" },
      { occurred_at: 301, entry_date: "2026-05-12", card_type: "name", grade: 1, subject_key: null },
    ]);
    const result = await pullGradeLog(client, "u");
    expect(result?.[0].subjectKey).toBe("42");
    expect(result?.[1].subjectKey).toBeUndefined();
  });

  it("returns null on supabase error", async () => {
    const { client } = makeClientWithOrderedSelect(null, { message: "boom" });
    expect(await pullGradeLog(client, "u")).toBeNull();
  });

  it("maps locale from cloud rows (#1259)", async () => {
    const { client } = makeClientWithOrderedSelect([
      { occurred_at: 400, entry_date: "2026-05-12", card_type: "name", grade: 4, subject_key: "1", locale: "ja" },
      { occurred_at: 401, entry_date: "2026-05-12", card_type: "name", grade: 5, subject_key: "1", locale: null },
    ]);
    const result = await pullGradeLog(client, "u");
    expect(result?.[0].locale).toBe("ja");
    expect(result?.[1].locale).toBe("en"); // null in cloud → "en" default
  });
});

describe("pushGradeLog locale (#1259)", () => {
  it("sends locale field in each row", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const entries = [
      makeEntry(500, { date: "2026-05-12", grade: 4, cardType: "name", locale: "ja" }),
    ];
    await pushGradeLog(client, "u", entries);
    const row = (upsert.mock.calls[0][0] as { locale: string }[])[0];
    expect(row.locale).toBe("ja");
  });

  it("defaults locale to en when not set on the entry", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const entries = [makeEntry(600, { date: "2026-05-12", grade: 4, cardType: "name" })];
    await pushGradeLog(client, "u", entries);
    const row = (upsert.mock.calls[0][0] as { locale: string }[])[0];
    expect(row.locale).toBe("en");
  });
});

describe("pushGradeLog learning_step / step_started_at (#1416)", () => {
  it("sends learning_step and step_started_at for an in-learning card", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const entries = [makeEntry(700, { learningStep: 0, stepStartedAt: 1_700_000 })];
    await pushGradeLog(client, "u", entries);
    const row = (upsert.mock.calls[0][0] as { learning_step: number | null; step_started_at: number | null }[])[0];
    expect(row.learning_step).toBe(0);
    expect(row.step_started_at).toBe(1_700_000);
  });

  it("sends learning_step: null and step_started_at: null for a graduated card (explicit null)", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const entries = [makeEntry(800, { learningStep: null, stepStartedAt: null })];
    await pushGradeLog(client, "u", entries);
    const row = (upsert.mock.calls[0][0] as { learning_step: number | null; step_started_at: number | null }[])[0];
    expect(row.learning_step).toBeNull();
    expect(row.step_started_at).toBeNull();
  });

  it("sends null for both when neither field is set (legacy call site - pre-migration entries)", async () => {
    const { client, upsert } = makeClientWithUpsert();
    const entries = [makeEntry(900)]; // no learningStep / stepStartedAt
    await pushGradeLog(client, "u", entries);
    const row = (upsert.mock.calls[0][0] as { learning_step: number | null; step_started_at: number | null }[])[0];
    expect(row.learning_step).toBeNull();
    expect(row.step_started_at).toBeNull();
  });
});

describe("pullGradeLog learning_step / step_started_at (#1416)", () => {
  it("maps learning_step and step_started_at from a cloud row for an in-learning card", async () => {
    const { client } = makeClientWithOrderedSelect([
      { occurred_at: 700, entry_date: "2026-05-12", card_type: "name", grade: 1, subject_key: null, locale: "en", learning_step: 0, step_started_at: 1_700_000 },
    ]);
    const result = await pullGradeLog(client, "u");
    expect(result?.[0].learningStep).toBe(0);
    expect(result?.[0].stepStartedAt).toBe(1_700_000);
  });

  it("omits learningStep and stepStartedAt when the cloud row has null (pre-migration / graduated)", async () => {
    const { client } = makeClientWithOrderedSelect([
      { occurred_at: 800, entry_date: "2026-05-12", card_type: "name", grade: 4, subject_key: null, locale: "en", learning_step: null, step_started_at: null },
    ]);
    const result = await pullGradeLog(client, "u");
    expect(result?.[0].learningStep).toBeUndefined();
    expect(result?.[0].stepStartedAt).toBeUndefined();
  });

  it("omits learningStep and stepStartedAt when the fields are absent on the cloud row (pre-migration row)", async () => {
    const { client } = makeClientWithOrderedSelect([
      { occurred_at: 900, entry_date: "2026-05-12", card_type: "name", grade: 4, subject_key: null, locale: "en" },
    ]);
    const result = await pullGradeLog(client, "u");
    expect(result?.[0].learningStep).toBeUndefined();
    expect(result?.[0].stepStartedAt).toBeUndefined();
  });
});
