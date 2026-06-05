#!/usr/bin/env node
// Diff-coverage gate (#824).
//
// Cross-references the lines a PR adds/changes against the v8 per-statement
// hit counts in coverage/coverage-final.json, and fails when patch coverage
// for the changed product code falls below a bar (default 90%).
//
// This is the "quality push" half of the coverage gate: the global floor in
// vitest.config.ts stops overall coverage regressing, this script stops new
// code from landing untested.
//
// Inputs:
//   coverage/coverage-final.json - produced by the `json` coverage reporter.
//   A unified diff on stdin - typically `git diff <base>...<head>`.
//
// Env (optional):
//   DIFF_COVERAGE_MIN - patch-coverage bar as a percentage (default 90).
//   DIFF_COVERAGE_OUT - path to write a Markdown summary fragment.
//
// Exit codes:
//   0  patch coverage at or above the bar, or no measurable changed lines.
//   1  patch coverage below the bar.
//   2  bad input (missing coverage file, unreadable diff).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COVERAGE_FILE = join(REPO_ROOT, "coverage", "coverage-final.json");

const MIN_PCT = Number(process.env.DIFF_COVERAGE_MIN ?? "90");
const OUT_FILE = process.env.DIFF_COVERAGE_OUT;

// Only product code carries a coverage signal. Mirror the include globs in
// vitest.config.ts so a changed file outside app/components/lib is ignored
// rather than counted as 0%.
const INCLUDE_PREFIXES = ["app/", "components/", "lib/"];

// Files that match an include prefix but are excluded from coverage in
// vitest.config.ts - test files and the generated seed payload. Changed lines
// in these never count toward patch coverage.
function isMeasurableFile(repoPath) {
  if (!INCLUDE_PREFIXES.some((p) => repoPath.startsWith(p))) return false;
  if (/\.test\.tsx?$/.test(repoPath)) return false;
  if (repoPath.startsWith("lib/sync/integration/")) return false;
  if (repoPath === "lib/pokemon/generated.json") return false;
  if (/\.d\.ts$/.test(repoPath)) return false;
  return true;
}

// Parse a unified diff into a map of repoPath -> Set<addedLineNumber>.
// Only added/modified lines (`+`) on the new side are collected; deletions
// carry no coverage obligation.
function parseDiff(diffText) {
  const added = new Map();
  let currentFile = null;
  let newLine = 0;

  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("+++ ")) {
      // "+++ b/path/to/file" - strip the "b/" prefix. "/dev/null" means the
      // file was deleted; leave currentFile null so its hunks are skipped.
      const target = raw.slice(4).trim();
      currentFile = target === "/dev/null" ? null : target.replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    if (raw.startsWith("@@")) {
      // "@@ -oldStart,oldCount +newStart,newCount @@"
      const m = raw.match(/\+(\d+)(?:,(\d+))?/);
      newLine = m ? Number(m[1]) : 0;
      continue;
    }
    if (currentFile === null) continue;

    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      if (!added.has(currentFile)) added.set(currentFile, new Set());
      added.get(currentFile).add(newLine);
      newLine += 1;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      // Deleted line - no new-side line number to advance.
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file" - metadata, not a content line.
    } else {
      // Context line (leading space) or an empty line inside a hunk.
      newLine += 1;
    }
  }
  return added;
}

// Build repoPath -> Map<lineNumber, hitCount> from the v8 coverage report.
// A line is "hit" if any statement covering it has a non-zero count.
function buildLineHits(coverage) {
  const byFile = new Map();
  for (const absPath of Object.keys(coverage)) {
    const entry = coverage[absPath];
    const repoPath = relative(REPO_ROOT, resolve(entry.path ?? absPath)).split("\\").join("/");
    const lineHits = new Map();
    for (const [id, range] of Object.entries(entry.statementMap ?? {})) {
      const count = entry.s?.[id] ?? 0;
      const startLine = range.start?.line;
      const endLine = range.end?.line ?? startLine;
      if (typeof startLine !== "number") continue;
      for (let ln = startLine; ln <= endLine; ln += 1) {
        const prev = lineHits.get(ln) ?? 0;
        lineHits.set(ln, Math.max(prev, count));
      }
    }
    byFile.set(repoPath, lineHits);
  }
  return byFile;
}

function main() {
  if (!existsSync(COVERAGE_FILE)) {
    console.error(
      `Diff coverage: ${relative(REPO_ROOT, COVERAGE_FILE)} not found. ` +
        "Run `npm run test:coverage` first (the `json` reporter must be enabled).",
    );
    process.exit(2);
  }

  let diffText = "";
  try {
    diffText = readFileSync(0, "utf8");
  } catch {
    console.error("Diff coverage: could not read a diff on stdin.");
    process.exit(2);
  }

  const coverage = JSON.parse(readFileSync(COVERAGE_FILE, "utf8"));
  const lineHits = buildLineHits(coverage);
  const addedByFile = parseDiff(diffText);

  let totalChanged = 0;
  let totalCovered = 0;
  const fileRows = [];
  const uncovered = [];

  for (const [repoPath, lines] of addedByFile) {
    if (!isMeasurableFile(repoPath)) continue;

    const hits = lineHits.get(repoPath);
    // A measurable file with no coverage entry was never imported by any
    // test. The line loop below skips every line when `hits` is undefined,
    // so such a file contributes nothing to the diff totals rather than
    // counting as fully uncovered. This is a deliberate choice: it avoids
    // false failures on files not yet reachable from any test. The known
    // blind spot is that a brand-new product file with zero tests passes
    // the diff gate unnoticed; the global coverage floor is what catches
    // that case.
    let fileChanged = 0;
    let fileCovered = 0;
    for (const ln of [...lines].sort((a, b) => a - b)) {
      // Only lines that v8 instrumented as statements are countable; blank
      // lines, comments and braces have no statement and are skipped.
      if (!hits || !hits.has(ln)) continue;
      fileChanged += 1;
      if (hits.get(ln) > 0) {
        fileCovered += 1;
      } else {
        uncovered.push(`${repoPath}:${ln}`);
      }
    }
    if (fileChanged === 0) continue;
    totalChanged += fileChanged;
    totalCovered += fileCovered;
    fileRows.push({ repoPath, fileChanged, fileCovered });
  }

  const pct = totalChanged === 0 ? 100 : (totalCovered / totalChanged) * 100;
  const pass = pct >= MIN_PCT;

  const lines = [];
  lines.push("### Diff coverage");
  lines.push("");
  if (totalChanged === 0) {
    lines.push(
      "No instrumented product lines changed in this PR. Diff-coverage gate skipped.",
    );
  } else {
    lines.push(
      `**${pct.toFixed(2)}%** of changed lines covered ` +
        `(${totalCovered} / ${totalChanged}). Bar: ${MIN_PCT}%. ` +
        `${pass ? "PASS" : "FAIL"}`,
    );
    lines.push("");
    lines.push("| File | Covered / Changed |");
    lines.push("|---|---|");
    for (const r of fileRows.sort((a, b) => a.repoPath.localeCompare(b.repoPath))) {
      lines.push(`| \`${r.repoPath}\` | ${r.fileCovered} / ${r.fileChanged} |`);
    }
    if (!pass && uncovered.length > 0) {
      lines.push("");
      lines.push("Uncovered changed lines:");
      lines.push("");
      lines.push("```");
      for (const u of uncovered.slice(0, 50)) lines.push(u);
      if (uncovered.length > 50) lines.push(`... and ${uncovered.length - 50} more`);
      lines.push("```");
    }
  }
  const report = lines.join("\n");

  console.log(report);
  if (OUT_FILE) writeFileSync(OUT_FILE, report);

  process.exit(pass ? 0 : 1);
}

main();
