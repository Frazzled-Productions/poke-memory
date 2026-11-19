#!/usr/bin/env node
// Row-count check after the data copy (OpenSpec change move-to-cloudflare, task 8.3, design D12).
// Compares the manifest written by scripts/cloudflare/copy-from-supabase.mjs (source counts, rows
// written, rows skipped with reasons) against the target D1 database's counts, prints a table of
// counts only, and exits 1 on any unexplained difference.
//
//   node scripts/cloudflare/compare-counts.mjs --manifest import.counts.json \
//     --database poke-memory-preview --env preview --remote
//   node scripts/cloudflare/compare-counts.mjs --manifest import.counts.json --target counts.json
//
// A table passes when target == rows written AND source == rows written + rows skipped. The query
// is a read-only SELECT count(*) per table.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** One read-only statement counting every table in the manifest. */
export function countsQuery(tables) {
  return tables.map((t) => `SELECT '${t}' AS name, count(*) AS n FROM "${t}"`).join(" UNION ALL ");
}

/**
 * @param {{ tables: { table: string, source: number, expected: number, skipped: Record<string, number> }[] }} manifest
 * @param {Record<string, number>} target counts per table in the target database
 */
export function compareCounts(manifest, target) {
  const rows = manifest.tables.map((t) => {
    const skippedTotal = Object.values(t.skipped).reduce((a, b) => a + b, 0);
    const actual = target[t.table];
    const problems = [];
    if (actual === undefined) problems.push("no target count");
    else if (actual !== t.expected) problems.push(`target ${actual} != written ${t.expected}`);
    if (t.source !== t.expected + skippedTotal) problems.push("source != written + skipped");
    return { ...t, target: actual ?? null, skippedTotal, ok: problems.length === 0, problems };
  });
  return { rows, ok: rows.every((r) => r.ok) };
}

export function formatComparison({ rows }) {
  const lines = [
    `${"table".padEnd(24)} ${"source".padStart(8)} ${"target".padStart(8)} ${"skipped".padStart(8)}  result`,
  ];
  for (const r of rows) {
    const reasons = Object.entries(r.skipped).map(([reason, n]) => `${n}: ${reason}`).join("; ");
    const result = r.ok ? "ok" : `MISMATCH (${r.problems.join("; ")})`;
    lines.push(
      `${r.table.padEnd(24)} ${String(r.source).padStart(8)} ${String(r.target ?? "-").padStart(8)} ${String(r.skippedTotal).padStart(8)}  ${result}${reasons ? `  [${reasons}]` : ""}`,
    );
  }
  return lines.join("\n");
}

/** Reads target counts with `wrangler d1 execute --json --command`. */
export function wranglerCounts({ database, env, remote, tables }) {
  if (!database) throw new Error("--database is required without --target");
  const args = ["wrangler", "d1", "execute", database, remote ? "--remote" : "--local", "--json", "--command", countsQuery(tables)];
  if (env) args.push("--env", env);
  const stdout = execFileSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const parsed = JSON.parse(stdout);
  const results = Array.isArray(parsed) ? parsed.flatMap((p) => p.results ?? []) : parsed.results ?? [];
  return Object.fromEntries(results.map((r) => [r.name, Number(r.n)]));
}

function parseArgs(argv) {
  const args = { manifest: null, target: null, database: null, env: null, remote: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") args.manifest = argv[++i];
    else if (a === "--target") args.target = argv[++i];
    else if (a === "--database") args.database = argv[++i];
    else if (a === "--env") args.env = argv[++i];
    else if (a === "--remote") args.remote = true;
    else if (a === "--local") args.remote = false;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.manifest) throw new Error("--manifest <import.counts.json> is required");
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
  const tables = manifest.tables.map((t) => t.table);
  const target = args.target
    ? JSON.parse(readFileSync(args.target, "utf8"))
    : wranglerCounts({ database: args.database, env: args.env, remote: args.remote, tables });
  const result = compareCounts(manifest, target);
  console.log(formatComparison(result));
  if (!result.ok) {
    console.error("\nRow counts differ: see the MISMATCH lines.");
    process.exit(1);
  }
  console.log("\nAll row counts match.");
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
