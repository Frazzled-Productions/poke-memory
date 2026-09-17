#!/usr/bin/env node
//
// Shared tracking-issue lookup for the scheduled monitor workflows (#2081).
//
// Usage, from a step running under `set -euo pipefail`:
//
//   EXISTING=$(node .github/scripts/find-marker-issue.mjs --repo "$REPO" --marker "$MARKER")
//
// Prints the number of the open issue whose body starts with the marker line,
// or nothing when there is none. Exits non-zero when `gh` fails, when its
// output is not the expected JSON, or when the issue list may have been cut
// short. Under `set -e` that aborts the step, so a failed lookup can never read
// as "no existing issue" and file a duplicate.
//
// Why one shared helper
// ---------------------
// Each monitor used to carry its own copy of this lookup, and the copies failed
// in different ways:
//
//   - `gh issue list --search "<marker> in:body"` silently matched nothing. The
//     search index strips HTML comments, and a colon in the marker parses as a
//     search qualifier, so every run filed a duplicate (#1919). `--label` goes
//     through the same search API in gh, so it is not used here either.
//   - An unanchored jq `contains` matched any open issue that merely quoted the
//     marker. qa-drift-check took over the 2026-W32 workflow review that way,
//     overwrote its body daily and then closed it (#1997).
//
// So a match requires the whole first line of the body to be the marker. Every
// writer already puts the marker alone on line 1. The issues are listed and
// matched locally, never searched. scripts/lint-marker-lookups.mjs fails the
// lint chain if either old form comes back into a workflow.
//
// Built-ins only: three of the calling jobs have no setup-node step and run on
// the runner's preinstalled Node.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Far above the open-issue count (44 when this was written). Reaching it means
// the list may be truncated, which is treated as a failure (see main).
export const ISSUE_LIMIT = 1000;

const MARKER_SHAPE = /^<!--.*-->$/;

/**
 * The first line of an issue body, with surrounding whitespace removed.
 * Web-UI edits save CRLF line endings, so both endings are accepted. Leading
 * whitespace is tolerated too: a writer whose heredoc kept some indentation
 * would otherwise never find its own issue and would file a new one every run.
 *
 * @param {unknown} body
 * @returns {string | null} null for a missing or non-string body
 */
export function firstLine(body) {
  if (typeof body !== "string") return null;
  return body.split(/\r?\n/, 1)[0].trim();
}

/**
 * Picks the tracking issue for a marker out of an open-issue list.
 *
 * @param {{ number: number, body?: string | null }[]} issues
 * @param {string} marker the full marker line, e.g. `<!-- qa-drift-check -->`
 * @returns {{ number: number | null, duplicates: number[] }} the newest
 *   (highest-numbered) match, plus any older matches, newest first
 */
export function findMarkerIssue(issues, marker) {
  const matches = issues
    .filter((issue) => firstLine(issue.body) === marker)
    .map((issue) => issue.number)
    .sort((a, b) => b - a);
  return { number: matches[0] ?? null, duplicates: matches.slice(1) };
}

/**
 * @param {string[]} argv arguments after the script path
 * @returns {{ repo: string, marker: string }}
 * @throws {Error} on a missing, unknown or malformed argument
 */
export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: "string" },
      marker: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.repo || !/^[\w.-]+\/[\w.-]+$/.test(values.repo)) {
    throw new Error(`--repo must be an owner/name slug, got "${values.repo ?? ""}"`);
  }
  // An empty marker would match every issue with an empty body, and a marker
  // spanning lines can never equal a first line, so both are caller bugs.
  if (!values.marker || !MARKER_SHAPE.test(values.marker)) {
    throw new Error(
      `--marker must be a single-line HTML comment, got "${values.marker ?? ""}"`,
    );
  }
  return { repo: values.repo, marker: values.marker };
}

/**
 * The `gh` arguments for the open-issue listing. Kept separate so the test can
 * pin that it lists rather than searches.
 *
 * @param {string} repo
 * @returns {string[]}
 */
export function ghListArgs(repo) {
  return [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    String(ISSUE_LIMIT),
    "--json",
    "number,body",
  ];
}

/** @param {string[]} args */
function runGh(args) {
  // No shell, so marker text is never shell-interpreted. gh's stderr goes
  // straight to the step log. The buffer allows for 1000 long bodies.
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * CLI entry point. Returns the exit code rather than exiting, so tests can
 * drive it with a stubbed `gh`.
 *
 * Annotations go to stderr, because stdout is captured by the caller's command
 * substitution and must hold nothing but the issue number. The Actions runner
 * reads workflow commands from both streams (ScriptHandler in actions/runner
 * attaches an OutputManager to each).
 *
 * @param {string[]} argv
 * @param {{
 *   gh?: (args: string[]) => string,
 *   stdout?: { write: (s: string) => unknown },
 *   stderr?: { write: (s: string) => unknown },
 * }} [io]
 * @returns {number}
 */
export function main(argv, io = {}) {
  const gh = io.gh ?? runGh;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const fail = (message) => {
    stderr.write(`::error::find-marker-issue: ${message}\n`);
    return 1;
  };

  let options;
  try {
    options = parseCliArgs(argv);
  } catch (err) {
    return fail(err.message);
  }

  let raw;
  try {
    raw = gh(ghListArgs(options.repo));
  } catch (err) {
    return fail(`gh issue list failed: ${err.message}`);
  }

  let issues;
  try {
    issues = JSON.parse(raw);
  } catch {
    return fail("gh issue list did not return JSON");
  }
  if (!Array.isArray(issues)) {
    return fail("gh issue list did not return a JSON array");
  }
  if (!issues.every((issue) => Number.isInteger(issue?.number))) {
    return fail("gh issue list returned an entry without an integer issue number");
  }
  if (issues.length >= ISSUE_LIMIT) {
    return fail(
      `gh issue list returned ${issues.length} open issues, the --limit of ${ISSUE_LIMIT}, ` +
        `so the tracking issue may be missing from the list. Raise ISSUE_LIMIT in ` +
        `.github/scripts/find-marker-issue.mjs.`,
    );
  }

  const { number, duplicates } = findMarkerIssue(issues, options.marker);
  if (duplicates.length > 0) {
    stderr.write(
      `::warning::find-marker-issue: ${duplicates.length + 1} open issues start with ` +
        `${options.marker}. Using #${number}; close the duplicates: ` +
        `${duplicates.map((n) => `#${n}`).join(", ")}.\n`,
    );
  }
  if (number !== null) stdout.write(`${number}\n`);
  return 0;
}

const INVOKED_DIRECTLY =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  process.exitCode = main(process.argv.slice(2));
}
