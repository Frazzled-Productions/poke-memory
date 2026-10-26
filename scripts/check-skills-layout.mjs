/**
 * Layout check: every tracked entry in `.claude/skills/` must be a folder
 * holding `SKILL.md`, the only layout Claude Code loads as a skill (#1992). A
 * flat `<name>.md` there is silently ignored. Wired into `npm run lint`.
 *
 * Reads `git ls-files`, as check-playwright-pin.mjs does, so an untracked
 * `.DS_Store`, scratch file or empty folder cannot fail lint locally while CI
 * stays green.
 *
 * Run directly: `node scripts/check-skills-layout.mjs` (or
 * `npm run lint:skills-layout`). Node built-ins only.
 */
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findSkillsLayoutProblems } from "./lib/skills-layout.mjs";

const ROOT = ".claude/skills";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let tracked;
try {
  tracked = execFileSync("git", ["ls-files", "-z", ROOT], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\0")
    .filter(Boolean);
} catch (err) {
  const reason = /** @type {Error} */ (err).message.split("\n")[0];
  console.error(
    `check-skills-layout: could not list tracked files with \`git ls-files\` (${reason}). ` +
      "Run this check from inside the git checkout with git on PATH.",
  );
  process.exit(1);
}

const problems = findSkillsLayoutProblems(ROOT, tracked);

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

console.log(`check-skills-layout: OK - every tracked entry in ${ROOT} is a folder with SKILL.md.`);
