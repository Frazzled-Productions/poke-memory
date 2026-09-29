#!/usr/bin/env node
//
// Find the open tracking issue that carries a monitor's HTML-comment marker
// (#2010, #2081).
//
// Usage:
//   gh issue list --json number,body,author ... > issues.json
//   node .github/scripts/find-marker-issue.mjs "<!-- monitor:x -->" \
//     --author github-actions [--author poke-memory-bot] < issues.json
//
// Prints the matching issue number, or nothing when no issue matches. Exits
// non-zero on unreadable input (not JSON, not an array, an issue without an
// `author` field) or a missing `--author`, so a caller under `set -e` fails
// the step instead of treating a broken lookup as "no existing issue" and
// opening a duplicate.
//
// Matching rule: the marker must be the WHOLE first line of the body (a
// trailing CR is tolerated, for bodies edited on Windows), AND the issue must
// have been opened by one of the allowed authors. Three looser forms have
// already misfired, or could, in this repo:
//   * `gh issue list --search "<marker> in:body"` silently matches nothing
//     (GitHub's search index drops HTML comments, and a colon in the marker
//     parses as a search qualifier; #1919).
//   * an unanchored "body contains marker" match lets any issue that merely
//     QUOTES the marker (a retro, a review) be taken over and have its body
//     overwritten (#1997).
//   * without an author filter, anyone can open an issue (the repo is public)
//     whose first line is exactly a monitor's marker; if it is older than the
//     real one, the monitor overwrites and later closes it (#2081 review).
// When several issues match, the oldest (lowest number) wins, so the original
// thread keeps its history.
//
// Author logins: gh's `author.login` shows an issue opened with GITHUB_TOKEN
// as `app/github-actions` (the REST API says `github-actions[bot]`), and one
// opened with the poke-memory-bot App token as `app/poke-memory-bot`. Both
// sides are normalised by dropping an `app/` prefix and a `[bot]` suffix, so
// `--author github-actions` matches any of those spellings.
//
// The issue's author must also BE a bot, so a human account that happens to
// be called `github-actions` or `poke-memory-bot` never matches: when gh
// reports `author.is_bot` (`gh issue list --json author` does) it must be
// true, and otherwise the login must be in a bot-only form (`app/<name>` or
// `<name>[bot]`; neither `/` nor `[` is legal in a user login).

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {string} login */
export function normaliseLogin(login) {
  return String(login)
    .trim()
    .toLowerCase()
    .replace(/^app\//, "")
    .replace(/\[bot\]$/, "");
}

const BOT_LOGIN_RE = /^app\/[^/\s]+$|^[^/\s]+\[bot\]$/i;

/**
 * Whether an issue author is a bot (GitHub App) account rather than a user.
 * @param {{ login?: string, is_bot?: boolean } | null | undefined} author
 */
export function isBotAuthor(author) {
  if (!author || typeof author.login !== "string") return false;
  if (typeof author.is_bot === "boolean") return author.is_bot;
  return BOT_LOGIN_RE.test(author.login.trim());
}

/**
 * @param {Array<{ number: number, body?: string | null, author?: { login?: string, is_bot?: boolean } | null }>} issues
 * @param {string} marker
 * @param {{ authors?: string[] }} [options] when `authors` is given, only
 *   issues opened by a bot account (see isBotAuthor) that is one of them
 *   match, and every issue must carry an `author` field (a caller that
 *   forgot `--json ...,author` fails loudly).
 * @returns {number | null} the oldest matching issue number, or null
 */
export function findMarkerIssue(issues, marker, options = {}) {
  if (!Array.isArray(issues)) {
    throw new TypeError("expected a JSON array of issues");
  }
  if (typeof marker !== "string" || marker.length === 0) {
    throw new TypeError("expected a non-empty marker");
  }
  const { authors } = options;
  let allowed = null;
  if (authors !== undefined) {
    if (!Array.isArray(authors) || authors.length === 0) {
      throw new TypeError("expected at least one allowed author");
    }
    allowed = new Set(authors.map(normaliseLogin));
  }
  const matches = issues
    .filter((issue) => {
      if (allowed) {
        if (!issue || !("author" in issue)) {
          throw new TypeError(
            `issue #${issue?.number} has no author field; list issues with --json number,body,author`,
          );
        }
        const author = issue.author;
        if (!isBotAuthor(author) || !allowed.has(normaliseLogin(author.login))) return false;
      }
      const body = typeof issue?.body === "string" ? issue.body : "";
      const firstLine = body.split("\n", 1)[0].replace(/\r$/, "");
      return firstLine === marker;
    })
    .map((issue) => issue.number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Parse CLI arguments: the marker, then one or more `--author <login>`.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const [marker, ...rest] = argv;
  const authors = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--author" && typeof rest[i + 1] === "string" && rest[i + 1] !== "") {
      authors.push(rest[i + 1]);
      i++;
    } else {
      throw new TypeError(`unexpected argument: ${rest[i]}`);
    }
  }
  if (authors.length === 0) {
    throw new TypeError(
      "at least one --author <login> is required (the login of the token that writes the tracking issue)",
    );
  }
  return { marker, authors };
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
    const { marker, authors } = parseArgs(process.argv.slice(2));
    const issues = JSON.parse(readFileSync(0, "utf8"));
    const found = findMarkerIssue(issues, marker, { authors });
    if (found !== null) process.stdout.write(`${found}\n`);
  } catch (err) {
    console.error(`find-marker-issue: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
