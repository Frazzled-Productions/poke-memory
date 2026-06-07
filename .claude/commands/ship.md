---
description: Take ONE linear change from issue to a correctly-formed qa PR - issue-first, branch off qa, implement, run the pre-PR gate, open a Closes-#N PR into qa, dispatch code-reviewer, enable auto-merge.
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, Agent, EnterWorktree, mcp__supabase__apply_migration]
---

# Ship

The single-change projection of [`/batch-issues`](batch-issues.md). Same discipline (issue-first, the pre-PR gate, the in-session `code-reviewer` pass, branch-off-`qa`, `Closes #N`), at the scale of ONE linear change instead of a batch drain. This file does **not** restate those rules - it points at the batch-issues sections that own them so the two paths never diverge (#1718). Read those sections; only the single-change deltas are spelled out here.

## When to use

User says `/ship`, "ship this one issue", "do #N and open a PR", or any single-change request where the batch machinery (parallel fan-out, conflict batching, PR-queue drain, promotion PR) is overkill. For more than one independent issue, use `/batch-issues` instead.

## The flow

One change, start to finish:

1. **Issue-first.** Identify the issue. If the change has no issue yet, create one (`gh issue create`) so the linkage and the auto workflows have an anchor - never the `auto` label (memory: `feedback_no_auto_label_on_create`). Run the issue-body cross-check: read the body verbatim, enumerate its acceptance criteria, and brief the implementer against them, exactly as batch-issues "Implementation" step 2 requires. If the work falls in an i18n / SRS / Supabase / PokéAPI / privacy domain, do the **specialist pre-consult on the brief** first (batch-issues step 2, "Specialist pre-consult").

2. **Branch off the latest `origin/qa`.** Single changes target `qa`, never `main` directly, same as batch work (see "The qa staging-branch flow" in batch-issues). `git fetch origin && git worktree add /private/tmp/<name> -b <branch> origin/qa`.

3. **Implement.** Dispatch the right specialist coder per AGENTS.md "File ownership" (or implement directly for a trivial doc/workflow tweak). The coder brief is the batch-issues step-2 template verbatim - including the verbatim issue body, the `## Acceptance criteria covered` echo, the multi-site domain-concept audit, the mandatory state + locale coverage rules, and the no-`Co-Authored-By` house rule. Do not fork a shorter brief; reuse the same one.

4. **Run the pre-PR gate.** Run **`npm run pre-pr`** (`scripts/pre-pr.mjs`, #1716) - the one command that runs the full gate in order, fail-fast: lint -> typecheck -> build -> test -> coverage -> diff-coverage. This is the SAME gate batch coders run; `/ship` must not re-derive or shorten it. Two-attempt budget, then stop and report (AGENTS.md "Pre-PR build gate"). For a main-targeting promotion, `DIFF_COVERAGE_BASE=origin/main npm run pre-pr`. Run `scripts/pre-pr-smoke.sh` too if the diff touches a high-surface-area path (the list in batch-issues step 2). Add a `changelog.d/unreleased/<issue>-<slug>.md` fragment unless the change is internal-only.

5. **Open the PR into `qa` with `Closes #N`.** `gh pr create --head <branch> --base qa` (both flags explicit - memory: `feedback_gh_pr_create_head_explicit`). The body carries `Closes #N` and the `## Acceptance criteria covered` echo. Note `Closes #N` does not auto-close on merge into `qa` - the `qa -> main` promotion PR (or `cut-release.yml`, #1715) does - but it keeps the linkage visible and is the safety net `qa-issue-label.yml` mirrors.

6. **Dispatch `code-reviewer`.** Run the `code-reviewer` sub-agent against the cumulative diff `git diff origin/qa...HEAD`, exactly as batch-issues "Implementation" step 3. Surface findings one line each (memory: `feedback_review_summaries`); push blocking fixes to the same branch, file non-blocking ones as issues with the user's existing priority labels. This is the same review gate as the batch path, not a lighter one.

7. **Enable auto-merge.** `gh pr merge <PR> --auto --squash` so the PR merges into `qa` once its required checks (`test` + `e2e`) go green, without a manual babysit. The PR still rides the normal `qa` ruleset - auto-merge only releases the hold once CI passes.

## Guardrails

Inherits every guardrail from [`/batch-issues`](batch-issues.md#guardrails). The single-change-relevant ones:

- **Never** add the `auto` label; the auto pipeline is user-dispatched only.
- **Never** promote issues between priority labels without explicit direction.
- **Ask before mutating shared GitHub state** outside this skill's documented operations.
- **Push with an explicit `git push origin <branch>`** - never a bare `git push` (a worktree off `origin/qa` has its upstream set to `origin/qa`).
- `/ship` lands on `qa`, not `main`. Promotion to `main` is the maintainer-QA'd `qa -> main` PR (`cut-release.yml`), never a `/ship` PR retargeted at `main`.
- **Graceful-exit on halt** - commit in-progress work as `WIP: halted ship on #N` and push; do not `--no-verify` or `--force` past failures.
