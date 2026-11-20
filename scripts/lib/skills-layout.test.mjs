import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findSkillsLayoutProblems } from "./skills-layout.mjs";

const ROOT = ".claude/skills";
const skill = (name) => `${ROOT}/${name}/SKILL.md`;
const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("findSkillsLayoutProblems", () => {
  it("reports the flat investigate-ci-failure.md that is on qa today (#1992)", () => {
    const tracked = [
      `${ROOT}/investigate-ci-failure.md`,
      skill("openspec-apply-change"),
      skill("openspec-propose"),
    ];
    expect(findSkillsLayoutProblems(ROOT, tracked)).toEqual([
      ".claude/skills/investigate-ci-failure.md",
    ]);
  });

  it("reports a folder that has no SKILL.md", () => {
    const tracked = [`${ROOT}/new-skill/README.md`, skill("openspec-propose")];
    expect(findSkillsLayoutProblems(ROOT, tracked)).toEqual([".claude/skills/new-skill/"]);
  });

  it("reports nothing when every entry is a folder holding SKILL.md", () => {
    const tracked = [
      skill("investigate-ci-failure"),
      `${ROOT}/openspec-propose/README.md`,
      skill("openspec-propose"),
      "AGENTS.md",
    ];
    expect(findSkillsLayoutProblems(ROOT, tracked)).toEqual([]);
  });
});

describe("check-skills-layout.mjs", () => {
  /** Scratch git repo holding a copy of the check and only correct tracked skills. */
  function scratchRepo() {
    const dir = mkdtempSync(join(tmpdir(), "skills-layout-"));
    cpSync(join(scriptsDir, "check-skills-layout.mjs"), join(dir, "scripts/check-skills-layout.mjs"));
    cpSync(join(scriptsDir, "lib/skills-layout.mjs"), join(dir, "scripts/lib/skills-layout.mjs"));
    mkdirSync(join(dir, ROOT, "good"), { recursive: true });
    writeFileSync(join(dir, ROOT, "good/SKILL.md"), "---\nname: good\n---\n");
    const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    return { dir, git };
  }
  const runCheck = (dir) =>
    spawnSync("node", ["scripts/check-skills-layout.mjs"], { cwd: dir, encoding: "utf8" });

  it("ignores untracked files and folders under .claude/skills", () => {
    const { dir } = scratchRepo();
    try {
      writeFileSync(join(dir, ROOT, ".DS_Store"), "");
      writeFileSync(join(dir, ROOT, "scratch.md"), "untracked\n");
      mkdirSync(join(dir, ROOT, "wip"));
      writeFileSync(join(dir, ROOT, "wip/notes.txt"), "untracked\n");
      const result = runCheck(dir);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails naming a tracked flat skill file", () => {
    const { dir, git } = scratchRepo();
    try {
      writeFileSync(join(dir, ROOT, "flat.md"), "---\nname: flat\n---\n");
      git("add", ".");
      const result = runCheck(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(".claude/skills/flat.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
