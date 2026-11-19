/**
 * Tests for the scoped-queries CI rule (design D4): raw D1 calls and SQL on
 * per-user tables may only live in lib/db/ and the explicit allowlist.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { PROTECTED_TABLES as TABLES_TS } from "../lib/db/tables";
import { ALLOWED_PATHS, PROTECTED_TABLES, checkRepo, findViolations, isAllowed } from "./check-scoped-queries.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const rules = (text, file = "app/api/x/route.ts") => findViolations(file, text).map((v) => v.rule);

describe("d1-call", () => {
  it.each([
    "const rows = await env.DB.prepare('SELECT 1').all();",
    "await db.batch([a, b]);",
    "await db.exec('DELETE FROM x');",
    "await env.DB.exec(sql);",
    "const r = await d1.exec(sql);",
    "await database . exec(sql)",
  ])("flags %s", (line) => {
    expect(rules(line)).toContain("d1-call");
  });

  it.each([
    "const m = /^(\\d+)_/.exec(name);",
    "while ((m = tagRe.exec(raw)) !== null) {}",
    "const rows = await forUser(db, userId).select('card_reviews');",
  ])("allows %s", (line) => {
    expect(rules(line)).toEqual([]);
  });
});

describe("sql-table", () => {
  it.each([
    "const sql = `SELECT * FROM card_reviews WHERE user_id = ?`;",
    "`INSERT INTO grade_log (user_id) VALUES (?)`",
    "'UPDATE user_settings SET settings = ?'",
    "`DELETE FROM push_subscriptions`",
    'const q = `SELECT id FROM "user"`;',
    "`SELECT token FROM session WHERE id = ?`",
    "`LEFT JOIN account a ON a.userId = u.id`",
    "`select * from streak_days where user_id = ?`",
    "'delete from feedback where id = ?'",
    "`update rate_limit_buckets set x = 1`",
    'const q = `select id from "account"`;',
    "`INSERT INTO feedback_discord_posts (feedback_id) VALUES (?)`",
  ])("flags %s", (line) => {
    expect(rules(line)).toEqual(["sql-table"]);
  });

  it.each([
    "// Reads from card_reviews and from user.",
    " * Upserts a single card into card_reviews.",
    "/* SELECT * FROM card_reviews */",
    'it("upserts into card_reviews with the correct onConflict columns", () => {});',
    "const { data } = await client.from(\"card_reviews\").select();",
    "const label = 'Sign in to your account from any device';",
    "const text = `Pulled from user settings`;",
    "await forUser(db, id).update('user_settings', { settings }, []);",
  ])("allows %s", (line) => {
    expect(rules(line)).toEqual([]);
  });
});

describe("allowlist", () => {
  it("allows lib/db/, worker/ and scripts/cloudflare/, nothing else by default", () => {
    const sql = "await env.DB.prepare(`SELECT * FROM card_reviews`).all();";
    for (const file of ["lib/db/scope.ts", "lib/db/testing/sqliteD1.ts", "worker/index.ts", "scripts/cloudflare/copy.mjs"]) {
      expect([file, findViolations(file, sql)]).toEqual([file, []]);
    }
    for (const file of ["lib/sync/cloud.ts", "app/api/db/route.ts", "lib/dbx/x.ts", "lib/auth/server.ts"]) {
      expect([file, findViolations(file, sql).length]).toEqual([file, 1]);
    }
  });

  it("every entry is a prefix that is either a directory or a single file", () => {
    for (const entry of ALLOWED_PATHS) {
      expect(entry.endsWith("/") || /\.[a-z]+$/.test(entry)).toBe(true);
    }
    expect(isAllowed("lib/db")).toBe(false);
  });

  it("reports file, line and text", () => {
    expect(findViolations("app/a.ts", "ok\nawait db.batch([])")).toEqual([
      { file: "app/a.ts", line: 2, rule: "d1-call", text: "await db.batch([])" },
    ]);
  });
});

describe("the repository", () => {
  it("has no violations", () => {
    expect(checkRepo(repoRoot)).toEqual([]);
  });

  it("the CLI exits 0 on the repository", () => {
    const res = spawnSync(process.execPath, [resolve(here, "check-scoped-queries.mjs")], { encoding: "utf8" });
    expect(res.status).toBe(0);
  });

  it("keeps the protected-table list in step with lib/db/tables.ts", () => {
    expect([...PROTECTED_TABLES].sort()).toEqual([...TABLES_TS].sort());
  });
});
