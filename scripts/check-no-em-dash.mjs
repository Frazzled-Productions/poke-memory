#!/usr/bin/env node
// Regression guard for the no-em-dash rule documented in the AGENTS.md
// "Punctuation" section. An em dash (U+2014) must not appear in user-facing
// copy. This script is wired into CI (the `lint` job) so the rule is enforced
// on every PR rather than relying on review alone.
//
// IN SCOPE (flagged):
//   - JSX text nodes (prose rendered to the user)
//   - string literals passed to user-visible JSX props: aria-label, alt,
//     title, placeholder
//   - string literals inside `metadata` / `generateMetadata` exports
//   - changelog.d/** fragment bullet lines
//   - CHANGELOG.md release-note prose
//
// OUT OF SCOPE (never flagged):
//   - code comments
//   - developer docs (AGENTS.md, README.md, WORKFLOW.md, docs/**, etc.)
//   - the standalone "no value" dash glyph on the Stats page. That glyph is an
//     em dash (U+2014) used on its own as a placeholder (e.g. RecordsCard,
//     AccuracySparkline, HigherOrLowerGame). A text node or string whose only
//     non-whitespace content is the dash is treated as the no-value glyph and
//     allowed; an em dash embedded in a longer run of prose is flagged.
//
// Run directly: `node scripts/check-no-em-dash.mjs` (or `npm run lint:em-dash`).
// Exit code 0 = clean, 1 = at least one violation.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const EM_DASH = "—";
const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// JSX attributes whose string values are rendered or read out to the user.
const USER_VISIBLE_ATTRS = new Set(["aria-label", "alt", "title", "placeholder"]);

// Directory subtrees scanned for source files. JSX and Next.js
// `metadata` / `generateMetadata` exports only ever live under `app/` and
// `components/`; `lib/` holds pure logic with no user-facing copy, so it is
// deliberately not scanned.
const SOURCE_ROOTS = ["app", "components"];
// Directories never descended into while collecting source files.
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".claude",
  "coverage",
]);

/** @type {{ file: string, line: number, column: number, context: string }[]} */
const violations = [];

/**
 * True when a string's only non-whitespace content is em dashes. That is the
 * intentional "no value" placeholder glyph and must not be flagged. An em dash
 * sitting inside other prose ("Game over — streak of N") is a real violation.
 */
function isStandaloneNoValueGlyph(text) {
  return text.includes(EM_DASH) && text.replace(/[\s—]/g, "") === "";
}

function recordViolation(file, sourceFile, pos, context) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
  violations.push({
    file: relative(REPO_ROOT, file),
    line: line + 1,
    column: character + 1,
    context: context.trim().replace(/\s+/g, " ").slice(0, 120),
  });
}

/** Recursively collect *.ts / *.tsx files under a root, skipping noise dirs. */
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
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
}

/** True when `node` is an `export`ed `metadata` const or `generateMetadata`. */
function isMetadataExport(node) {
  const hasExport = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
  if (!hasExport) return false;
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.some(
      (d) => ts.isIdentifier(d.name) && d.name.text === "metadata",
    );
  }
  if (ts.isFunctionDeclaration(node)) {
    return node.name?.text === "generateMetadata";
  }
  return false;
}

/** Flag any string-literal descendant of `node` that carries a real em dash. */
function scanStringLiteralsForEmDash(node, file, sourceFile) {
  const visit = (n) => {
    if (
      (ts.isStringLiteral(n) ||
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateExpression(n)) &&
      n.getText(sourceFile).includes(EM_DASH) &&
      !isStandaloneNoValueGlyph(n.getText(sourceFile))
    ) {
      recordViolation(file, sourceFile, n.getStart(sourceFile), n.getText(sourceFile));
    }
    n.forEachChild(visit);
  };
  visit(node);
}

function checkSourceFile(file) {
  const text = readFileSync(file, "utf8");
  // Cheap pre-filter: nothing to do when the file has no em dash at all.
  if (!text.includes(EM_DASH)) return;

  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node) => {
    // 1. JSX text nodes — rendered prose. A standalone no-value dash is allowed.
    if (ts.isJsxText(node)) {
      if (node.text.includes(EM_DASH) && !isStandaloneNoValueGlyph(node.text)) {
        recordViolation(file, sourceFile, node.getStart(sourceFile), node.text);
      }
    }

    // 2. User-visible JSX attribute string values.
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sourceFile);
      if (USER_VISIBLE_ATTRS.has(name)) {
        const init = node.initializer;
        const valueNode = ts.isJsxExpression(init) ? init.expression : init;
        if (
          valueNode &&
          (ts.isStringLiteral(valueNode) ||
            ts.isNoSubstitutionTemplateLiteral(valueNode) ||
            ts.isTemplateExpression(valueNode)) &&
          valueNode.getText(sourceFile).includes(EM_DASH) &&
          !isStandaloneNoValueGlyph(valueNode.getText(sourceFile))
        ) {
          recordViolation(
            file,
            sourceFile,
            valueNode.getStart(sourceFile),
            valueNode.getText(sourceFile),
          );
        }
      }
    }

    // 3. metadata / generateMetadata exports — every string literal inside.
    if (isMetadataExport(node)) {
      scanStringLiteralsForEmDash(node, file, sourceFile);
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);
}

/**
 * Markdown scan. `changelog.d/**` fragment bodies and `CHANGELOG.md` release
 * notes are user-visible once a release is cut. Front-matter, headings, and
 * the HTML stub comment in CHANGELOG.md are structural, not prose, so they are
 * skipped — but in practice they should never carry an em dash anyway.
 */
function checkMarkdownFile(file) {
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
    violations.push({
      file: relative(REPO_ROOT, file),
      line: idx + 1,
      column: idxOfDash + 1,
      context: line.trim().slice(0, 120),
    });
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
        // changelog.d/README.md is developer docs, not a fragment — skip it.
        out.push(full);
      }
    }
  };
  walk(changelogDir);

  const changelog = join(REPO_ROOT, "CHANGELOG.md");
  try {
    if (statSync(changelog).isFile()) out.push(changelog);
  } catch {
    /* CHANGELOG.md absent — nothing to check */
  }
  return out;
}

function main() {
  const sourceFiles = [];
  for (const root of SOURCE_ROOTS) {
    collectSourceFiles(join(REPO_ROOT, root), sourceFiles);
  }
  for (const file of sourceFiles) checkSourceFile(file);

  for (const file of collectMarkdownFiles()) checkMarkdownFile(file);

  if (violations.length === 0) {
    console.log("no-em-dash guard: OK (no em dashes in user-facing copy).");
    process.exit(0);
  }

  violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
  console.error(
    `no-em-dash guard: ${violations.length} violation(s) found.\n` +
      `An em dash (U+2014) is not allowed in user-facing copy — see the\n` +
      `"Punctuation" section in AGENTS.md. Restructure the sentence, or use a\n` +
      `comma, colon, parentheses, or a spaced hyphen instead.\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.column}  ${v.context}`);
  }
  process.exit(1);
}

main();
