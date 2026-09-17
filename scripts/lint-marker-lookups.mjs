#!/usr/bin/env node
// Fails the lint chain when a workflow looks up an HTML-comment marker in a way
// that has already misfired (#2081).
//
// Scheduled monitors find their tracking issue again by a marker on line 1 of
// its body, and each used to carry its own copy of that lookup. Two forms kept
// coming back, each after a comment elsewhere warned against it:
//
//   - `gh issue list --search "<marker> in:body"`. The search index strips HTML
//     comments, and a colon in the marker parses as a qualifier, so the lookup
//     silently matched nothing and a duplicate was filed on every run (#1919).
//     #2003 reintroduced it a month later.
//   - An unanchored `contains(...)` on a body. It matches any body that merely
//     quotes the marker: qa-drift-check took over an unrelated issue that way,
//     overwrote its body daily and then closed it (#1997).
//
// A comment did not hold the line, so this check does. It reads
// .github/workflows/*.yml line by line (no YAML parser is a dependency) and
// flags any non-comment line that contains `in:body`, or that contains both
// `contains(` and `body`. The check is textual: a lookup split across lines
// would slip past it, so keep a lookup on one line. It is also deliberately
// broad: a body check that has nothing to do with a marker (a keyword in a PR
// description, say) is flagged too, and needs an exemption or startsWith.
//
// The fix is `.github/scripts/find-marker-issue.mjs` for a tracking issue, and
// a line-1 anchor (jq `startswith`, Actions `startsWith`) for a comment.
//
// A deliberate exception goes in ALLOWLIST below, one entry per line, with a
// reason. An entry that no longer matches exactly one flagged line fails the
// check too, so exceptions cannot outlive the line they were written for.
//
// Run directly: `node scripts/lint-marker-lookups.mjs` (or
// `npm run lint:marker-lookups`). Exit code 0 = clean, 1 = violation.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORKFLOWS_DIR = ".github/workflows";

export const RULES = [
  {
    id: "search-in-body",
    matches: (line) => line.includes("in:body"),
  },
  {
    id: "unanchored-contains",
    matches: (line) => line.includes("contains(") && line.includes("body"),
  },
];

// Pending the #2081 workflow edit, which this lane could not make: see
// docs/plans/2081-question.md. Applying that edit makes these four entries
// stale, and the check then fails until they are removed.
const PENDING_2081 =
  "tracking-issue lookup still to be switched to find-marker-issue.mjs " +
  "(docs/plans/2081-workflow-edits.patch)";

// PR-comment lookups. Their writers put the marker on line 1, so each could be
// anchored with startswith; whether to do that here is Q1 in
// docs/plans/2081-question.md.
const COMMENT_LOOKUP_Q1 =
  "PR-comment lookup outside #2081's tracking-issue scope; anchoring it is " +
  "Q1 in docs/plans/2081-question.md";

/** @type {{ file: string, needle: string, reason: string }[]} */
export const ALLOWLIST = [
  {
    file: "auto-release.yml",
    needle: "select(.body | contains($m))",
    reason: PENDING_2081,
  },
  {
    file: "cron-health-monitor.yml",
    needle: "select(.body | contains($marker))",
    reason: PENDING_2081,
  },
  {
    file: "pokeapi-species-monitor.yml",
    needle: "select(.body | contains($marker))",
    reason: PENDING_2081,
  },
  {
    file: "monitor-grade-log-divergence.yml",
    needle: '--search "$MARKER in:body"',
    reason: PENDING_2081,
  },
  {
    file: "coverage.yml",
    needle: 'select(.body | contains(\\"$MARKER\\"))',
    reason: COMMENT_LOOKUP_Q1,
  },
  {
    file: "ci-failure-autofix.yml",
    needle: "select(.body | contains($marker))",
    reason: COMMENT_LOOKUP_Q1,
  },
  {
    file: "pr-check-monitor.yml",
    needle: "select(.body | contains($marker))",
    reason: COMMENT_LOOKUP_Q1,
  },
  {
    file: "vercel-preview-on-ready.yml",
    needle: "vercel-preview-fired:$SHA",
    reason: COMMENT_LOOKUP_Q1,
  },
  {
    file: "vercel-preview-on-ready.yml",
    needle: "contains(github.event.comment.body, '<!-- auto-review:')",
    reason:
      "if: filter for the auto-review verdict comment; auto-review.yml was " +
      "removed, so the whole gate is tracked in #2020 rather than patched here",
  },
  {
    file: "vercel-preview-on-ready.yml",
    needle: "auto-review-sha:$SHA",
    reason:
      "the auto-review SHA marker sits on line 2 of its comment, so startswith " +
      "cannot anchor it; part of the dead auto-review gate tracked in #2020",
  },
];

/**
 * @param {string} file workflow basename, used in the report
 * @param {string} text file contents
 * @returns {{ file: string, line: number, rules: string[], text: string }[]}
 */
export function scanText(file, text) {
  const found = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim();
    // Comments may name the banned forms on purpose, to warn against them.
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const rules = RULES.filter((rule) => rule.matches(raw)).map((rule) => rule.id);
    if (rules.length > 0) found.push({ file, line: index + 1, rules, text: trimmed });
  });
  return found;
}

/**
 * Removes allowlisted lines, and reports entries that do not cover exactly one
 * flagged line.
 *
 * @param {ReturnType<typeof scanText>} violations
 * @param {typeof ALLOWLIST} allowlist
 * @returns {{ violations: ReturnType<typeof scanText>, problems: string[] }}
 */
export function applyAllowlist(violations, allowlist) {
  const allowed = new Set();
  const problems = [];
  for (const entry of allowlist) {
    const hits = violations.filter(
      (v) => v.file === entry.file && v.text.includes(entry.needle),
    );
    if (hits.length === 1) {
      allowed.add(hits[0]);
    } else {
      problems.push(
        `allowlist entry for ${entry.file} (${JSON.stringify(entry.needle)}) matches ` +
          `${hits.length} flagged lines, not 1. ` +
          (hits.length === 0
            ? "The line it exempted is gone or fixed: remove the entry."
            : "Each entry covers one line: add an entry per line, or fix the copies."),
      );
    }
  }
  return { violations: violations.filter((v) => !allowed.has(v)), problems };
}

/**
 * Scans every workflow under `root`.
 *
 * @param {{ root?: string, allowlist?: typeof ALLOWLIST }} [options]
 * @returns {{ violations: ReturnType<typeof scanText>, problems: string[] }}
 */
export function run({ root = REPO_ROOT, allowlist = ALLOWLIST } = {}) {
  const dir = join(root, WORKFLOWS_DIR);
  const files = readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
  const violations = files.flatMap((name) =>
    scanText(name, readFileSync(join(dir, name), "utf8")),
  );
  return applyAllowlist(violations, allowlist);
}

function main() {
  const { violations, problems } = run();
  if (violations.length === 0 && problems.length === 0) {
    console.log("marker-lookups guard: OK (no search or unanchored marker lookups).");
    process.exit(0);
  }

  if (violations.length > 0) {
    console.error(
      `marker-lookups guard: ${violations.length} workflow line(s) look up a marker in a ` +
        `form that has misfired before (#2081).\n` +
        `  - \`in:body\` search never sees an HTML-comment marker (#1919).\n` +
        `  - An unanchored contains() matches any body that quotes the marker (#1997).\n` +
        `Fix:\n` +
        `  - Tracking issue: EXISTING=$(node .github/scripts/find-marker-issue.mjs ` +
        `--repo "$REPO" --marker "$MARKER")\n` +
        `  - Comment: anchor on line 1 with jq startswith($marker), or startsWith() ` +
        `in an Actions expression.\n` +
        `A deliberate exception goes in ALLOWLIST in scripts/lint-marker-lookups.mjs, ` +
        `with a reason.\n`,
    );
    for (const v of violations) {
      console.error(`  ${WORKFLOWS_DIR}/${v.file}:${v.line}  [${v.rules.join(", ")}]  ${v.text}`);
    }
  }
  for (const problem of problems) {
    console.error(`marker-lookups guard: ${problem}`);
  }
  process.exit(1);
}

const INVOKED_DIRECTLY =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  main();
}
