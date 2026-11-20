/**
 * The guards that stay in the database as SQLite triggers and CHECKs (design
 * D3), run against db/d1/migrations through the node:sqlite D1 shim. Ports of
 * db/tests/002_card_reviews_regression_trigger.test.sql and the Postgres
 * integration tests in lib/sync/integration/ (regression-trigger.test.ts for
 * 002/015/016/017/020/021/022/029/043, push-subscription-limits.test.ts for 049).
 * Each guard must refuse with code 23514 (check_violation), as in Postgres.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KNOWN_PUSH_ENDPOINT_PATTERN } from "@/lib/push/endpoints";
import { toDbError } from "./errors";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";

let d1: SqliteD1;
let user: string;

beforeEach(() => {
  d1 = createSqliteD1();
  user = createTestUser(d1);
});

afterEach(() => {
  d1.close();
});

/** Runs SQL through the D1 interface; resolves to the Postgres-style code or "ok". */
async function outcome(sql: string, ...params: unknown[]): Promise<string> {
  try {
    await d1.prepare(sql).bind(...params).run();
    return "ok";
  } catch (err) {
    return toDbError(err).code;
  }
}

function query<T = Record<string, unknown>>(sql: string, ...params: (string | number | null)[]): T[] {
  return d1.sqlite.prepare(sql).all(...params) as T[];
}

const today = () => new Date().toISOString().slice(0, 10);
const daysFromToday = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** A reviewed card, as the Postgres suite's insertCard. */
async function insertCard(subjectKey: string, overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    user_id: user,
    card_type: "name",
    subject_key: subjectKey,
    stability: 2.0,
    difficulty: 5.0,
    elapsed_days: 1,
    scheduled_days: 3,
    reps: 2,
    lapses: 0,
    fsrs_state: "review",
    due_date: "2026-06-01",
    last_review: "2026-05-20",
    first_seen: "2026-05-18",
    seen_in_pasture: 0,
    ...overrides,
  };
  const columns = Object.keys(row);
  return outcome(
    `INSERT INTO card_reviews (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
}

function updateCard(subjectKey: string, set: string, ...params: unknown[]) {
  return outcome(
    `UPDATE card_reviews SET ${set} WHERE user_id = ? AND card_type = 'name' AND subject_key = ?`,
    ...params,
    user,
    subjectKey,
  );
}

describe("card_reviews regression trigger (002, 015, 016, 017, 029)", () => {
  beforeEach(async () => {
    expect(await insertCard("101")).toBe("ok");
  });

  it("blocks last_review to NULL (002 probe A)", async () => {
    expect(await updateCard("101", "last_review = NULL")).toBe("23514");
  });

  it("blocks first_seen to NULL (002 probe B)", async () => {
    expect(await updateCard("101", "first_seen = NULL")).toBe("23514");
  });

  it("blocks last_review moving backward (002 probe C)", async () => {
    expect(await updateCard("101", "last_review = '2026-04-01'")).toBe("23514");
  });

  it("allows an Again regrade that moves last_review forward (002 probe D)", async () => {
    expect(
      await updateCard("101", "scheduled_days = 1, last_review = ?, due_date = ?", today(), daysFromToday(1)),
    ).toBe("ok");
  });

  it("allows last_review staying the same", async () => {
    expect(await updateCard("101", "last_review = '2026-05-20', reps = 3")).toBe("ok");
  });

  it("blocks reps decreasing (015)", async () => {
    expect(await updateCard("101", "reps = 1")).toBe("23514");
  });

  it("blocks lapses decreasing (015)", async () => {
    expect(await updateCard("101", "lapses = 1")).toBe("ok");
    expect(await updateCard("101", "lapses = 0")).toBe("23514");
  });

  it("blocks scheduled_days dropping without advancing last_review (016)", async () => {
    expect(await updateCard("101", "scheduled_days = 1")).toBe("23514");
  });

  it("allows scheduled_days dropping while last_review advances (016, Again)", async () => {
    expect(await updateCard("101", "scheduled_days = 1, last_review = '2026-05-25'")).toBe("ok");
  });

  it("blocks seen_in_pasture true to false, allows false to true (017)", async () => {
    expect(await updateCard("101", "seen_in_pasture = 1")).toBe("ok");
    expect(await updateCard("101", "seen_in_pasture = 0")).toBe("23514");
  });

  it("fires on the DO UPDATE path of an upsert, as Postgres does", async () => {
    expect(
      await outcome(
        `INSERT INTO card_reviews (user_id, card_type, subject_key, due_date, reps)
         VALUES (?, 'name', '101', '2026-06-01', 0)
         ON CONFLICT (user_id, card_type, subject_key, locale) DO UPDATE SET reps = excluded.reps`,
        user,
      ),
    ).toBe("23514");
  });

  it("a refused update leaves the row unchanged", async () => {
    await updateCard("101", "reps = 0");
    expect(query("SELECT reps FROM card_reviews WHERE subject_key = '101'")).toEqual([{ reps: 2 }]);
  });
});

describe("card_reviews CHECKs (020, 029)", () => {
  it.each([
    ["difficulty above 10", { difficulty: 10.5 }],
    ["difficulty below 0", { difficulty: -0.1 }],
    ["negative stability", { stability: -1 }],
    ["an unknown locale", { locale: "fr" }],
    ["an unknown fsrs_state", { fsrs_state: "done" }],
    ["a malformed due_date", { due_date: "2026-13-01" }],
    ["seen_in_pasture outside 0/1", { seen_in_pasture: 2 }],
  ])("blocks %s", async (_label, overrides) => {
    expect(await insertCard("201", overrides)).toBe("23514");
  });

  it("allows boundary values: stability 0, difficulty 0 and 10", async () => {
    expect(await insertCard("202", { stability: 0, difficulty: 0 })).toBe("ok");
    expect(await insertCard("203", { difficulty: 10 })).toBe("ok");
  });

  it("allows two rows differing only by locale (029 primary key)", async () => {
    expect(await insertCard("204", { locale: "en" })).toBe("ok");
    expect(await insertCard("204", { locale: "ja" })).toBe("ok");
    expect(await insertCard("204", { locale: "ja" })).toBe("23505");
  });

  it("defaults a new card's FSRS fields and locale", async () => {
    await outcome(
      `INSERT INTO card_reviews (user_id, card_type, subject_key, due_date) VALUES (?, 'name', '205', '2026-06-01')`,
      user,
    );
    expect(
      query("SELECT locale, stability, reps, fsrs_state, seen_in_pasture FROM card_reviews WHERE subject_key = '205'"),
    ).toEqual([{ locale: "en", stability: 0, reps: 0, fsrs_state: "new", seen_in_pasture: 0 }]);
  });

  it("gives new rows a v4 UUID id", async () => {
    await insertCard("206");
    const [{ id }] = query<{ id: string }>("SELECT id FROM card_reviews WHERE subject_key = '206'");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("card_reviews updated_at stamp (043)", () => {
  it("stamps updated_at on update whatever the client sent", async () => {
    await insertCard("600");
    const before = Date.now();
    expect(await updateCard("600", "reps = 3, updated_at = '2020-01-01T00:00:00.000Z'")).toBe("ok");
    const [{ updated_at }] = query<{ updated_at: string }>(
      "SELECT updated_at FROM card_reviews WHERE subject_key = '600'",
    );
    expect(updated_at).not.toBe("2020-01-01T00:00:00.000Z");
    expect(Date.parse(updated_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("stamps updated_at on the DO UPDATE path of an upsert", async () => {
    await insertCard("601");
    await outcome(
      `INSERT INTO card_reviews (user_id, card_type, subject_key, due_date, reps, updated_at)
       VALUES (?, 'name', '601', '2026-06-01', 5, '2020-01-01T00:00:00.000Z')
       ON CONFLICT (user_id, card_type, subject_key, locale)
       DO UPDATE SET reps = excluded.reps, updated_at = excluded.updated_at`,
      user,
    );
    const [row] = query<{ reps: number; updated_at: string }>(
      "SELECT reps, updated_at FROM card_reviews WHERE subject_key = '601'",
    );
    expect(row.reps).toBe(5);
    expect(row.updated_at).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("streak_days no future date (021)", () => {
  it("blocks a review_date far in the future", async () => {
    expect(await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)", user, daysFromToday(5))).toBe(
      "23514",
    );
  });

  it("allows today and tomorrow (one grace day for UTC+14)", async () => {
    expect(await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)", user, today())).toBe("ok");
    expect(await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)", user, daysFromToday(1))).toBe(
      "ok",
    );
  });

  it("blocks an update moving a day into the future", async () => {
    await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)", user, today());
    expect(await outcome("UPDATE streak_days SET review_date = ? WHERE user_id = ?", daysFromToday(3), user)).toBe(
      "23514",
    );
  });

  it("keeps one row per user and day", async () => {
    await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)", user, today());
    expect(await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)", user, today())).toBe("23505");
  });
});

describe("last_reset_at tombstone (022)", () => {
  beforeEach(() => {
    d1.sqlite
      .prepare("INSERT INTO user_settings (user_id, last_reset_at) VALUES (?, ?)")
      .run(user, new Date().toISOString());
  });

  it("blocks a card_reviews insert with first_seen before the reset", async () => {
    expect(
      await insertCard("401", { due_date: "2020-06-01", last_review: "2020-05-20", first_seen: "2020-05-18" }),
    ).toBe("23514");
  });

  it("blocks a card_reviews insert with last_review before the reset", async () => {
    expect(await insertCard("402", { last_review: "2020-05-20", first_seen: null })).toBe("23514");
  });

  it("blocks a streak_days insert before the reset", async () => {
    expect(await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, '2020-01-01')", user)).toBe("23514");
  });

  it("blocks a grade_log insert before the reset", async () => {
    expect(
      await outcome(
        `INSERT INTO grade_log (user_id, occurred_at, entry_date, card_type, grade, subject_key)
         VALUES (?, ?, '2020-01-01', 'name', 4, '1')`,
        user,
        Date.now(),
      ),
    ).toBe("23514");
  });

  it("allows rows dated on or after the reset", async () => {
    expect(await insertCard("403", { due_date: daysFromToday(10), last_review: today(), first_seen: today() })).toBe(
      "ok",
    );
    expect(await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)", user, today())).toBe("ok");
  });

  it("does not apply to other users", async () => {
    const other = createTestUser(d1);
    expect(await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, '2020-01-01')", other)).toBe("ok");
  });
});

describe("grade_log CHECKs (006)", () => {
  it("refuses a grade outside 1, 2, 4, 5 and a duplicate occurred_at", async () => {
    const insert = (occurredAt: number, grade: number) =>
      outcome(
        `INSERT INTO grade_log (user_id, occurred_at, entry_date, card_type, grade, subject_key)
         VALUES (?, ?, ?, 'name', ?, '1')`,
        user,
        occurredAt,
        today(),
        grade,
      );
    expect(await insert(1, 3)).toBe("23514");
    expect(await insert(1, 4)).toBe("ok");
    expect(await insert(1, 5)).toBe("23505");
  });
});

describe("push_subscriptions known hosts (049)", () => {
  const subscribe = (endpoint: string, owner = user) =>
    outcome(
      "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret) VALUES (?, ?, 'p256', 'auth')",
      owner,
      endpoint,
    );

  it.each([
    "https://web.push.apple.com/a",
    "https://fcm.googleapis.com/fcm/send/a",
    "https://updates.push.services.mozilla.com/wpush/v2/a",
    "https://wns2-par02p.notify.windows.com/w/?token=a",
  ])("accepts %s", async (endpoint) => {
    expect(await subscribe(endpoint)).toBe("ok");
  });

  it.each([
    "https://push.example/a",
    "http://fcm.googleapis.com/x",
    "https://fcm.googleapis.com.example.com/x",
    "https://fcm.googleapis.com@example.com/x",
    "https://fcm.googleapis.com:8443/x",
  ])("refuses %s", async (endpoint) => {
    expect(await subscribe(endpoint)).toBe("23514");
  });

  it("matches KNOWN_PUSH_ENDPOINT_PATTERN in lib/push/endpoints.ts (one list)", async () => {
    const pattern = new RegExp(KNOWN_PUSH_ENDPOINT_PATTERN);
    const samples = [
      "https://fcm.googleapis.com/",
      "https://fcm.googleapis.com",
      "https://FCM.googleapis.com/x",
      "https://.push.apple.com/x",
      "https://a.b-c.push.apple.com/x",
      "https://a_b.push.apple.com/x",
      "https://push.apple.com/x",
      "https://x.notify.windows.com/x",
      "https://x.y.notify.windows.com/x",
      "https://-.notify.windows.com/x",
      "https://notify.windows.com/x",
      "https://updates.push.services.mozilla.com/",
      "https://updates.push.services.mozilla.com.evil/",
      "https://evil.com/https://fcm.googleapis.com/",
      "https:///fcm.googleapis.com/",
      " https://fcm.googleapis.com/x",
    ];
    for (const endpoint of samples) {
      const expected = pattern.test(endpoint) ? "ok" : "23514";
      const owner = createTestUser(d1);
      expect([endpoint, await subscribe(endpoint, owner)]).toEqual([endpoint, expected]);
    }
  });
});

describe("push_subscriptions at most 10 per account (049)", () => {
  const HOST = "https://fcm.googleapis.com/fcm/send";

  /** `count` rows, oldest first (last_seen_at set after insert, as the Postgres seed does). */
  function seed(owner: string, count: number) {
    for (let i = 0; i < count; i++) {
      d1.sqlite
        .prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret) VALUES (?, ?, 'p', 'a')")
        .run(owner, `${HOST}/${i}`);
      d1.sqlite
        .prepare("UPDATE push_subscriptions SET last_seen_at = ? WHERE user_id = ? AND endpoint = ?")
        .run(new Date(Date.now() - (count - i) * 3_600_000).toISOString(), owner, `${HOST}/${i}`);
    }
  }

  const subscribe = (endpoint: string, lastSeen = new Date().toISOString(), owner = user) =>
    outcome(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret, last_seen_at)
       VALUES (?, ?, 'p256', 'auth', ?)`,
      owner,
      endpoint,
      lastSeen,
    );

  const endpoints = (owner = user) =>
    query<{ endpoint: string }>("SELECT endpoint FROM push_subscriptions WHERE user_id = ?", owner).map(
      (r) => r.endpoint,
    );

  it("a new device at the limit: the oldest row goes and the user has 10", async () => {
    seed(user, 10);
    expect(await subscribe(`${HOST}/new`)).toBe("ok");
    const rows = endpoints();
    expect(rows).toHaveLength(10);
    expect(rows).toContain(`${HOST}/new`);
    expect(rows).not.toContain(`${HOST}/0`);
  });

  it("20 inserts in a row leave 10", async () => {
    for (let i = 0; i < 20; i++) await subscribe(`${HOST}/p${i}`);
    expect(endpoints()).toHaveLength(10);
  });

  it("an account already over the limit comes down to 10, the newest among them", async () => {
    seed(user, 14);
    await subscribe(`${HOST}/new`);
    const rows = endpoints();
    expect(rows).toHaveLength(10);
    expect(rows).toContain(`${HOST}/new`);
    expect(rows).toContain(`${HOST}/13`);
    expect(rows).not.toContain(`${HOST}/4`);
  });

  it("an unknown host at the limit removes nothing", async () => {
    seed(user, 10);
    expect(await subscribe("https://push.example/a")).toBe("23514");
    expect(endpoints()).toHaveLength(10);
  });

  it("reaching the limit changes no one else's rows", async () => {
    const other = createTestUser(d1);
    seed(user, 10);
    seed(other, 3);
    await subscribe(`${HOST}/new`);
    expect(endpoints(other)).toHaveLength(3);
  });

  it("the database sets last_seen_at, so a wrong device clock does not decide which row goes", async () => {
    seed(user, 9);
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
    await subscribe(`${HOST}/slow-clock`, yearAgo);
    const [{ last_seen_at }] = query<{ last_seen_at: string }>(
      "SELECT last_seen_at FROM push_subscriptions WHERE endpoint = ?",
      `${HOST}/slow-clock`,
    );
    expect(Date.parse(last_seen_at)).toBeGreaterThan(Date.now() - 60_000);

    await subscribe(`${HOST}/new`);
    const after = endpoints();
    expect(after).toHaveLength(10);
    expect(after).toContain(`${HOST}/slow-clock`);
    expect(after).not.toContain(`${HOST}/0`);
  });

  it("more than 10 devices take turns: the device with no row gets one back", async () => {
    seed(user, 10);
    await subscribe(`${HOST}/eleven`);
    expect(endpoints()).not.toContain(`${HOST}/0`);
    await subscribe(`${HOST}/0`);
    const rows = endpoints();
    expect(rows).toHaveLength(10);
    expect(rows).toContain(`${HOST}/0`);
    expect(rows).toContain(`${HOST}/eleven`);
    expect(rows).not.toContain(`${HOST}/1`);
  });

  it("an existing device re-subscribing at the limit replaces no other row", async () => {
    seed(user, 10);
    d1.sqlite.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(user, `${HOST}/5`);
    await subscribe(`${HOST}/5`);
    expect(endpoints().sort()).toEqual(Array.from({ length: 10 }, (_, i) => `${HOST}/${i}`).sort());
  });
});

describe("other tables", () => {
  it("feedback: category CHECK, guest rows with no user", async () => {
    expect(await outcome("INSERT INTO feedback (category, message) VALUES ('bug', 'x')")).toBe("ok");
    expect(await outcome("INSERT INTO feedback (category, message) VALUES ('praise', 'x')")).toBe("23514");
  });

  it("rate_limit_buckets: action and hash-length CHECKs (041, 045)", async () => {
    const hash = "a".repeat(64);
    expect(await outcome("INSERT INTO rate_limit_buckets (ip_hash, action) VALUES (?, 'feedback')", hash)).toBe("ok");
    expect(await outcome("INSERT INTO rate_limit_buckets (ip_hash, action) VALUES (?, 'other')", hash)).toBe("23514");
    expect(await outcome("INSERT INTO rate_limit_buckets (ip_hash, action) VALUES ('short', 'signin')")).toBe("23514");
  });

  it("user_settings: settings must be JSON, push hour 0 to 23", async () => {
    expect(await outcome("INSERT INTO user_settings (user_id, settings) VALUES (?, 'not json')", user)).toBe("23514");
    expect(await outcome("INSERT INTO user_settings (user_id, push_notification_hour) VALUES (?, 24)", user)).toBe(
      "23514",
    );
    expect(await outcome("INSERT INTO user_settings (user_id) VALUES (?)", user)).toBe("ok");
    expect(query("SELECT settings FROM user_settings")).toEqual([{ settings: "{}" }]);
  });

  it("has no feedback_discord_posts table (dropped by 0004 with Discord, 20 November 2026)", () => {
    expect(query("SELECT name FROM sqlite_master WHERE name = 'feedback_discord_posts'")).toEqual([]);
  });

  it("refuses a row for a user that does not exist (foreign key)", async () => {
    expect(await outcome("INSERT INTO streak_days (user_id, review_date) VALUES ('nobody', ?)", today())).toBe("23503");
  });

  it("deleting a user cascades to every per-user table", async () => {
    await insertCard("1");
    await outcome("INSERT INTO streak_days (user_id, review_date) VALUES (?, ?)", user, today());
    await outcome("INSERT INTO user_settings (user_id) VALUES (?)", user);
    await outcome(
      `INSERT INTO grade_log (user_id, occurred_at, entry_date, card_type, grade, subject_key)
       VALUES (?, 1, ?, 'name', 4, '1')`,
      user,
      today(),
    );
    await outcome(
      "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret) VALUES (?, 'https://fcm.googleapis.com/x', 'p', 'a')",
      user,
    );
    await outcome("INSERT INTO feedback (user_id, category, message) VALUES (?, 'bug', 'x')", user);
    expect(await outcome('DELETE FROM "user" WHERE id = ?', user)).toBe("ok");
    for (const table of ["card_reviews", "streak_days", "user_settings", "grade_log", "push_subscriptions", "feedback"]) {
      expect([table, query(`SELECT count(*) AS n FROM ${table}`)[0]]).toEqual([table, { n: 0 }]);
    }
  });
});

describe("Better Auth user table (0002_auth.sql)", () => {
  it.each(["ab", "a".repeat(31), "Alice", "al.ice", "al ice", "ålice"])("refuses username %j", async (name) => {
    expect(
      await outcome(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, username)
         VALUES ('u1', 'n', 'e@example.test', 0, 'now', 'now', ?)`,
        name,
      ),
    ).toBe("23514");
  });

  it.each(["abc", "a".repeat(30), "a_b-c9"])("accepts username %j", async (name) => {
    expect(createTestUser(d1, { username: name })).toBeTruthy();
  });

  it("allows accounts without a username (GitHub, Google) and checks renames", async () => {
    const id = createTestUser(d1, { username: null });
    expect(await outcome('UPDATE "user" SET username = ? WHERE id = ?', "Bad Name", id)).toBe("23514");
    expect(await outcome('UPDATE "user" SET username = ? WHERE id = ?', "good_name", id)).toBe("ok");
  });
});
