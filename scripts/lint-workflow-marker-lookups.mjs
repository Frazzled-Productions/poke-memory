#!/usr/bin/env node
/**
 * Forcing function for the monitor tracking-issue lookup (#2081).
 *
 * Every scheduled monitor finds its tracking issue again by an HTML-comment
 * marker on line 1 of the issue body. Each workflow used to carry its own copy
 * of that lookup, and the copies misfired:
 *   * `gh issue list --search "<marker> in:body"` silently matches nothing
 *     (GitHub's search index drops HTML comments, and a colon in the marker
 *     parses as a search qualifier), so a duplicate is filed every run (#1919).
 *   * an unanchored jq `select(.body | contains($marker))` lets any issue that
 *     merely QUOTES the marker be taken over and have its body overwritten
 *     (#1997).
 * The single source of truth is .github/scripts/find-marker-issue.mjs (marker
 * on line 1, opened by an allowed author). This lint fails when a workflow
 * reintroduces a broken form, or lists issue bodies without the helper.
 *
 * Rules, over .github/workflows/*.yml (comment lines are ignored):
 *   in-body-search        `in:body` anywhere. Never exemptible.
 *   marker-search         `--search` on the same line as a marker (`<!--` or
 *                         `$MARKER` / `$*_MARKER`). Never exemptible.
 *   unanchored-body-match a jq `.body ... | contains(` / `test(` / `index(`
 *                         (pipes allowed in between; a `||`, as in an `if:`
 *                         expression, is not a pipe). Exemptible.
 *   issue-list-no-helper  a `run:` step that lists issues with their bodies
 *                         (`gh issue list` or `gh search issues` with
 *                         `--json ...body...` / `--json=...body...`, `gh api`
 *                         on an `/issues` list endpoint, or a `gh api graphql`
 *                         statement that mentions both `issues` and `body`)
 *                         but never calls find-marker-issue.mjs. Exemptible.
 *   pr-comment-no-author  a statement that reads PR comments (`/comments`,
 *                         `--json comments`, `pulls/`) and mentions a marker,
 *                         but never filters on the comment author: REST
 *                         `.user.login`, or GraphQL `.author.login` together
 *                         with a bot check (`is_bot` / `__typename`), since
 *                         the GraphQL login drops the `[bot]` suffix that no
 *                         human account can hold. Anyone can post a comment
 *                         that quotes the marker (#2124). Never exemptible.
 *   pr-comment-unanchored the same kind of statement without a first-line
 *                         anchor for the marker (`split("\n")[0]`, or
 *                         `startswith(`), so a comment that merely quotes the
 *                         marker further down would match (#2124). Exemptible.
 *                         A statement that only writes (`--method` / `-X`
 *                         POST, PATCH, PUT or DELETE, with no `select(`) is
 *                         not a lookup and is skipped by both rules.
 *
 * Exemptions are a comment directly above the ONE statement they cover (the
 * next non-comment statement of the same `run:` block; a statement includes
 * its `\` continuations, pipes and multi-line quotes). The reason is mandatory:
 *   # marker-lookup-exempt: <reason>
 *       For a PR-comment lookup only: the statement must read comments
 *       (`/comments`, `--json comments`) or pulls (`pulls/`). Waives
 *       unanchored-body-match and pr-comment-unanchored, never
 *       pr-comment-no-author. The number of these in the tree is pinned by a
 *       test (none today), so adding one is a visible change.
 *   # issue-body-read-exempt: <reason>
 *       For reading issue bodies for something that is NOT a marker (such as
 *       task-list checkboxes): the statement must not mention a marker, and
 *       must narrow the list with `--label`, so the read only ever sees
 *       issues someone with triage rights has opted in. The number of these
 *       in the tree is pinned by a test, so adding one is a visible change.
 * A misplaced, reasonless, mis-kinded or unused exemption is itself an error.
 *
 * Run directly: `node scripts/lint-workflow-marker-lookups.mjs` (wired into
 * `npm run lint` as `lint:workflow-markers`). Node built-ins only.
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EXEMPT_RE = /^\s*#\s*(marker-lookup-exempt|issue-body-read-exempt):\s*(\S.*)?$/;
// A single `|` (a jq pipe) only: `||` in an `if:` expression is not one.
const BODY_MATCH_RE = /\.body\b.*?(?<!\|)\|(?!\|)\s*(contains|test|index)\s*\(/;
const IN_BODY_RE = /\bin:body\b/;
const SEARCH_RE = /--search\b/;
const MARKER_RE = /<!--|\$\{?MARKER\b|\$\{?[A-Z_]*_MARKER\b/;
const PR_COMMENT_RE = /\/comments\b|--json\s+["']?comments\b|pulls\//;
const ISSUE_LIST_RE =
  /\bgh\s+(?:issue\s+list|search\s+issues)\b[\s\S]*--json(?:\s+|=)["']?[\w,]*\bbody\b/;
// A GraphQL query that reads issue bodies (the query must sit in the same
// statement for the lint to see it).
const GRAPHQL_RE = /\bgh\s+api\s+graphql\b/;
const GRAPHQL_ISSUES_RE = /\bissues\b/;
const GRAPHQL_BODY_RE = /\bbody\b/;
const LABEL_RE = /--label\b/;
// `gh api` on an issue LIST endpoint (…/issues, optionally with a query), not
// a single issue (…/issues/$N) or its comments.
const API_ISSUES_LIST_RE = /\bgh\s+api\b[\s\S]*?\/issues(?:\?[^\s"']*)?["'\s]/;
const HELPER_RE = /find-marker-issue\.mjs/;
// PR-comment marker lookups (#2131): who wrote the comment, and where the
// marker sits in it.
const REST_AUTHOR_RE = /\.user\.login\b/;
const GRAPHQL_AUTHOR_RE = /\.author\.login\b/;
const BOT_CHECK_RE = /\bis_bot\b|__typename\b/;
// `split("\n")[0]` as written in a single-quoted jq program, or with the
// quotes and backslash escaped inside a double-quoted `--jq "..."`.
const FIRST_LINE_RE = /split\(\s*\\?"\\{1,2}n\\?"\s*\)\s*\[\s*0\s*\]/;
const STARTSWITH_RE = /\bstartswith\s*\(/;
const WRITE_METHOD_RE = /(?:--method|-X)\s+["']?(?:POST|PATCH|PUT|DELETE)\b/;
const SELECT_RE = /\bselect\s*\(/;

const isCommentLine = (line) => /^\s*#/.test(line);
const indentOf = (line) => line.length - line.trimStart().length;

/**
 * Scan one shell line, carrying quote state across lines. Returns the new
 * state and a heredoc delimiter opened on this line (outside quotes), if any.
 * @param {string} line
 * @param {null | "'" | '"'} state
 */
function scanShellLine(line, state) {
  let heredoc = null;
  let outside = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (state === "'") {
      if (ch === "'") state = null;
      continue;
    }
    if (state === '"') {
      if (ch === "\\") i++;
      else if (ch === '"') state = null;
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
    if (ch === "'" || ch === '"') {
      state = ch;
      continue;
    }
    outside += ch;
  }
  const m = outside.match(/(?<!<)<<(?!<)-?\s*(\w+)/) || line.match(/(?<!<)<<(?!<)-?\s*['"](\w+)['"]/);
  if (m) heredoc = m[1];
  return { state, heredoc };
}

/**
 * Split a workflow into `run:` blocks, each a list of statements.
 * @param {string[]} lines
 * @returns {Array<{ start: number, end: number, statements: Array<{ start: number, end: number, text: string, exemption: null | { kind: string, reason: string | undefined, line: number } }> }>}
 */
export function parseRunBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*(?:-\s+)?)run:\s*(.*)$/);
    if (!m) continue;
    const keyCol = m[1].length;
    const rest = m[2].trim();
    let bodyStart;
    let bodyEnd;
    if (/^[|>][-+0-9]*$/.test(rest)) {
      bodyStart = i + 1;
      bodyEnd = bodyStart;
      while (
        bodyEnd < lines.length &&
        (lines[bodyEnd].trim() === "" || indentOf(lines[bodyEnd]) > keyCol)
      ) {
        bodyEnd++;
      }
    } else {
      bodyStart = i;
      bodyEnd = i + 1;
    }
    blocks.push({ start: bodyStart, end: bodyEnd, statements: splitStatements(lines, bodyStart, bodyEnd, i === bodyStart) });
    i = Math.max(i, bodyEnd - 1);
  }
  return blocks;
}

function splitStatements(lines, from, to, inline) {
  const statements = [];
  let pendingExempt = [];
  let i = from;
  while (i < to) {
    const raw = inline ? lines[i].replace(/^\s*(?:-\s+)?run:\s*/, "") : lines[i];
    if (raw.trim() === "") {
      // A blank line detaches any exemption above it: report it as unused.
      for (const ex of pendingExempt) {
        statements.push({ start: ex.line, end: ex.line + 1, text: "", exemption: ex, extraExemptions: [] });
      }
      pendingExempt = [];
      i++;
      continue;
    }
    if (isCommentLine(raw)) {
      const ex = raw.match(EXEMPT_RE);
      if (ex) pendingExempt.push({ kind: ex[1], reason: ex[2], line: i });
      i++;
      continue;
    }
    const start = i;
    const parts = [];
    let state = null;
    let heredoc = null;
    for (;;) {
      const line = inline ? raw : lines[i];
      parts.push(line);
      const scanned = scanShellLine(line, state);
      state = scanned.state;
      if (scanned.heredoc && !heredoc) heredoc = scanned.heredoc;
      i++;
      if (heredoc && state === null) {
        while (i < to && lines[i].trim() !== heredoc) i++;
        i++;
        heredoc = null;
        break;
      }
      if (i >= to) break;
      const trimmed = line.trimEnd();
      const next = lines[i].trim();
      if (
        state !== null ||
        trimmed.endsWith("\\") ||
        /(\||&&|\|\|)$/.test(trimmed) ||
        /^(\||&&|\|\|)/.test(next)
      ) {
        continue;
      }
      break;
    }
    const exemption = pendingExempt.length > 0 ? pendingExempt[pendingExempt.length - 1] : null;
    statements.push({ start, end: i, text: parts.join("\n"), exemption, extraExemptions: pendingExempt.slice(0, -1) });
    pendingExempt = [];
  }
  // An exemption comment with no statement after it in the block.
  for (const ex of pendingExempt) {
    statements.push({ start: ex.line, end: ex.line + 1, text: "", exemption: ex, extraExemptions: [] });
  }
  return statements;
}

/**
 * Whether a statement lists issues together with their bodies.
 * @param {string} text
 */
export function listsIssueBodies(text) {
  return (
    ISSUE_LIST_RE.test(text) ||
    API_ISSUES_LIST_RE.test(`${text}\n`) ||
    (GRAPHQL_RE.test(text) && GRAPHQL_ISSUES_RE.test(text) && GRAPHQL_BODY_RE.test(text))
  );
}

/**
 * Whether a statement looks up PR comments by a marker: it reads PR comments,
 * mentions a marker, and is not a pure write (a write-method call with no
 * `select(` filter, such as the PATCH / POST / DELETE that acts on the id).
 * @param {string} text
 */
export function isPrCommentMarkerLookup(text) {
  if (!PR_COMMENT_RE.test(text) || !MARKER_RE.test(text)) return false;
  return !(WRITE_METHOD_RE.test(text) && !SELECT_RE.test(text));
}

/**
 * Whether a PR-comment lookup filters on the comment author.
 * @param {string} text
 */
export function filtersOnAuthor(text) {
  return REST_AUTHOR_RE.test(text) || (GRAPHQL_AUTHOR_RE.test(text) && BOT_CHECK_RE.test(text));
}

/**
 * Whether a PR-comment lookup anchors the marker to the start of the body.
 * @param {string} text
 */
export function anchorsToFirstLine(text) {
  return FIRST_LINE_RE.test(text) || STARTSWITH_RE.test(text);
}

/**
 * Why an `issue-body-read-exempt` cannot apply to a statement, or null.
 * @param {string} text
 */
function issueBodyReadMisuse(text) {
  if (MARKER_RE.test(text)) {
    return "`issue-body-read-exempt` is for non-marker body reads; this statement mentions a marker, so use .github/scripts/find-marker-issue.mjs.";
  }
  if (!LABEL_RE.test(text)) {
    return "`issue-body-read-exempt` needs the statement to narrow the list with `--label`, so it only reads issues someone with triage rights opted in.";
  }
  return null;
}

/**
 * Whether a statement's exemption is valid and may waive `rule`.
 * marker-lookup-exempt: PR-comment lookups, waives unanchored-body-match and
 * pr-comment-unanchored (never pr-comment-no-author).
 * issue-body-read-exempt: non-marker, label-gated body reads, waives both
 * body rules.
 */
function exemptionWaives(st, rule) {
  const ex = st.exemption;
  if (!ex || !ex.reason || !st.text) return false;
  if (ex.kind === "marker-lookup-exempt") {
    return (
      (rule === "unanchored-body-match" || rule === "pr-comment-unanchored") &&
      PR_COMMENT_RE.test(st.text)
    );
  }
  if (ex.kind === "issue-body-read-exempt") {
    return issueBodyReadMisuse(st.text) === null;
  }
  return false;
}

/**
 * @param {string} file display name for messages
 * @param {string} text workflow YAML source
 * @returns {Array<{ file: string, line: number, rule: string, message: string }>}
 */
export function findViolations(file, text) {
  const lines = text.split("\n");
  /** @type {Array<{ file: string, line: number, rule: string, message: string }>} */
  const out = [];
  const push = (line, rule, message) => out.push({ file, line: line + 1, rule, message });

  const blocks = parseRunBlocks(lines);
  /** @type {Map<number, any>} line index -> statement */
  const statementAt = new Map();
  for (const block of blocks) {
    for (const st of block.statements) {
      for (let l = st.start; l < st.end; l++) statementAt.set(l, st);
    }
  }
  const usedExemptions = new Set();

  // Line rules.
  lines.forEach((line, i) => {
    if (isCommentLine(line)) {
      const ex = line.match(EXEMPT_RE);
      if (ex && !ex[2]) {
        push(i, "exempt-reason", `\`# ${ex[1]}:\` needs a one-line reason after the colon.`);
      }
      return;
    }
    if (IN_BODY_RE.test(line)) {
      push(
        i,
        "in-body-search",
        "`in:body` search: GitHub's search index drops HTML comments, so a marker search silently matches nothing (#1919). List issues with --json number,body,author and pipe them to .github/scripts/find-marker-issue.mjs.",
      );
      return;
    }
    if (SEARCH_RE.test(line) && MARKER_RE.test(line)) {
      push(
        i,
        "marker-search",
        "`--search` for a marker: GitHub's search index drops HTML comments (#1919). Use .github/scripts/find-marker-issue.mjs.",
      );
      return;
    }
    if (BODY_MATCH_RE.test(line)) {
      const st = statementAt.get(i);
      if (st && exemptionWaives(st, "unanchored-body-match")) {
        usedExemptions.add(st.exemption);
        return;
      }
      push(
        i,
        "unanchored-body-match",
        "unanchored `.body | contains(`/`test(`/`index(` match: any issue that quotes the marker can be taken over (#1997). For a tracking-issue lookup use .github/scripts/find-marker-issue.mjs; for a PR-comment lookup add `# marker-lookup-exempt: <reason>` directly above the statement.",
      );
    }
  });

  // Positive rule, per run block.
  for (const block of blocks) {
    const blockText = block.statements.map((s) => s.text).join("\n");
    const callsHelper = HELPER_RE.test(blockText);
    for (const st of block.statements) {
      if (!st.text) continue;
      if (!listsIssueBodies(st.text) || callsHelper) continue;
      if (exemptionWaives(st, "issue-list-no-helper")) {
        usedExemptions.add(st.exemption);
        continue;
      }
      push(
        st.start,
        "issue-list-no-helper",
        "this step lists issues with their bodies but never calls .github/scripts/find-marker-issue.mjs. A marker lookup must go through the helper (marker on line 1, allowed author); a non-marker body read needs `# issue-body-read-exempt: <reason>` directly above the statement.",
      );
    }
  }

  // PR-comment marker lookups (#2131): author filter and first-line anchor.
  for (const block of blocks) {
    for (const st of block.statements) {
      if (!st.text || !isPrCommentMarkerLookup(st.text)) continue;
      if (!filtersOnAuthor(st.text)) {
        push(
          st.start,
          "pr-comment-no-author",
          "this PR-comment lookup matches a marker without filtering on the comment author, so anyone can plant or quote the marker and hijack the dedup (#2124). Select on `.user.login` (REST; `github-actions[bot]` for GITHUB_TOKEN posts), or `.author.login` plus an `is_bot` / `__typename` check (GraphQL drops `[bot]`). Not exemptible.",
        );
      }
      if (anchorsToFirstLine(st.text)) continue;
      if (exemptionWaives(st, "pr-comment-unanchored")) {
        usedExemptions.add(st.exemption);
        continue;
      }
      push(
        st.start,
        "pr-comment-unanchored",
        'this PR-comment lookup does not anchor the marker to the first line, so a comment that merely quotes it matches (#2124). Compare `((.body // "") | split("\\n")[0] | rtrimstr("\\r")) == $marker`, or add `# marker-lookup-exempt: <reason>` directly above the statement.',
      );
    }
  }

  // Exemption hygiene: kind must fit the statement, and each must be used.
  for (const block of blocks) {
    for (const st of block.statements) {
      for (const extra of st.extraExemptions) {
        push(extra.line, "exempt-misplaced", "only the exemption comment directly above a statement counts; remove this extra one.");
      }
      const ex = st.exemption;
      if (!ex || !ex.reason) continue;
      if (!st.text) {
        push(ex.line, "exempt-unused", "exemption is not followed by a statement in this `run:` block.");
        continue;
      }
      if (ex.kind === "marker-lookup-exempt" && !PR_COMMENT_RE.test(st.text)) {
        push(ex.line, "exempt-misuse", "`marker-lookup-exempt` is for PR-comment lookups only (the statement must read `/comments`, `--json comments` or `pulls/`). A tracking-issue lookup must use .github/scripts/find-marker-issue.mjs.");
        continue;
      }
      if (ex.kind === "issue-body-read-exempt") {
        const misuse = issueBodyReadMisuse(st.text);
        if (misuse) {
          push(ex.line, "exempt-misuse", misuse);
          continue;
        }
      }
      if (!usedExemptions.has(ex)) {
        push(ex.line, "exempt-unused", "exemption covers a statement that needs none; remove it.");
      }
    }
  }

  return out.sort((a, b) => a.line - b.line);
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
  console.log("lint:workflow-markers: OK (no body-search, unanchored or helper-less marker lookups).");
}
