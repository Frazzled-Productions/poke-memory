#!/usr/bin/env node
// Regression guard for the no-em-dash rule documented in the AGENTS.md
// "Punctuation" section (house directive 2026-06-03: no em dashes anywhere,
// including code comments). An em dash (U+2014) must not appear anywhere in
// the repo's source. This script is wired into CI (the `lint` job) so the rule
// is enforced on every PR rather than relying on review alone.
//
// IN SCOPE (flagged):
//   - code comments and JSDoc (every `// ...` and block comment)
//   - JSX text nodes (prose rendered to the user)
//   - any string / template literal (test describe/it labels, script output,
//     user-visible JSX props, metadata exports - all of it)
//   - changelog.d source fragment bullet lines
//   - CHANGELOG.md release-note prose
//
// OUT OF SCOPE (never flagged):
//   - developer docs (AGENTS.md, README.md, WORKFLOW.md, docs source, etc.)
//   - this detector file itself, which necessarily contains the em-dash glyph
//     as the EM_DASH constant and in this header (see DETECTOR_SELF_PATH)
//   - the standalone "no value" dash glyph. That glyph is an em dash (U+2014)
//     used on its own as a placeholder (e.g. RecordsCard, AccuracySparkline,
//     HigherOrLowerGame) and as the literal matched by the stats tests
//     (getAllByText, not.toContain). A string or text node whose only
//     non-whitespace content is the dash is treated as the no-value glyph and
//     allowed; an em dash embedded in a longer run is flagged.
//   - external identifiers that literally contain an em dash. None exist in the
//     repo today; the house rule's only exception is documented here for the
//     future maintainer.
//
// Run directly: `node scripts/check-no-em-dash.mjs` (or `npm run lint:em-dash`).
// Exit code 0 = clean, 1 = at least one violation.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const EM_DASH = "—";
const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// This detector file necessarily contains the em-dash glyph (the EM_DASH
// constant above and the header comment). Exclude it from scanning so the
// linter never flags itself. Compared against the repo-relative path.
const DETECTOR_SELF_PATH = relative(
  REPO_ROOT,
  fileURLToPath(import.meta.url),
).replace(/\\/g, "/");

// Directory subtrees scanned for source files. Comments, test labels, script
// output strings and JSDoc all carry prose, so the scan covers product code,
// pure logic, scripts and the e2e / db helpers - not only the user-facing
// surfaces under app/ and components/.
const SOURCE_ROOTS = ["app", "components", "lib", "scripts", "e2e", "db", "i18n"];
// File extensions parsed as source (TypeScript, TSX, and the .mjs/.js/.cjs
// scripts). The TypeScript parser handles all of these.
const SOURCE_EXT = /\.(tsx?|mjs|cjs|js)$/;
// Directories never descended into while collecting source files.
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".claude",
  "coverage",
  "dist",
  "build",
]);

/**
 * Strip a single layer of matching surrounding quote characters (`"`, `'` or
 * a backtick) from a string. `node.getText(sourceFile)` returns a string
 * literal *with* its quotes (`"—"`), whereas a JSX text node's `.text` is
 * already unquoted. Normalising here lets `isStandaloneNoValueGlyph` treat
 * both call-site shapes identically.
 */
function stripSurroundingQuotes(text) {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if (first === last && (first === '"' || first === "'" || first === "`")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/**
 * True when a string's only non-whitespace content is em dashes. That is the
 * intentional "no value" placeholder glyph and must not be flagged. An em dash
 * sitting inside other prose is a real violation.
 *
 * Accepts either an unquoted value (a JSX text node's `.text`) or a quoted
 * string-literal source (`node.getText(sourceFile)`); surrounding quotes are
 * stripped first so an `alt` value and a bare text node behave the same.
 */
function isStandaloneNoValueGlyph(text) {
  const unquoted = stripSurroundingQuotes(text);
  return (
    unquoted.includes(EM_DASH) &&
    unquoted.replace(new RegExp(`[\\s${EM_DASH}]`, "g"), "") === ""
  );
}

function recordViolation(sink, file, sourceFile, pos, context) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
  sink.push({
    file: relative(REPO_ROOT, file),
    line: line + 1,
    column: character + 1,
    context: context.trim().replace(/\s+/g, " ").slice(0, 120),
  });
}

function recordRawViolation(sink, file, line, column, context) {
  sink.push({
    file: relative(REPO_ROOT, file),
    line,
    column,
    context: context.trim().replace(/\s+/g, " ").slice(0, 120),
  });
}

/** Recursively collect source files under a root, skipping noise dirs. */
function collectSourceFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) collectSourceFiles(full, out);
    } else if (SOURCE_EXT.test(entry)) {
      out.push(full);
    }
  }
}

/**
 * Find every comment range (`//` line, `/* *\/` block, JSDoc, and JSX `{/* *\/}`)
 * in raw source text with a small character scanner that skips over string,
 * template and regex literals so a `//` *inside* a string is never mistaken for
 * a comment. The TypeScript scanner mis-tokenises trivia inside JSX regions of a
 * `.tsx` file, so this raw pass is used for comments instead of `ts`.
 *
 * Returns `[start, end]` half-open offsets into `text`.
 */
function commentRanges(text) {
  const ranges = [];
  const n = text.length;
  let i = 0;
  // The previous significant (non-whitespace) character, used to decide whether
  // a `/` opens a regex literal (it does after an operator / `(` / `,` etc.).
  let prevSig = "";
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      const start = i;
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      ranges.push([start, i]);
      prevSig = "";
      continue;
    }
    if (c === "/" && d === "*") {
      const start = i;
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      ranges.push([start, i]);
      prevSig = "";
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && text[i] !== c) {
        if (text[i] === "\\") i++;
        i++;
      }
      i++;
      prevSig = c;
      continue;
    }
    if (c === "`") {
      i++;
      while (i < n && text[i] !== "`") {
        if (text[i] === "\\") {
          i++;
        } else if (text[i] === "$" && text[i + 1] === "{") {
          // Skip a `${ ... }` interpolation, tracking nested braces.
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (text[i] === "{") depth++;
            else if (text[i] === "}") depth--;
            i++;
          }
          continue;
        }
        i++;
      }
      i++;
      prevSig = "`";
      continue;
    }
    if (c === "/" && /[=(,:;[{!&|?+\-*%^~]/.test(prevSig)) {
      // Regex literal: opens after an operator or opening bracket. `<` and `>`
      // are deliberately excluded: in a `.tsx` file a `/` after `<` or `>` is a
      // JSX close tag (`</div>`) far more often than a regex, and treating it as
      // a regex would swallow a following `// comment` (see the JSX edge case in
      // the gate's test). A genuine regex opening right after a `<`/`>` operator
      // does not occur in this repo.
      i++;
      let inClass = false;
      while (i < n) {
        const r = text[i];
        if (r === "\\") {
          i += 2;
          continue;
        }
        if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) {
          i++;
          break;
        } else if (r === "\n") break;
        i++;
      }
      prevSig = "/";
      continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return ranges;
}

/**
 * Scan a file's comments (single-line, multi-line, JSDoc, JSX comments) for em
 * dashes. Comments are prose: every em dash in one is a violation (no glyph
 * exemption).
 */
function scanComments(sink, file, text, sourceFile) {
  for (const [start, end] of commentRanges(text)) {
    const tokenText = text.slice(start, end);
    if (tokenText.includes(EM_DASH)) {
      recordViolation(sink, file, sourceFile, start, tokenText);
    }
  }
}

/**
 * Walk the AST flagging em dashes in JSX text and in every string / template
 * literal (test labels, script output, JSX props, metadata, anything). The
 * standalone no-value glyph is allowed in both shapes.
 */
function scanAst(sink, file, sourceFile) {
  const visit = (node) => {
    // JSX text nodes - rendered prose. A standalone no-value dash is allowed.
    if (ts.isJsxText(node)) {
      if (node.text.includes(EM_DASH) && !isStandaloneNoValueGlyph(node.text)) {
        recordViolation(sink, file, sourceFile, node.getStart(sourceFile), node.text);
      }
    }

    // Every string / template literal. Covers describe/it labels, script
    // output strings, user-visible JSX props, metadata exports - all of it.
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const raw = node.getText(sourceFile);
      if (raw.includes(EM_DASH) && !isStandaloneNoValueGlyph(raw)) {
        recordViolation(sink, file, sourceFile, node.getStart(sourceFile), raw);
      }
    }

    node.forEachChild(visit);
  };
  visit(sourceFile);
}

/**
 * Scan a single in-memory source text and return its violations. Pure: no
 * filesystem access, no `process.exit`. `fileName` only labels output and
 * selects TSX vs TS parsing. Exported for the forcing-function test.
 */
function scanText(fileName, text) {
  const sink = [];
  if (!text.includes(EM_DASH)) return sink;
  const scriptKind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );
  scanComments(sink, fileName, text, sourceFile);
  scanAst(sink, fileName, sourceFile);
  return sink;
}

function checkSourceFile(sink, file) {
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
  // Never scan the detector itself - it holds the glyph by necessity.
  if (rel === DETECTOR_SELF_PATH) return;

  const text = readFileSync(file, "utf8");
  // Cheap pre-filter: nothing to do when the file has no em dash at all.
  if (!text.includes(EM_DASH)) return;

  for (const v of scanText(file, text)) sink.push(v);
}

/**
 * Markdown scan. `changelog.d` source fragment bodies and `CHANGELOG.md`
 * release notes are user-visible once a release is cut. YAML front-matter
 * (delimited by `---` at the top of a file) is skipped because it is structural
 * metadata, not prose. Every other non-front-matter line is checked.
 */
function checkMarkdownFile(sink, file) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(EM_DASH)) return;

  const lines = text.split(/\r?\n/);
  let inFrontMatter = false;
  let frontMatterSeen = false;

  lines.forEach((line, idx) => {
    // YAML front-matter is delimited by `---` on its own line at the top.
    if (line.trim() === "---") {
      if (!frontMatterSeen && idx === 0) {
        inFrontMatter = true;
        frontMatterSeen = true;
        return;
      }
      if (inFrontMatter) {
        inFrontMatter = false;
        return;
      }
    }
    if (inFrontMatter) return;
    if (!line.includes(EM_DASH)) return;

    const idxOfDash = line.indexOf(EM_DASH);
    recordRawViolation(sink, file, idx + 1, idxOfDash + 1, line);
  });
}

function collectMarkdownFiles() {
  const out = [];
  const changelogDir = join(REPO_ROOT, "changelog.d");
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".md") && entry !== "README.md") {
        // changelog.d/README.md is developer docs, not a fragment - skip it.
        out.push(full);
      }
    }
  };
  walk(changelogDir);

  const changelog = join(REPO_ROOT, "CHANGELOG.md");
  try {
    if (statSync(changelog).isFile()) out.push(changelog);
  } catch {
    /* CHANGELOG.md absent - nothing to check */
  }
  return out;
}

function run() {
  const violations = [];
  const sourceFiles = [];
  for (const root of SOURCE_ROOTS) {
    collectSourceFiles(join(REPO_ROOT, root), sourceFiles);
  }
  for (const file of sourceFiles) checkSourceFile(violations, file);

  for (const file of collectMarkdownFiles()) checkMarkdownFile(violations, file);

  violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
  return violations;
}

function main() {
  const found = run();
  if (found.length === 0) {
    console.log("no-em-dash guard: OK (no em dashes in source).");
    process.exit(0);
  }

  console.error(
    `no-em-dash guard: ${found.length} violation(s) found.\n` +
      `An em dash (U+2014) is not allowed anywhere in source, including code\n` +
      `comments (see the "Punctuation" section in AGENTS.md). Restructure the\n` +
      `sentence, or use a comma, colon, parentheses, or a spaced hyphen instead.\n`,
  );
  for (const v of found) {
    console.error(`  ${v.file}:${v.line}:${v.column}  ${v.context}`);
  }
  process.exit(1);
}

// Pure helpers exported for the forcing-function test. The CLI entry point
// (`main`) is only invoked when the script is run directly, never on import.
export { scanText, isStandaloneNoValueGlyph, commentRanges, run, EM_DASH };

const INVOKED_DIRECTLY =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  main();
}
