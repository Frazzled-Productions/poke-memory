/**
 * Forcing function for #2018: the table inventory in docs/persistence.md and
 * the "Tables today" line in AGENTS.md must match the set of tables the
 * migrations actually create (minus any they drop or rename away). Both lists
 * went four migrations stale without anyone noticing, so parity is now a test.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(repoRoot, rel), "utf8");

/** Strip `--` line comments and block comments so commented-out DDL is ignored. */
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

const NAME = String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`;
const CREATE_RE = new RegExp(String.raw`\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?${NAME}`, "gi");
const DROP_RE = new RegExp(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?${NAME}`, "gi");
const RENAME_RE = new RegExp(
  String.raw`\balter\s+table\s+(?:if\s+exists\s+)?${NAME}\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?`,
  "gi",
);

/**
 * Replay the migrations in filename order and return the set of live tables.
 * @param {{ name: string, sql: string }[]} migrations
 */
function liveTables(migrations) {
  const tables = new Set();
  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  for (const { sql } of ordered) {
    const body = stripSqlComments(sql);
    // Collect every statement with its offset so effects apply in source order.
    const events = [];
    for (const m of body.matchAll(CREATE_RE)) {
      events.push([m.index, () => tables.add(m[1].toLowerCase())]);
    }
    for (const m of body.matchAll(DROP_RE)) {
      events.push([m.index, () => tables.delete(m[1].toLowerCase())]);
    }
    for (const m of body.matchAll(RENAME_RE)) {
      events.push([
        m.index,
        () => {
          tables.delete(m[1].toLowerCase());
          tables.add(m[2].toLowerCase());
        },
      ]);
    }
    events.sort((a, b) => a[0] - b[0]).forEach(([, apply]) => apply());
  }
  return tables;
}

/** Backticked names in the first column of the marked inventory table. */
function docTables(markdown) {
  const match = markdown.match(
    /<!-- persistence-tables:start -->([\s\S]*?)<!-- persistence-tables:end -->/,
  );
  if (!match) throw new Error("docs/persistence.md is missing the persistence-tables markers");
  return new Set([...match[1].matchAll(/^\|\s*`([a-z_][a-z0-9_]*)`\s*\|/gm)].map((m) => m[1]));
}

/** Backticked names in AGENTS.md's comma-separated "Tables today:" list. */
function agentsTables(markdown) {
  const match = markdown.match(/Tables today: ((?:`[a-z0-9_]+`(?:, )?)+)/);
  if (!match) throw new Error('AGENTS.md is missing its "Tables today:" list');
  return new Set([...match[1].matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]));
}

const sorted = (set) => [...set].sort();

describe("liveTables", () => {
  it("handles IF NOT EXISTS, schema qualification, quoting and case", () => {
    const got = liveTables([
      {
        name: "001.sql",
        sql: 'CREATE TABLE a (id int);\ncreate table if not exists public.b ();\nCREATE TABLE "public"."c" ();',
      },
    ]);
    expect(sorted(got)).toEqual(["a", "b", "c"]);
  });

  it("applies drops and renames in migration and statement order", () => {
    const got = liveTables([
      { name: "002.sql", sql: "DROP TABLE IF EXISTS a;\nALTER TABLE b RENAME TO b2;" },
      { name: "001.sql", sql: "CREATE TABLE a ();\nCREATE TABLE b ();\nCREATE TABLE c ();" },
      { name: "003.sql", sql: "DROP TABLE c;\nCREATE TABLE c ();" },
    ]);
    expect(sorted(got)).toEqual(["b2", "c"]);
  });

  it("ignores DDL inside comments", () => {
    const got = liveTables([
      {
        name: "001.sql",
        sql: "-- CREATE TABLE ghost ();\n/* CREATE TABLE spectre (); */\nCREATE TABLE real_one ();",
      },
    ]);
    expect(sorted(got)).toEqual(["real_one"]);
  });
});

describe("docTables / agentsTables", () => {
  it("reads only the first column of the marked table", () => {
    const md = [
      "| `outside` | 1 | x |",
      "<!-- persistence-tables:start -->",
      "| Table | Migration | Notes |",
      "|---|---|---|",
      "| `a` | 001 | mentions `b` in a later column |",
      "<!-- persistence-tables:end -->",
    ].join("\n");
    expect(sorted(docTables(md))).toEqual(["a"]);
  });

  it("throws when the markers are missing", () => {
    expect(() => docTables("no markers here")).toThrow(/markers/);
  });

  it("stops the AGENTS.md list at the first non-list text", () => {
    expect(sorted(agentsTables("Tables today: `a`, `b` (see `c`). More."))).toEqual(["a", "b"]);
    expect(() => agentsTables("nothing")).toThrow(/Tables today/);
  });
});

describe("docs/persistence.md and AGENTS.md list every live table (#2018)", () => {
  const dir = resolve(repoRoot, "db/migrations");
  const migrations = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(resolve(dir, name), "utf8") }));
  const live = sorted(liveTables(migrations));

  it("finds tables in the migrations (sanity check on the parser)", () => {
    expect(live).toContain("card_reviews");
    expect(live.length).toBeGreaterThanOrEqual(8);
  });

  it("docs/persistence.md inventory matches the migrations", () => {
    expect(sorted(docTables(read("docs/persistence.md")))).toEqual(live);
  });

  it('AGENTS.md "Tables today" matches the migrations', () => {
    expect(sorted(agentsTables(read("AGENTS.md")))).toEqual(live);
  });
});
