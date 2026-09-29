#!/usr/bin/env node
//
// Find the open tracking issue that carries a monitor's HTML-comment marker
// (#2010, #2081).
//
// Usage:
//   gh issue list --json number,body ... > issues.json
//   node .github/scripts/find-marker-issue.mjs "<!-- monitor:x -->" < issues.json
//
// Prints the matching issue number, or nothing when no issue matches. Exits
// non-zero on unreadable input (not JSON, not an array), so a caller under
// `set -e` fails the step instead of treating a broken lookup as "no existing
// issue" and opening a duplicate.
//
// Matching rule: the marker must be the WHOLE first line of the body (a
// trailing CR is tolerated, for bodies edited on Windows). Two looser forms
// have already misfired in this repo:
//   * `gh issue list --search "<marker> in:body"` silently matches nothing
//     (GitHub's search index drops HTML comments, and a colon in the marker
//     parses as a search qualifier; #1919).
//   * an unanchored "body contains marker" match lets any issue that merely
//     QUOTES the marker (a retro, a review) be taken over and have its body
//     overwritten (#1997).
// When several issues match, the oldest (lowest number) wins, so the original
// thread keeps its history.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {Array<{ number: number, body?: string | null }>} issues
 * @param {string} marker
 * @returns {number | null} the oldest matching issue number, or null
 */
export function findMarkerIssue(issues, marker) {
  if (!Array.isArray(issues)) {
    throw new TypeError("expected a JSON array of issues");
  }
  if (typeof marker !== "string" || marker.length === 0) {
    throw new TypeError("expected a non-empty marker");
  }
  const matches = issues
    .filter((issue) => {
      const body = typeof issue?.body === "string" ? issue.body : "";
      const firstLine = body.split("\n", 1)[0].replace(/\r$/, "");
      return firstLine === marker;
    })
    .map((issue) => issue.number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  return matches.length > 0 ? matches[0] : null;
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
    const marker = process.argv[2];
    const issues = JSON.parse(readFileSync(0, "utf8"));
    const found = findMarkerIssue(issues, marker);
    if (found !== null) process.stdout.write(`${found}\n`);
  } catch (err) {
    console.error(`find-marker-issue: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
