#!/usr/bin/env node
/**
 * Forcing function for the monitor tracking-issue lookup (#2081).
 *
 * Every scheduled monitor finds its tracking issue again by an HTML-comment
 * marker on line 1 of the issue body. Each workflow used to carry its own copy
 * of that lookup, and the copies misfired in two ways:
 *   * `gh issue list --search "<marker> in:body"` silently matches nothing
 *     (GitHub's search index drops HTML comments, and a colon in the marker
 *     parses as a search qualifier), so a duplicate is filed every run (#1919).
 *   * an unanchored jq `select(.body | contains($marker))` lets any issue that
 *     merely QUOTES the marker be taken over and have its body overwritten
 *     (#1997).
 * The single source of truth is .github/scripts/find-marker-issue.mjs. This
 * lint fails when a workflow reintroduces either form instead of calling it.
 *
 * Rules (applied to non-comment lines of .github/workflows/*.yml):
 *   1. `in:body` anywhere: a body-text search. No exemption.
 *   2. `--search` on the same line as a marker (`<!--` or `$MARKER`).
 *      No exemption.
 *   3. a jq `.body | contains(` match. Legitimate for PR-comment dedup (a
 *      comment is not a tracking issue, and those lookups are keyed on a
 *      unique per-SHA or per-run marker), so it may be exempted by a comment
 *      line `# marker-lookup-exempt: <reason>` within the EXEMPT_WINDOW lines
 *      above it. The reason is mandatory.
 *
 * Run directly: `node scripts/lint-workflow-marker-lookups.mjs` (wired into
 * `npm run lint` as `lint:workflow-markers`). Node built-ins only.
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** How many lines above a `contains(` match an exemption comment may sit. */
export const EXEMPT_WINDOW = 6;

const EXEMPT_RE = /^\s*#\s*marker-lookup-exempt:\s*(\S.*)?$/;
const BODY_CONTAINS_RE = /\.body\b[^|\n]*\|\s*contains\s*\(/;
const IN_BODY_RE = /\bin:body\b/;
const SEARCH_RE = /--search\b/;
const MARKER_RE = /<!--|\$\{?MARKER\b|\$\{?[A-Z_]*_MARKER\b/;

const isCommentLine = (line) => /^\s*#/.test(line);

/**
 * @param {string} file display name for messages
 * @param {string} text workflow YAML source
 * @returns {Array<{ file: string, line: number, rule: string, message: string }>}
 */
export function findViolations(file, text) {
  const lines = text.split("\n");
  /** @type {Array<{ file: string, line: number, rule: string, message: string }>} */
  const out = [];

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const exempt = line.match(EXEMPT_RE);
    if (exempt && !exempt[1]) {
      out.push({
        file,
        line: lineNo,
        rule: "exempt-reason",
        message: "`# marker-lookup-exempt:` needs a one-line reason after the colon.",
      });
      return;
    }
    if (isCommentLine(line)) return;

    if (IN_BODY_RE.test(line)) {
      out.push({
        file,
        line: lineNo,
        rule: "in-body-search",
        message:
          "`in:body` search: GitHub's search index drops HTML comments, so a marker search silently matches nothing (#1919). List issues with --json number,body and pipe them to .github/scripts/find-marker-issue.mjs.",
      });
      return;
    }
    if (SEARCH_RE.test(line) && MARKER_RE.test(line)) {
      out.push({
        file,
        line: lineNo,
        rule: "marker-search",
        message:
          "`--search` for a marker: GitHub's search index drops HTML comments (#1919). Use .github/scripts/find-marker-issue.mjs.",
      });
      return;
    }
    if (BODY_CONTAINS_RE.test(line)) {
      const from = Math.max(0, i - EXEMPT_WINDOW);
      const exempted = lines
        .slice(from, i)
        .some((prev) => {
          const m = prev.match(EXEMPT_RE);
          return Boolean(m && m[1]);
        });
      if (!exempted) {
        out.push({
          file,
          line: lineNo,
          rule: "unanchored-contains",
          message:
            "unanchored `.body | contains(` match: any issue that quotes the marker can be taken over (#1997). For a tracking-issue lookup use .github/scripts/find-marker-issue.mjs; for a PR-comment lookup add `# marker-lookup-exempt: <reason>` above the command.",
        });
      }
    }
  });

  return out;
}

/**
 * @param {string} dir directory holding the workflow files
 */
export function lintWorkflowDir(dir) {
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .flatMap((name) =>
      findViolations(join(".github/workflows", name), readFileSync(join(dir, name), "utf8")),
    );
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
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = lintWorkflowDir(join(repoRoot, ".github/workflows"));
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`${v.file}:${v.line}: [${v.rule}] ${v.message}`);
    }
    console.error(
      `\nlint:workflow-markers: ${violations.length} problem(s). See .github/scripts/find-marker-issue.mjs (#2081).`,
    );
    process.exit(1);
  }
  console.log("lint:workflow-markers: OK (no body-search or unanchored marker lookups).");
}
