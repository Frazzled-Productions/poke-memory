## 1. Layout check (failing first)

- [ ] 1.1 `scripts/lib/skills-layout.test.mjs`: fed today's `.claude/skills/` entries, the helper reports `.claude/skills/investigate-ci-failure.md`; fed a folder with only `README.md`, it reports that folder; fed only folders with `SKILL.md`, it reports nothing. Verify: run red first against a stub helper that returns nothing (`npx vitest run scripts/lib/skills-layout.test.mjs`, the flat-file and missing-`SKILL.md` cases fail), then green.
- [ ] 1.2 `scripts/lib/skills-layout.mjs` (pure helper) and `scripts/check-skills-layout.mjs` (reads the folder, prints each offending path, exits 1). Verify: `node scripts/check-skills-layout.mjs` exits 1 naming `.claude/skills/investigate-ci-failure.md` before task 2.1, and exits 0 after it.
- [ ] 1.3 `package.json`: add `lint:skills-layout` and append it to the `lint` chain. Verify: `npm run lint` exits 0 after task 2.1.
- [ ] 1.4 `ci.yml`: one `npm run lint:skills-layout` step in the always-run `em-dash` job (only if Fraser keeps that open call's recommendation), reviewed by `workflow-expert`. Verify: the job runs and passes on the build PR, and a scratch commit with a flat file in `.claude/skills/` turns it red (shown in the PR, then dropped).

## 2. Move the skill

- [ ] 2.1 `git mv .claude/skills/investigate-ci-failure.md .claude/skills/investigate-ci-failure/SKILL.md`. Verify: `git diff -M --stat origin/qa` shows a 100% rename; `node scripts/check-playwright-pin.mjs` exits 0.
- [ ] 2.2 `.claude/commands/batch-issues.md:224`: name `/investigate-ci-failure` instead of the file path. Verify: `git grep -n "skills/investigate-ci-failure.md"` prints nothing.

## 3. Gates

- [ ] 3.1 Discovery check, once by hand (one subscription model call, not in CI): from the build worktree, `claude -p "/investigate-ci-failure" --max-turns 1 --tools "" --output-format stream-json --verbose`, and the transcript shows "Base directory for this skill: .../investigate-ci-failure", while the init message's `slash_commands` still lists `batch-issues`, `ship`, `opsx:propose` and `openspec-propose` (the two baseline requirements). Verify: session id and the quoted lines in the PR body.
- [ ] 3.2 `npm run lint` and `npx vitest run scripts/lib/skills-layout.test.mjs` exit 0, with the test count in the PR body.
- [ ] 3.3 `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` exits 0, then `/opsx:verify fix-investigate-ci-failure-skill` before the final review.

## 4. After merge

- [ ] 4.1 Exercise the skill on the next real non-converging CI failure (the issue's ask). Verify: move to its own issue before the build PR merges and tick as "~~...~~ Moved to #N (date)".
