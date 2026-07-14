#!/usr/bin/env node
// Fails if AGENTS.md grows past its line or byte budget.
//
// AGENTS.md is loaded into context every session, so its value depends on
// staying a lean lookup index of runtime conventions. Heavy detail belongs in
// WORKFLOW.md, docs/*.md, or .claude/agents/*.md and should be pointed to from
// here, not duplicated. This gate is the forcing function for that rule: when
// the file crosses the ceiling, the fix is to relocate detail to its canonical
// home, not to raise the ceiling reflexively.
//
// Raising MAX_LINES is allowed but must be a deliberate decision (the same way
// coverage-floor.json is ratcheted): bump it in the same commit that adds the
// content, with a one-line justification in the commit message.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FILE = "AGENTS.md";

// Ceilings, with headroom above the current size so ordinary edits don't trip
// them but a section-sized re-bloat does. After the #1912 slimming pass the
// file is ~205 lines / ~23 KiB; 240 lines allows a section or two of genuine
// new runtime convention before the gate asks you to relocate detail instead.
const MAX_LINES = 240;

// Byte ceiling (#1912): some agent tools silently truncate instruction files
// at 32 KiB, and the line budget alone missed a ~40 KB file made of long
// lines. 26 KiB keeps a hard margin below the truncation point.
const MAX_BYTES = 26 * 1024;

const text = readFileSync(resolve(ROOT, FILE), "utf8");
const lines = text.trimEnd().split("\n").length;
const bytes = Buffer.byteLength(text, "utf8");

if (lines > MAX_LINES || bytes > MAX_BYTES) {
  console.error(
    `✗ ${FILE} is ${lines}/${MAX_LINES} lines and ${bytes}/${MAX_BYTES} bytes; one of the budgets is exceeded.\n` +
      `  AGENTS.md is loaded every session and must stay a lean index.\n` +
      `  Relocate detail to its canonical home and leave a pointer:\n` +
      `    - process / Actions / branching / release  -> WORKFLOW.md\n` +
      `    - heavy subsystems (sync, srs, sprites, ...) -> docs/*.md\n` +
      `    - per-agent pre-flight / step wording        -> .claude/agents/*.md\n` +
      `  Only raise MAX_LINES / MAX_BYTES in scripts/lint-agents-size.mjs as a\n` +
      `  deliberate decision, in the same commit, with a justification.`,
  );
  process.exit(1);
}

console.log(`✓ ${FILE} is ${lines}/${MAX_LINES} lines, ${bytes}/${MAX_BYTES} bytes.`);
