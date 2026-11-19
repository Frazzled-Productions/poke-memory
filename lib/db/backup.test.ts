/**
 * The nightly backup (design D10) with a fake R2 bucket, and a restore of the
 * file into a fresh migrated database with the row counts compared.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { R2BucketLike } from "./d1";
import { BACKUP_RETENTION_DAYS, backupKey, dumpDatabase, pruneBackups, runBackup, sqlLiteral } from "./backup";
import { forUser } from "./scope";
import { BACKUP_TABLE_ORDER, backupTables } from "./system/backup";
import { discordPostStore, insertFeedback } from "./system/feedback";
import { checkRateLimit } from "./system/rateLimit";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";

/** An in-memory stand-in for an R2 bucket, listing in pages of `pageSize`. */
function fakeBucket(pageSize = 1000) {
  const objects = new Map<string, { body: string; uploaded: Date }>();
  const bucket: R2BucketLike & { objects: typeof objects } = {
    objects,
    async put(key, value) {
      objects.set(key, { body: String(value), uploaded: new Date() });
      return {};
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { text: async () => o.body } : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    async list({ prefix = "", cursor } = {}) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + pageSize);
      const truncated = start + pageSize < keys.length;
      return {
        objects: page.map((key) => ({ key, uploaded: objects.get(key)!.uploaded })),
        truncated,
        cursor: truncated ? String(start + pageSize) : undefined,
      };
    },
  };
  return bucket;
}

const NOW = new Date("2026-11-20T02:00:03.120Z");

let d1: SqliteD1;
beforeEach(() => {
  d1 = createSqliteD1();
});
afterEach(() => d1.close());

/** A database with a row in every table, awkward values included. */
async function seed(db: SqliteD1) {
  const alice = createTestUser(db, { username: "alice_1" });
  const bob = createTestUser(db, { username: "bob" });
  db.sqlite.exec(`
    INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId)
      VALUES ('s1', '2026-12-01', 'tok', '2026-11-01', '2026-11-01', '${alice}');
    INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES ('a1', '${alice}', 'credential', '${alice}', '$2b$10$abc''quoted', '2026-11-01', '2026-11-01');
    INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
      VALUES ('v1', 'x', 'y', '2026-12-01', '2026-11-01', '2026-11-01');
  `);
  const a = forUser(db, alice);
  await a.insert("card_reviews", [
    { card_type: "name", subject_key: "1", locale: "en", due_date: "2026-11-20", first_seen: "2026-01-01", last_review: "2026-11-01", stability: 21.75, reps: 3, seen_in_pasture: true },
    { card_type: "evolution-edge", subject_key: "1>2", locale: "ja", due_date: "2026-11-21", difficulty: 4.5 },
  ], { defaultToNull: false });
  await a.insert("streak_days", [{ review_date: "2026-11-18" }, { review_date: "2026-11-19" }]);
  await a.insert("grade_log", { occurred_at: 1763500000000, entry_date: "2026-11-19", card_type: "name", grade: 4, subject_key: "1", locale: "en" });
  // A reset after the reviews: restoring user_settings last keeps the pre-reset triggers quiet.
  await a.insert("user_settings", {
    settings: { note: "it's \"quoted\"\nand multi-line; -- not a comment", nested: { a: [1, null] } },
    timezone: "Europe/London",
    last_reset_at: "2026-11-19T12:00:00.000Z",
    push_notification_hour: 9,
  });
  await a.insert("push_subscriptions", { endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "p", auth_secret: "s" });
  const fb = await insertFeedback(db, { user_id: null, category: "bug", message: "O'Brien says 'hi' ;", page: null, app_version: "1.0" });
  await insertFeedback(db, { user_id: bob, category: "feature", message: "émoji ✨ Flabébé", page: "/", app_version: null });
  await discordPostStore(db).storeMessageId(fb.id, "123");
  await checkRateLimit(db, "c".repeat(64), "feedback", NOW);
}

describe("backupTables", () => {
  it("BACKUP_TABLE_ORDER lists exactly the migrated tables", async () => {
    const { tables, unlisted } = await backupTables(d1);
    expect(unlisted).toEqual([]);
    expect(tables).toEqual([...BACKUP_TABLE_ORDER]);
  });

  it("puts every table after the tables its foreign keys name", async () => {
    const { tables } = await backupTables(d1);
    for (const [i, table] of tables.entries()) {
      const parents = d1.sqlite.prepare(`SELECT "table" AS parent FROM pragma_foreign_key_list(?)`).all(table) as { parent: string }[];
      for (const { parent } of parents) expect(tables.indexOf(parent), `${table} -> ${parent}`).toBeLessThan(i);
    }
  });

  it("appends a table no migration listed yet, so it is never left out", async () => {
    d1.sqlite.exec("CREATE TABLE zz_new (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO zz_new (v) VALUES ('x');");
    const { tables, unlisted } = await backupTables(d1);
    expect(unlisted).toEqual(["zz_new"]);
    expect(tables.at(-1)).toBe("zz_new");
  });
});

describe("dumpDatabase", () => {
  it("starts with the header the restore check parses: a dated first line, then rows per table", async () => {
    await seed(d1);
    const { sql, counts } = await dumpDatabase(d1, NOW);
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- poke-memory D1 backup 2026-11-20T02:00:03.120Z");
    expect(lines.slice(1, 1 + BACKUP_TABLE_ORDER.length)).toEqual(
      BACKUP_TABLE_ORDER.map((t) => `-- rows ${t}: ${counts[t]}`),
    );
    expect(counts).toMatchObject({ user: 2, card_reviews: 2, streak_days: 2, feedback: 2, rate_limit_buckets: 1 });
    // Same pattern as scripts/cloudflare/check-restore.mjs.
    const rowsLine = /^-- rows ([A-Za-z_][A-Za-z0-9_]*): (\d+)\s*$/;
    expect(lines.filter((l) => rowsLine.test(l))).toHaveLength(BACKUP_TABLE_ORDER.length);
    // Data only: one INSERT per row after the header (a multi-line value spans lines).
    const inserts = lines.filter((l) => l.startsWith("INSERT INTO "));
    expect(inserts).toHaveLength(Object.values(counts).reduce((a, b) => a + b, 0));
    expect(sql).not.toMatch(/\b(CREATE|DROP|PRAGMA|BEGIN|COMMIT)\b/);
  });

  it("an empty database still lists every table with 0 rows", async () => {
    const { sql } = await dumpDatabase(d1, NOW);
    expect(sql).toContain("-- rows user: 0\n");
    expect(sql).not.toContain("INSERT");
  });

  it("restores into a fresh migrated database with the same rows in every table", async () => {
    await seed(d1);
    const { sql, counts } = await dumpDatabase(d1, NOW);

    const fresh = createSqliteD1();
    try {
      fresh.sqlite.exec(sql);
      for (const table of BACKUP_TABLE_ORDER) {
        const n = (fresh.sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
        expect(n, table).toBe(counts[table]);
      }
      // Values survive the round trip (push_subscriptions.last_seen_at aside:
      // its insert trigger stamps the restore time).
      for (const table of BACKUP_TABLE_ORDER.filter((t) => t !== "push_subscriptions")) {
        const read = (db: SqliteD1) => db.sqlite.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
        expect(read(fresh), table).toEqual(read(d1));
      }
    } finally {
      fresh.close();
    }
  });
});

describe("sqlLiteral", () => {
  it("encodes NULL, numbers, text with quotes and blobs", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(21.75)).toBe("21.75");
    expect(sqlLiteral(3)).toBe("3");
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral(new Uint8Array([0, 255]))).toBe("X'00ff'");
    expect(() => sqlLiteral(Number.NaN)).toThrow();
  });
});

describe("runBackup and pruneBackups", () => {
  it("writes d1/YYYY-MM-DD.sql and returns the counts", async () => {
    await seed(d1);
    const bucket = fakeBucket();
    const result = await runBackup(d1, bucket, NOW);
    expect(result.key).toBe("d1/2026-11-20.sql");
    expect(backupKey(NOW)).toBe("d1/2026-11-20.sql");
    expect(result.counts.user).toBe(2);
    const stored = await bucket.get("d1/2026-11-20.sql");
    expect((await stored!.text()).startsWith("-- poke-memory D1 backup ")).toBe(true);
    expect(result.bytes).toBe(new TextEncoder().encode(await stored!.text()).byteLength);
  });

  it(`deletes backups dated more than ${BACKUP_RETENTION_DAYS} days ago, across list pages, and keeps other keys`, async () => {
    const bucket = fakeBucket(2);
    const keys = [
      "d1/2026-08-21.sql", // 91 days before 2026-11-20
      "d1/2026-08-22.sql", // exactly 90 days: kept
      "d1/2026-01-01.sql",
      "d1/2026-11-19.sql",
      "d1/notes.txt",
      "other/2020-01-01.sql",
    ];
    for (const k of keys) await bucket.put(k, "x");
    const pruned = await pruneBackups(bucket, NOW);
    expect(pruned.sort()).toEqual(["d1/2026-01-01.sql", "d1/2026-08-21.sql"]);
    expect([...bucket.objects.keys()].sort()).toEqual(
      ["d1/2026-08-22.sql", "d1/2026-11-19.sql", "d1/notes.txt", "other/2020-01-01.sql"],
    );
  });
});
