/**
 * Layout check: every entry in `.claude/skills/` must be a folder holding
 * `SKILL.md`, the only layout Claude Code loads as a skill (#1992). A flat
 * `<name>.md` there is silently ignored. Wired into `npm run lint`.
 *
 * Run directly: `node scripts/check-skills-layout.mjs` (or
 * `npm run lint:skills-layout`). Node built-ins only.
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findSkillsLayoutProblems } from "./lib/skills-layout.mjs";

const ROOT = ".claude/skills";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(repoRoot, ROOT);

const entries = existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.name !== ".DS_Store")
      .map((d) => ({
        name: d.name,
        isDirectory: d.isDirectory(),
        children: d.isDirectory() ? readdirSync(resolve(dir, d.name)) : [],
      }))
  : [];

const problems = findSkillsLayoutProblems(ROOT, entries);

if (problems.length > 0) {
  console.error("\ncheck-skills-layout: Claude Code will not load these as skills:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nA project skill must be a folder holding SKILL.md: move `<name>.md` to " +
      "`<name>/SKILL.md` (git mv keeps its history). Flat files are valid only " +
      "under .claude/commands/ (#1992).\n",
  );
  process.exit(1);
}

console.log(
  `check-skills-layout: OK - all ${entries.length} entries in ${ROOT} are folders with SKILL.md.`,
);
