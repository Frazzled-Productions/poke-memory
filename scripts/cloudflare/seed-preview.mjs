#!/usr/bin/env node
// Seed data for the preview Worker's D1 database (OpenSpec change move-to-cloudflare, design D11 and
// Open call 4: previews get a seeded test database, never a copy of real data).
//
// Writes SQL to stdout (or to the file named by --out) for
// `wrangler d1 execute DB --remote --env preview --file <that file>`. The SQL creates two test users,
// each with a Better Auth `user` row and a `credential` `account` row, plus some card_reviews,
// user_settings, streak_days and grade_log rows.
//
// Idempotent: it touches only the two fixed test user ids below. Their data rows are deleted and
// inserted again; their `user` and `account` rows are upserted (never deleted, so nothing the preview
// keeps for them elsewhere is cascaded away). Running it twice leaves the same rows.
//
// Password: read from SEED_TEST_PASSWORD (in CI the PREVIEW_TEST_PASSWORD repo secret) and hashed with
// Better Auth's own scrypt (`hashPassword` from `better-auth/crypto`). With no password set, a random
// one is used and thrown away, so the users exist but nobody can sign in as them. No password or hash
// is ever written to this repository.
//
// Columns follow db/d1/migrations: 0001_schema.sql (the Postgres schema in SQLite: uuid and
// timestamps as ISO TEXT, booleans as 0/1, jsonb as TEXT) and 0002_auth.sql (Better Auth's tables,
// camelCase columns, with the username plugin's `username` and `displayUsername`).

import { randomBytes } from "node:crypto";
import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The two test users. Ids are fixed and obviously fake so their rows are easy to spot. */
export const TEST_USERS = [
  {
    id: "00000000-0000-4000-8000-00000000a001",
    username: "preview-tester-a",
    name: "Preview tester A",
  },
  {
    id: "00000000-0000-4000-8000-00000000b002",
    username: "preview-tester-b",
    name: "Preview tester B",
  },
];

/** Same rule as lib/auth/username.ts `syntheticEmail`. */
const INTERNAL_DOMAIN = "users.noreply.pokememory.internal";

/** Data tables cleared for the test users, children before parents. */
export const DATA_TABLES = [
  "grade_log",
  "streak_days",
  "card_reviews",
  "push_subscriptions",
  "user_settings",
];

/** Quote a value as an SQLite literal. */
export function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insert(table, row, conflict = "") {
  const cols = Object.keys(row);
  const quoted = cols.map((c) => `"${c}"`).join(", ");
  const values = cols.map((c) => sqlValue(row[c])).join(", ");
  return `INSERT INTO "${table}" (${quoted}) VALUES (${values})${conflict};`;
}

function upsert(table, row, key) {
  const updates = Object.keys(row)
    .filter((c) => c !== key && c !== "createdAt")
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ");
  return insert(table, row, ` ON CONFLICT ("${key}") DO UPDATE SET ${updates}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoTime = (ms) => new Date(ms).toISOString();

/**
 * Card fixtures per user: a few name cards in review, one evolution card, one new card.
 * `ago` is days since the last review; `due` is days from now (negative = overdue).
 */
const CARDS = [
  { card_type: "name", subject_key: "1", ago: 3, due: 4, stability: 7.5, reps: 4, state: "review" },
  { card_type: "name", subject_key: "4", ago: 1, due: -1, stability: 2.1, reps: 2, state: "review" },
  { card_type: "name", subject_key: "7", ago: 10, due: 20, stability: 25.3, reps: 7, state: "review" },
  { card_type: "name", subject_key: "25", ago: 2, due: 0, stability: 1.2, reps: 1, state: "learning" },
  { card_type: "evolution-edge", subject_key: "1>>>2", ago: 5, due: 6, stability: 9.8, reps: 3, state: "review" },
  { card_type: "name", subject_key: "133", ago: null, due: 0, stability: 0, reps: 0, state: "new" },
];

/**
 * Build the seed SQL.
 * @param {{ now: number, passwordHashes: string[] }} options `now` in ms; one hash per test user.
 * @returns {string}
 */
export function buildSeedSql({ now, passwordHashes }) {
  if (!Number.isFinite(now)) throw new Error("now must be a timestamp in ms");
  if (!Array.isArray(passwordHashes) || passwordHashes.length !== TEST_USERS.length) {
    throw new Error(`Need ${TEST_USERS.length} password hashes`);
  }
  const ids = TEST_USERS.map((u) => sqlValue(u.id)).join(", ");
  const lines = [
    "-- Preview seed: two test users and their data (scripts/cloudflare/seed-preview.mjs).",
    "-- Idempotent: touches only the two test user ids.",
    "PRAGMA defer_foreign_keys = ON;",
  ];

  // Clear the test users' data and sessions. `user` and `account` are upserted below instead.
  for (const table of DATA_TABLES) {
    lines.push(`DELETE FROM "${table}" WHERE user_id IN (${ids});`);
  }
  lines.push(`DELETE FROM "session" WHERE "userId" IN (${ids});`);

  const stamp = isoTime(now);
  TEST_USERS.forEach((user, index) => {
    lines.push(
      upsert(
        "user",
        {
          id: user.id,
          name: user.name,
          email: `${user.username}@${INTERNAL_DOMAIN}`,
          emailVerified: false,
          image: null,
          createdAt: stamp,
          updatedAt: stamp,
          username: user.username,
          displayUsername: user.username,
        },
        "id",
      ),
    );
    lines.push(
      upsert(
        "account",
        {
          id: `${user.id}-credential`,
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password: passwordHashes[index],
          createdAt: stamp,
          updatedAt: stamp,
        },
        "id",
      ),
    );

    // Settings first: the card_reviews, streak_days and grade_log tombstone triggers read
    // user_settings.last_reset_at, which stays NULL here.
    lines.push(
      insert("user_settings", {
        user_id: user.id,
        settings: JSON.stringify({ maxNewPerDay: 10, typedEntryOnboardingShown: true }),
        timezone: "Europe/London",
        date_format: "dmy",
        push_notification_hour: null,
        last_reset_at: null,
      }),
    );

    // User B gets fewer cards so the two accounts are distinguishable in cross-user checks.
    const cards = index === 0 ? CARDS : CARDS.slice(0, 3);
    for (const card of cards) {
      const reviewed = card.ago === null ? null : now - card.ago * DAY_MS;
      lines.push(
        insert("card_reviews", {
          user_id: user.id,
          card_type: card.card_type,
          subject_key: card.subject_key,
          locale: "en",
          stability: card.stability,
          difficulty: card.reps === 0 ? 0 : 5,
          elapsed_days: card.ago ?? 0,
          scheduled_days: card.reps === 0 ? 0 : Math.max(card.due + (card.ago ?? 0), 0),
          reps: card.reps,
          lapses: 0,
          fsrs_state: card.state,
          due_date: isoDate(now + card.due * DAY_MS),
          last_review: reviewed === null ? null : isoDate(reviewed),
          first_seen: reviewed === null ? null : isoDate(now - 30 * DAY_MS),
          hidden_since: null,
          seen_in_pasture: card.state === "review",
          updated_at: isoTime(reviewed ?? now),
        }),
      );
      if (reviewed !== null) {
        // grade_log card types use the evolution-stream vocabulary (`evolution`, not `evolution-edge`).
        const logType = card.card_type === "evolution-edge" ? "evolution" : card.card_type;
        lines.push(
          insert("grade_log", {
            user_id: user.id,
            occurred_at: reviewed,
            entry_date: isoDate(reviewed),
            card_type: logType,
            subject_key: card.subject_key,
            grade: 4,
            locale: "en",
            learning_step: card.state === "learning" ? 0 : null,
            step_started_at: card.state === "learning" ? reviewed : null,
          }),
        );
      }
    }

    // A three-day streak ending yesterday (never today or later: streak_days rejects future dates).
    for (const daysAgo of [3, 2, 1]) {
      lines.push(insert("streak_days", { user_id: user.id, review_date: isoDate(now - daysAgo * DAY_MS) }));
    }
  });

  return `${lines.join("\n")}\n`;
}

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex === -1 ? null : process.argv[outIndex + 1];
  if (outIndex !== -1 && !out) throw new Error("--out needs a file path");

  let password = process.env.SEED_TEST_PASSWORD ?? "";
  if (!password) {
    console.error(
      "SEED_TEST_PASSWORD is not set, so the test users get a random password nobody knows (sign-in as them is not possible).",
    );
    password = randomBytes(24).toString("base64url");
  }
  const { hashPassword } = await import("better-auth/crypto");
  const passwordHashes = await Promise.all(TEST_USERS.map(() => hashPassword(password)));
  const sql = buildSeedSql({ now: Date.now(), passwordHashes });
  if (out) {
    writeFileSync(out, sql, "utf8");
    console.error(`Wrote ${out}.`);
  } else {
    process.stdout.write(sql);
  }
}

function isInvokedDirectly() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
