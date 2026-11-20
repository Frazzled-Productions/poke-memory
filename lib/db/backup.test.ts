/**
 * The nightly backup (design D10) with a fake R2 bucket, a restore of the
 * file into a fresh migrated database with the row counts compared, and the
 * monthly restore check the production Worker runs inside Cloudflare.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { R2BucketLike } from "./d1";
import {
  BACKUP_RETENTION_DAYS,
  MAX_BACKUP_AGE_DAYS,
  backupKeys,
  checkLatestBackup,
  dumpDatabase,
  pruneBackups,
  runBackup,
  runRestoreCheck,
  sqlLiteral,
  type BackupManifest,
} from "./backup";
import { forUser } from "./scope";
import { BACKUP_TABLE_ORDER, backupTables, readTablePages } from "./system/backup";
import { parseMigrationTriggers } from "./migrationTriggers.mjs";
import { discordPostStore, insertFeedback } from "./system/feedback";
import { checkRateLimit } from "./rateLimit";
import { createSqliteD1, createTestUser, type SqliteD1 } from "./testing/sqliteD1";

/** An in-memory stand-in for an R2 bucket, listing in pages of `pageSize`. */
function fakeBucket(pageSize = 1000) {
  const objects = new Map<string, { body: Uint8Array; uploaded: Date }>();
  const bucket: R2BucketLike & { objects: typeof objects } = {
    objects,
    async put(key, value) {
      const body =
        typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer);
      objects.set(key, { body: body.slice(), uploaded: new Date() });
      return {};
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        text: async () => new TextDecoder().decode(o.body),
        arrayBuffer: async () => o.body.slice().buffer,
      };
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
const PREFIX = "d1/poke-memory";

async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function migrationTexts(): string[] {
  const dir = join(process.cwd(), "db", "d1", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

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
  it("starts with a header: a dated first line, then rows per table", async () => {
    await seed(d1);
    const { sql, counts } = await dumpDatabase(d1, NOW);
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- poke-memory D1 backup 2026-11-20T02:00:03.120Z");
    expect(lines.slice(1, 1 + BACKUP_TABLE_ORDER.length)).toEqual(
      BACKUP_TABLE_ORDER.map((t) => `-- rows ${t}: ${counts[t]}`),
    );
    expect(counts).toMatchObject({ user: 2, card_reviews: 2, streak_days: 2, feedback: 2, rate_limit_buckets: 1 });
    const rowsLine = /^-- rows ([A-Za-z_][A-Za-z0-9_]*): (\d+)\s*$/;
    expect(lines.filter((l) => rowsLine.test(l))).toHaveLength(BACKUP_TABLE_ORDER.length);
    // One INSERT per row after the header, each on its own line.
    const inserts = lines.filter((l) => l.startsWith("INSERT INTO "));
    expect(inserts).toHaveLength(Object.values(counts).reduce((a, b) => a + b, 0));
    // No schema beyond the triggers it drops and recreates, and no PRAGMA or transaction.
    expect(lines.filter((l) => /^(CREATE|DROP)\b/.test(l)).every((l) => /^(DROP TRIGGER IF EXISTS|CREATE TRIGGER) /.test(l))).toBe(true);
    expect(sql).not.toMatch(/\b(PRAGMA|BEGIN TRANSACTION|COMMIT)\b/);
  });

  it("an empty database still lists every table with 0 rows", async () => {
    const { sql } = await dumpDatabase(d1, NOW);
    expect(sql).toContain("-- rows user: 0\n");
    expect(sql).not.toContain("INSERT INTO");
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
      // Values survive the round trip, push_subscriptions.last_seen_at included:
      // the file restores with the triggers off.
      for (const table of BACKUP_TABLE_ORDER) {
        const read = (db: SqliteD1) => db.sqlite.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
        expect(read(fresh), table).toEqual(read(d1));
      }
    } finally {
      fresh.close();
    }
  });
});

describe("dumpDatabase restores faithfully, triggers bypassed as the copy left them", () => {
  /** Rows today's triggers would trim or refuse, written with the triggers off (as the copy did). */
  function seedTriggerBypassingRows(db: SqliteD1, userId: string): void {
    const triggers = db.sqlite
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('push_subscriptions', 'streak_days')`)
      .all() as { name: string; sql: string }[];
    for (const t of triggers) db.sqlite.exec(`DROP TRIGGER "${t.name}"`);
    const push = db.sqlite.prepare(
      "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret, last_seen_at) VALUES (?, ?, 'p', 's', ?)",
    );
    for (let i = 0; i < 11; i++) {
      push.run(userId, `https://fcm.googleapis.com/fcm/send/${i}`, `2026-11-${String(i + 1).padStart(2, "0")}T08:00:00.000Z`);
    }
    db.sqlite.prepare("INSERT INTO streak_days (user_id, review_date) VALUES (?, '2099-01-01')").run(userId);
    for (const t of triggers) db.sqlite.exec(t.sql);
  }

  it("11 push rows for one user and a 2099 streak date restore with identical counts and values", async () => {
    const alice = createTestUser(d1, { username: "alice_1" });
    seedTriggerBypassingRows(d1, alice);
    const { sql, counts } = await dumpDatabase(d1, NOW);
    expect(counts).toMatchObject({ push_subscriptions: 11, streak_days: 1 });

    const fresh = createSqliteD1();
    try {
      fresh.sqlite.exec(sql);
      for (const table of BACKUP_TABLE_ORDER) {
        const read = (db: SqliteD1) => db.sqlite.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
        expect(read(fresh), table).toEqual(read(d1));
      }
    } finally {
      fresh.close();
    }
  });

  it("drops the database's triggers before the rows and recreates them verbatim after", async () => {
    const { sql } = await dumpDatabase(d1, NOW);
    const triggers = d1.sqlite
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY rowid")
      .all() as { name: string; sql: string }[];
    expect(triggers.map((t) => t.name).sort()).toEqual(parseMigrationTriggers(migrationTexts()).map(([n]) => n).sort());
    for (const t of triggers) expect(sql).toContain(`DROP TRIGGER IF EXISTS "${t.name}";`);
    for (const t of triggers) expect(sql).toContain(`${t.sql};`);

    const fresh = createSqliteD1();
    try {
      fresh.sqlite.exec(sql);
      const after = fresh.sqlite
        .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
        .all();
      expect(after).toEqual(
        d1.sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all(),
      );
    } finally {
      fresh.close();
    }
  });

  it("pages by rowid, so a table larger than a page is read whole and in order", async () => {
    const alice = createTestUser(d1, { username: "alice_1" });
    const insert = d1.sqlite.prepare(
      "INSERT INTO grade_log (user_id, occurred_at, entry_date, card_type, grade, subject_key) VALUES (?, ?, '2026-11-19', 'name', 4, '1')",
    );
    for (let i = 0; i < 2501; i++) insert.run(alice, 1_000 + i);
    d1.sqlite.prepare("DELETE FROM grade_log WHERE occurred_at % 7 = 0").run();
    const pages: number[] = [];
    const seen: number[] = [];
    await readTablePages(d1, "grade_log", (columns, rows) => {
      pages.push(rows.length);
      const at = columns.indexOf("occurred_at");
      for (const row of rows) seen.push(row[at] as number);
      expect(columns).not.toContain("_backup_rowid");
    });
    const expected = (d1.sqlite.prepare("SELECT occurred_at FROM grade_log ORDER BY rowid").all() as { occurred_at: number }[]).map((r) => r.occurred_at);
    expect(seen).toEqual(expected);
    expect(pages.length).toBe(3);
  });

  it("pages with WHERE rowid > ?, not OFFSET", async () => {
    const queries: string[] = [];
    const spy = new Proxy(d1, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (query: string) => {
            queries.push(query);
            return target.prepare(query);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await readTablePages(spy, "user", () => {});
    expect(queries.some((q) => /WHERE rowid > \?/.test(q))).toBe(true);
    expect(queries.some((q) => /OFFSET/i.test(q))).toBe(false);
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

  it("writes text with a line break or other control character as UTF-8 hex, so every statement is one line", () => {
    expect(sqlLiteral("a\nb")).toBe("CAST(X'610a62' AS TEXT)");
    expect(sqlLiteral("tab\there")).toBe("CAST(X'7461620968657265' AS TEXT)");
    expect(sqlLiteral("émoji ✨")).toBe("'émoji ✨'");
  });
});

describe("dumpDatabase: one statement a line", () => {
  it("a multi-line value stays on its INSERT line and restores unchanged", async () => {
    await seed(d1);
    await insertFeedback(d1, {
      user_id: null,
      category: "bug",
      message: 'line one\nINSERT INTO "user" ("id") VALUES (\'x\');\r\nline three',
      page: null,
      app_version: null,
    });
    const { sql, counts } = await dumpDatabase(d1, NOW);
    const inserts = sql.split("\n").filter((l) => l.startsWith("INSERT INTO "));
    expect(inserts).toHaveLength(Object.values(counts).reduce((a, b) => a + b, 0));
    expect(inserts.filter((l) => l.startsWith('INSERT INTO "user" '))).toHaveLength(counts.user);

    const fresh = createSqliteD1();
    try {
      fresh.sqlite.exec(sql);
      const read = (db: SqliteD1) => db.sqlite.prepare('SELECT * FROM "feedback" ORDER BY rowid').all();
      expect(read(fresh)).toEqual(read(d1));
    } finally {
      fresh.close();
    }
  });
});

describe("runBackup and pruneBackups", () => {
  it("writes <prefix>/YYYY-MM-DD.sql.gz, its counts file and latest.json, and returns the counts", async () => {
    await seed(d1);
    const bucket = fakeBucket();
    const result = await runBackup(d1, bucket, PREFIX, NOW);
    expect(backupKeys(PREFIX, NOW)).toEqual({
      dump: "d1/poke-memory/2026-11-20.sql.gz",
      counts: "d1/poke-memory/2026-11-20.json",
      latest: "d1/poke-memory/latest.json",
    });
    expect(result.key).toBe("d1/poke-memory/2026-11-20.sql.gz");
    expect(result.counts.user).toBe(2);

    const stored = bucket.objects.get("d1/poke-memory/2026-11-20.sql.gz")!.body;
    const sql = await gunzipText(stored);
    expect(sql.startsWith("-- poke-memory D1 backup 2026-11-20T02:00:03.120Z\n")).toBe(true);
    expect(sql).toBe((await dumpDatabase(d1, NOW)).sql);
    expect(result.bytes).toBe(stored.byteLength);
    expect(result.sha256).toBe(await sha256Hex(stored));

    const latest = JSON.parse(await (await bucket.get("d1/poke-memory/latest.json"))!.text()) as BackupManifest;
    expect(latest).toEqual({
      exportedAt: "2026-11-20T02:00:03.120Z",
      key: "d1/poke-memory/2026-11-20.sql.gz",
      bytes: stored.byteLength,
      sha256: result.sha256,
      counts: result.counts,
    });
    expect(JSON.parse(await (await bucket.get("d1/poke-memory/2026-11-20.json"))!.text())).toEqual(latest);
  });

  it(`deletes dumps and counts files dated more than ${BACKUP_RETENTION_DAYS} days ago, across list pages, and keeps other keys`, async () => {
    const bucket = fakeBucket(2);
    const keys = [
      "d1/poke-memory/2026-08-21.sql.gz", // 91 days before 2026-11-20
      "d1/poke-memory/2026-08-21.json",
      "d1/poke-memory/2026-08-22.sql.gz", // exactly 90 days: kept
      "d1/poke-memory/2026-08-22.json",
      "d1/poke-memory/2026-01-01.sql.gz",
      "d1/poke-memory/2026-11-19.sql.gz",
      "d1/poke-memory/latest.json",
      "d1/poke-memory/notes.txt",
      "d1/poke-memory-preview/2026-01-01.sql.gz",
      "other/2020-01-01.sql",
    ];
    for (const k of keys) await bucket.put(k, "x");
    const pruned = await pruneBackups(bucket, PREFIX, NOW);
    expect(pruned.sort()).toEqual([
      "d1/poke-memory/2026-01-01.sql.gz",
      "d1/poke-memory/2026-08-21.json",
      "d1/poke-memory/2026-08-21.sql.gz",
    ]);
    expect([...bucket.objects.keys()].sort()).toEqual([
      "d1/poke-memory-preview/2026-01-01.sql.gz",
      "d1/poke-memory/2026-08-22.json",
      "d1/poke-memory/2026-08-22.sql.gz",
      "d1/poke-memory/2026-11-19.sql.gz",
      "d1/poke-memory/latest.json",
      "d1/poke-memory/notes.txt",
      "other/2020-01-01.sql",
    ]);
  });
});

describe("checkLatestBackup (the monthly restore check, inside Cloudflare)", () => {
  const CHECK_AT = new Date("2026-12-01T04:00:00.000Z");

  async function exported() {
    await seed(d1);
    const bucket = fakeBucket();
    const result = await runBackup(d1, bucket, PREFIX, new Date("2026-11-30T02:00:00.000Z"));
    return { bucket, result };
  }

  /** Replaces the dump with `bytes` and rewrites latest.json with `edit` applied. */
  async function tamper(
    bucket: ReturnType<typeof fakeBucket>,
    bytes: Uint8Array | null,
    edit: (m: BackupManifest) => BackupManifest = (m) => m,
  ) {
    const manifest = JSON.parse(await (await bucket.get(`${PREFIX}/latest.json`))!.text()) as BackupManifest;
    if (bytes) await bucket.put(manifest.key, bytes);
    await bucket.put(`${PREFIX}/latest.json`, JSON.stringify(edit(manifest)));
  }

  it("passes on a fresh export: checksum, decompression, per-table counts and freshness", async () => {
    const { bucket, result } = await exported();
    const checked = await checkLatestBackup({ bucket, prefix: PREFIX, now: CHECK_AT });
    expect(checked).toEqual({ key: result.key, exportedAt: "2026-11-30T02:00:00.000Z", counts: result.counts });
  });

  it("counts an empty table, which has no INSERT lines, as 0", async () => {
    // An empty database: every table is listed in the counts file with 0 and the dump has no INSERTs.
    const bucket = fakeBucket();
    const result = await runBackup(d1, bucket, PREFIX, new Date("2026-11-30T02:00:00.000Z"));
    expect(Object.values(result.counts).every((n) => n === 0)).toBe(true);
    await expect(checkLatestBackup({ bucket, prefix: PREFIX, now: CHECK_AT })).resolves.toMatchObject({
      key: result.key,
    });
  });

  it("fails when there is no latest.json", async () => {
    await expect(checkLatestBackup({ bucket: fakeBucket(), prefix: PREFIX, now: CHECK_AT })).rejects.toThrow(
      /no latest\.json/,
    );
  });

  it(`fails when the newest export is more than ${MAX_BACKUP_AGE_DAYS} days old`, async () => {
    const { bucket } = await exported();
    const late = new Date("2026-12-03T02:00:01.000Z");
    await expect(checkLatestBackup({ bucket, prefix: PREFIX, now: late })).rejects.toThrow(/stale/);
  });

  it("fails when the dump's checksum does not match", async () => {
    const { bucket } = await exported();
    await tamper(bucket, null, (m) => ({ ...m, sha256: "0".repeat(64) }));
    await expect(checkLatestBackup({ bucket, prefix: PREFIX, now: CHECK_AT })).rejects.toThrow(/sha256/);
  });

  it("fails when the dump does not decompress", async () => {
    const { bucket } = await exported();
    const garbage = new TextEncoder().encode("not gzip at all");
    // The checksum is made to match, so only the decompression can fail.
    const sha = await sha256Hex(garbage);
    await tamper(bucket, garbage, (m) => ({ ...m, bytes: garbage.byteLength, sha256: sha }));
    await expect(checkLatestBackup({ bucket, prefix: PREFIX, now: CHECK_AT })).rejects.toThrow(/decompress/);
  });

  it("fails when a table's rows in the dump differ from the counts file", async () => {
    const { bucket } = await exported();
    const manifest = JSON.parse(await (await bucket.get(`${PREFIX}/latest.json`))!.text()) as BackupManifest;
    const lines = (await gunzipText(bucket.objects.get(manifest.key)!.body)).split("\n");
    lines.splice(lines.findIndex((l) => l.startsWith('INSERT INTO "card_reviews" ')), 1);
    const bytes = await gzipText(lines.join("\n"));
    const sha = await sha256Hex(bytes);
    await tamper(bucket, bytes, (m) => ({ ...m, bytes: bytes.byteLength, sha256: sha }));
    await expect(checkLatestBackup({ bucket, prefix: PREFIX, now: CHECK_AT })).rejects.toThrow(
      /card_reviews: counts file 2, dump 1/,
    );
  });

  it("fails when the dump named by latest.json is missing", async () => {
    const { bucket, result } = await exported();
    await bucket.delete(result.key);
    await expect(checkLatestBackup({ bucket, prefix: PREFIX, now: CHECK_AT })).rejects.toThrow(/is missing/);
  });

  it("fails when latest.json lists no tables", async () => {
    const { bucket } = await exported();
    await tamper(bucket, null, (m) => ({ ...m, counts: {} }));
    await expect(checkLatestBackup({ bucket, prefix: PREFIX, now: CHECK_AT })).rejects.toThrow(/no tables/);
  });
});

describe("runRestoreCheck (the Worker's monthly Cron Trigger)", () => {
  const CHECK_AT = new Date("2026-12-01T04:00:00.000Z");
  const sink = () => {
    const lines: string[] = [];
    return { lines, log: (m: string) => void lines.push(`log ${m}`), error: (m: string) => void lines.push(`error ${m}`) };
  };

  it("logs one ok line with the key and counts", async () => {
    await seed(d1);
    const bucket = fakeBucket();
    await runBackup(d1, bucket, PREFIX, new Date("2026-11-30T02:00:00.000Z"));
    const out = sink();
    await runRestoreCheck({ BACKUPS: bucket, D1_BACKUP_PREFIX: PREFIX }, CHECK_AT, out);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatch(
      /^log d1-backup: restore-check ok, d1\/poke-memory\/2026-11-30\.sql\.gz \(exported 2026-11-30T02:00:00\.000Z\), counts \{"user":2,/,
    );
  });

  it('logs "d1-backup: restore-check FAILED: ..." and rethrows, so the invocation shows as failed', async () => {
    const out = sink();
    await expect(runRestoreCheck({ BACKUPS: fakeBucket(), D1_BACKUP_PREFIX: PREFIX }, CHECK_AT, out)).rejects.toThrow(
      /no latest\.json/,
    );
    expect(out.lines).toEqual([
      expect.stringMatching(/^error d1-backup: restore-check FAILED: no latest\.json at d1\/poke-memory\/latest\.json/),
      "error d1-backup: alert not sent: no RESEND_API_KEY",
    ]);
  });

  it("emails one alert through Resend on failure, then still rethrows", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    const out = sink();
    const env = { BACKUPS: fakeBucket(), D1_BACKUP_PREFIX: PREFIX, RESEND_API_KEY: "re_test" };
    await expect(runRestoreCheck(env, CHECK_AT, out, fetch)).rejects.toThrow(/no latest\.json/);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init?.body));
    expect(body.to).toEqual(["hello@frazzledproductions.com"]);
    expect(body.subject).toBe("Poké Memory: D1 restore-check FAILED");
    expect(body.text).toMatch(/^d1-backup: restore-check FAILED: no latest\.json/);
    expect(out.lines).toHaveLength(1);
  });

  it("sends no alert when the check passes", async () => {
    await seed(d1);
    const bucket = fakeBucket();
    await runBackup(d1, bucket, PREFIX, new Date("2026-11-30T02:00:00.000Z"));
    const fetch = vi.fn<typeof globalThis.fetch>();
    await runRestoreCheck({ BACKUPS: bucket, D1_BACKUP_PREFIX: PREFIX, RESEND_API_KEY: "re_test" }, CHECK_AT, sink(), fetch);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails without the BACKUPS binding or the prefix (the preview Worker has neither)", async () => {
    for (const env of [{ D1_BACKUP_PREFIX: PREFIX }, { BACKUPS: fakeBucket() }]) {
      const out = sink();
      await expect(runRestoreCheck(env, CHECK_AT, out)).rejects.toThrow(/BACKUPS binding or the D1_BACKUP_PREFIX/);
      expect(out.lines[0]).toMatch(/^error d1-backup: restore-check FAILED: /);
    }
  });

  it("logs no row data, only keys and counts", async () => {
    await seed(d1);
    const bucket = fakeBucket();
    await runBackup(d1, bucket, PREFIX, new Date("2026-11-30T02:00:00.000Z"));
    const out = sink();
    await runRestoreCheck({ BACKUPS: bucket, D1_BACKUP_PREFIX: PREFIX }, CHECK_AT, out);
    expect(out.lines.join("\n")).not.toMatch(/O'Brien|alice_1|Europe\/London/);
  });
});
