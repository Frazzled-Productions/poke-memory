#!/usr/bin/env node
// Restore check for the nightly D1 backup (OpenSpec change move-to-cloudflare, design D10), run
// by .github/workflows/restore-test.yml (by hand; its schedule is off) after it has loaded the newest backup into a fresh
// local D1. Compares the row count of every table named in the backup's header with the restored
// database and exits 1 on any difference.
//
// Backup file format (written by POST /api/cron/backup to R2 at d1/YYYY-MM-DD.sql):
//
//   -- poke-memory D1 backup
//   -- created: 2026-11-20T02:00:03.120Z
//   -- rows user: 21
//   -- rows card_reviews: 4812
//   -- ... one `-- rows <table>: <count>` line for EVERY table in the dump, including empty ones
//   INSERT INTO "user" ("id", "name", ...) VALUES (...);
//   ...
//
// - Data only: no CREATE, DROP or PRAGMA. The restore applies db/d1/migrations to a fresh local D1
//   first, then executes the file, so the schema (and every trigger) is today's.
// - One INSERT per row, tables in dependency order (parents before children, `user` first), so
//   the foreign keys and the tombstone triggers accept the rows as they did when they were written.
// - wrangler's own `d1_migrations` table and SQLite/D1 internal tables (`sqlite_*`, `_cf_*`) are not
//   dumped: the migrations recreate the first, and the others are not ours.
//
// Usage: node scripts/cloudflare/check-restore.mjs <backup.sql> <local D1 persist folder>

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { queryD1 } from "./d1-query.mjs";

const ROWS_LINE = /^-- rows ([A-Za-z_][A-Za-z0-9_]*): (\d+)\s*$/;

/**
 * Read the `-- rows <table>: <count>` lines from the comment header at the top of the file.
 * @param {string} sql
 * @returns {Map<string, number>}
 */
export function parseBackupHeader(sql) {
  const counts = new Map();
  for (const line of sql.split("\n")) {
    if (!line.startsWith("--")) {
      if (line.trim() === "") continue;
      break; // The header ends at the first statement.
    }
    const match = ROWS_LINE.exec(line);
    if (!match) continue;
    if (counts.has(match[1])) throw new Error(`The header names table ${match[1]} twice.`);
    counts.set(match[1], Number(match[2]));
  }
  if (counts.size === 0) {
    throw new Error("The backup has no `-- rows <table>: <count>` header lines, so it cannot be checked.");
  }
  return counts;
}

/**
 * @param {Map<string, number>} expected From the header.
 * @param {Map<string, number>} actual From the restored database.
 * @returns {string[]} One line per mismatch; empty when every count matches.
 */
export function compareCounts(expected, actual) {
  const problems = [];
  for (const [table, want] of expected) {
    const got = actual.get(table);
    if (got === undefined) problems.push(`${table}: missing from the restored database`);
    else if (got !== want) problems.push(`${table}: header says ${want}, restored ${got}`);
  }
  return problems;
}

/** One query counting every table, so wrangler starts once. */
export function countQuery(tables) {
  return `SELECT ${tables
    .map((t, i) => `(SELECT COUNT(*) FROM "${t}") AS c${i}`)
    .join(", ")}`;
}

function main() {
  const [file, persistTo] = process.argv.slice(2);
  if (!file || !persistTo) {
    console.error("Usage: node scripts/cloudflare/check-restore.mjs <backup.sql> <local D1 persist folder>");
    process.exit(2);
  }
  const expected = parseBackupHeader(readFileSync(file, "utf8"));
  const tables = [...expected.keys()];

  // Only tables that exist can be counted; a missing one is reported, not a query error.
  const present = new Set(
    queryD1("SELECT name FROM sqlite_master WHERE type = 'table'", { persistTo }).map((r) => r.name),
  );
  const countable = tables.filter((t) => present.has(t));
  const actual = new Map();
  if (countable.length > 0) {
    const [row] = queryD1(countQuery(countable), { persistTo });
    countable.forEach((t, i) => actual.set(t, Number(row[`c${i}`])));
  }

  for (const table of tables) {
    console.log(`${table}: header ${expected.get(table)}, restored ${actual.get(table) ?? "missing"}`);
  }
  const problems = compareCounts(expected, actual);
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log(`Restore check passed: ${tables.length} tables, every row count matches.`);
}

function isInvokedDirectly() {
  try {
    return (
      process.argv[1] !== undefined &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
