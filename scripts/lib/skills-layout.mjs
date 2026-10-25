/**
 * Pure helper for the `.claude/skills/` layout check (#1992).
 *
 * Claude Code discovers a project skill only as a folder holding `SKILL.md`
 * (`.claude/skills/<name>/SKILL.md`). A flat `<name>.md` is valid under
 * `.claude/commands/` but is silently ignored under `.claude/skills/`, which is
 * how `/investigate-ci-failure` went unloaded from May to October 2026.
 * scripts/check-skills-layout.mjs feeds this helper so the mistake fails
 * `npm run lint` with the path named.
 *
 * Imports nothing, so it runs under plain `node` and in the vitest node project.
 */

/**
 * Returns the repo-relative path of every entry in the skills folder that
 * Claude Code would not load: a top-level file, or a folder with no SKILL.md.
 *
 * @param {string} root repo-relative skills folder, e.g. ".claude/skills"
 * @param {{ name: string, isDirectory: boolean, children?: string[] }[]} entries
 *   the folder's top-level entries; `children` lists a folder's file names
 * @returns {string[]}
 */
export function findSkillsLayoutProblems(root, entries) {
  return entries
    .filter((e) => !e.isDirectory || !(e.children ?? []).includes("SKILL.md"))
    .map((e) => `${root}/${e.name}`);
}
