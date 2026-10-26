/**
 * Pure helper for the `.claude/skills/` layout check (#1992).
 *
 * Claude Code discovers a project skill only as a folder holding `SKILL.md`
 * (`.claude/skills/<name>/SKILL.md`). A flat `<name>.md` is valid under
 * `.claude/commands/` but is silently ignored under `.claude/skills/`, which is
 * how `/investigate-ci-failure` went unloaded from May to October 2026.
 * scripts/check-skills-layout.mjs feeds this helper the git-tracked paths so
 * the mistake fails `npm run lint` with the path named.
 *
 * Imports nothing, so it runs under plain `node` and in the vitest node project.
 */

/**
 * Returns every entry under the skills folder that Claude Code would not load:
 * a top-level file (as `<root>/<name>`), or a folder with no SKILL.md directly
 * inside it (as `<root>/<name>/`). Sorted.
 *
 * @param {string} root repo-relative skills folder, e.g. ".claude/skills"
 * @param {string[]} trackedPaths repo-relative file paths, as `git ls-files` prints them
 * @returns {string[]}
 */
export function findSkillsLayoutProblems(root, trackedPaths) {
  const prefix = `${root}/`;
  const files = new Set();
  /** @type {Map<string, boolean>} folder name to "holds SKILL.md" */
  const folders = new Map();
  for (const path of trackedPaths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      files.add(`${prefix}${rest}`);
      continue;
    }
    const name = rest.slice(0, slash);
    folders.set(name, folders.get(name) || rest.slice(slash + 1) === "SKILL.md");
  }
  const badFolders = [...folders].filter(([, ok]) => !ok).map(([name]) => `${prefix}${name}/`);
  return [...files, ...badFolders].sort();
}
