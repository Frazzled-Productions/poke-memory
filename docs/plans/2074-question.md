# Question: #2074, how to land the half of the fix that touches `.github/workflows/`

## Where this stands

The implementer lane landed the **enforcement half** of the plan (`docs/plans/2074-plan.md`, in PR #2080) and stopped before the **bump half**. The reason is a permission boundary, not a design problem:

- **Every edit under `.github/workflows/` was refused.** The lane's profile denies that directory, and AGENTS.md requires a `workflow-expert` review on every workflow change anyway. So the six `container.image` tags could not move.
- **The image could not be checked.** Docker, `curl` to `mcr.microsoft.com` and WebFetch were all refused. So nobody has yet confirmed that `mcr.microsoft.com/playwright:v1.62.1-noble` is published, or that it ships Node 24 (plan risks 1 and 2). `npm view` did confirm that `@playwright/test` 1.62.1 is on npm.

Moving the package to 1.62.1 without the tags would recreate the exact half-done state the issue describes, and the new check would fail `npm test`. So **the package stays at 1.60.0 in this commit**. The tree is consistent: lockfile and every tag agree on 1.60.0.

### What this commit contains

- `scripts/lib/playwright-version.mjs` (pure helpers) and its tests.
- `scripts/check-playwright-version-drift.mjs` (CLI; takes an optional repo-root argument) and `scripts/check-playwright-version-drift.test.mjs`.
  - The test runs the check against the checkout, so a PR already fails on drift **today**, with no new workflow. Where the failure appears:
    - **`Test coverage report` (required):** `coverage.yml` runs the whole suite (`vitest run --coverage`) on every non-fork PR, so this fires on any drift.
    - **`test` (required):** this job runs `npm test -- --changed origin/<base>`. Vitest reruns everything when `package.json` changes, as it does in a Dependabot bump like #2035. A PR that changes only `package-lock.json` or only a workflow does not select the test here. This was checked against vitest 4.1.11's `forceRerunTriggers` with picomatch on CI-style paths.
    - **Locally:** `npm run pre-pr` and a plain `npm test` run it.
  - The catch: the failure shows up under a coverage or test check, which is an odd place to look for a version mismatch. The dedicated workflow (step 6 below) gives it its own check name. That is its value; it is not the only line of defence.
  - The test also spawns the CLI against fixture repos to prove each failure path and the fix-it message.
- Version numbers removed from prose: `WORKFLOW.md` (the `visual-regression.yml` and `visual-baseline-update.yml` entries, and the perf-budget section) and `docs/testing.md`. The runnable `docker run` at `WORKFLOW.md:281` keeps its literal, so the check still scans it.
- The stale `[skip ci]` wording fixed in the `visual-baseline-update.yml` catalogue entry (#1145 removed that marker).
- Comments in `.github/dependabot.yml` and `scripts/check-node-version-drift.mjs` that point at the new check.

### Evidence that the check catches the real failure

With the package bumped to 1.62.1 and the tags left alone, the fitness test failed and listed exactly these 16 sites. Every tag named in the issue is there, plus the version-bearing comments:

```
.github/workflows/ci.yml:138, :235
.github/workflows/e2e.yml:36
.github/workflows/perf-budget.yml:79
.github/workflows/visual-baseline-update.yml:12, :130, :150, :168
.github/workflows/visual-regression.yml:113
scripts/pre-pr-smoke.sh:45
WORKFLOW.md:278, :281, :292, :905
docs/testing.md:66
.claude/skills/investigate-ci-failure.md:42
```

Each line read, for example: `.github/workflows/ci.yml:138 uses mcr.microsoft.com/playwright:v1.60.0-noble (Playwright 1.60.0 instead of 1.62.1); expected mcr.microsoft.com/playwright:v1.62.1-noble`. It was followed by the three fix-it steps (confirm the image and its Node major, move every listed tag, dispatch `visual-baseline-update.yml` if baselines shift). After the bump was reverted, all 34 tests passed.

## The question

**How should the remaining half land: the 1.62.1 bump, the tag moves and the standalone `playwright-version-drift.yml`?**

### Option A: someone adds a follow-up commit on this PR's branch

A person does the checklist below on this branch, gets the `workflow-expert` review, and the PR then closes #2074 and replaces #2035, as the plan intended.

- For: one PR, and the bump arrives together with its guard.
- Against: someone has to push onto a loop-created branch. This PR also can't merge until the Docker checks are done, so the enforcement half waits on them.

### Option B: merge this PR as the enforcement half, then bump in a second PR (recommended)

This PR says `Refs #2074`, not `Closes`. A small follow-up PR, off `qa`, does the checklist below and closes #2074. It replaces #2035, which then closes itself or is closed with your OK.

- For: each PR is green and self-contained.
- For: the guard is on `qa` before the bump, so the bump PR shows the check working from red to green.
- For: the workflow and Docker work sits in one small PR, where the `workflow-expert` review is quick.
- Against: two PRs instead of one.
- Against: once #2035 rebases, it gains red `test` and `Test coverage report` checks, each carrying the named list. It is already red on `e2e`, so it is no less mergeable than it is now.

### Option C: give the implementer lane write access to `.github/workflows/`

- For: the loop could finish issues like this unattended.
- Against: unattended YAML edits are exactly what AGENTS.md's mandatory `workflow-expert` review exists to catch (#1859, #1815, #1806). The lane also still could not verify the image. **Not recommended.**

**Recommendation: B.** It gets the guard onto `qa` now at no risk, and it leaves the part that needs Docker access and a workflow review to a person.

### Also still open from the plan: pinning versus deriving the tag (plan Q1)

This commit implements the plan's recommendation, **pinned tags plus a drift check**.

If you choose to **derive the tag at run time** instead, the helper would change from "every tag equals the locked version" to "no literal tag in a workflow". The prose edits and the lockfile helper stay useful either way.

## Checklist for the remaining half (options A or B)

1. **Branch.** Branch off a fresh `origin/qa` (for B), or check out this branch (for A).
2. **Verify the image.**
   - `docker pull mcr.microsoft.com/playwright:v1.62.1-noble` must succeed.
   - `docker run --rm mcr.microsoft.com/playwright:v1.62.1-noble node --version` must print `v24.x`. If it doesn't, stop: that is a Node-policy call.
3. **Bump the package.** Run `npm install -D @playwright/test@1.62.1` under Node 24.
   - The lockfile diff should move only `@playwright/test`, `playwright` and `playwright-core` to 1.62.1, whose `engines.node` changes to `>=20`.
   - That is what this lane saw in a trial run before reverting it.
4. **Move each literal to `v1.62.1-noble`.**
   - `.github/workflows/ci.yml:138` and `:235`
   - `.github/workflows/e2e.yml:36`
   - `.github/workflows/perf-budget.yml:79`
   - `.github/workflows/visual-regression.yml:113`
   - `.github/workflows/visual-baseline-update.yml:150`
   - `scripts/pre-pr-smoke.sh:45`
   - `.claude/skills/investigate-ci-failure.md:42`
   - `WORKFLOW.md:281`
5. **Remove the version from the workflow comments** so it can't drift again:
   - `visual-baseline-update.yml:12`, `:130` and `:168`: say "the pinned Playwright image".
   - Delete "(currently 1.60.0)" at `visual-baseline-update.yml:146-147` and `visual-regression.yml:108-109`.
6. **Add `.github/workflows/playwright-version-drift.yml`** (text below).
7. **Update the docs and tests for the new workflow.**
   - Add the `WORKFLOW.md` catalogue entry (text below) after the `migration-check.yml` entry.
   - Extend the `WORKFLOW.md:278` sentence to name the workflow.
   - Add the paths-filter parity test (text below) to `scripts/check-playwright-version-drift.test.mjs`.
   - Update the `SCANNED_FILES` comment in the CLI so it names the workflow.
8. **Get the `workflow-expert` review** of the workflow edits.
9. **Run the checks.**
   - `npm test -- --project node scripts/check-playwright-version-drift.test.mjs` (the full `--project node` run before pushing).
   - `npm run pre-pr`.
   - `./scripts/pre-pr-smoke.sh`.
10. **On the PR:**
    - Confirm `test`, `e2e` (both legs plus `e2e-real-auth`), the three Perf budget checks, Visual Regression and the new drift check are all green.
    - If Visual Regression fails on rendering-only differences, dispatch `visual-baseline-update.yml` on the branch. Inspect the diff images before accepting them.

### `.github/workflows/playwright-version-drift.yml`

```yaml
name: Playwright version drift check

# Asserts that every pinned mcr.microsoft.com/playwright image tag matches the
# @playwright/test version locked in package-lock.json (#2074). Dependabot
# bumps the package but not the container.image lines, so a half-done bump
# otherwise fails every browser job with "Executable doesn't exist". This
# check names every file:line to fix instead. Mirrors node-version-drift.yml.
#
# scripts/check-playwright-version-drift.mjs imports only Node built-ins, so
# there is no `npm ci` step. Not a required check: it is path-filtered, and the
# required `Test coverage report` check already runs the same check through
# scripts/check-playwright-version-drift.test.mjs in its full vitest run. This
# workflow exists to give the failure its own, obvious name.

on:
  pull_request:
    paths:
      - "package.json"
      - "package-lock.json"
      - ".github/workflows/**"
      - "scripts/pre-pr-smoke.sh"
      - "WORKFLOW.md"
      - "docs/testing.md"
      - ".claude/skills/investigate-ci-failure.md"
      - "scripts/check-playwright-version-drift.mjs"
      - "scripts/lib/playwright-version.mjs"

concurrency:
  group: playwright-version-drift-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
      - name: Assert Playwright image tags match package-lock.json
        run: node scripts/check-playwright-version-drift.mjs
```

### `WORKFLOW.md` catalogue entry

```markdown
### `playwright-version-drift.yml` - Playwright version drift check

| | |
|---|---|
| **Trigger** | `pull_request` touching `package.json`, `package-lock.json`, `.github/workflows/**`, the check script or its helper, or a file on its scan list (`scripts/pre-pr-smoke.sh`, `WORKFLOW.md`, `docs/testing.md`, `.claude/skills/investigate-ci-failure.md`) |
| **Job** | `check` |
| **What it does** | Runs `scripts/check-playwright-version-drift.mjs`. It reads the `@playwright/test` version from `package-lock.json` (requiring `playwright` and `playwright-core` to agree), then fails if any `mcr.microsoft.com/playwright:<tag>` in a workflow or scanned file is not exactly `v<locked>-noble`, or if no workflow references the image at all. The error lists every `file:line` and the steps to fix a half-done Dependabot bump (#2074). Plain `node`, no `npm ci`. |
| **Required check** | No - path-filtered, so it cannot be required. The required `Test coverage report` check (a full vitest run) runs the same check via `scripts/check-playwright-version-drift.test.mjs`, as does `test` whenever `package.json` changes. This workflow gives the failure its own name. |
| **Concurrency** | Cancels concurrent runs on the same ref. |
```

### Parity test for `scripts/check-playwright-version-drift.test.mjs`

```js
  it("keeps the workflow paths filter in step with the scan list", () => {
    const workflow = readFileSync(
      join(REPO_ROOT, ".github/workflows/playwright-version-drift.yml"),
      "utf8",
    );
    for (const path of [
      ...SCANNED_FILES,
      "package.json",
      "package-lock.json",
      ".github/workflows/**",
      "scripts/check-playwright-version-drift.mjs",
      "scripts/lib/playwright-version.mjs",
    ]) {
      expect(workflow).toContain(`- "${path}"`);
    }
  });
```
