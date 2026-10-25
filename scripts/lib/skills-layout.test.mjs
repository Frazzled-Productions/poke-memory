import { describe, it, expect } from "vitest";
import { findSkillsLayoutProblems } from "./skills-layout.mjs";

const ROOT = ".claude/skills";
const skill = (name) => ({ name, isDirectory: true, children: ["SKILL.md"] });

describe("findSkillsLayoutProblems", () => {
  it("reports the flat investigate-ci-failure.md that is on qa today (#1992)", () => {
    const entries = [
      { name: "investigate-ci-failure.md", isDirectory: false },
      skill("openspec-apply-change"),
      skill("openspec-propose"),
    ];
    expect(findSkillsLayoutProblems(ROOT, entries)).toEqual([
      ".claude/skills/investigate-ci-failure.md",
    ]);
  });

  it("reports a folder that has no SKILL.md", () => {
    const entries = [
      { name: "half-done", isDirectory: true, children: ["README.md"] },
      skill("openspec-propose"),
    ];
    expect(findSkillsLayoutProblems(ROOT, entries)).toEqual([
      ".claude/skills/half-done",
    ]);
  });

  it("reports nothing when every entry is a folder holding SKILL.md", () => {
    const entries = [
      skill("investigate-ci-failure"),
      skill("openspec-propose"),
    ];
    expect(findSkillsLayoutProblems(ROOT, entries)).toEqual([]);
  });
});
