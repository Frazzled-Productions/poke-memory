# #2081: what is done, what is blocked, and two questions for Fraser

This file deliberately names markers ("the drift marker") rather than quoting them in full. Until the fix reaches `main`, the old lookups still run, and any open issue whose body quotes a full marker can be taken over. If this file is ever pasted into an issue, keep it that way.

## What this commit does

- **`.github/scripts/find-marker-issue.mjs` (new).** The shared lookup from the issue's suggested fix. It lists open issues (`gh issue list --state open --limit 1000 --json number,body`, run without a shell) and returns the one whose first line, trimmed, is exactly the marker. If there are several, it returns the newest and prints a `::warning::` naming the rest. It exits non-zero when `gh` fails, when the output is not a JSON array of numbered issues, or when the list reaches the limit, so a failed lookup can never read as "no existing issue".
- **`scripts/find-marker-issue.test.mjs` (new).** 23 tests. They cover the #1997 takeover case (a newer issue quoting the marker mid-body loses to the older issue that carries it on line 1), colon markers (#1919), CRLF bodies, empty and null bodies, duplicates, and every failure exit. A mutation check (swapping the anchored match back to `includes`) fails 4 of them.
- **`scripts/lint-marker-lookups.mjs` (new), wired into `npm run lint`.** It fails on any non-comment workflow line that contains `in:body`, or that contains both `contains(` and `body`. Exemptions are listed in the script, one line each, with a reason. An exemption that stops matching exactly one flagged line fails the check, so exemptions clean themselves up.
- **`scripts/lint-marker-lookups.test.mjs` (new).** 25 tests. The flagged fixtures are copied from the real lookup lines. The tests also check that the real tree passes, and that removing an exemption surfaces its line.
- **`WORKFLOW.md`.** The hard rule on marker dedup now names the helper and the lint check, and the lint-chain list includes the new check.

Checked live (read-only, 2026-09-17): there are 44 open issues. Only #2044 has the drift marker on line 1, and only #2031 has the grade-log marker there. No open issue has a cron-health or PokéAPI marker on line 1. Once the patch below is applied, the helper will therefore return #2044 and #2031 and nothing for the other two monitors.

## Blocked: the workflow edits need someone who can write `.github/workflows/`

This lane's permission profile refuses every edit under `.github/workflows/` and `.claude/agents/`, so the monitors themselves are **not** switched yet. That is steps 2 and 4 of the issue's suggested fix. Until they are switched, the four monitors still use their old lookups: three use the unanchored match, and the grade-log monitor uses the search.

The edits are ready as **`docs/plans/2081-workflow-edits.patch`**, written against this commit. Apply it from the repo root:

    git apply docs/plans/2081-workflow-edits.patch
    npm run lint && npm test -- scripts/find-marker-issue.test.mjs scripts/lint-marker-lookups.test.mjs

The patch:

1. Switches `auto-release.yml` (qa-drift-check), `cron-health-monitor.yml`, `pokeapi-species-monitor.yml` and `monitor-grade-log-divergence.yml` to `EXISTING=$(node .github/scripts/find-marker-issue.mjs --repo "$REPO" --marker "$MARKER")`.
   - `cron-health-monitor.yml` drops its one-off `ALL_OPEN_ISSUES` fetch and calls the helper once per watched workflow.
   - The grade-log step gains `REPO` in its env and `--repo "$REPO"` on its `gh` calls. It also drops `--label monitoring` from the lookup, because gh routes `--label` through the same search API (`issueList` in cli/cli `pkg/cmd/issue/list`). The label is still applied when the issue is created.
2. Removes the four "pending" exemptions from `scripts/lint-marker-lookups.mjs`. Without that, the lint check fails as soon as the workflows change, because those exemptions no longer match anything.
3. Adds a test that each of the four monitors calls the helper and no longer runs its own `gh issue list`.
4. Updates the four monitors' rows in `WORKFLOW.md`, including the grade-log row, which has been stale since #2003 (it still says the job always opens a new issue).
5. Adds a "Looking a marker up" paragraph to `.claude/agents/workflow-expert.md`.

**How the patch was checked.** This lane cannot run `git apply` either. Instead, a throwaway script (not committed) parsed the patch and confirmed each hunk's line counts and old-side lines against this commit's files. It then applied the patch to a scratch copy of the tree and ran the patched test files against the patched workflows. The result: 52 tests pass, the patched lint check is clean, and six exemptions remain. Before relying on the patch, run `git apply --check`, which this lane could not.

**Design review.** `workflow-expert` reviewed the design before the patch was written. It confirmed:
- every writer puts its marker at column 0 of line 1;
- `EXISTING=$(node ...)` under `set -euo pipefail` aborts the step when the helper fails;
- dropping the label filter is safe.

Two of its findings changed or were checked:
- **Leading whitespace (adopted).** The helper now trims both ends of line 1. Otherwise a future writer whose heredoc keeps some indentation would silently file a new issue on every run.
- **Annotations on stderr (checked, not adopted).** It said annotations written to stderr are not parsed, because the docs only mention stdout. The runner source says otherwise: `ScriptHandler.cs` in actions/runner attaches an `OutputManager` to stderr as well as stdout. So the helper keeps writing its annotations to stderr, since stdout carries the issue number.

It also flagged a trade-off in `cron-health-monitor.yml`. The old single up-front fetch failed before any workflow was checked. With one helper call per workflow, a `gh` failure part-way through skips the workflows still to come in that run. The run still fails red either way, and the cadence is weekly, so the patch accepts this.

AGENTS.md still requires a `workflow-expert` review of the applied diff, because the patch touches `.github/workflows/**`.

**Do not verify by dispatching `auto-release.yml`.** `workflow_dispatch` also runs the `release` job, which cuts a release if fragments are pending. Scheduled runs use `main`, so the change takes effect after the next qa to main promotion. From then on:
- the drift job should log "Updating tracking issue #2044", or close #2044 if qa has recovered;
- a persisting grade-log divergence should comment on #2031 instead of opening a new issue.

## Q1. How far should the lint check reach?

The check flags ten lines on today's tree. Four are the monitor lookups the patch fixes. Of the other six:
- four are **PR-comment** lookups whose writers put the marker on line 1: `coverage.yml`, `ci-failure-autofix.yml`, `pr-check-monitor.yml`, and the preview-fired lookup in `vercel-preview-on-ready.yml`;
- two belong to the dead auto-review gate in `vercel-preview-on-ready.yml`, tracked in #2020. One of those markers sits on line 2 of its comment, so it cannot be anchored at all.

- **A. Anchor the four PR-comment lookups too (recommended).** In each file, change `contains(` to `startswith(` and drop its exemption. Only the two #2020 lines stay exempt.
  *Trade-off:* four more workflow files, each needing workflow-expert review, and each writer has to be re-checked to confirm the marker is at column 0 of its comment. In return, the same takeover bug is fixed for comments. `coverage.yml` is the sharpest case: on a match it overwrites the comment rather than skipping, so today it would overwrite the first PR comment that quotes its marker, even a human's.
- **B. Leave them exempt (what this commit does for now).** The check covers new code only, and the six exemptions point here and at #2020.
  *Trade-off:* the smallest change, and it matches the issue's four-monitor scope. But the comment lookups stay unanchored, and six standing exemptions make the check look weaker than it is.
- **C. Narrow the check to `in:body` plus the four monitor files by name.**
  *Trade-off:* no exemptions. But a new monitor file would not be covered, which is how #2003 reintroduced the search form. Not recommended.

## Q2. Also require the issue to be authored by the workflow's own identity?

The issue asks for a line-1 match, and that is what the helper does. The plan (PR #2085) proposed also requiring `author.login` to equal `app/github-actions`, the identity all four monitors post as today.

- **A. Add the author check (recommended).** Add a required `--author` argument to the helper, and pass `app/github-actions` at the four call sites.
  *Why:* a line-1 match alone still leaves two holes.
  - The repo is public, so anyone can open an issue whose first line is the drift marker. The drift job would then rewrite that issue daily and close it, and the real tracking issue would stop updating.
  - #1997's overwritten body now starts with the drift marker. If #1997 is reopened to recover the W32 review without its body being restored first, the job takes it over again.

  The grade-log lookup used to have a partial guard against this, the `monitoring` label, since outsiders cannot apply labels. The patch drops that label filter because it goes through search.

  *Trade-off:* the lookup is then tied to the posting identity. If a monitor moves to the App token, its issues are authored by `app/poke-memory-bot`, the lookup stops matching, and it opens a new issue every run. The duplicate warning makes that visible, but the `--author` value has to change together with the token. A tracking issue recreated by hand is also ignored.
- **B. Line 1 only (what this commit does).** This is what the issue suggested.
  *Trade-off:* simpler, with no dependency on the posting identity, and already a strict improvement: before, any issue quoting the marker anywhere could be taken over. The planted-marker and reopened-#1997 cases stay open.

A is a small follow-up on top of this commit: one option and one filter in the helper, a few tests, and one argument at each call site in the patch.

## Still for a human (from the issue, not done here)

- Close #2000 to #2002 as duplicates of #1999, or close all four, since #2031 is the issue that carries the marker.
- Recover the W32 review text from #1997's edit history if its proposals still matter. See Q2 before reopening it.
- Decide whether #2010 should close in favour of #2081.

## Noticed on the way, not changed

- `WORKFLOW.md`, grade-log section: the Trigger row gives the default threshold as 5, but the workflow's input says 0.
- `WORKFLOW.md`, cron-health section: the "What it does" row still lists the weekly digests and `auto-deep-audit`, which the workflow no longer watches.
- `auto-close-umbrella.yml:35`: its comment points at `auto-retro-harvest.yml`, which no longer exists.
