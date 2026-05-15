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

3. **Confirm clean working tree** on `main`. If there are uncommitted changes or we are not on `main`, surface and stop.

## Planning

Read each non-trivial issue's body. For each, identify the primary file areas it will touch (`app/`, `lib/`, `db/`, `components/`, `.github/`, docs, etc.). Group issues into batches with these rules:

- **Same batch is OK** when issues touch disjoint file trees (`app/pokedex/**` vs `app/stats/**`, or a workflow tweak vs. a UI change). These can run in parallel.
- **Different batches** when issues are likely to conflict — same file, same module, same migration sequence number, or one depends on the other.
- **Migrations are serial.** Any two issues that add a `db/migrations/*.sql` file must be in different batches and ordered, so the migration filenames don't collide and so the second can be authored against the post-merge state.
- **Trivial edits (typos, doc fixes, single-line tweaks)** can pile into a single batch regardless of location.

Present the batch plan to the user as a short bullet list — issue numbers per batch, file-area justification — and proceed. The user has given standing autonomy for the implement → review → PR → merge loop in batch sessions; only pause for `[USER-DECISION]` items per AGENTS.md "Stack decisions".

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
   - "Open the PR via `gh pr create --head <your-branch>` — pass `--head` explicitly so we never inherit the wrong branch." (memory: `feedback_gh_pr_create_head_explicit` — burned us on docs PR #544.)
   - "Do **not** add a `Co-Authored-By` trailer to any commit." House rule; commits go under the user's name only. (memory: `feedback_commits`.)

3. **In-session `code-reviewer` pass per PR.** After each agent's PR is open, run the `code-reviewer` sub-agent against that branch's diff in this session (not a CI run). Surface findings as a one-line description each — never just counts. (memory: `feedback_review_summaries`.) If a finding is blocking, dispatch a follow-up Agent to fix; non-blocking findings get filed as new issues with the user's existing priority labels, never `priority:now` without direction.

## PR queue drain

Once a batch's PRs are all open and reviewed in-session:

1. **Serial, not parallel.** Pre-emptive parallel rebases — manual or via `@dependabot rebase` fan-out — burn CI because each merge re-invalidates every queued run. (memory: `feedback_pr_queue_serial`.) The loop is:
   - Pick the next PR in the batch (the **head** of the queue).
   - `gh pr checks <PR>` — wait for required checks green.
   - If `Migration drift check` fails, the agent forgot to apply the migration via MCP — apply it now and the check re-runs.
   - `gh pr merge <PR> --squash --delete-branch`.
   - Refresh `origin/main`. Rebase **only the next single PR** in the queue onto the fresh `main` with `--force-with-lease`. Do **not** rebase the rest yet — they wait their turn.
   - Loop until the queue is empty.

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
   - Anything filed as a follow-up issue.

## Guardrails

- **Never** add the `auto` label to issues we are implementing — the auto pipeline is user-dispatched only. (memory: `feedback_no_auto_label_on_create`.)
- **Never** promote issues between priority labels without explicit user direction — the user owns priorities. (See AGENTS.md "Backlog / process".)
- **Ask before mutating shared GitHub state** outside this skill's documented operations: title/label changes on existing issues, branch ops on someone else's PR, etc. (memory: `feedback_ask_before_mutating_github`.)
- **Don't rationalize** sub-agent decisions if the user pushes back mid-run; evaluate honestly. (memory: `feedback_dont_rationalize_downstream`.)
- **Graceful-exit re-enables Auto Review.** If the run halts for any reason — CI failures, user interruption, an unfixable conflict — before reaching Wrap-up, the exit path must:
  1. Run `gh workflow enable "Auto Review"` so the pre-flight disable is reversed. This is unconditional — even if the disable step itself failed, run the enable defensively.
  2. Commit any in-progress work as `WIP: halted run on #N` and push, per AGENTS.md "Graceful exit on halt".
  3. Do not skip hooks (`--no-verify`) or `--force` past failures.
