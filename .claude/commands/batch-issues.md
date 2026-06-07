---
description: Plan + implement the open issue backlog in conflict-minimizing batches, with an in-session code-reviewer pass per PR, draining into the qa staging branch.
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, Agent, EnterWorktree, TaskCreate, TaskUpdate, TaskList, mcp__supabase__apply_migration]
---

# Batch Issues

> **Model guard.** The global default is now Sonnet (for cost). Batch orchestration must run on
> **Opus**: the orchestrator owns verification, recovery, and taking over stalled agents, which need
> Opus reliability. First step before anything else, if this session is not on Opus, tell the user to
> run `/model opus` and wait for confirmation before proceeding.

End-to-end workflow for draining the open issue backlog. Surveys open issues (ignoring `priority:later`), groups them into batches that minimize merge-conflict risk, implements them in parallel where safe and serially where not, opens PRs with an in-session `code-reviewer` pass on each, drains the PR queue into the `qa` staging branch, fires a `qa` preview deploy, and opens a draft `qa -> main` promotion PR for the maintainer to QA and merge.

## When to use

User says `/batch-issues`, "work through the backlog", "implement all the open issues", or any variant that asks for a batched pass over the issue tracker.

## The qa staging-branch flow

Batch PRs do **not** target `main`. They target **`qa`**, an integration branch with a relaxed ruleset (#806):

- `qa` requires `test` + `e2e` to pass before merge but **not** strict-up-to-date, so batch PRs merge back-to-back with no rebase tax.
- `main` keeps its strict ruleset and only accepts PRs from `qa` (the `Restrict main PR source` check enforces this; a `hotfix` label is the documented bypass).
- After the drain, `/batch-issues` fires a Vercel preview deploy of `qa` and opens a **draft** `qa -> main` PR. The maintainer tests the preview, then marks the PR ready and merges it.
- Merging `qa -> main` triggers `auto-release.yml`, which cuts the release, deploys production, and resets `qa` to `main`.

See [WORKFLOW.md](../../WORKFLOW.md) "Branching model" for the full picture.

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

2. **Disable Auto Review.** `auto-review.yml` runs on PRs into `qa` as well as `main`. During a batch drain the in-session `code-reviewer` (Implementation step 3) is the review gate, so disable the workflow to avoid a redundant second review on every batch PR:

   ```bash
   gh workflow disable "Auto Review"
   ```

   Deliberate global mutation per the user's standing ask - paired with the re-enable in Wrap-up and the graceful-exit guardrail so a halted run never leaves it disabled.

   `gh workflow disable`/`enable "Auto Review"` are in `.claude/settings.json` `permissions.allow`, so the auto-mode classifier should not block them. If a future harness still blocks it (or the command errors with a genuine permissions failure), do **NOT** stop the run: proceed with Auto Review left **ENABLED** - `auto-review.yml` then acts as a second per-PR review gate alongside the in-session `code-reviewer`, which is harmless (a redundant review, plus possible `/fix` autofix commits via `auto-pr.yml` that the orchestrator should sanity-check before merge). Re-enable in Wrap-up regardless.

3. **Confirm a clean working tree.** If `git status` shows uncommitted changes, surface and stop. Do **not** require being on the `main` branch - under parallel jobs `main` is often checked out by another worktree, leaving this session on a detached HEAD, which is fine. Every implementation agent branches off `origin/qa` in its own worktree regardless.

   **Do not infer "unmerged work" from a non-qa branch's SHA alone (#1652).** When the session starts checked out on a feature branch, its CONTENT may already have shipped to `qa`/`main` via a DIFFERENT commit (e.g. through a hotfix backmerge), even though the branch looks unmerged by SHA. Before treating it as outstanding work, grep `origin/qa` / `origin/main` for the branch's content - `git show origin/qa:<path>` and search for the distinctive strings the branch introduced - to confirm whether it already landed. In the 2026-06-04 batch the local `update-controller-to-ltd` branch (b1fe471b) looked like unmerged #1565 work but the same change had already reached qa via #1612, and the wrong "promote the unmerged branch" premise was only caught by checking qa's file content directly. (Mirrors "triage against `origin/qa`, never the working tree" - memory: `feedback_fetch_before_judging_dirty_tree`.)

4. **Sync the `qa` staging branch.** Batch PRs target `qa`. Fetch and inspect it:

   ```bash
   git fetch origin --quiet
   git rev-list --left-right --count origin/main...origin/qa
   ```

   The output is `<behind> <ahead>` - commits on `main` not in `qa`, then commits on `qa` not in `main`.

   - **`qa` clean** (`ahead == 0`): no un-promoted work. If `behind > 0` (e.g. a `hotfix` PR landed on `main` since the last reset), fast-forward `qa` to `main` first - `git push origin +origin/main:qa` - so agents branch off the latest state. (The repo admin is a bypass actor on the `qa-staging` ruleset, so this direct push is allowed.) If `behind == 0`, `qa` already equals `main`. Either way, proceed.
   - **`qa` ahead** (`ahead > 0`): either a previous batch was drained but never promoted, OR `qa` was never reset to `main` after its last release. **Distinguish the two with `git merge-base --is-ancestor origin/main origin/qa`** before doing anything else:
     - **`main` IS an ancestor of `qa`** (genuine un-promoted work): stop and ask the maintainer whether to **promote** (open the `qa -> main` PR for the existing work first) or **discard** (`git push origin +origin/main:qa`) before starting a new batch - do not silently stack a new batch on top.
     - **`main` is NOT an ancestor of `qa`** (un-reset `qa`): the post-release "Reset qa to main" step did not fire (#1664), so `qa` carries already-released commits as divergent history. Do **NOT** batch on top of this - a batch piled onto un-reset `qa` (especially a repo-wide sweep) makes the eventual `qa -> main` promotion conflict-laden (2026-06-05: ~30 conflicts, amplified by the #1648 em-dash sweep). First **reconcile `qa`**, then re-check `git merge-base --is-ancestor origin/main origin/qa` passes, THEN batch. Two ways to reconcile: (a) reset `qa` to `main` and cherry-pick only the genuinely-un-promoted commits onto it (cleanest history, but a force-push needs the new tip to carry passing checks, so it is often admin-only); (b) merge `main` into `qa` resolving to qa's content - `git merge -X ours origin/main`, verify the tree is unchanged (`git diff --quiet HEAD origin/qa`), open a PR into `qa` and merge it with a **merge commit, not squash** (squash drops the `main` parent). Worked example: #1663.
   - If `qa` does not exist at all, stop and surface it - the qa staging-branch setup (#806) has not been applied.

5. **Check for existing open PRs (#1368).** The step-4 ahead/behind count only sees *merged* commits - it cannot surface open, unmerged PRs that already implement a backlog issue. Before dispatching any coder, list open PRs and reconcile them against the backlog:

   ```bash
   gh pr list --state open --json number,title,headRefName,baseRefName \
     --jq '.[] | "#\(.number) [\(.baseRefName)] \(.title) (\(.headRefName))"'
   ```

   Map each open PR to a backlog issue (via title, branch name, or `closes #N` in the body). On any overlap with an issue you are about to implement, **stop and ask the maintainer** whether to resume/finish the existing PR or supersede it - never spawn a fresh coder on top of an in-flight PR. This guards the duplicate-work detour that hit the #1313/#1314/#1316 batch when PRs #1340/#1341/#1342 were already open for those issues. (memory: `feedback_batch_preflight_check_open_prs`.)

6. **Per-issue staleness check (#1322).** For every non-trivial issue surfaced in step 1, run:

   ```bash
   .github/scripts/check-issue-staleness.sh <N>
   ```

   The script prints a structured verdict (`STALE: yes|no` plus reasons). For any issue that reports `STALE: yes` (default 3-day age threshold, or git activity on backtick-quoted file paths in the body since `createdAt`), include it in the **Decisions first** AskUserQuestion round below - the maintainer either confirms the ACs still hold (proceed) or marks the issue for an amend (skip this batch). Per-issue threshold overrides live on the issue itself as a `stale-check:N` label (or `stale-check:off` to disable the age branch); see the script header for the precedence rules.

   Skip the staleness check for trivial issues (typo fixes, doc tweaks, one-liner workflow changes) - they are exempt under the same rule that lets them skip the planner.

7. **Pre-existing CI noise + stale-preview pre-flight.** Two advisory checks so this session is not blamed for unrelated red signals or a stale preview:

   ```bash
   # 6a. Workflows whose LATEST qa run is a failure (genuinely red NOW). Querying
   #     by failure-status alone is blind to later successes, so a long-fixed
   #     failure burst gets re-surfaced every session (#1510 — the Perf-budget
   #     false positive). Take the latest run per workflow across ALL conclusions
   #     and flag only those whose most recent run failed.
   gh run list --branch=qa --limit 60 --json conclusion,createdAt,name \
     --jq 'group_by(.name)
           | map({workflow:.[0].name,
                  latest:(max_by(.createdAt).conclusion),
                  recent_failures:(map(select(.conclusion=="failure"))|length)})
           | map(select(.latest=="failure"))'

   # 6b. Preview-deploy freshness — is the last QA Preview Deploy behind origin/qa?
   gh run list --workflow="QA Preview Deploy" --limit 1 --json headSha --jq '.[0].headSha'
   git rev-parse origin/qa
   ```

   For each workflow surfaced by 6a, check that a tracking issue already exists; if not, file one (`priority:later` by default) so the noise is captured and the session does not silently inherit blame. Carry the list into the Wrap-up handoff so the maintainer sees "known noise" annotated separately from "introduced by this batch". The freshness check (6b) is a hint for the Wrap-up `Fire qa preview deploy` step - if the SHAs already diverge before this session even starts, the maintainer needs to know this batch is not the first to land work since the last preview.

8. **Triage the backlog.** Not every open issue produces a PR. Classify each issue from step 1 into one of:

   - **Code** - a concrete, implementable change. Goes into the implementation batches.
   - **Analysis** - a read-only audit or umbrella issue whose deliverable is a report plus scoped follow-up issues, not a PR.
   - **Exploration** - a design or research issue that ends in a decision, not code.
   - **Decision** - a product or design question that needs a user choice before any code can be written.
   - **Blocked** - gated on an external precondition (e.g. a beta dependency reaching GA). Skip it, and say so in the summary with the reason.

   Carry this classification into Planning - each class is handled differently.

## Planning

### Decisions first

Before planning any code, collect everything that needs a user choice and ask it in **one** round:

- Every **Decision**-class issue from triage.
- The handling of **Analysis** and **Exploration** issues - run them this session, or defer?
- Any `[USER-DECISION]` item per AGENTS.md "Stack decisions" you can already foresee from the issue bodies.

Put all of these into a single `AskUserQuestion` call. Do not discover questions mid-run - a question surfaced after implementation has started forces an avoidable pause.

### Code batches

Read each **Code**-class issue's body and identify the primary file areas it touches (`app/`, `lib/`, `db/`, `components/`, `.github/`, docs, etc.). Group issues into batches with these rules:

- **Same batch is OK** when issues touch disjoint file trees (`app/pokedex/**` vs `app/stats/**`, or a workflow tweak vs. a UI change). These can run in parallel.
- **Different batches** when issues are likely to conflict - same file, same module, same migration sequence number, or one depends on the other.
- **Migrations are serial.** Any two issues that add a `db/migrations/*.sql` file must be in different batches and ordered, so the migration filenames don't collide and so the second can be authored against the post-merge state.
- **Trivial edits (typos, doc fixes, single-line tweaks)** can pile into a single batch regardless of location.
- **Combine tightly-coupled issues** into one PR and one agent when one issue's resolution *is* part of another's (e.g. a bug fix whose correct form depends on a design decision in a sibling issue). A single PR may carry `closes #A` and `closes #B`. Prefer this over two PRs that fight over the same files.
- **One PR per shared-single-file epic - do NOT decompose into serial sub-PRs (2026-06-07 retro).** When a multi-sub-issue epic restructures ONE shared file (e.g. a 2.7k-line single-file pass), default to ONE agent / ONE PR carrying `closes #A #B #C`, with milestone WIP pushes after each sub-issue (Implementation step 2). On `qa` (no strict-up-to-date) decomposing into serial sub-PRs buys zero conflict saving but pays N CI runs + N reviews and manufactures constant-drift conflicts at the seams where each sub-PR re-touches the same file. Decompose ONLY a genuinely file-disjoint piece - a catalogue-only change, a test-only addition, a move into a different file. This is the inverse of the "combine tightly-coupled" bullet above: shared-file work stays together too.

### Analysis and Exploration issues

These are read-only - they produce a report and scoped follow-up issues, never a PR. Dispatch them as **background agents** (`run_in_background: true`) at the start of the run so they proceed concurrently with the code batches. Each such agent's prompt: do the analysis, post the report as a comment on the umbrella issue, file scoped follow-up issues (`priority:later` by default, never `auto`, never `priority:now`), and do **not** close the umbrella. Surface any `[USER-DECISION]` an exploration produces in the wrap-up. **When the exploration proposes a new user-facing visual surface or layout change, the report MUST include a mock-up (ASCII art is fine, or an attached image) of the proposed surface - desktop and mobile where they differ - so the maintainer can inspect and annotate it before any implementation ticket is written (#1500).** A prose-only proposal of a visible surface is incomplete.

Present the plan to the user as a short bullet list - issue numbers per batch and per class - and proceed. The user has given standing autonomy for the implement → review → PR → merge loop in batch sessions.

## Implementation (per batch)

For each batch, in order:

1. **Spawn one Agent per issue in the batch, in parallel** (single message, multiple `Agent` tool calls). Use the appropriate specialist subagent type per AGENTS.md "File ownership". Each agent works in an isolated worktree (`EnterWorktree`) so parallel branches don't collide.

   **Immediately after dispatch, health-check each agent's worktree** before considering the agent productive:

   ```bash
   # For each agent's reported worktree path:
   git -C <worktree-path> rev-parse --abbrev-ref HEAD          # must match the assigned branch
   git -C <worktree-path> log -1 --format='%h %s'              # must be on origin/qa's tip or a branch off it
   ```

   If the worktree is on the wrong branch (e.g. a stale `chore/...` left over from a prior run) or the HEAD is on a release-tag commit instead of `origin/qa`, stop that agent immediately with `TaskStop` and re-dispatch into a fresh worktree. A stalled or wrong-branched agent can spend ~1h producing edits that never reach the assigned branch - the canonical failure mode is the #1329 Context-refactor agent that edited files in a sibling worktree on `chore/1328-dry-single-source-of-truth-rule` instead of its own assignment. (memory: `feedback_verify_agent_reports`.)

   **MCP-needing agents must be `general-purpose` (#1368).** `data-coder` and `ui-coder` have NO access to the Supabase MCP tools (`execute_sql`, `get_logs`, `apply_migration`). Any task that must query or mutate the live database - a divergence investigation, a recovery dry-run, an analysis that reads prod state - must go to a `general-purpose` agent, which loads MCP tools via ToolSearch. A DB-needing task handed to `data-coder`/`ui-coder` fails silently. Migrations are still *authored* by `data-coder` per file-ownership; only the `apply_migration` MCP *call* needs a general-purpose agent or the orchestrator applying it directly after the coder writes the `.sql` file. (memory: `feedback_mcp_needs_general_purpose_agent`.)

   **Do NOT delegate open-ended local verification to sub-agents - they stall silently.** Briefing an agent to "verify by running the app", "run the full build gate", or "wait for CI to go green after pushing" reliably hangs it: a sub-agent's intermediate output does not stream to the main chat, so a stall is indistinguishable from normal quiet work and there is no completion notification. In the #1394 mini-batch, two consecutive fix agents stalled (one ~2h in a wait-for-CI loop after pushing, one on a file-read mid-build-gate) and only the maintainer caught them by opening the sub-agent chat. Brief agents to **push and report immediately**; the orchestrator owns CI-watching (bounded background `gh pr view --json` polls) and the app-run / `/verify` step. When a sub-agent goes quiet abnormally long (no commit/push in ~15-20 min), **stop it with `TaskStop` and take over** - it usually left correct work *uncommitted* in its worktree (`git worktree list` → `git -C <wt> status`), so inspect the diff, run the build gate yourself, fix any failing test, and commit + push directly rather than redispatching. **On takeover, run the EXACT `npm run` gate commands CI runs (`npm run lint` / `npm run typecheck` / `npm run build` / `npm test` / `npm run test:coverage`), never a hand-rolled `tsc --noEmit` / `eslint` (#1651).** A one-off `tsc -p tsconfig.json` in a takeover used a stale incremental cache and missed a TS2554 that then failed CI's `test` job. And **trust the killed agent's last-reported error state - hunt that specific failure down rather than concluding "clean"** after a green local run that may not reproduce it. (memory: `feedback_dont_delegate_open_ended_local_verification`.)

   **Liveness is not watch output - verify against ground truth.** In the web/remote runtime the container is paused between turns, which silently kills any `sleep`-based watch or `run_in_background` poll loop a sub-agent starts within its turn. A watch that last printed "still progressing" or "cap reached" may have died long before its loop finished, so its output is **not** evidence the agent is alive. Never report agent progress (especially "no stall") from a watch alone: confirm against ground truth first - `git ls-remote origin <branch>` for the tip (must match the SHA the agent last reported pushing), the tip commit's age (`git log -1 --format=%ct origin/<branch>` vs `date +%s`), and the agent output-file mtime. No push in ~15-20 min *by the clock* means stalled: take over per the paragraph above, regardless of what any watch last said. (Worked example, 2026-05-31 drain: the #1434 sweep agent stalled 2.5h after its last group-push while dead watches implied progress; the maintainer caught the false "no stall" report.)

   **Output-file mtime is a FALSE stall signal during back-to-back blocking gate commands (#1651).** An agent running `npm run build` then `npm run test:coverage` produces no transcript output for 15-20+ min, so an mtime-based stall check looks tripped while the agent is alive mid cold-build then coverage. Liveness is the **process table + push status, not output age**: before taking over on an mtime stall, check `ps` for a live `next-build` / `vitest` / `tsc` under the worktree path and the branch-push status; only conclude stalled if neither shows progress. (Worked example, 2026-06-04 batch: the #1588 agent looked stalled at 17 min of no output but the process table confirmed it was alive mid cold-build to coverage.)

   **Orchestrator heartbeat duty for any >10-min agent (2026-06-07 retro).** For any agent expected to run more than ~10 min (a big epic, a repo-wide sweep), the orchestrator posts a periodic **ground-truth** heartbeat rather than relaying the agent's transcript: branch-tip / push status (`git ls-remote origin <branch>`), the worktree's dirty-file count (`git -C <wt> status --porcelain | wc -l`), and the process table (`ps` for a live `next-build` / `vitest` / `tsc` under the worktree). Do **NOT** conclude a stall from output-file mtime alone - a live agent mid-`build` / mid-`test` produces no output for minutes (see the mtime paragraph above); always corroborate against the process table and push status before taking over. The heartbeat is the orchestrator's own visibility signal; pair it with the WIP-push briefing (Implementation step 2) so the branch tip actually moves between heartbeats.

2. **Each agent's prompt must include:**
   - The issue number and **the full body, verbatim** - not paraphrased, not summarised. Include all subsections; the implementer cross-checks against them in the PR body. The orchestrator-side scope drop that landed #1259/#1260 without per-locale FSRS rows happened because the brief paraphrased the issue's "Data model" section instead of pasting it.
   - **"Echo back any `## Data model` / `## Schema` / `## Acceptance criteria` / `## Acceptance` sections from the issue body verbatim in the PR description before opening the PR."** The implementer's own copy is the cross-check anchor for both the auto-review job (`feedback_consult_specialist_on_brief`) and the in-session reviewer.
   - **Specialist pre-consult (when applicable).** If the work falls in an i18n / SRS / Supabase / PokéAPI / privacy domain (per AGENTS.md "File ownership"), the orchestrator must consult the relevant specialist sub-agent (`i18n-expert`, `srs-expert`, `supabase-expert`, `pokeapi-expert`, `privacy-expert`) on the **brief** before dispatching the implementer - not just on the implemented diff afterwards. The specialist's read on the brief catches scope drops the implementer would miss (the canonical example: i18n-expert would have flagged the missing per-locale FSRS PK in the #1259 brief). **Brief the specialist (and verify its findings) against `origin/qa` - `git show origin/qa:<path>`, `git grep origin/qa` - NOT the session's working-tree checkout, which is often a stale feature branch (2026-06-05 batch: both the i18n and ux consults wrongly concluded an existing helper / catalogue key did not exist because they read the stale checkout; mirrors #1652).** Carry the specialist's notes into the implementer's prompt under a `## Specialist notes` heading.
   - **Multi-site domain-concept audit (when applicable).** If the work touches a domain concept that is rendered or computed at multiple sites - Pokémon names, dates, mastery counts, sprite URLs, locale-aware text, ARIA labels, anything per the `dry-single-source` memory - the prompt must include: "Before implementing, grep the whole repo for every existing call site of this concept and list them as either in-scope or explicitly out-of-scope-with-rationale in the PR body. A fix that only patches the site QA flagged is the failure mode #1259/#1311/#1318/#1329 went through four rounds to escape." (memory: `feedback_agent_fix_full_audit`.)
   - "Branch off the latest `origin/qa` and open the PR against `qa` - batch work lands on the `qa` staging branch, never `main` directly. (memory: `feedback_rebase_before_pr`.)"
   - "Reference the issue in commit messages (`closes #N`). Note this does not auto-close the issue on merge into `qa` - the `qa -> main` promotion PR does that - but it keeps the linkage visible."
   - "If your change adds a Supabase migration, call `mcp__supabase__apply_migration` with the stripped name (no `0NN_` prefix) **before** opening the PR - the `migration-check.yml` check fails until file-vs-applied parity holds." (See AGENTS.md "Adding a feature that needs to persist data".)
   - "Add a `changelog.d/unreleased/<issue-number>-<slug>.md` fragment unless the change is internal-only (agent roster, workflow tweaks not visible to users)."
   - "Run the build gate as the SEPARATE commands `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:coverage` (each with a one-line status after it), NOT the bundled `npm run pre-pr` - a single long blocking command emits nothing to your own transcript until it returns, which is indistinguishable from a stall to the orchestrator watching you. If anything fails, fix and retry up to twice, then stop and report. The `test:coverage` step catches global-floor breaches before push (#1123). The 90% per-diff patch-coverage gate then runs in CI - **immediately after `test:coverage`, run `npm run test:diff-coverage` (MANDATORY, not optional) while `coverage/coverage-final.json` is still present** to catch per-diff breaches locally before push; green-locally-then-red-on-CI-diff-coverage bit #1642 / #1646. Same two-attempt budget. (`npm run pre-pr` stays the canonical gate for a human running it locally; the step-by-step form is for agent-run visibility - 2026-06-07 retro.)" (AGENTS.md "Pre-PR build gate" - #1649.)
   - "If your diff touches `app/layout.tsx`, `app/page.tsx`, `components/onboarding/**`, `components/Nav.tsx`, `components/BottomTabBar.tsx`, `components/MobileNavPaddingWrapper.tsx`, `lib/settings/persistence.ts`, or `playwright.config.ts`, additionally run `scripts/pre-pr-smoke.sh` (chromium-only Playwright smoke subset via the pinned Docker image - requires Docker; if `docker info` fails the script exits 2, in which case skip this step and note the skip in the PR description rather than retrying) before opening the PR. Same two-attempt retry budget. PRs that only touch a single page or component surface outside that list skip this step." (AGENTS.md "Pre-PR e2e smoke (high-surface-area changes)" - #1126.)
   - "If your change alters user-facing copy, ARIA labels, `alt`/`title`/`placeholder` text, or a user flow, grep `e2e/` for assertions that reference it and update those specs too - not just the unit tests. A copy change that leaves a stale `e2e/` assertion fails CI on both browser projects. For a **multi-surface sweep** (a change touching many components - e.g. an i18n re-wiring), updating `e2e/` is *part of the change*, not optional cleanup: editing dozens of components while touching zero `e2e/` specs almost always fails `e2e` even when unit tests, lint, and coverage pass locally - because the local gate does not run the browser projects. Grep `e2e/` for every accessible-name / visible-string you rename or change, and reconcile each."
   - **"Mandatory coverage rules (AGENTS.md "Mandatory coverage rules") - not optional. (a) STATE in AND out: anything that introduces or gates on a state (flag, mode, setting, signed-in vs guest, empty vs populated data) must be tested on BOTH sides, including the empty/all-caught-up branch - drive data-dependent state via the #1326 QA-seed scenarios or superuser flags. (b) NAMES/LABELS in EVERY locale on EVERY surface: anything rendering a Pokémon name or user-facing label must render correctly in `en`/`ja`/`zh-Hans`/`zh-Hant` (both `appLocale` and `pokemonNameLocale` axes) on every surface that renders it - INCLUDING lint-allowlisted/perf-exempted surfaces like the Pokédex grid (resolve via the pure `lib/pokemon/localeNames.ts::getLocaleName`, never the raw English seed field), with a locale-rendering test. The #1302/#1327 batch shipped English grid names + an untranslated UI because these went untested in non-`en` / on the exempted surface."** (memory: `feedback_verify_core_mechanics_by_running_app`.)
   - **"Tightening an existing gate? Reconcile its EXISTING tests, not just add new ones. When your change narrows or adds a condition to a gate that already exists (a render/visibility condition, a nudge trigger, a derivation predicate), grep for the pre-existing unit/e2e tests of that gate and update them for the tighter scope. A stale \"renders\" assertion written for the old looser gate goes red when the new condition suppresses what it expected - the #1498 scope-nudge miss, where a pre-existing e2e renders test was not updated for the tightened gate and went red in CI."**
   - **"Milestone WIP pushes for a big single-file epic.** If you are implementing a multi-sub-issue epic in one PR (e.g. a 2.7k-line single-file restructure), `git push origin <your-branch>` a WIP commit after EACH sub-issue lands - do not work in a long unpushed silence. The orchestrator's heartbeat (Implementation step 1) watches the branch tip; a tip that moves every sub-issue is the signal you are alive and progressing, versus a single push at the very end that is indistinguishable from a stall for an hour. (2026-06-07 retro.)"
   - "Commit and push your branch (`git push origin <your-branch>`) as soon as the build gate passes and BEFORE running the self code-review - a truncation or stall mid-review then still leaves your work on the remote for the orchestrator to take over rather than stranded uncommitted in the worktree (2026-06-05 batch: two agents ended mid-self-review having never pushed). Then run the `code-reviewer` sub-agent on your own diff inside your worktree, push any blocking fixes, and open the PR. This also puts reviewed code in front of CI on the first run, instead of paying an extra rebase + CI cycle for each post-review fix."
   - "Use `npm ci`, not `npm install`, so `package-lock.json` does not drift. Leave the worktree clean - commit only intended files, and remove any stray output files before opening the PR."
   - "Push with an explicit `git push origin <your-branch>` - never a bare `git push`. A worktree branched off `origin/qa` has its upstream set to `origin/qa`, so a bare `git push` does not update `origin/<your-branch>` and your PR branch stays stale (CI runs the old commit, often red). Name the remote and branch every time." (issue #1474 - a pseudo-locale regen 'pushed' but never landed on the PR branch.)
   - "Open the PR via `gh pr create --head <your-branch> --base qa` - pass both `--head` and `--base` explicitly so we never inherit the wrong branch or default to `main`." (memory: `feedback_gh_pr_create_head_explicit` - burned us on docs PR #544.)
   - "Do **not** add a `Co-Authored-By` trailer to any commit." House rule; commits go under the user's name only. (memory: `feedback_commits`.)

3. **In-session `code-reviewer` pass per PR.** After each agent's PR is open, run the `code-reviewer` sub-agent against that branch's **cumulative diff** in this session (not a CI run) as a confirmation gate - the agent should already have self-reviewed per step 2, so this pass mostly verifies. Brief the reviewer with the cumulative range `git diff origin/qa...HEAD` (or the PR's diff endpoint), never `git diff HEAD~1` / "the last commit": a batch PR squashes multiple commits into one on `qa`, so the cumulative diff is what lands and what a future reader sees, and some bugs only appear across commits (#1277). Surface findings as a one-line description each - never just counts. (memory: `feedback_review_summaries`.) If a finding is blocking, dispatch a follow-up Agent to fix; non-blocking findings get filed as new issues with the user's existing priority labels, never `priority:now` without direction.

   **Sweep red flag (many components, no `e2e/`).** When a coder's diff touches many UI components but **zero** `e2e/` specs, treat it as a likely `e2e`-red even when the agent reports its local gate green - the local gate (`typecheck`/`build`/`test`/`coverage`) does **not** run the browser projects, so a stale accessible-name/text assertion only surfaces in CI. Before merge, confirm the e2e specs were reconciled.

   **After a heading / section-rename sweep, run the affected specs LOCALLY until green - do not grep-and-hope (2026-06-07 retro).** When an epic renames sections or changes heading levels across many surfaces, grep alone repeatedly misses stale `getByRole("heading", { level: N })` and renamed-section assertions (this hit ~4× in the 2026-06-07 batch). The e2e-reconciliation fix MUST run the affected specs against a **local dev server** (`npm run dev` in one terminal, then `npx playwright test e2e/<affected>.spec.ts` against `PLAYWRIGHT_BASE_URL=http://localhost:3000` under the pinned `nvm use` Node) until they pass, not patch-by-inspection. Grep finds the obvious renames; the local run finds the level-N and accessible-name mismatches grep cannot see. If `e2e` is already red and the environment cannot run Playwright to pinpoint the failing assertion (e.g. the browser CDN is network-blocked), do **not** blind-iterate CI: mark the PR draft with the failure shape + a pointer to the Playwright trace, file/keep the work, and hand off (see `/investigate-ci-failure` in the PR queue drain section for the full triage procedure once fix-rounds begin). (Worked example, 2026-05-31 drain: the #1434 sweep edited ~27 components and 0 e2e specs, passed the local gate, and went `e2e`-red on both browser projects.)

   **Applying a review-fix to an already-open PR branch.** After a coder finishes, its branch stays checked out (worktree-locked) in `.claude/worktrees/agent-<id>/`, so a background orchestrator that has not isolated cannot edit it directly (the bg-isolation guard) and a fresh worktree cannot check the branch out (already checked out elsewhere). To land a fix on the SAME PR branch (never open a new PR): **(verified, 2026-05-30)** `git worktree remove --force <that agent's worktree>` to free the branch, then dispatch a fresh coder that runs `git checkout -B <branch> origin/<branch>`, applies the fix, re-runs the build gate, and `git push`es to update the PR in place. **(alternative, per the EnterWorktree tool docs but not exercised this session)** `EnterWorktree(path: <that agent's worktree>)` to switch into it and edit in place. `SendMessage` to continue the original completed agent was not available as a tool. This recurred ~4× in the 2026-05-30 drain (the #1421, #1408 ×2, and #1411 review-fix rounds). Separately, **do not spawn an isolated wrap-up agent that runs `npm ci` in a fresh worktree** - that hung silently twice in the 2026-05-30 drain (no output, no completion notification); do the docs/coverage wrap-up edits in an orchestrator-owned `EnterWorktree`, reusing the main checkout's `node_modules` (`ln -s`) when a deps-unchanged batch needs a coverage measurement.

   `auto-review.yml` *does* run on PRs into `qa`, so Pre-flight disables it for the batch drain - this in-session pass is the review gate instead, and Wrap-up re-enables it.

## PR queue drain

Once a batch's PRs are all open and reviewed in-session, merge them into `qa`:

0. **Agent-done != CI-green != merge-ready.** A sub-agent completing only means *the agent finished its work* - it does **not** mean the PR is green or mergeable. The agent's own local build-gate output is also **not** authoritative for the PR's required checks (the agent ran locally; CI runs `test` + `e2e` on the PR, plus `integration`/`migration-check` where applicable). Before reporting a PR as ready or merging it, query the PR's actual required-check status (`gh pr checks <PR> --json name,state`, or the MCP equivalent `pull_request_read` `get_status`/`get_check_runs`) and classify it explicitly as **ready / pending / failing** - never infer merge-readiness from an agent's self-report ("CI is running", "all checks pass") or its local gate. In status updates, distinguish "agent finished" from "CI green" from "merged", and make any headline count ("N of M done") reflect **merge-readiness**, not agent completion. (This codifies `feedback_verify_agent_reports` in-repo; the 2026-05-30 drain reported "4 of 5 done" while one PR had a failing migration-check and two had pending e2e, and the maintainer had to correct it - #1436.)

1. **No rebase tax.** The `qa` ruleset does not require strict-up-to-date, so a PR does not need rebasing when a sibling merges ahead of it, and merging one PR does not invalidate another's checks. Merge each PR as soon as its required checks are green - order does not matter:
   - `gh pr checks <PR>` - wait for required checks (`test`, `e2e`) green.
   - **Also check the `integration` result, even though it is not required on `qa`.** A red `integration` is a real failure that surfaces on the eventual `qa -> main` release PR (where it *is* enforced) - do not filter it out of your merge-readiness check. In the #1394 batch an `integration`-only failure (a test-date bug) merged into `qa` because the readiness check looked only at `test`/`e2e`, then blocked the promotion PR. If `integration` is red for a reason unrelated to the PR, note it; if the PR caused it, fix before merge.
   - If `Migration drift check` fails, the agent forgot to apply the migration via MCP - apply it now and the check re-runs.
   - `gh pr merge <PR> --squash --delete-branch`.
   - Loop until the queue is empty. **No rebase step** between merges - that strict-`main` cost is exactly what the qa flow removes.

2. **Real conflicts only.** Disjoint batches almost never conflict. If `gh pr merge` reports a genuine merge conflict (two PRs touched the same lines), rebase *that one PR* onto `origin/qa` with `--force-with-lease`, resolve, push, and retry the merge. This is the rare exception, not the per-PR norm.

   **After one fix-round fails to converge, use `/investigate-ci-failure` rather than dispatching a second sweep.** If a batch PR's CI is still red after the first fix agent runs, do not dispatch another agent of the same shape - the second sweep will not converge either (memory: `feedback_investigate_after_sweep_fail`; worked examples in `#1234` and `#1263`). Hand off to `.claude/skills/investigate-ci-failure.md`, which forces a logic-vs-perf triage and mandates Playwright traces for perf-shape failures before any code change.

3. **Detached-HEAD noise.** When the session runs from a detached HEAD (the parallel-jobs case), `gh pr merge` prints a harmless `could not determine current branch` notice *after* a successful merge. Confirm the merge landed with `gh pr view <PR> --json state` rather than trusting the command's exit code.

## Wrap-up

After every batch is merged into `qa` and the queue is drained:

1. **Re-enable Auto Review** (disabled in Pre-flight):

   ```bash
   gh workflow enable "Auto Review"
   ```

2. **Fire the `qa` preview deploy:**

   ```bash
   gh workflow run "QA Preview Deploy" --ref qa
   ```

   **Always pass `--ref qa`.** Without it, `gh workflow run` dispatches against the default branch and deploys a stale SHA - the canonical session shipped a preview on an old release commit and the maintainer would have QA'd the wrong build. Confirm it dispatched AND targets the current tip: `gh run list --workflow="QA Preview Deploy" --limit 1 --json headSha,headBranch` and assert `headSha` equals `git rev-parse origin/qa`. Then poll the deploy to `READY` via `mcp__claude_ai_Vercel__get_deployment` (or the GitHub deployments API) so the URL handed off in step 7 is live, not still building.

   **Then verify the batch's headline user-facing mechanics on the preview - do not assume green CI means they work (AGENTS.md "Mandatory coverage rules").** For each core user-facing change in the batch, exercise it on the preview *in its relevant state*: switch `appLocale` and `pokemonNameLocale` and check names/labels on **every** surface (grid AND detail, not just one), apply the #1326 QA-seed scenarios to populate data-dependent sections and also check their empty branch, etc. Drive this with Playwright against the preview URL if you can't inspect visually. The #1302/#1327 batch passed all CI and still shipped three broken headline behaviours because nothing exercised them in the broken locale/state - this step is the backstop. (memory: `feedback_verify_core_mechanics_by_running_app`.)

3. **Mini-batch follow-up loop.** Preview QA reliably surfaces 1-3 follow-up issues per session (worked examples: #1270/#1271 after #1234; #1331/#1332 after the multi-locale batch; memory: `feedback_mini_batch_after_qa`). Bake this in:

   - When the maintainer surfaces a preview-QA gap, file it as a new issue (`priority:later` by default, `priority:next` if clearly higher; never `priority:now` without explicit direction) so it is tracked even if it is not implemented this session.
   - For follow-ups the maintainer wants implemented inline, run them through the per-batch Implementation playbook (one Agent per issue, brief template from step 2, in-session `code-reviewer` pass, merge into `qa`).
   - **After any mini-batch work lands on `qa`, return to step 2 and re-fire the preview deploy** so the next QA round is against the new `qa` tip, not the pre-mini-batch one. This is the rule the canonical session missed: #1329 + Context refactor landed on `qa` and no fresh preview was dispatched until the maintainer asked.
   - Loop steps 2-3 zero or more times until the maintainer reports preview QA is clean.

4. **Open the `qa -> main` promotion PR as a draft.** Only after step 3 reports a clean QA round. A PR merged into `qa` does **not** auto-close its `closes #N` issue - GitHub only auto-closes on the default branch. So the promotion PR must carry every issue number the batch resolved (including any from mini-batch rounds):

   ```bash
   gh pr create --base main --head qa --draft \
     --title "Release: <short summary of the batch>" \
     --body "<body>"
   ```

   The body must list `Closes #N` for every issue resolved in the batch (one per line), followed by a one-line summary per merged PR. Merging this PR closes all those issues, triggers `auto-release.yml` (release + production deploy), and resets `qa` to `main`.

   Leave it as a **draft** - the maintainer marks it ready after QA. Do not merge it yourself.

5. **End-of-session retro (#1333).** Produce a structured retro covering:

   - **What went well** - patterns worth keeping; honest, not performative.
   - **What went poorly** - named incidents with one-line cost and root-cause attribution. Distinguish "we caught this in the session" from "the user caught it for us". Surface dropped scope, partial-fix loops, symptom-chasing, fire-and-forget async work, silent agent stalls, missed memory consultations, and any moment the orchestrator paraphrased an issue body instead of reading it verbatim.
   - **Concrete improvements - codify IN-REPO, not in memory.** Any learning that would apply to a future contributor or agent on *any* clone of this repo MUST be written into a repo file, never (only) into a machine-local memory: a rule/convention → `AGENTS.md` or `WORKFLOW.md`; an agent-behaviour fix → `.claude/agents/**`; a process fix → this skill / `.claude/commands/**`; a CI gate → `.github/workflows/**`; and - strongest - an enforceable invariant → a **forcing-function test** that fails in CI. Memories live under `~/.claude` on one machine: they do not travel with a clone, are not read by CI, and are not seen by an agent run on a fresh machine, so a repo-applicable rule left only in memory is effectively lost on the next machine. Bias toward landing these edits in the same PR that closes out the session, not a follow-up issue ("file an issue" for a process gap defers the fix and the failure mode usually recurs first).
   - **Memories** - reserve for genuinely *session/this-machine-local* hints or the maintainer's personal working preferences that have no place in the shared repo (e.g. "this user dislikes the word 'slice'"). Anything an agent on a fresh clone would need belongs in-repo per the bullet above. For the memories you do file, verify each `Write` succeeds and the file exists before claiming it was saved (memory: `feedback_dont_claim_memory_without_verify`).

   Hand the retro back to the user as a punch list. If the user picks improvements to implement, fold them into the same PR (or a separate retro PR if they touch many files); never let a retro lapse silently.

6. **Coverage ratchet.** Run `npm run test:coverage` against the post-merge `qa` state. Read the printed `Statements / Branches / Functions / Lines` summary, then update **the single source of truth**:

   ```bash
   # Edit the file directly — every consumer (vitest.config.ts,
   # .github/workflows/coverage.yml's PR comment, AGENTS.md / WORKFLOW.md
   # references) reads from it, so this one edit propagates everywhere.
   vim coverage-floor.json
   ```

   Set each metric to the nearest whole percentage **at or below** the measured value. Coverage floor never goes down - if the new measurement is below the existing JSON values, do **not** ratchet; file an issue about the regression instead and surface it in the handoff. Re-run `npm run test:coverage` after editing to confirm the new floor still passes (the vitest config imports the JSON, so a too-aggressive ratchet fails the gate immediately).

   **Drift verification.** Before opening the wrap-up PR, confirm there is no orphan copy of the floor anywhere:

   ```bash
   # If anything matches outside coverage-floor.json itself and the
   # coverage/ output dir, a copy has crept back in — fix it before
   # opening the wrap-up PR.
   git grep -nE 'Statements [0-9]+ / Branches [0-9]+ / Functions [0-9]+ / Lines [0-9]+' \
     -- ':!coverage' ':!node_modules'
   ```

   The expected output is empty (or only the PR-comment template's templating string, which substitutes from the JSON at run time). Any hit with literal hardcoded numbers is a drift bug - extract it to `coverage-floor.json` or delete the duplicate. (User ask, this session - #1333 surfaced four divergent copies, two of which were already stale by multiple ratchets. The single-JSON design exists to make a recurrence impossible.)

7. **Hand off to the maintainer.** One summary block:
   - Issues drained into `qa` (numbers, including any added in mini-batch rounds) and the PRs merged (numbers).
   - The draft `qa -> main` promotion PR number.
   - Mini-batch follow-ups filed but **not** implemented this session, with their numbers and priority labels.
   - Coverage ratchet applied (old → new floor per metric); link to the commit.
   - Retro punch list - at minimum, list the proposed improvements and whether each landed in this session or was deferred (with the deferral issue number).
   - Pre-existing red CI inherited from step 7 of Pre-flight, with the tracking issue link for each.
   - Next steps for the maintainer: "Test the `qa` preview deploy. When satisfied, mark draft PR #N ready and merge it - that cuts the release, deploys production, and resets `qa`. If the batch carries a `minor-bump` fragment, apply `version-bump:approved` to the promotion PR first."
   - **Analysis/Exploration** issues run - which umbrella issues got a report comment, and how many follow-up issues each filed (the umbrellas stay open for the user to review and close).
   - Any `[USER-DECISION]` items still awaiting a choice.
   - **Blocked** issues skipped, with the reason.

   `/batch-issues` does **not** trigger `Auto Release` itself - merging the `qa -> main` PR does.

## Batch-drain lessons (2026-06-02)

Hard-won rules from the 2026-06-02 drain. Apply them from the start of every run.

- **Triage against `origin/qa` / `origin/main`, never the working tree.** A session often starts on a stale feature branch (the working copy may be many commits behind the integration branch). Run every triage grep / file inspection with an explicit ref - `git grep origin/qa`, `git show origin/qa:<path>` - not against the checked-out tree. A working-tree grep produced a wrong "feature X does not exist, so the issue is blocked" verdict for work that had already merged. (memory: `feedback_fetch_before_judging_dirty_tree`.)
- **Coder subagents lack `EnterWorktree`.** `data-coder` / `ui-coder` / `playwright` have no `EnterWorktree` tool, so a brief telling them to "use EnterWorktree to isolate" silently fails and they fall back to the shared main checkout. Brief them to create their own isolate explicitly as the FIRST step: `git fetch origin && git worktree add /private/tmp/<name> -b <branch> origin/qa && cd /private/tmp/<name>` (or pass `isolation:'worktree'` on the Agent call). One mis-briefed agent switched the maintainer's main checkout to its branch.
- **Only ONE coder live in the shared main checkout at a time (fix/iterate phase) (#1694).** Because coders fall back to the shared main checkout (above), two fix-coders `checkout -B`-ing different PR branches in the same directory concurrently collide: one switches the branch out from under the other, uncommitted edits leak as stray untracked files, and a leftover worktree locks the checkout (observed fixing PRs #1681/#1689, 2026-06-05). When two PR branches both need edits, pick one: (a) **serialise** - dispatch one coder, wait for its push, then the next; (b) the orchestrator does a **`git worktree add` per branch** and points each coder at it by absolute path (`cd <path>` as their first step); or (c) the orchestrator **edits in its own `EnterWorktree`**. Never two coders `checkout -B`-ing the same directory at once. Health-check between dispatches: after a fix-coder pushes, confirm the main checkout is back on the expected branch (`git -C <checkout> rev-parse --abbrev-ref HEAD`) before dispatching the next.
- **One single-line site, one owner.** When two batched agents could both touch the same line (e.g. agent A splits a file that also contains a class-name literal agent B is sweeping), assign that exact site to exactly ONE agent and tell the other to HARD-SKIP it (and say so in its PR body). Both touching it produces a merge conflict even when the change is identical.
- **Check for an auto-review autofix before dispatching a manual review-fix.** `auto-review.yml` runs on `qa` PRs and, via the `/fix` loop in `auto-pr.yml`, pushes `claude[bot]` "address auto-review findings" commits. Before dispatching your own fix agent for a review finding, `git fetch` and check the branch tip for a bot autofix commit - it may already be done (it pre-empted two manual fixes this drain).
- **Read the failing e2e assertion before re-running.** A red `e2e-browser` leg is often the Microsoft container registry being blocked ("pull access denied" / "request is blocked") or a per-test async-fetch race, not a real failure. But always read the actual assertion first: a chromium-only failure on a non-UI change was once a genuine app bug (a detail panel that never re-rendered on async data), which a test-side cache-warming workaround had masked. Fix the app, not the test.

## Guardrails

- **Never** add the `auto` label to issues we are implementing - the auto pipeline is user-dispatched only. (memory: `feedback_no_auto_label_on_create`.)
- **Never** promote issues between priority labels without explicit user direction - the user owns priorities. (See AGENTS.md "Backlog / process".)
- **Ask before mutating shared GitHub state** outside this skill's documented operations: title/label changes on existing issues, branch ops on someone else's PR, etc. (memory: `feedback_ask_before_mutating_github`.)
- **Don't rationalize** sub-agent decisions if the user pushes back mid-run; evaluate honestly. (memory: `feedback_dont_rationalize_downstream`.)
- **Never merge the `qa -> main` PR yourself.** The maintainer's QA of the preview deploy is the gate between batch work and production. Open it as a draft and stop.
- **Graceful-exit on halt.** If the run halts for any reason - CI failures, user interruption, an unfixable conflict - before reaching Wrap-up:
  1. Run `gh workflow enable "Auto Review"` so the Pre-flight disable is reversed. Unconditional - even if the disable itself failed, run the enable defensively.
  2. Commit any in-progress work as `WIP: halted run on #N` and push, per AGENTS.md "Graceful exit on halt".
  3. Do not skip hooks (`--no-verify`) or `--force` past failures.
  4. Any PRs already merged into `qa` stay there - a later `/batch-issues` run's pre-flight step 4 will detect the un-promoted `qa` and ask how to handle it.
