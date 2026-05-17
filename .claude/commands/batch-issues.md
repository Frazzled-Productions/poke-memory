---
description: Plan + implement the open issue backlog in conflict-minimizing batches, with an in-session code-reviewer pass per PR, then cut a release.
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, Agent, EnterWorktree, TaskCreate, TaskUpdate, TaskList, mcp__supabase__apply_migration]
---

# Batch Issues

End-to-end workflow for draining the open issue backlog. Surveys open issues (ignoring `priority:later`), groups them into batches that minimize merge-conflict risk, implements them in parallel where safe and serially where not, opens PRs with an in-session `code-reviewer` pass on each, drains the PR queue, then triggers `auto-release.yml`.

## When to use

User says `/batch-issues`, "work through the backlog", "implement all the open issues", or any variant that asks for a batched pass over the issue tracker.

## Pre-flight

1. **List the backlog.** Filter out `priority:later`:

   ```bash
   gh issue list \
     --state open \
     --limit 200 \
     --json number,title,labels,body,url \
     --jq '[.[] | select(.labels | map(.name) | index("priority:later") | not)]'
   ```

   If the result is empty, stop and tell the user there is nothing to do.

2. **Disable Auto Review** so per-PR runs don't burn CI minutes while we batch-implement. This is a deliberate global mutation per the user's standing ask — paired with the re-enable step in Wrap-up and a matching re-enable in the graceful-exit guardrail so a halted run can never leave it disabled.

   ```bash
   gh workflow disable "Auto Review"
   ```

   Note this in the run summary so the user sees what we touched. If the disable fails (already disabled, permissions, etc.), surface the error and stop — do not proceed with a half-applied setup.

3. **Confirm a clean working tree.** If `git status` shows uncommitted changes, surface and stop. Do **not** require being on the `main` branch — under parallel jobs `main` is often checked out by another worktree, leaving this session on a detached HEAD, which is fine. Every implementation agent branches off `origin/main` in its own worktree regardless.

4. **Triage the backlog.** Not every open issue produces a PR. Classify each issue from step 1 into one of:

   - **Code** — a concrete, implementable change. Goes into the implementation batches.
   - **Analysis** — a read-only audit or umbrella issue whose deliverable is a report plus scoped follow-up issues, not a PR.
   - **Exploration** — a design or research issue that ends in a decision, not code.
   - **Decision** — a product or design question that needs a user choice before any code can be written.
   - **Blocked** — gated on an external precondition (e.g. a beta dependency reaching GA). Skip it, and say so in the summary with the reason.

   Carry this classification into Planning — each class is handled differently.

## Planning

### Decisions first

Before planning any code, collect everything that needs a user choice and ask it in **one** round:

- Every **Decision**-class issue from triage.
- The handling of **Analysis** and **Exploration** issues — run them this session, or defer?
- Any `[USER-DECISION]` item per AGENTS.md "Stack decisions" you can already foresee from the issue bodies.

Put all of these into a single `AskUserQuestion` call. Do not discover questions mid-run — a question surfaced after implementation has started forces an avoidable pause.

### Code batches

Read each **Code**-class issue's body and identify the primary file areas it touches (`app/`, `lib/`, `db/`, `components/`, `.github/`, docs, etc.). Group issues into batches with these rules:

- **Same batch is OK** when issues touch disjoint file trees (`app/pokedex/**` vs `app/stats/**`, or a workflow tweak vs. a UI change). These can run in parallel.
- **Different batches** when issues are likely to conflict — same file, same module, same migration sequence number, or one depends on the other.
- **Migrations are serial.** Any two issues that add a `db/migrations/*.sql` file must be in different batches and ordered, so the migration filenames don't collide and so the second can be authored against the post-merge state.
- **Trivial edits (typos, doc fixes, single-line tweaks)** can pile into a single batch regardless of location.
- **Combine tightly-coupled issues** into one PR and one agent when one issue's resolution *is* part of another's (e.g. a bug fix whose correct form depends on a design decision in a sibling issue). A single PR may carry `closes #A` and `closes #B`. Prefer this over two PRs that fight over the same files.

### Analysis and Exploration issues

These are read-only — they produce a report and scoped follow-up issues, never a PR. Dispatch them as **background agents** (`run_in_background: true`) at the start of the run so they proceed concurrently with the code batches. Each such agent's prompt: do the analysis, post the report as a comment on the umbrella issue, file scoped follow-up issues (`priority:later` by default, never `auto`, never `priority:now`), and do **not** close the umbrella. Surface any `[USER-DECISION]` an exploration produces in the wrap-up.

Present the plan to the user as a short bullet list — issue numbers per batch and per class — and proceed. The user has given standing autonomy for the implement → review → PR → merge loop in batch sessions.

## Implementation (per batch)

For each batch, in order:

1. **Spawn one Agent per issue in the batch, in parallel** (single message, multiple `Agent` tool calls). Use the appropriate specialist subagent type per AGENTS.md "File ownership". Each agent works in an isolated worktree (`EnterWorktree`) so parallel branches don't collide.

2. **Each agent's prompt must include:**
   - The issue number and full body.
   - "Rebase your worktree onto the latest `origin/main` before opening the PR." House rule; no exceptions. (memory: `feedback_rebase_before_pr`.)
   - "Reference the issue in commit messages (`closes #N`)."
   - "If your change adds a Supabase migration, call `mcp__supabase__apply_migration` with the stripped name (no `0NN_` prefix) **before** opening the PR — the `migration-check.yml` required check fails until file-vs-applied parity holds." (See AGENTS.md "Adding a feature that needs to persist data".)
   - "Add a `changelog.d/unreleased/<issue-number>-<slug>.md` fragment unless the change is internal-only (agent roster, workflow tweaks not visible to users)."
   - "Run `npm run typecheck && npm run build && npm test` before opening the PR; if anything fails, fix and retry up to twice, then stop and report." (AGENTS.md "Pre-PR build gate".)
   - "If your change alters user-facing copy, ARIA labels, `alt`/`title`/`placeholder` text, or a user flow, grep `e2e/` for assertions that reference it and update those specs too — not just the unit tests. A copy change that leaves a stale `e2e/` assertion fails CI on both browser projects."
   - "Before opening the PR, run the `code-reviewer` sub-agent on your own diff inside your worktree and fold in any blocking fixes. This puts reviewed code in front of CI on the first run, instead of paying an extra rebase + CI cycle for each post-review fix."
   - "Use `npm ci`, not `npm install`, so `package-lock.json` does not drift. Leave the worktree clean — commit only intended files, and remove any stray output files before opening the PR."
   - "Open the PR via `gh pr create --head <your-branch>` — pass `--head` explicitly so we never inherit the wrong branch." (memory: `feedback_gh_pr_create_head_explicit` — burned us on docs PR #544.)
   - "Do **not** add a `Co-Authored-By` trailer to any commit." House rule; commits go under the user's name only. (memory: `feedback_commits`.)

3. **In-session `code-reviewer` pass per PR.** After each agent's PR is open, run the `code-reviewer` sub-agent against that branch's diff in this session (not a CI run) as a confirmation gate — the agent should already have self-reviewed per step 2, so this pass mostly verifies. Surface findings as a one-line description each — never just counts. (memory: `feedback_review_summaries`.) If a finding is blocking, dispatch a follow-up Agent to fix; non-blocking findings get filed as new issues with the user's existing priority labels, never `priority:now` without direction.

## PR queue drain

Once a batch's PRs are all open and reviewed in-session:

1. **Use the merge queue.** `main` has a GitHub merge queue (set up in #797). For each reviewed PR whose own required checks are green, run `gh pr merge <PR> --squash --auto`. The queue rebases each entry onto the latest `main`, runs the required checks (`test`, `e2e`, `Check version bump approval`) against the speculative merge, and merges entries in order when green — testing several in parallel. Queue **all** of a batch's ready PRs, then wait for the queue to drain. You do **not** `update-branch` or rebase PRs by hand — handing the rebase to the queue is the whole point.
   - `gh pr checks <PR>` first — a PR's own checks must be green before `--auto` admits it to the queue.
   - If `Migration drift check` fails, the agent forgot to apply the migration via MCP — apply it now so the check re-runs.
   - If a PR is **ejected** from the queue (its speculative merge failed CI), that is a real failure against the combined state — investigate, push a fix, and re-queue. Do not blindly re-queue.

2. **Do not pre-emptively rebase.** The merge queue does the rebasing. Manual rebases — or `@dependabot rebase` fan-out — burn CI because each merge re-invalidates queued runs. (memory: `feedback_pr_queue_serial`.) Queue and wait; do not touch the branches.

3. **Detached-HEAD noise.** When the session runs from a detached HEAD (the parallel-jobs case), `gh pr merge` prints a harmless `could not determine current branch` notice *after* a successful `--auto` enqueue. Confirm the PR was queued / merged with `gh pr view <PR> --json state` rather than trusting the command's exit code.

4. **Fallback — no merge queue.** If the merge queue is ever disabled, fall back to a strictly serial loop: wait for the head PR's checks, `gh pr merge <PR> --squash --delete-branch`, refresh `origin/main`, then rebase **only the next single PR** onto fresh `main` with `--force-with-lease` — never the whole queue at once. Under strict-up-to-date branch protection this pays a full rebase + CI re-run per PR; that serial cost is exactly what the merge queue exists to remove.

## Wrap-up

After every batch is merged and the queue is drained:

1. **Re-enable Auto Review:**

   ```bash
   gh workflow enable "Auto Review"
   ```

2. **Trigger Auto Release** to cut a SemVer release from the accumulated `changelog.d/unreleased/*.md` fragments:

   ```bash
   gh workflow run "Auto Release"
   ```

   Watch the run to first-completion:

   ```bash
   gh run watch $(gh run list --workflow="Auto Release" --limit 1 --json databaseId --jq '.[0].databaseId')
   ```

   If `Auto Release` no-ops because no fragments were produced (e.g. the whole batch was internal-only), surface that and skip the watch.

3. **Summary to the user.** One block:
   - Issues closed (numbers).
   - PRs merged (numbers).
   - Release tag cut (or "no release — internal-only batch").
   - **Analysis/Exploration** issues run — which umbrella issues got a report comment, and how many follow-up issues each filed (the umbrellas stay open for the user to review and close).
   - Any `[USER-DECISION]` items still awaiting a choice.
   - **Blocked** issues skipped, with the reason.

## Guardrails

- **Never** add the `auto` label to issues we are implementing — the auto pipeline is user-dispatched only. (memory: `feedback_no_auto_label_on_create`.)
- **Never** promote issues between priority labels without explicit user direction — the user owns priorities. (See AGENTS.md "Backlog / process".)
- **Ask before mutating shared GitHub state** outside this skill's documented operations: title/label changes on existing issues, branch ops on someone else's PR, etc. (memory: `feedback_ask_before_mutating_github`.)
- **Don't rationalize** sub-agent decisions if the user pushes back mid-run; evaluate honestly. (memory: `feedback_dont_rationalize_downstream`.)
- **Graceful-exit re-enables Auto Review.** If the run halts for any reason — CI failures, user interruption, an unfixable conflict — before reaching Wrap-up, the exit path must:
  1. Run `gh workflow enable "Auto Review"` so the pre-flight disable is reversed. This is unconditional — even if the disable step itself failed, run the enable defensively.
  2. Commit any in-progress work as `WIP: halted run on #N` and push, per AGENTS.md "Graceful exit on halt".
  3. Do not skip hooks (`--no-verify`) or `--force` past failures.
