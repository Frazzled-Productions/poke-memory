#!/usr/bin/env node
// CI rule for the scope helper (decision 0018, design D4): per-user data is only
// read or written through lib/db/ (forUser in lib/db/scope.ts, or the named jobs
// in lib/db/system.ts), never with raw D1 calls or SQL elsewhere.
//
// Fails when a tracked source file outside ALLOWED_PATHS:
//   d1-call   calls .prepare( or .batch(, or .exec( on something named like a
//             database (db, DB, d1, database, sqlite); a RegExp's .exec( is fine.
//   sql-table holds SQL naming a protected table: an upper-case FROM / INTO /
//             UPDATE / JOIN / TABLE before the name, a lower-case statement
//             (select ... from t, insert into t, delete from t, update t set),
//             or a double-quoted auth table ("user"). Comment lines are prose
//             and skipped, so a comment can name a table.
//
// Better Auth's own queries run inside the library and are outside the rule.
// Run: node scripts/check-scoped-queries.mjs (in `npm run lint`).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The per-user and auth tables (design D4). lib/db/tables.ts exports the same
 * list as PROTECTED_TABLES; scripts/check-scoped-queries.test.mjs fails if they differ.
 */
export const PROTECTED_TABLES = [
  "card_reviews",
  "user_settings",
  "streak_days",
  "grade_log",
  "push_subscriptions",
  "feedback",
  "feedback_discord_posts",
  "rate_limit_buckets",
  "user",
  "session",
  "account",
];

/**
 * Where raw D1 calls and SQL are allowed. Each entry is a path prefix; keep the
 * list short and give every entry its reason.
 */
export const ALLOWED_PATHS = [
  // The scope helper, system jobs, RPC ports, the D1 test shim and their tests.
  "lib/db/",
  // Worker entry and its D1 type check.
  "worker/",
  // Operator scripts run against D1 or Postgres directly (data copy, preview seed,
  // auth schema generation).
  "scripts/cloudflare/",
  // This rule and its test hold the patterns as data.
  "scripts/check-scoped-queries.mjs",
  "scripts/check-scoped-queries.test.mjs",
  // The Postgres-era suites and scripts. They talk to Supabase/Postgres, not
  // D1, and are removed with db/migrations/ after the 14-day fallback (design D3).
  "lib/sync/integration/",
  "scripts/qa-seed-cloud.ts",
  "scripts/refresh-user-count.mjs",
  "scripts/check-migrations.mjs",
  ".github/scripts/check-grade-log-divergence.mjs",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

const TABLES = PROTECTED_TABLES.join("|");
const WORD_TABLES = PROTECTED_TABLES.filter((t) => !t.includes("_")).join("|");

const RULES = [
  { rule: "d1-call", pattern: /\.(?:prepare|batch)\s*\(/ },
  { rule: "d1-call", pattern: /\b\w*(?:db|d1|database|sqlite)\w*\s*\.\s*exec\s*\(/i },
  // Upper-case SQL (the house style): FROM card_reviews, INSERT INTO "user".
  {
    rule: "sql-table",
    pattern: new RegExp(`\\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\\s+["'\`]?(?:${TABLES})\\b`),
  },
  // Lower-case SQL: a statement keyword and a table on one line.
  {
    rule: "sql-table",
    pattern: new RegExp(
      `\\b(?:select|insert|delete)\\b.*\\b(?:from|into|join)\\s+["'\`]?(?:${TABLES})\\b`,
      "i",
    ),
  },
  { rule: "sql-table", pattern: new RegExp(`\\bupdate\\s+["'\`]?(?:${TABLES})["'\`]?\\s+set\\b`, "i") },
  // A double-quoted auth table name is SQL whatever the case.
  {
    rule: "sql-table",
    pattern: new RegExp(`\\b(?:from|into|update|join|table)\\s+"(?:${WORD_TABLES})"`, "i"),
  },
];

/** Comment lines are prose: `//`, `/*` and JSDoc `*` lines are skipped. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

export function isAllowed(file) {
  return ALLOWED_PATHS.some((prefix) => file === prefix || file.startsWith(prefix));
}

/** Violations in one file's text: { file, line, rule, text }. */
export function findViolations(file, text) {
  if (isAllowed(file)) return [];
  const violations = [];
  text.split("\n").forEach((line, index) => {
    if (COMMENT_LINE.test(line)) return;
    const hit = RULES.find((r) => r.pattern.test(line));
    if (hit) violations.push({ file, line: index + 1, rule: hit.rule, text: line.trim() });
  });
  return violations;
}

export function trackedSourceFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((f) => f && SOURCE_EXTENSIONS.has(path.extname(f)));
}

export function checkRepo(root) {
  return trackedSourceFiles(root).flatMap((file) => {
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      return []; // deleted in the working tree
    }
    return findViolations(file, text);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const violations = checkRepo(root);
  if (violations.length > 0) {
    for (const v of violations) console.error(`${v.file}:${v.line}: [${v.rule}] ${v.text}`);
    console.error(
      `\n${violations.length} raw D1 call(s) or SQL on per-user tables outside lib/db/. ` +
        "Use forUser() from lib/db/scope.ts, or a named job in lib/db/system.ts (design D4).",
    );
    process.exit(1);
  }
  console.log("check-scoped-queries: no raw D1 calls or per-user SQL outside lib/db/.");
}
