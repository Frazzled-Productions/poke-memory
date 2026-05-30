#!/usr/bin/env node
// Fails if AGENTS.md grows past its line budget.
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
import { join } from "node:path";

const ROOT = process.cwd();
const FILE = "AGENTS.md";

// Ceiling, with headroom above the current size so ordinary edits don't trip it
// but a section-sized re-bloat does. Current size after the compression pass is
// ~289 lines; 330 allows a section or two of genuine new runtime convention
// before the gate asks you to relocate detail instead. The pre-compression file
// was 449 lines, so this still fires long before the old level of bloat.
const MAX_LINES = 330;

const text = readFileSync(join(ROOT, FILE), "utf8");
const lines = text.split("\n").length;

if (lines > MAX_LINES) {
  console.error(
    `✗ ${FILE} is ${lines} lines, over the ${MAX_LINES}-line budget.\n` +
      `  AGENTS.md is loaded every session and must stay a lean index.\n` +
      `  Relocate detail to its canonical home and leave a pointer:\n` +
      `    - process / Actions / branching / release  -> WORKFLOW.md\n` +
      `    - heavy subsystems (sync, srs, sprites, ...) -> docs/*.md\n` +
      `    - per-agent pre-flight / step wording        -> .claude/agents/*.md\n` +
      `  Only raise MAX_LINES in scripts/lint-agents-size.mjs as a deliberate\n` +
      `  decision, in the same commit, with a justification.`,
  );
  process.exit(1);
}

console.log(`✓ ${FILE} is ${lines}/${MAX_LINES} lines.`);
