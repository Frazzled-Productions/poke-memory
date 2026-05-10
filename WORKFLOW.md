# Workflow

This is the **process map** for poke-memory — how work flows through this repo end-to-end. It covers the sub-agent roster, orchestration playbook, GitHub Actions catalog, issue lifecycle, build gates, and retrospectives.

For implementation conventions (caching, SRS, PokéAPI integration, file ownership), see [AGENTS.md](AGENTS.md).

**Update rule:** update this file in the same commit that changes a workflow, automation, or orchestration behavior — no separate docs-only commit.

---

## Sub-agent roster

Custom agents live in `.claude/agents/`. Invoke via the Agent tool with `subagent_type: "<name>"`.

| Agent | Role | Read-only? |
|---|---|---|
| [planner](.claude/agents/planner.md) | Designs implementation plans; surfaces unknowns before any code is written | Yes |
| [next16-expert](.claude/agents/next16-expert.md) | Next.js 16 API, caching, routing, rendering questions | Yes |
| [pokeapi-expert](.claude/agents/pokeapi-expert.md) | PokéAPI endpoint selection, schemas, caching strategy | Yes |
| [srs-expert](.claude/agents/srs-expert.md) | Spaced-repetition algorithm design and implementation | No |
| [researcher](.claude/agents/researcher.md) | Generalist investigation that doesn't fit a specialist | Yes |
| [ui-coder](.claude/agents/ui-coder.md) | Pages, layouts, components, styling | No |
| [data-coder](.claude/agents/data-coder.md) | API routes, Server Actions, persistence, integrations | No |
| [code-reviewer](.claude/agents/code-reviewer.md) | Independent diff review at the end of a change | Yes |
| [workflow-expert](.claude/agents/workflow-expert.md) | GitHub Actions / orchestration changes — idempotency markers, salvage patterns, fork-PR guard, cycle caps | Yes |

---

## Orchestration playbook

The main agent (Claude in the user's session) orchestrates. Coder agents do not call other agents directly — they receive research findings via the prompt.

Standard flow for non-trivial work:

1. **Plan** — invoke `planner`. It surfaces unknowns tagged as `[EXPERT-RESEARCH]`, `[USER-DECISION + RESEARCH]`, or `[USER-DECISION]`.
2. **Research in parallel** — dispatch specialists (`next16-expert`, `pokeapi-expert`, `srs-expert`, `researcher`) in a single message when their questions are independent. Fold answers into the plan.
3. **Implement** — invoke `ui-coder` and/or `data-coder` with full context (research findings + spec). Run in parallel when their work is independent.
4. **Review** — invoke `code-reviewer` at the end. Iterate on its punch list.

When *not* to use a sub-agent: small one-off edits, single-file changes, or anything where the round-trip cost outweighs the value.

---

## Issue lifecycle

Issues move through the following states on the [project board](https://github.com/orgs/Frazzled-Productions/projects/1):

```
Todo → Planned → In Progress → PR → Ready to merge → Done
```

| Transition | Trigger |
|---|---|
| **Todo → Planned** | `auto-issue.yml` plan job posts the `<!-- auto-plan -->` comment |
| **Planned → In Progress** | Maintainer comments `/go`; implement job starts |
| **In Progress → PR** | Implement job opens a PR |
| **PR → Ready to merge** | `auto-review.yml` posts verdict `Looks good to me` |
| **Any open → Done** | Issue closes (via `closes #N` on merge, or manually) |

### Commands

| Comment | Where | Effect |
|---|---|---|
| `/go` | On an issue | Triggers the implement job in `auto-issue.yml` |
| `/continue` | On an issue | Resumes a halted implement run from the saved branch |
| `/split` | On an issue | Files sub-issues from the planner's **Suggested split** block |
| `/fix` | On a PR | Runs a fix cycle in `auto-pr.yml` (up to 3 cycles per PR) |

### Backlog ownership

- Backlog lives in GitHub Issues, labelled `priority:now` / `priority:next` / `priority:later`.
- The [Poké Memory roadmap](https://github.com/orgs/Frazzled-Productions/projects/1) is a kanban view over the same issues with a `Priority` field matching those labels.
- **The user owns priorities.** Don't move issues between priority labels or columns without explicit user direction.
- Issues filed from mobile (or anywhere) land on the board automatically via `auto-label.yml`.

---

## GitHub Actions catalog

### `ci.yml` — CI

| | |
|---|---|
| **Trigger** | `pull_request` (any), push to `main` |
| **Job** | `test` |
| **What it does** | `npm ci && npm run typecheck && npm run build && npm test` |
| **Required check** | The `test` job is the required status check for `main` (not the workflow name `CI`). Branch protection enforces strict-up-to-date; the bot app bypasses for auto-merges. |
| **Concurrency** | Cancels concurrent runs on the same ref — only the latest push on a branch completes. |

---

### `auto-issue.yml` — Auto Issue Worker

Handles four commands: `plan`, `implement`, `continue`, and `split`.

#### Plan job

| | |
|---|---|
| **Trigger** | Issue labeled `auto` |
| **What it does** | Invokes the `planner` sub-agent; posts `<!-- auto-plan -->` comment; moves issue to **Planned** on the project board |
| **Scope check** | Planner assesses scope (≥4 files, ≥3 surfaces, infra+logic, ≥6 acceptance criteria) and runs a coupling check before offering `/split` |
| **Salvage** | Post-step runs with `if: always()` — if the orchestrator halts before posting the plan, it salvages `/tmp/plan-body.md` to the issue |

#### Implement job

| | |
|---|---|
| **Trigger** | Maintainer (OWNER / MEMBER / COLLABORATOR) comments `/go` on an open `auto`-labelled issue |
| **Conflict gate** | Checks for `<!-- overlap-scan:i+j:conflict -->` markers linked to open issues; refuses to proceed if unresolved |
| **What it does** | Runs the orchestration playbook (plan → research → implement → review), pushes a branch, runs the build gate, opens a PR |
| **Build gate** | `npm run typecheck && npm run build && npm test` — up to 2 fix attempts before stopping without a PR |
| **Post-step** | Runs `if: always()` — salvages uncommitted edits as a `WIP: halted run on #N` commit, verifies the branch on origin before advertising `/continue`, updates the live status comment |
| **Project status** | Moves to **In Progress** on start; to **PR** when a PR opens |

#### Continue job

| | |
|---|---|
| **Trigger** | Maintainer comments `/continue` on an open `auto`-labelled issue |
| **Pre-flight** | Guards against existing open PR; parses branch name from the last `<!-- auto-status -->` comment; verifies branch exists on origin |
| **What it does** | Checks out the saved branch and resumes implementation from where it left off; follows the same workflow as implement |
| **WIP handling** | If the last commit subject starts with `WIP:`, the resumed orchestrator inspects `git diff HEAD~1` and amends or reverts before continuing |

#### Split job

| | |
|---|---|
| **Trigger** | Maintainer comments `/split` on an open `auto`-labelled issue |
| **What it does** | Parses numbered titles from the `**Suggested split:**` block in the most recent planner comment; creates a child issue per title; links as native GitHub sub-issues; inherits the parent's `priority:*` label plus `auto` |
| **Cascade** | Each child gets the `auto` label, which triggers its own plan run — the planner breaks the work down further without manual intervention |
| **Idempotency** | Posts `<!-- auto-split:N -->` marker *before* the create loop; re-runs bail when the marker exists |

---

### `auto-pr.yml` — Auto PR Fix

| | |
|---|---|
| **Trigger** | Maintainer (OWNER / MEMBER / COLLABORATOR) or `auto-review.yml` posts `/fix` on a PR |
| **Cycle cap** | 3 auto-review cycles per PR (counted by `<!-- auto-review:N -->` markers). After 3, the workflow posts a stop comment and exits. |
| **LGTM short-circuit** | Bare `/fix` on an already-approved PR does nothing — the orchestrator posts a note and stops. `/fix <inline findings>` overrides and forces a fix run using the inline body as the punch list. |
| **No-progress guard** | If a fix cycle produces zero commits, no new review is posted and the chain ends. |
| **What it does** | Reads the latest `<!-- auto-review:N -->` comment (or the inline `/fix` body), addresses findings, commits, pushes, runs `code-reviewer`, posts `<!-- auto-review:N+1 -->` |
| **Project status** | Moves to **In Progress** during the fix; to **PR** or **Ready to merge** after based on the new review verdict |

---

### `auto-review.yml` — Auto Review

| | |
|---|---|
| **Trigger** | `pull_request: [opened, reopened, labeled]` |
| **Gate** | PRs whose head branch starts with `auto/` OR which carry an `auto-review` label. Drafts are skipped. Fork PRs are explicitly excluded (`head.repo.fork == false`). For `labeled` events, only the `auto-review` label fires a run. |
| **Idempotency** | Each review comment includes `<!-- auto-review-sha:<head-sha> -->` on row 2; re-triggers at the same SHA are skipped. |
| **Auto-fix trigger** | When verdict is `Needs fixes` and the cycle count is below 3, automatically posts a `<!-- auto-review-autofix -->` `/fix` comment on the PR — which triggers `auto-pr.yml` without manual intervention. The existing cycle cap (3) and no-progress guard still hold; the auto-trigger respects both. |
| **LGTM mention** | When verdict is `Looks good to me`, the comment body includes `@fraserbrookhouse` so the maintainer receives a GitHub notification. |
| **What it does** | Runs `code-reviewer` sub-agent; posts `<!-- auto-review:N -->` comment; upgrades project status to **Ready to merge** if verdict is `Looks good to me`; auto-posts `/fix` if verdict is `Needs fixes` |
| **Check gate** | Final job step exits non-zero when the latest verdict scoped to the current head SHA is `Needs fixes` — PR checks show red until a `/fix` cycle lands an approval at a new SHA |

---

### `auto-retro.yml` — Auto Retro

| | |
|---|---|
| **Trigger** | `issues: [closed]` |
| **Skips** | Issues closed as `not_planned`; issues with no linked merged PR; issues already having an `<!-- auto-retro -->` comment |
| **What it does** | Fetches the PR diff and metadata; posts a single `<!-- auto-retro -->` comment on the closed issue covering: which sub-agents ran, what worked, what was overhead, and one transferable lesson |
| **Scope** | Process reflection only — no code change recommendations |

---

### `auto-status.yml` — Auto Status

| | |
|---|---|
| **Trigger** | `issues: [closed]` |
| **What it does** | Moves the issue to **Done** on the project board — regardless of how it was closed (PR merge, manual close, or `not_planned`) |
| **Note** | All other project-status transitions are driven from `auto-issue.yml` and `auto-pr.yml`. This workflow owns only the terminal **Done** state. |

---

### `auto-label.yml` — Auto Label

| | |
|---|---|
| **Trigger** | `issues: [opened]` |
| **What it does** | Classifies any missing label dimensions (priority / type / area) via Claude and applies them — purely additive, never removes existing labels |
| **Fallback** | If Claude doesn't produce a valid priority label, defaults to `priority:later` |
| **Effect** | Issues filed from mobile land on the project board correctly without manual triage |

---

### `issue-overlap-scan.yml` — Issue Overlap Scan

| | |
|---|---|
| **Trigger** | `workflow_dispatch` (manual only) |
| **Scope** | Only `priority:now` and `priority:next` issues |
| **Kinds** | `merge` (duplicate intent), `overlap` (same area, partial intersection), `conflict` (mutually exclusive — one blocks the other) |
| **Markers** | Posts `<!-- overlap-scan:i+j:<kind> -->` on both issues in each pair; de-dupes on exact (i, j, kind) across runs |
| **Load-bearing** | `conflict` markers are checked by `auto-issue.yml`'s implement job — `/go` refuses to run on an issue with an unresolved conflict marker linked to an open issue |

---

### `vercel-failure-autofix.yml` — Vercel Auto-fix

| | |
|---|---|
| **Trigger** | `deployment_status: failure` on branches matching `auto/issue-*` |
| **Requires** | `VERCEL_TOKEN` repo secret (Vercel personal access token scoped to the account owning the deployment). No-op when the secret is absent. |
| **What it does** | Fetches the error excerpt from Vercel's events API; posts a `/fix` comment on the PR — which triggers `auto-pr.yml`'s fix cycle |
| **Idempotency** | Skips if a `<!-- vercel-autofix -->` comment was posted on the same PR in the last 10 minutes (Vercel sometimes fires multiple `failure` events for one deployment) |

---

## Build gates

Two separate gates catch type/build/test errors at different points:

### Pre-PR gate (inside `auto-issue.yml` and `auto-pr.yml`)

Runs before opening a PR: `npm run typecheck && npm run build && npm test`

- Orchestrator is allowed up to **2 targeted fix attempts** (commit + push + retry).
- After the second failure: post a comment on the issue with the last 80 lines of build output and stop. Branch stays pushed for manual inspection.
- Goal: surface errors in the same run that produced them, before Vercel or CI finds them.

### CI gate (`ci.yml`)

Runs on every `pull_request` event and every push to `main`: the same `typecheck && build && test` triple.

- Named check: `test` (the job ID). Branch protection requires this check by name.
- Concurrent runs on the same ref are cancelled — only the latest push completes.

---

## Graceful exit & WIP salvage

When an implement (or continue) run hits its turn cap, times out, or errors mid-flight, the post-step runs with `if: always()` and:

1. **Salvage push** — if uncommitted edits exist in the working tree, stages and commits them as `WIP: halted run on #N`, then pushes to origin. This ensures `/continue` always has a branch to resume from.
2. **Status update** — PATCHes the live `<!-- auto-status -->` comment with a "Run finished" section showing outcome, branch, last commit, and recovery instructions.
3. **Recovery footer** — only advertises `/continue` when the branch is confirmed on origin via `git ls-remote`. Falls back to `/go` if the salvage push itself failed.

When resuming via `/continue`, the orchestrator checks `git log -1 --format=%s`. If the subject starts with `WIP:`, it inspects `git diff HEAD~1` and amends or reverts the WIP commit before continuing.

---

## Scope warning & `/split`

When the planner posts its plan, it assesses scope against four thresholds. When any is crossed, it appends a warning block:

| Threshold | Value |
|---|---|
| Distinct files | ≥ 4 |
| Distinct surfaces | ≥ 3 |
| Infra + logic, with files | ≥ 3 files |
| Acceptance criteria | ≥ 6 |

Before offering `/split`, the planner runs a **coupling check** — it sketches the boundary between proposed children and checks whether they would share surface area (same symbol name, same `localStorage` key or DB table, same leaf module directory, or same file). If coupling is found, `/split` is **not** offered; the warning still fires but the recommendation is to proceed as a single issue.

When children are cleanly independent, the warning includes a numbered **Suggested split** block. Commenting `/split` triggers the split job (see [auto-issue.yml](#auto-issueyml--auto-issue-worker) above).

---

## Retrospectives

After each merged PR, `auto-retro.yml` posts a `<!-- auto-retro -->` comment on the closed issue covering:
- **Agents used** — which sub-agents ran
- **What worked** — specific evidence (review finding, planner question that surfaced a risk)
- **What didn't / overhead** — where a round-trip cost more than it returned
- **Lesson** — one transferable rule for future changes

Retros are process reflection only — no code change recommendations. Aggregating patterns across retros into convention (promoting to `AGENTS.md`) is left manual; if a lesson recurs across several retros, add it to `AGENTS.md` by hand.
