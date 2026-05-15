---
description: Plan + implement the open issue backlog in conflict-minimizing batches, with local code review per PR, then cut a release.
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, Agent, TaskCreate, TaskUpdate, TaskList]
---

# Batch Issues

End-to-end workflow for draining the open issue backlog. Surveys open issues (ignoring `priority:later`), groups them into batches that minimize merge-conflict risk, implements them in parallel where safe and serially where not, opens PRs with local `code-reviewer` review on each, drains the PR queue, then triggers `auto-release.yml`.

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

2. **Disable Auto Review** so per-PR runs don't burn CI minutes while we batch-implement. Record the prior state so we can restore it.

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
   - "Rebase your worktree onto the latest `origin/main` before opening the PR" — non-negotiable per the user's feedback memory.
   - "Reference the issue in commit messages (`closes #N`)".
   - "If your change adds a Supabase migration, call `mcp__supabase__apply_migration` with the stripped name (no `0NN_` prefix) **before** opening the PR — the `migration-check.yml` required check fails until file-vs-applied parity holds."
   - "Add a `changelog.d/unreleased/<issue-number>-<slug>.md` fragment unless the change is internal-only (agent roster, workflow tweaks not visible to users)."
   - "Run `npm run typecheck && npm run build && npm test` before opening the PR; if anything fails, fix and retry up to twice, then stop and report."
   - "Open the PR via `gh pr create --head <your-branch>` — pass `--head` explicitly so we never inherit the wrong branch."
   - "Do **not** add a Co-Authored-By trailer."

3. **Local code review per change.** After each agent's PR is open, run the `code-reviewer` sub-agent against that branch's diff. Surface findings as a one-line description each (per the user's "Surface review findings substance" memory), not just counts. If a finding is blocking, dispatch a follow-up Agent to fix; non-blocking findings get filed as new issues with the user's existing priority labels.

## PR queue drain

Once a batch's PRs are all open and locally reviewed:

1. **Serial, not parallel** (per the user's "Drain a PR queue serially" memory). For each PR in the batch:
   - `gh pr checks <PR>` — wait for required checks green.
   - If `Migration drift check` fails, the agent forgot to apply the migration via MCP — apply it now and the check re-runs.
   - `gh pr merge <PR> --squash --delete-branch`.
   - Refresh `origin/main`. Rebase the next PR's branch onto the new `main` with `--force-with-lease` before touching the one after.

2. **Do not** issue `@dependabot rebase` fan-out or pre-emptive parallel rebases — that wastes CI on invalidated runs.

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

- **Never** add the `auto` label to issues we are implementing — the auto pipeline is user-dispatched only (memory: `feedback_no_auto_label_on_create`).
- **Never** promote issues between priority labels without explicit user direction (memory: backlog/process — the user owns priorities).
- **Ask before mutating shared GitHub state** outside this skill's documented operations: title/label changes on existing issues, branch ops on someone else's PR, etc. (memory: `feedback_ask_before_mutating_github`).
- **Don't rationalize** sub-agent decisions if the user pushes back mid-run; evaluate honestly (memory: `feedback_dont_rationalize_downstream`).
- If a PR's CI fails repeatedly, **graceful-exit per AGENTS.md** — commit any in-progress work as `WIP: halted run on #N`, push, and stop. Do not skip hooks or `--force` past failures.
