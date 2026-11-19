/**
 * Tests for scripts/cloudflare/seed-preview.mjs: the preview seed is valid SQL, idempotent, and
 * touches only the two test users. Runs against node:sqlite with the real db/d1/migrations when
 * they exist, otherwise with a minimal stand-in schema holding the columns the seed writes.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSeedSql, DATA_TABLES, sqlValue, TEST_USERS } from "./seed-preview.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(repoRoot, "db", "d1", "migrations");

const STAND_IN_SCHEMA = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL, image TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  username TEXT UNIQUE, displayUsername TEXT);
CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, password TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);
CREATE TABLE user_settings (user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  settings TEXT NOT NULL CHECK (json_valid(settings)), timezone TEXT, date_format TEXT,
  push_notification_hour INTEGER, last_reset_at TEXT);
CREATE TABLE card_reviews (user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  card_type TEXT NOT NULL, subject_key TEXT NOT NULL, locale TEXT NOT NULL, stability REAL NOT NULL,
  difficulty REAL NOT NULL, elapsed_days INTEGER NOT NULL, scheduled_days INTEGER NOT NULL,
  reps INTEGER NOT NULL, lapses INTEGER NOT NULL, fsrs_state TEXT NOT NULL, due_date TEXT NOT NULL,
  last_review TEXT, first_seen TEXT, hidden_since TEXT, seen_in_pasture INTEGER NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY (user_id, card_type, subject_key, locale));
CREATE TABLE grade_log (user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  occurred_at INTEGER NOT NULL, entry_date TEXT NOT NULL, card_type TEXT NOT NULL,
  subject_key TEXT NOT NULL, grade INTEGER NOT NULL CHECK (grade IN (1, 2, 4, 5)), locale TEXT NOT NULL,
  learning_step INTEGER, step_started_at INTEGER,
  PRIMARY KEY (user_id, occurred_at, card_type, subject_key, locale));
CREATE TABLE streak_days (user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  review_date TEXT NOT NULL, PRIMARY KEY (user_id, review_date));
CREATE TABLE push_subscriptions (user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL);
`;

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  if (existsSync(migrationsDir)) {
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
      db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    }
  } else {
    db.exec(STAND_IN_SCHEMA);
  }
  return db;
}

const NOW = Date.parse("2026-11-19T12:00:00Z");
const HASHES = ["hash-a", "hash-b"];
const OTHER_USER = "11111111-2222-4333-8444-555555555555";

function countFor(db, table, userId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE user_id = ?`).get(userId).n;
}

function snapshot(db) {
  const tables = [...DATA_TABLES, "user", "account"];
  return Object.fromEntries(
    tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]),
  );
}

describe("seed-preview", () => {
  it("quotes SQL values safely", () => {
    expect(sqlValue(null)).toBe("NULL");
    expect(sqlValue(true)).toBe("1");
    expect(sqlValue(2.5)).toBe("2.5");
    expect(sqlValue("it's")).toBe("'it''s'");
    expect(() => sqlValue(Number.NaN)).toThrow();
  });

  it("refuses a call without one hash per user", () => {
    expect(() => buildSeedSql({ now: NOW, passwordHashes: ["only-one"] })).toThrow();
  });

  it("creates both test users with credential accounts and data", () => {
    const db = freshDb();
    db.exec(buildSeedSql({ now: NOW, passwordHashes: HASHES }));

    for (const [index, user] of TEST_USERS.entries()) {
      const row = db.prepare(`SELECT username, email FROM "user" WHERE id = ?`).get(user.id);
      expect(row.username).toBe(user.username);
      expect(row.email).toBe(`${user.username}@users.noreply.pokememory.internal`);
      const account = db
        .prepare(`SELECT providerId, password FROM account WHERE userId = ?`)
        .get(user.id);
      expect(account).toEqual({ providerId: "credential", password: HASHES[index] });
      for (const table of ["card_reviews", "user_settings", "streak_days", "grade_log"]) {
        expect(countFor(db, table, user.id), `${table} for ${user.username}`).toBeGreaterThan(0);
      }
    }
    // The two users hold different amounts of data so cross-user checks can tell them apart.
    expect(countFor(db, "card_reviews", TEST_USERS[0].id)).not.toBe(
      countFor(db, "card_reviews", TEST_USERS[1].id),
    );
  });

  it("never writes a streak day today or later", () => {
    const sql = buildSeedSql({ now: NOW, passwordHashes: HASHES });
    const days = [...sql.matchAll(/INSERT INTO "streak_days" .*? VALUES \('[^']+', '([^']+)'\)/g)].map(
      (m) => m[1],
    );
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((d) => d < "2026-11-19")).toBe(true);
  });

  it("is idempotent and leaves other users alone", () => {
    const db = freshDb();
    const stamp = "2026-11-01T00:00:00.000Z";
    db.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, username)
       VALUES (?, 'Someone', 'someone@example.invalid', 0, ?, ?, 'someone')`,
    ).run(OTHER_USER, stamp, stamp);
    db.prepare(`INSERT INTO streak_days (user_id, review_date) VALUES (?, '2026-11-01')`).run(OTHER_USER);

    db.exec(buildSeedSql({ now: NOW, passwordHashes: HASHES }));
    const first = snapshot(db);
    db.exec(buildSeedSql({ now: NOW + 60_000, passwordHashes: ["hash-a2", "hash-b2"] }));
    expect(snapshot(db)).toEqual(first);

    // A later run refreshes the password hash in place.
    const account = db.prepare(`SELECT password FROM account WHERE userId = ?`).get(TEST_USERS[0].id);
    expect(account.password).toBe("hash-a2");
    // The other user's rows are untouched.
    expect(countFor(db, "streak_days", OTHER_USER)).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE id = ?`).get(OTHER_USER).n).toBe(1);
  });
});
