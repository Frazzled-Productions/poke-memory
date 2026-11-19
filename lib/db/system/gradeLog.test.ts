/**
 * reconcileGradeLogOrphans against the D1 test database: the cases of the
 * Postgres integration test (lib/sync/integration/reconcile-orphans.test.ts)
 * for reconcile_grade_log_orphans (migration 032).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forUser } from "../scope";
import { createSqliteD1, createTestUser, type SqliteD1 } from "../testing/sqliteD1";
import { RECONCILE_LIMIT, reconcileGradeLogOrphans } from "./gradeLog";

const NOW = new Date("2026-11-19T04:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const TODAY = daysAgo(0);

let d1: SqliteD1;
let alice: string;
let bob: string;
let occurred = 1;

beforeEach(() => {
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
});
afterEach(() => d1.close());

async function grade(userId: string, cardType: string, subjectKey: string, locale: string, g: number, entryDate: string) {
  await forUser(d1, userId).insert("grade_log", {
    occurred_at: occurred++,
    entry_date: entryDate,
    card_type: cardType,
    subject_key: subjectKey,
    locale,
    grade: g,
  });
}

function cards(userId: string, filters: { subject_key?: string; locale?: string } = {}) {
  return forUser(d1, userId).select("card_reviews", {
    filters: Object.entries(filters).map(([column, value]) => ({ column, op: "eq" as const, value })),
    order: [{ column: "card_type" }, { column: "locale" }],
  });
}

const live = () => reconcileGradeLogOrphans(d1, { dryRun: false, now: NOW });

describe("reconcileGradeLogOrphans", () => {
  it("dry run (the default): counts the orphan, inserts nothing", async () => {
    await grade(alice, "name", "25", "en", 4, daysAgo(1));
    expect(await reconcileGradeLogOrphans(d1, { now: NOW })).toEqual({ dryRun: true, orphans: 1, inserted: 0 });
    expect(await cards(alice)).toHaveLength(0);
  });

  it("live run: inserts the placeholder with derived reps, first_seen, last_review and locale", async () => {
    await grade(alice, "name", "1", "ja", 4, daysAgo(3));
    await grade(alice, "name", "1", "ja", 4, daysAgo(1));
    expect(await live()).toEqual({ dryRun: false, orphans: 1, inserted: 1 });
    const [row] = await cards(alice);
    expect(row).toMatchObject({
      card_type: "name",
      subject_key: "1",
      locale: "ja",
      reps: 2,
      lapses: 0,
      first_seen: daysAgo(3),
      last_review: daysAgo(1),
      due_date: TODAY,
      fsrs_state: "review",
      seen_in_pasture: false,
      hidden_since: null,
      stability: 1,
      difficulty: 5,
      scheduled_days: 1,
      elapsed_days: 0,
    });
  });

  it("a second live run inserts nothing and leaves the row as it was", async () => {
    await grade(alice, "name", "4", "en", 5, daysAgo(1));
    await live();
    const [first] = await cards(alice);
    expect(await live()).toEqual({ dryRun: false, orphans: 0, inserted: 0 });
    expect(await cards(alice)).toEqual([first]);
  });

  it("does not heal a subject with only Again and Hard grades", async () => {
    await grade(alice, "name", "7", "en", 1, daysAgo(2));
    await grade(alice, "name", "7", "en", 2, daysAgo(1));
    expect((await live()).inserted).toBe(0);
  });

  it("never touches an existing card_reviews row", async () => {
    await forUser(d1, alice).insert("card_reviews", {
      card_type: "name",
      subject_key: "9",
      locale: "en",
      due_date: TODAY,
      reps: 5,
    });
    await grade(alice, "name", "9", "en", 4, daysAgo(1));
    expect((await live()).inserted).toBe(0);
    expect((await cards(alice))[0].reps).toBe(5);
  });

  it("treats each locale as its own subject", async () => {
    await grade(alice, "name", "25", "en", 4, daysAgo(1));
    await grade(alice, "name", "25", "ja", 4, daysAgo(1));
    await live();
    expect((await cards(alice)).map((r) => r.locale)).toEqual(["en", "ja"]);
  });

  it("normalises evolution and reverse-evolution card types", async () => {
    await grade(alice, "evolution", "100-101", "en", 4, daysAgo(1));
    await grade(alice, "reverse-evolution", "101-102", "en", 4, daysAgo(1));
    await live();
    expect((await cards(alice)).map((r) => r.card_type)).toEqual(["evolution-edge", "reverse-evolution-edge"]);
  });

  it("counts lapses as Again grades after the first graduation", async () => {
    await grade(alice, "name", "150", "en", 1, daysAgo(4));
    await grade(alice, "name", "150", "en", 4, daysAgo(3));
    await grade(alice, "name", "150", "en", 1, daysAgo(2));
    await grade(alice, "name", "150", "en", 4, daysAgo(1));
    await live();
    expect((await cards(alice))[0]).toMatchObject({ reps: 2, lapses: 1, first_seen: daysAgo(4) });
  });

  it("only looks at the last four days (CURRENT_DATE - 4 days, inclusive)", async () => {
    await grade(alice, "name", "1", "en", 4, daysAgo(4));
    await grade(alice, "name", "2", "en", 4, daysAgo(5));
    await live();
    expect((await cards(alice)).map((r) => r.subject_key)).toEqual(["1"]);
  });

  it("heals each user's orphans into that user's rows only", async () => {
    await grade(alice, "name", "1", "en", 4, daysAgo(1));
    await grade(bob, "name", "2", "en", 4, daysAgo(1));
    await live();
    expect((await cards(alice)).map((r) => r.subject_key)).toEqual(["1"]);
    expect((await cards(bob)).map((r) => r.subject_key)).toEqual(["2"]);
  });

  it(`inserts at most ${RECONCILE_LIMIT} rows a run`, async () => {
    for (let i = 1; i <= RECONCILE_LIMIT + 5; i++) await grade(alice, "name", String(i), "en", 4, daysAgo(1));
    expect(await live()).toEqual({ dryRun: false, orphans: RECONCILE_LIMIT, inserted: RECONCILE_LIMIT });
    expect((await live()).inserted).toBe(5);
  });
});
