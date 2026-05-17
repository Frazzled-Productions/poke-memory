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
| [pokeapi-expert](.claude/agents/pokeapi-expert.md) | PokéAPI endpoint selection, schemas, caching strategy — low-frequency: the dataset is build-time-seeded, so invoke only when changing the seed script or adding a data category | Yes |
| [srs-expert](.claude/agents/srs-expert.md) | Spaced-repetition algorithm design and implementation | No |
| [supabase-expert](.claude/agents/supabase-expert.md) | Supabase Auth + RLS + schema design for persisted user data (currently FSRS scheduling state on `card_reviews`, plus `streak_days`, `user_settings`, `grade_log`) | Yes |
| [researcher](.claude/agents/researcher.md) | Generalist investigation that doesn't fit a specialist | Yes |
| [ui-coder](.claude/agents/ui-coder.md) | Pages, layouts, components, styling | No |
| [data-coder](.claude/agents/data-coder.md) | API routes, Server Actions, persistence, integrations | No |
| [playwright](.claude/agents/playwright.md) | E2E smoke tests after user-facing changes; owns `e2e/**` | No |
| [code-reviewer](.claude/agents/code-reviewer.md) | Independent diff review at the end of a change | Yes |
| [privacy-expert](.claude/agents/privacy-expert.md) | Data-protection / compliance advice — GDPR/UK-GDPR controller obligations, Children's Code, PECR/cookies, privacy notice + Terms drafting, DPIA upkeep, sub-processor classification | Yes |
| [workflow-expert](.claude/agents/workflow-expert.md) | Reviews GitHub Actions / orchestration changes — idempotency markers, salvage patterns, fork-PR guard, cycle caps | Yes |

---

## Orchestration playbook

The main agent (Claude in the user's session) orchestrates. Coder agents do not call other agents directly — they receive research findings via the prompt.

Standard flow for non-trivial work:

1. **Plan** — invoke `planner`. It surfaces unknowns tagged as `[EXPERT-RESEARCH]`, `[USER-DECISION + RESEARCH]`, or `[USER-DECISION]`.
2. **Research in parallel** — dispatch specialists (`next16-expert`, `pokeapi-expert`, `srs-expert`, `researcher`) in a single message when their questions are independent. Fold answers into the plan.
3. **Implement** — invoke `ui-coder` and/or `data-coder` with full context (research findings + spec). Run in parallel when their work is independent.
4. **E2E** — if the change is user-facing, invoke `playwright` to add or update E2E smoke tests. Pass the diff summary and affected pages.
5. **Review** — invoke `code-reviewer` at the end. Iterate on its punch list.

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
| `/replan` | On an issue | Re-runs the plan job against the current tree; use after a staleness gate refusal |
| `/fix` | On a PR | Runs a fix cycle in `auto-pr.yml` (up to 3 cycles per PR) |
| `/resolve` | On a PR | Merges the PR's base branch (`qa` or `main`), resolves conflicts via Claude, runs build gate, pushes (`auto-resolve.yml`) |

### Backlog ownership

- Backlog lives in GitHub Issues, labelled `priority:now` / `priority:next` / `priority:later`.
- The [Poké Memory roadmap](https://github.com/orgs/Frazzled-Productions/projects/1) is a kanban view over the same issues with a `Priority` field matching those labels.
- **The user owns priorities.** Don't move issues between priority labels or columns without explicit user direction.
- Issues filed from mobile (or anywhere) are labelled manually or by the workflow that created them (e.g. `auto-app-suggest.yml` applies all three label dimensions at creation).

---

## Branching model — qa staging flow

`main` is strict and production-tracked; `qa` is the integration branch where batch work is bundled and QA-tested before promotion (#806).

```
Batch PRs ─▶ qa ─▶ (preview deploy + maintainer QA) ─▶ qa→main PR ─▶ main ─▶ release + production
```

| Branch | Ruleset | Who PRs into it |
|---|---|---|
| `main` | `main-protection` — strict-up-to-date; required checks `test`, `e2e`, `Check version bump approval`, `Restrict main PR source` | Only `qa`. A non-`qa` PR needs the `hotfix` label. |
| `qa` | `qa-staging` — required checks `test`, `e2e`; **not** strict-up-to-date. Bypass actors: `poke-memory-bot` and the repo admin role. | `/batch-issues`, the `auto` pipeline, and one-off feature branches. |

**Why `qa` exists.** `main`'s strict-up-to-date rule forces every queued PR to rebase + re-run CI one at a time — the serial-rebase tax. A GitHub merge queue would remove it but is unavailable for personal-account repos (#797). `qa` is non-strict, so `/batch-issues` merges PRs back-to-back with no rebase tax, then promotes the bundled result to `main` in a single PR.

**The flow:**

1. `/batch-issues` opens each batch PR against `qa` and drains them straight in (no rebase tax).
2. At end of drain it fires `qa-preview-deploy.yml` (a Vercel preview of `qa`) and opens a **draft** `qa -> main` PR carrying every `Closes #N`.
3. The maintainer tests the preview, marks the draft ready, and merges `qa -> main`. The full required suite runs against strict `main`.
4. The merge triggers `auto-release.yml`: it cuts the release, pushes the `[skip ci]` release commit to `main` (Vercel deploys production), then resets `qa` to `main` so the next batch starts clean.

**Hotfix bypass.** A genuine hotfix can skip `qa` by opening a PR straight into `main` with the `hotfix` label — `main-pr-source-gate.yml` checks for it. Only the repo owner applies the label.

**Managing `qa`.** `qa` is the loose branch: the repo admin role and `poke-memory-bot` are bypass actors on the `qa-staging` ruleset, so the owner can fast-forward or reset `qa` directly (the `/batch-issues` pre-flight relies on this) and `auto-release.yml` can force-push the post-release reset. `main-protection` has no owner bypass — `main` stays strict for everyone.

**Note on `closes #N`.** GitHub auto-closes a linked issue only when the PR merges into the *default* branch. A batch PR merged into `qa` does not close its issue; the `qa -> main` promotion PR carries the aggregated `Closes #N` lines and closes them all on merge.

---

## GitHub Actions catalog

### `ci.yml` — CI

| | |
|---|---|
| **Trigger** | `pull_request` (any), push to `main` |
| **Jobs** | `changes` (path classification), `test` (`typecheck && build && test`), `e2e-browser` (Playwright matrix — `chromium` + `mobile-safari` legs run in parallel inside the official Playwright container), `e2e` (aggregator over the matrix legs) |
| **What it does** | `test` runs `npm ci && npm run typecheck && npm run build && npm test`. `e2e-browser` runs the Playwright smoke suite split by browser project so the two projects run as parallel matrix legs (#643). The `changes` job classifies the PR so `test`/`e2e` inner steps no-op on docs-only changes. |
| **Required checks** | `test` and `e2e` are `ci.yml`'s two required status checks (not the workflow name `CI`); `main`'s full required set also includes `Check version bump approval` and `Restrict main PR source` (see Branching model). `e2e` is a thin aggregator over the `e2e-browser` matrix, so the required-check name stays stable when matrix legs are added or renamed. The `qa` ruleset requires only `test` + `e2e`. `main-protection` enforces strict-up-to-date; the bot app bypasses for auto-merges. |
| **Concurrency** | Cancels concurrent runs on the same ref — only the latest push on a branch completes. |

---

### `version-bump-gate.yml` — Version bump gate

| | |
|---|---|
| **Trigger** | `pull_request` (opened, synchronize, reopened, labeled, unlabeled) |
| **Job** | `gate` |
| **What it does** | Scans `changelog.d/unreleased/*.md` frontmatter for `kind: minor-bump` or `kind: major-bump`. If found and the PR lacks the `version-bump:approved` label, the job fails. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard — fork contributors cannot apply the label, so running on fork PRs would produce an unresolvable failure). |
| **Required check** | Yes — `Check version bump approval` is a required status check on the `main-protection` ruleset. |
| **Concurrency** | Cancels concurrent runs on the same PR. |

---

### `main-pr-source-gate.yml` — Main PR source gate

| | |
|---|---|
| **Trigger** | `pull_request` into `main` (opened, synchronize, reopened, labeled, unlabeled) |
| **Job** | `gate` (check name `Restrict main PR source`) |
| **What it does** | Fails any PR into `main` whose head branch is not `qa`, unless the PR carries the `hotfix` label. Enforces the qa staging flow — `main` only takes promotion PRs from `qa`. |
| **Hotfix bypass** | The `hotfix` label lets a non-`qa` PR through. Same approval pattern as `version-bump:approved`; only the repo owner applies it. A `labeled` event re-runs the gate so adding the label to an open PR clears it. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard — same pattern as `version-bump-gate.yml`). |
| **Required check** | Yes — `Restrict main PR source` is a required status check on the `main-protection` ruleset. |
| **Concurrency** | Cancels concurrent runs on the same PR. |

---

### `migration-check.yml` — Migration drift check

| | |
|---|---|
| **Trigger** | `pull_request` touching `db/migrations/**`, `scripts/check-migrations.mjs`, or the workflow file itself; push to `main` |
| **Job** | `check` |
| **What it does** | Runs `scripts/check-migrations.mjs`, which lists files in `db/migrations/` (excluding the bootstrap `001_initial_sync_schema.sql`), calls the Supabase Management API to list applied migrations, and exits non-zero if any committed file is not in the applied list |
| **Required secrets** | `SUPABASE_ACCESS_TOKEN` (Supabase PAT with read access), `SUPABASE_PROJECT_REF` (dashboard slug, e.g. `nvxvvtvnthsgdxgksmju`). Both must be set as repo secrets before the workflow can run; without them the script exits 2 with a clear error. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard — same pattern as `auto-review.yml`). No secrets exposed. |
| **Required check** | No — informational. Failure flags the gap; the recovery action is to run `mcp__supabase__apply_migration` against the named file. |
| **Concurrency** | Cancels concurrent runs on the same ref. |

---

### `e2e.yml` — E2E

| | |
|---|---|
| **Trigger** | `deployment_status` (Vercel webhook) |
| **Gate** | Runs only when: deployment state is `success`, environment is not `Production`, and creator is `vercel[bot]` |
| **Job** | `playwright` |
| **What it does** | Installs chromium + webkit, runs Playwright smoke tests against the Vercel preview URL (`deployment_status.target_url`), uploads the HTML report as an artifact (14-day retention) |
| **Required check** | No — non-blocking. Promote to required once flake rate is proven stable. |
| **Concurrency** | Serialized per deployment ID (`cancel-in-progress: false`) |
| **Scope** | Guest-mode flows, plus signed-in UI flows via the mock-auth seam (see below). Page loads, navigation, card flip, grade buttons, key sections on Stats / Pokédex / Settings; the signed-in avatar / sign-out / nav, the conflict picker, and the superuser cloud-write-guard surfaces. |

#### Mock-auth seam (E2E)

`e2e/auth.spec.ts` exercises the **signed-in** UI in a real browser without a
real OAuth handshake (issue #751, Option 2 of #742). It relies on a test-only
seam in `lib/auth/mockAuth.ts` that makes `AuthProvider` return a hard-coded
fake `User` plus a fake `SupabaseClient` whose `.from()` calls resolve from an
in-memory fixture.

- **Activation**: the seam activates only when `NEXT_PUBLIC_E2E_AUTH_MOCK === "1"`
  AND `process.env.NODE_ENV !== "production"`. Both conditions are checked by
  `isMockAuthEnabled()`.
- **Deployment wiring**: `NEXT_PUBLIC_*` vars are inlined at **build time** when
  accessed as a literal static member expression (`process.env.NEXT_PUBLIC_…`);
  `isMockAuthEnabled()` and `assertMockAuthNotInProduction()` use that literal
  form so a production bundle dead-code-eliminates the mock branch. The seam is
  enabled by setting `NEXT_PUBLIC_E2E_AUTH_MOCK=1` in the Vercel project's
  **Preview** environment scope (Preview only — **never** Production).
  `e2e.yml` also sets the var on the Playwright runner as a documented
  companion; the specs in `e2e/auth.spec.ts` detect at runtime whether the seam
  is live and skip themselves if it is not, so a preview built without the
  Preview-scoped var simply skips the auth specs rather than failing.
- **Production safety**: the seam is provably unreachable in production.
  `isMockAuthEnabled()` short-circuits on `NODE_ENV === "production"`, and
  `next.config.ts` calls `assertMockAuthNotInProduction()` which fails the
  build loudly if the flag is ever set in a production build.
  `lib/auth/mockAuth.test.ts` asserts both guards.

---

### `coverage.yml` — Coverage

| | |
|---|---|
| **Trigger** | `pull_request` (any), `workflow_dispatch` |
| **Job** | `coverage` |
| **What it does** | Runs `npm ci && npm run test:coverage` (vitest v8 provider), enforces two coverage gates, then posts the coverage summary (statements / branches / functions / lines) plus the diff-coverage result as a PR comment. The comment is keyed on the `<!-- coverage-report -->` HTML marker, so re-runs update the existing comment instead of posting duplicates (same idempotency pattern as `pr-check-monitor.yml`). The comment posts on both pass and fail. |
| **Gates (#824)** | **Global floor** — `coverage.thresholds` in `vitest.config.ts` (Statements 64 / Branches 59 / Functions 55 / Lines 65, just below the measured baseline). `vitest run --coverage` exits non-zero if overall coverage regresses. **Diff coverage** — `scripts/diff-coverage.mjs` cross-references the PR's added/changed lines against the v8 per-statement hit counts in `coverage/coverage-final.json` and requires changed product lines to hit an 80% patch bar. The coverage step no longer carries `continue-on-error`; either gate failing fails the job. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard — fork PRs run with a read-only token and cannot post comments). |
| **Required check** | Not yet — the gates fail the job, but `coverage` must still be added as a required check on the `qa` and `main` rulesets (owner action) before a breach blocks merge. Until then the job goes red without blocking. (Originally non-blocking by design under #762; gated under #824.) |
| **Concurrency** | Cancels concurrent runs on the same ref. |

---

### `codeql.yml` — CodeQL

| | |
|---|---|
| **Trigger** | `pull_request` (opened, synchronize, reopened); push to `main`; weekly `schedule` (`0 9 * * 1` — Monday 09:00 UTC) |
| **Job** | `analyze` |
| **What it does** | Runs GitHub's CodeQL security scan over the `javascript-typescript` language pack with the `security-extended` query suite. No `autobuild` step — CodeQL v3 source-traces JS/TS without a build, keeping the scan fast; generated `.next/` output is out of scope. The weekly cron catches newly-published CVEs and dependency drift that no push would otherwise trigger. |
| **Permissions** | `security-events: write` (uploads results to the Security tab), `contents: read`, `actions: read`. |
| **Concurrency** | Scheduled runs get a per-`run_id` group with `cancel-in-progress: false`, so a push to `main` during the weekly window cannot cancel the scan. Push and PR runs share a per-event-type+ref group and may cancel stale siblings. |

---

### `integration-tests.yml` — Integration Tests

| | |
|---|---|
| **Trigger** | `pull_request` (opened, synchronize, reopened, labeled); `workflow_dispatch` |
| **Jobs** | `decide` (gate), `integration` |
| **What it does** | The `decide` job runs on every PR and uses `dorny/paths-filter` to check whether the PR touches the cloud-write surface (`lib/sync/**`, `app/api/sync/**`, `db/migrations/**`, `lib/gradelog/**`, or this workflow file). If a path matches, the PR carries the `integration-tests` label, or the run is a manual dispatch, the `integration` job runs the DB-backed suite (`npm run test:integration`) against a `postgres:15` service container — migration apply, RLS isolation, and the regression trigger. No Supabase API calls, no branch quota. |
| **Why a gate job** | A bare `on.pull_request.paths:` filter would also filter out `labeled` events on PRs that don't touch the paths, breaking the label escape hatch. The cheap `decide` job combines "paths OR label" so the opt-in label still works. |
| **Required check** | No — `integration` is not a required status check, so PRs outside the path filter simply don't run it and aren't blocked. |
| **Concurrency** | Cancels concurrent runs on the same ref. |

---

### `auto-issue.yml` — Auto Issue Worker

Handles five commands: `plan`, `implement`, `continue`, `split`, and `replan`.

#### Plan job

| | |
|---|---|
| **Trigger** | Issue labeled `auto` |
| **What it does** | Invokes the `planner` sub-agent; posts `<!-- auto-plan -->` comment; moves issue to **Planned** on the project board |
| **Scope check** | Planner assesses scope (≥4 files, ≥3 surfaces, infra+logic, ≥6 acceptance criteria) and runs a coupling check before offering `/split` |
| **Overlap annotation** | If the issue has `<!-- overlap-scan:i+j:<kind> -->` markers, the orchestrator extracts the verbatim reason from each marker's comment body and passes the list to the planner, which appends a `**Related issues:**` section to the plan (one `- #<num> (<kind>): <reason>` line per linked issue) — informational only |
| **Salvage** | Post-step runs with `if: always()` — if the orchestrator halts before posting the plan, it salvages `/tmp/plan-body.md` to the issue |

#### Implement job

| | |
|---|---|
| **Trigger** | Maintainer (OWNER / MEMBER / COLLABORATOR) comments `/go` on an open `auto`-labelled issue |
| **Conflict gate** | Checks for `<!-- overlap-scan:i+j:conflict -->` markers linked to open issues; refuses to proceed if unresolved |
| **Staleness gate** | Parses `<!-- plan-meta: base=<sha> files=<list> -->` from the most recent `<!-- auto-plan -->` comment; runs `git diff --name-only <base>..origin/qa -- <files>` (implement PRs target `qa`); non-empty intersection → posts a comment naming the conflicting files and the commits that touched them, then exits 1. Missing `plan-meta` (older plans) → warning only, proceeds. Empty `files=` → proceeds. Comment `/replan` to recover. |
| **What it does** | Runs the orchestration playbook (plan → research → implement → review), pushes a branch, runs the build gate, opens a PR **into `qa`** (the staging branch — `main` only takes promotion PRs) |
| **Build gate** | `npm run typecheck && npm run build && npm test` — up to 2 fix attempts before stopping without a PR |
| **Git credential** | `claude-code-action` URL-embeds the App installation token (passed via `github_token:`) into the origin remote, so subprocess pushes authenticate as `poke-memory-bot` and CI fires on the resulting `synchronize` events. Do NOT add a `git config --global http.https://github.com/.extraheader` step in front of the action — that layers a Bearer header on top of the URL-embedded Basic auth, GitHub rejects the dual-auth request, and the action's internal `git fetch origin main --depth=1` fails before Claude is invoked. |
| **Post-step** | Runs `if: always()` — salvages uncommitted edits as a `WIP: halted run on #N` commit, verifies the branch on origin before advertising `/continue`, updates the live status comment |
| **Project status** | Moves to **In Progress** on start; to **PR** when a PR opens |

#### Continue job

| | |
|---|---|
| **Trigger** | Maintainer comments `/continue` on an open `auto`-labelled issue |
| **Pre-flight** | Guards against existing open PR; parses branch name from the last `<!-- auto-status -->` comment; verifies branch exists on origin |
| **What it does** | Checks out the saved branch and resumes implementation from where it left off; follows the same workflow as implement |
| **Git credential** | Same as the implement job — `claude-code-action`'s URL-embedded App token handles subprocess pushes. No global git credential step. |
| **WIP handling** | If the last commit subject starts with `WIP:`, the resumed orchestrator inspects `git diff HEAD~1` and amends or reverts before continuing |

#### Split job

| | |
|---|---|
| **Trigger** | Maintainer comments `/split` on an open `auto`-labelled issue |
| **What it does** | Parses numbered titles from the `**Suggested split:**` block in the most recent planner comment; creates a child issue per title; links as native GitHub sub-issues; inherits the parent's `priority:*` label plus `auto` |
| **Cascade** | Each child gets the `auto` label, which triggers its own plan run — the planner breaks the work down further without manual intervention |
| **Idempotency** | Posts `<!-- auto-split:N -->` marker *before* the create loop; re-runs bail when the marker exists |

#### Replan job

| | |
|---|---|
| **Trigger** | Maintainer comments `/replan` on an open `auto`-labelled issue |
| **What it does** | Mirrors the plan job — invokes `planner`, posts a fresh `<!-- auto-plan -->` comment, moves issue to **Planned** |
| **Use case** | Recovery after a staleness gate refusal (`/go` blocked because `origin/qa` moved into planned files); also useful when scope has changed since the original plan |
| **Overlap annotation** | Same as plan job — overlap-scan markers are parsed and passed to the planner, which appends a `**Related issues:**` section to the plan |
| **Salvage** | Same `if: always()` post-step as the plan job |

---

### `auto-pr.yml` — Auto PR Fix

| | |
|---|---|
| **Trigger** | Maintainer (OWNER / MEMBER / COLLABORATOR), or the `poke-memory-bot` GitHub App, posts `/fix` on a PR |
| **Cycle cap** | 3 auto-review cycles per PR (counted by `<!-- auto-review:N -->` markers). After 3, the workflow posts a stop comment and exits. |
| **LGTM short-circuit** | Bare `/fix` on an already-approved PR does nothing — the orchestrator posts a note and stops. `/fix <inline findings>` overrides and forces a fix run using the inline body as the punch list. |
| **CI pre-flight** | Before the agent runs, a bash step fetches the PR's `statusCheckRollup` for the `test` check and sets `CI_FAILING_AT_HEAD=true` in the environment when CI is currently failing. The agent prompt checks this env var first: if `true`, the LGTM short-circuit is bypassed unconditionally, and the CI error excerpt in `FIX_COMMENT_BODY` becomes the punch list. This prevents the race where a queued fix run inherits a stale LGTM verdict from a previous cycle. |
| **Review producer** | `auto-pr.yml` does **not** run `code-reviewer` or post an `<!-- auto-review:N -->` comment itself. It addresses findings, commits, and pushes — and stops. The push fires `auto-review.yml` on `synchronize`, which is the **single** review producer: it reviews the resulting diff, posts the next `auto-review:N` comment, and kicks the next `/fix` if needed. Previously both workflows posted reviews, racing to compute the same `N` and producing duplicate `auto-review:N` comments with conflicting verdicts (and a corrupted cycle counter). |
| **No-progress guard** | If a fix cycle produces zero commits, nothing is pushed — no `synchronize` event fires, so no new review runs and the chain ends. |
| **What it does** | Reads the latest `<!-- auto-review:N -->` comment (or the inline `/fix` body), addresses findings, commits, and pushes. The run ends at the push; `auto-review.yml` reviews the pushed commit. |
| **Git credential** | `actions/checkout` writes the App token to the repo-local `.git/config`. `claude-code-action`'s `git-config.ts` then unsets that local extraheader and embeds the App token directly in the remote URL (`https://x-access-token:${TOKEN}@github.com/...`), so subprocess fetches and pushes authenticate as `poke-memory-bot`. No global git credential is set: doing so injects a second `Authorization` header (Bearer) on top of the URL-embedded Basic auth, which GitHub rejects, and the action's `git fetch origin main --depth=1` step fails before Claude is invoked. |
| **Project status** | Moves to **In Progress** during the fix. The post-fix **PR** / **Ready to merge** transition is owned by `auto-review.yml` when it reviews the pushed commit. |

---

### `auto-resolve.yml` — Auto Resolve

| | |
|---|---|
| **Trigger** | Maintainer (OWNER / MEMBER / COLLABORATOR) or `poke-memory-bot` posts `/resolve` on an open PR |
| **Fork guard** | Fork PRs are excluded — `isCrossRepository` is fetched via `gh pr view` and the job bails early if true |
| **Pre-flight** | Retries `mergeableState` up to 3× while `UNKNOWN` (posts a warning comment if still `UNKNOWN` after 3 retries); exits with a comment if already `CLEAN` |
| **Fast-path** | If merging the PR's base branch (`origin/<base>`) cleanly succeeds, runs the build gate (`typecheck` / `build` / `test`), then pushes and posts `<!-- auto-resolve:N -->` — no Claude invocation |
| **Conflict path** | Claude resolves each conflicted file; reads both sides + recent main history per file; bails if any file is under `lib/srs/`, `db/migrations/`, or is `next.config.ts`, or if more than 5 files conflict |
| **Build gate** | `npm run typecheck && npm run build && npm test` — two attempts. On second failure, posts last 80 lines of output and stops without pushing |
| **Idempotency** | `<!-- auto-resolve:N -->` marker (N = count of existing resolve comments + 1) is posted in the summary; concurrent `/resolve` comments queue via `cancel-in-progress: false` and the second run finds a clean PR |
| **What it does** | Merges the PR's base branch (`qa` for staged work, `main` for hotfixes) into the PR branch, resolves conflicts, runs the build gate, pushes, and posts an `<!-- auto-resolve:N -->` summary listing each conflicted file and how it was resolved |

---

### `auto-review.yml` — Auto Review

| | |
|---|---|
| **Trigger** | `pull_request: [opened, synchronize, reopened, ready_for_review]` |
| **Gate** | Skip-list (inverted from the earlier allow-list — see #469): drafts, fork PRs (`head.repo.fork == false`), base branches other than `main` or `qa`, the `qa -> main` promotion PR (`head.ref == 'qa'`), Dependabot PRs, `chore(release):` titles, and `[skip ci]` in the title or body are all skipped. So it reviews PRs into `qa` (one-off and `auto`-pipeline PRs) and into `main` (hotfixes). `/batch-issues` disables the workflow during its drain, since batch PRs get the in-session `code-reviewer` instead (#814). |
| **Single review producer** | `auto-review.yml` posts every `auto-review:N` comment — the first review on PR open and every follow-up review after a `/fix` push (which arrives as a `synchronize` event). `auto-pr.yml` only fixes and pushes; it never posts a review. This is the design that removes the duplicate-post race. |
| **Cycle-aware review** | First review (no prior `auto-review:N` comments) reviews the full diff. A follow-up review of a `/fix` push verifies the prior Blocker/Concern findings are resolved and flags only genuine **new** regressions the fix introduced — it does not re-scan untouched code for fresh nitpicks or escalate severities, so the bar does not drift between cycles. |
| **Severity calibration** | `Blocker` / `Concern` / `Nit` / `Praise`, calibrated strictly: `Concern` is reserved for real correctness/security/convention problems in the changed code; hypothetical, pre-existing, or stylistic items are `Nit`. A `Needs fixes` verdict needs at least one Blocker or Concern, so over-tagging Nits as Concerns is what burns extra fix cycles. |
| **Idempotency** | Each review comment includes `<!-- auto-review-sha:<head-sha> -->` on row 2; re-triggers at the same SHA are skipped. |
| **Auto-fix trigger** | When verdict is `Needs fixes` and the cycle count is below 2 (i.e. there is at most one existing auto-review), automatically posts a `<!-- auto-review-autofix:N -->` `/fix` comment (N = the new review number) — which triggers `auto-pr.yml` without manual intervention. The marker is cycle-specific, so idempotent re-runs skip a duplicate post. The existing cycle cap (3) and no-progress guard still hold. |
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

### `qa-issue-label.yml` — QA Issue Label

| | |
|---|---|
| **Trigger** | `pull_request: [closed]`, guarded to merged PRs only |
| **Job** | `label` (check name `Label referenced issues`) |
| **What it does** | Bridges the gap left by GitHub auto-closing `closes #N` issues only on the default branch. When a PR merges into `qa`, it parses the PR body and commit messages for `closes/fixes/resolves #N` keywords and adds the `status:in-qa` label to each referenced issue — a board signal that the work is done and staged. When the `qa -> main` promotion PR merges (`base: main`, `head: qa`), GitHub auto-closes those issues on `main`, so this run strips the now-stale `status:in-qa` label for tidiness. |
| **Label creation** | The `status:in-qa` label (colon-namespaced, consistent with `priority:*`) is created idempotently on first run via `gh label create ... \|\| true`. The workflow owns the label — it is not created by hand. |
| **Scope** | Label only. Project-board column transitions are deliberately left to `auto-status.yml`; this workflow never touches board columns. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard — same pattern as `auto-review.yml`; fork PRs run with a read-only token and cannot edit issue labels). |
| **Idempotency** | `gh label create ... \|\| true` no-ops once the label exists; `--add-label` / `--remove-label` are idempotent by nature, so a re-run changes nothing. |
| **Required check** | No — board hygiene only, does not gate merge. |
| **Concurrency** | Serialized per PR (`cancel-in-progress: false`). |

---

### `pr-check-monitor.yml` — PR Check Monitor

| | |
|---|---|
| **Trigger** | `schedule: '*/15 * * * *'` (every 15 minutes); `workflow_dispatch` |
| **What it does** | Lists all open, non-draft, non-fork PRs older than 20 minutes and calls `GET /repos/{owner}/{repo}/commits/{sha}/check-runs?check_name=test` for each. If no check run exists (CI was never dispatched), posts a `<!-- pr-check-monitor:{sha} -->` comment on the PR with recovery instructions. |
| **Dedup** | The SHA-scoped HTML marker prevents duplicate alerts on the same HEAD commit. Re-running on a healthy PR (CI dispatched) produces no comment. |
| **Why schedule?** | `schedule`-triggered workflows operate on GitHub's internal cron queue, independently of webhook dispatch — they continue firing even when `push`/`pull_request` event dispatch is throttled. |
| **Permissions** | `contents: read`, `pull-requests: write`. `GITHUB_TOKEN` only — no Claude, no App token. |
| **Recovery time** | A stuck PR typically receives an alert within 30 minutes of the 20-minute threshold passing (15-minute cron interval plus GitHub cron jitter, which can exceed 15 minutes under load). |

---

### `cron-health-monitor.yml` — Cron Health Monitor

| | |
|---|---|
| **Trigger** | `schedule: '0 10 * * 1'` (weekly, Monday 10:00 UTC); `workflow_dispatch` |
| **What it does** | For each cron-driven workflow (`auto-release`, `refresh-user-count`, `monitor-grade-log-divergence`, and the four weekly digests `auto-workflow-suggest` / `auto-codequality-suggest` / `auto-app-suggest` / `auto-backlog-groom`), calls `gh run list --workflow=<file> --event schedule --branch <default-branch>` and checks (a) a scheduled run exists within the expected interval (48h for daily workflows, 240h for weekly) and (b) the most recent completed run succeeded — any non-`success`/`skipped` conclusion (`failure`, `timed_out`, `startup_failure`, `cancelled`) counts as unhealthy. On a stale or unhealthy workflow it opens or updates a per-workflow tracking issue. If the `gh run list` call itself errors (transient GitHub API failure), that workflow is skipped for the run rather than treated as stale, so an outage cannot spam a tracking issue for every monitored workflow at once. |
| **Dedup** | A `<!-- cron-health-monitor:{file} -->` HTML marker keyed by workflow filename gives each watched workflow its own tracking issue. Re-runs edit that issue in place and add a re-check comment rather than opening duplicates. When a workflow recovers, the monitor closes its tracking issue automatically. |
| **Why schedule?** | The monitor runs on GitHub's internal cron queue, independently of the workflows it watches — so it still fires even if those workflows have stopped. It cannot detect its own staleness, but the blast radius of one un-monitored monitor is small. |
| **Permissions** | `contents: read`, `actions: read`, `issues: write`. `GITHUB_TOKEN` only — no Claude, no App token, no app checkout. |
| **Why monitor cron workflows?** | GitHub disables scheduled workflows after 60 days of repo inactivity, and a malformed cron or an expired secret can silently stop a workflow firing — none of which produces an alert on its own. `pr-check-monitor` watches open PRs; this watches the schedule-driven workflows themselves. |

---

### `issue-overlap-scan.yml` — Issue Overlap Scan

| | |
|---|---|
| **Trigger** | Issues labeled `auto`; `workflow_dispatch` (manual) |
| **Scope** | Only `priority:now` and `priority:next` issues |
| **Kinds** | `merge` (duplicate intent), `overlap` (same area, partial intersection), `conflict` (mutually exclusive — one blocks the other) |
| **Markers** | Posts `<!-- overlap-scan:i+j:<kind> -->` on both issues in each pair; de-dupes on exact (i, j, kind) across runs |
| **Load-bearing** | `conflict` markers are checked by `auto-issue.yml`'s implement job — `/go` refuses to run on an issue with an unresolved conflict marker linked to an open issue |
| **Plan annotation** | When overlap-scan markers exist on an issue, the plan-job and replan-job append a `**Related issues:**` section to the plan body (one line per linked issue, format `#<num> (<kind>): <reason>`) — informational only, does not affect scope decisions |

---

### `auto-workflow-suggest.yml` — Weekly Workflow Digest

| | |
|---|---|
| **Trigger** | Weekly cron Monday 09:00 UTC + `workflow_dispatch` |
| **Idempotency key** | ISO week string in issue title (`Weekly workflow review — YYYY-Www`). Checks all states (open + closed). |
| **Inputs** | Retro comments (last 30d), PR review comments on `auto/*` PRs (last 30d), WIP-salvage commits (last 30d), agent invocation patterns in merged PR bodies |
| **Output** | One digest issue per ISO week, ≤5 curated items, each with evidence links and a priority label recommendation |
| **No-op** | Skips silently when nothing crosses the relevance threshold or when a digest issue already exists for the week |
| **Scope** | Only proposes changes to `.github/workflows/**`, `.claude/agents/**`, `WORKFLOW.md`, or `AGENTS.md` — never app code or individual issue filings |
| **Label** | Digest issue is labelled `area:workflow`; label is created if absent |

---

### `auto-codequality-suggest.yml` — Weekly Code-Quality Digest

| | |
|---|---|
| **Trigger** | Weekly cron Wednesday 09:00 UTC + `workflow_dispatch` |
| **Idempotency key** | ISO week string in issue title (`Weekly code-quality review — YYYY-Www`). Checks all states (open + closed). |
| **Inputs** | Files changed in `app/**`, `components/**`, `lib/**`, `db/**` in the last 30 days |
| **Signal constraints** | A — Recency filter (only recently-changed files); B — Recurrence filter (only patterns spanning ≥2 files) |
| **Output** | One digest issue per ISO week, ≤5 curated items, each with file paths, a concrete evidence snippet, and a `- [ ] File this as an issue <!-- proposal:N -->` checkbox |
| **No-op** | Skips silently when nothing crosses the recurrence threshold or when a digest issue already exists for the week |
| **Scope** | Tech debt, missing tests, dead code, and accessibility gaps within `app/**`, `components/**`, `lib/**`, or `db/**` — never workflow files, feature ideas, or individual issue filings |
| **Label** | Digest issue is labelled `area:app`; label is created if absent |

---

### `auto-app-suggest.yml` — Weekly Feature Ideas Digest

| | |
|---|---|
| **Trigger** | Weekly cron Thursday 09:00 UTC + `workflow_dispatch` |
| **Idempotency key** | ISO week string in issue title (`Weekly feature ideas — YYYY-Www`). Checks all states (open + closed). |
| **Inputs** | Open enhancement issues (clusters/gaps); user-facing pages under `app/**/page.tsx` and `components/**`; README "Features" section vs. codebase; last 3 CHANGELOG releases; latest `auto-workflow-suggest` digest (UX themes) |
| **Output** | One digest issue per ISO week, ≤5 proposals, each with surface, why-it-matters, priority, and a `- [ ] File this as an issue <!-- proposal:N -->` checkbox |
| **No-op** | Skips silently when nothing crosses the bar or when a digest issue already exists for the week |
| **Scope** | User-facing behaviour changes only — explicitly forbids refactors, test additions, dead-code removal, dependency bumps, accessibility gaps, and CI/workflow changes |
| **Labels** | Digest issue is labelled `area:app`, `enhancement`, `priority:later`; labels are created if absent |

---

### `auto-digest-fanout.yml` — Digest Fan-out

| | |
|---|---|
| **Trigger** | `issues: [edited]` |
| **Guard** | Issue body contains `<!-- auto-codequality-suggest -->` or `<!-- auto-app-suggest -->` |
| **Permissions** | `issues: write` only — never touches the git tree |
| **Concurrency** | `digest-fanout-{issue}`, `cancel-in-progress: false` — queues runs, never cancels, so each re-trigger after a body PATCH does a fast no-op |
| **What it does** | For each proposal whose `- [ ] File this as an issue <!-- proposal:N -->` checkbox is newly checked: extracts the title and `**Priority:**` label, creates a child issue (with `area:app` and the extracted priority, never `auto`), writes ` → filed as #N` onto the proposal heading as an idempotency marker, then posts a single summary comment on the parent |
| **Idempotency** | The `→ filed as #N` back-marker on the heading is the source of truth — checked proposals that already carry a marker are skipped unconditionally |
| **Un-check behaviour** | Un-checking a filed proposal does NOT close or delete the child — manual cleanup only (out of scope for v1) |
| **Auth** | `actions/create-github-app-token@v3` with `vars.BOT_APP_ID` / `secrets.BOT_APP_PRIVATE_KEY` |

---

### `auto-backlog-groom.yml` — Weekly Backlog Grooming Digest

| | |
|---|---|
| **Trigger** | Weekly cron Friday 09:00 UTC + `workflow_dispatch` |
| **Idempotency key** | ISO week string in issue title (`Weekly backlog grooming — YYYY-Www`). Checks all states (open + closed). |
| **Inputs** | All open issues across `priority:now`, `priority:next`, `priority:later`; comment threads for retro signals, blocking cross-references, and overlap-scan conflict markers |
| **Staleness thresholds** | `priority:now` ≥ 4 weeks, `priority:next` ≥ 8 weeks, `priority:later` ≥ 16 weeks |
| **Move types** | Promote, Demote, Leapfrog, Flag stale |
| **Output** | One digest issue per ISO week, ≤5 curated proposals, each citing a specific named signal |
| **No-op** | Skips silently when nothing crosses the signal bar or when a digest issue already exists for the week |
| **Scope** | Proposals only — never edits labels or moves issues |
| **Label** | Digest issue is labelled `area:backlog`; label is created if absent |

---

### `vercel-failure-autofix.yml` — Vercel Auto-fix

| | |
|---|---|
| **Trigger** | `deployment_status: failure` on branches matching `auto/issue-*` |
| **Requires** | `VERCEL_TOKEN` repo secret (Vercel personal access token scoped to the account owning the deployment). No-op when the secret is absent. |
| **What it does** | Fetches the error excerpt from Vercel's events API; posts a `/fix` comment on the PR — which triggers `auto-pr.yml`'s fix cycle |
| **Idempotency** | Skips if a `<!-- vercel-autofix -->` comment was posted on the same PR in the last 10 minutes (Vercel sometimes fires multiple `failure` events for one deployment) |

---

### `ci-failure-autofix.yml` — CI Auto-fix

| | |
|---|---|
| **Trigger** | `workflow_run` on `CI` workflow `completed` with `conclusion == 'failure'`, branches matching `auto/issue-*` |
| **What it does** | Finds the failed `test` job, fetches the last 80 lines of its log, and posts a `/fix` comment on the PR — which triggers `auto-pr.yml`'s fix cycle |
| **Idempotency** | Skips if a `<!-- ci-autofix:$RUN_ID -->` comment already exists on the PR — exact match by run ID, so re-delivery of the same `workflow_run` event is a no-op |
| **Cycle-cap interaction** | `auto-pr.yml`'s 3-cycle cap does not prevent this workflow from posting a `/fix` on the next CI failure. On a capped PR, `auto-pr.yml` will silently drop the comment; no further fix cycles run, but stale `/fix` comments may accumulate. |
| **Race-condition guard** | When a `/fix` posted by this workflow queues behind an active `auto-pr.yml` run, the queued run may encounter an LGTM verdict posted by the active run even though CI is still red. `auto-pr.yml`'s CI pre-flight step (`Check CI status at HEAD`) detects this: it reads the PR's `statusCheckRollup` before the agent starts and sets `CI_FAILING_AT_HEAD=true` when CI is failing. The agent bypasses the LGTM short-circuit when that env var is set, so the fix cycle runs regardless of what auto-review verdict was posted by the previous cycle. |
| **Coupling** | Job selector matches by name `"test"` (the API-returned display name). After any `ci.yml` change, verify the name with `gh api repos/{owner}/{repo}/actions/runs/{id}/jobs --jq '.jobs[].name'` and update the `jq` selector in the `Fetch failing job log` step if needed. |

---

### `vercel-preview-on-ready.yml` — Vercel Preview on Ready

| | |
|---|---|
| **Status** | **Disabled** (`disabled_manually`). Under the qa staging flow, QA happens on the bundled `qa` branch via `qa-preview-deploy.yml`, so per-PR previews are redundant and were retired to stay within Vercel's deploy rate limit (#814). Re-enable with `gh workflow enable "Vercel Preview on Ready"` if per-PR previews are wanted again. |
| **Trigger** | `workflow_run` on `CI` (`completed`); `issue_comment: created` |
| **Gate** | Fires the Vercel Deploy Hook only when both conditions hold on the same HEAD SHA: the `test` check is `success` AND the latest `<!-- auto-review:N -->` comment scoped to that SHA carries `Verdict: Looks good to me`. The auto-review SHA scope comes from the `<!-- auto-review-sha:<sha> -->` row that `auto-review.yml` writes on every comment. |
| **Manual override** | A `/preview` PR comment from OWNER / MEMBER / COLLABORATOR bypasses both gates and fires the hook unconditionally — for mid-iteration peeks before LGTM. |
| **Fork guard** | `workflow_run` arm requires `head_repository.fork == false`; the `issue_comment` arm relies on `auto-review.yml` already excluding forks (so no LGTM verdict is ever posted for a fork PR). |
| **Idempotency** | Posts `<!-- vercel-preview-fired:<sha> -->` on the PR after a successful fire; subsequent re-evaluations at the same SHA are no-ops. |
| **Why two triggers** | CI and auto-review run independently; whichever finishes second flips the gate. Both events re-evaluate against the current HEAD SHA, so order doesn't matter. |
| **qa promotion PRs** | Skipped — a `qa -> main` PR's head branch is `qa`, and its preview is handled by `qa-preview-deploy.yml`. Firing here too would double-deploy `qa`. |
| **Required secrets** | `VERCEL_DEPLOY_HOOK_URL`, `BOT_APP_PRIVATE_KEY`, `BOT_APP_ID` (var). |
| **Context** | `vercel.json` sets `git.deploymentEnabled = { "**": false, "main": true }`, so non-`main` branches do not auto-deploy. This workflow is the path that creates preview deployments for batch / feature PRs. Production deploys on `main` are unaffected. `e2e.yml` triggers on the `deployment_status` that Vercel fires when the gated preview deploys, so it inherits the gate. |

---

### `qa-preview-deploy.yml` — QA Preview Deploy

| | |
|---|---|
| **Trigger** | `workflow_dispatch` only |
| **Job** | `deploy` |
| **What it does** | Fires the Vercel Deploy Hook with `?ref=qa`, creating a preview deployment of the `qa` staging branch. Invoked by the `/batch-issues` skill at the end of its queue drain (`gh workflow run "QA Preview Deploy"`), or manually from the Actions tab. |
| **Why a dedicated workflow** | The deploy-hook URL is a repo secret, so the deploy must be fired server-side, not from the local `/batch-issues` session. `?ref=qa` is hardcoded — dispatching from the default branch would otherwise resolve `github.ref` to `main`. |
| **Required secrets** | `VERCEL_DEPLOY_HOOK_URL`. |
| **Concurrency** | `group: qa-preview-deploy` with `cancel-in-progress: false`. |

---

### `auto-release.yml` — Auto Release

| | |
|---|---|
| **Trigger** | `pull_request` (`closed`) into `main` — the primary trigger, a merged `qa -> main` promotion PR; `schedule` (daily `0 9 * * *` cron — 09:00 UTC) as a safety net; `workflow_dispatch` for manual cuts. The job `if:` filters the `pull_request` trigger to merged PRs whose head branch is `qa`. |
| **Gate** | Each run cuts at most one release — `cut-release.mjs` writes `skip=true` when no fragments exist. The release commit + tag are a `push` to `main`, which does not match the `pull_request`/`schedule`/`workflow_dispatch` triggers, so the release commit cannot re-fire the workflow. |
| **What it does** | Runs `.github/scripts/cut-release.mjs`: scans `changelog.d/unreleased/*.md` fragments, groups bullets by `kind` into Keep-a-Changelog subsections, decides bump type (`minor-bump` fragment or Added/Changed/Removed/Deprecated → minor; only Fixed/Security → patch), writes the new `## [X.Y.Z]` section into `CHANGELOG.md`, bumps `package.json`, deletes consumed fragments (`git rm changelog.d/unreleased/*.md`), commits as `chore(release): vX.Y.Z (TYPE) [skip ci]`, tags `vX.Y.Z`, pushes commit + tag to `main`, and creates a matching GitHub Release with the assembled section as the body |
| **No-op condition** | No `*.md` files in `changelog.d/unreleased/` → script writes `skip=true` and the workflow exits cleanly. Internal-only changes without a fragment do not trigger a release. |
| **Bootstrap** | One-time: on first run, if no `v0.1.0` tag exists, creates `v0.1.0` at SHA `cddb3a8` (last commit whose CHANGELOG content matched the current `[0.1.0]` section) and the matching GitHub Release. Subsequent runs no-op the bootstrap. |
| **Loop break** | Structural: none of the triggers (`pull_request`, `schedule`, `workflow_dispatch`) is `push`, so the release commit landing on `main` cannot re-fire this workflow. The `[skip ci]` marker on the release commit is defence in depth only — it suppresses the `push`-triggered workflows (`ci.yml`, `migration-check.yml`) on that commit, but it is not what stops `auto-release.yml` from looping. |
| **qa reset** | On a `qa -> main` trigger only (`github.event_name == 'pull_request'`), a final step force-updates `qa` to `main` (`git push origin +HEAD:refs/heads/qa`) so the next batch run starts from a clean integration branch. `schedule`/`workflow_dispatch` runs skip this — `qa` may hold in-progress batch work. |
| **Vercel interaction** | The release commit touches `package.json`, which is in `WATCH_PATHS` in `scripts/vercel-ignored-build.sh` — so Vercel rebuilds and the in-app version banner (`NEXT_PUBLIC_APP_VERSION`) updates. |
| **Prerequisite** | The `poke-memory-bot` App must be a bypass actor on **both** the `main-protection` ruleset (to land the release commit on `main`) and the `qa-staging` ruleset (to force-push the qa reset). If a push step fails with a protected-branch error, that is the missing setup. |
| **Concurrency** | `group: auto-release` with `cancel-in-progress: false` — back-to-back merges queue rather than collapse. |

---

### `monitor-grade-log-divergence.yml` — Monitor grade_log divergence

| | |
|---|---|
| **Trigger** | Daily `schedule` (`0 8 * * *` — 08:00 UTC); `workflow_dispatch` (with an optional `threshold` input overriding the default divergence threshold of 5) |
| **Job** | `check` |
| **What it does** | Runs `.github/scripts/check-grade-log-divergence.mjs`, which flags users whose `grade_log` shows activity but whose `card_reviews` table is missing the corresponding rows — the #584 sync-break signature. If divergence is detected, the workflow opens an issue titled `[monitoring] grade_log divergence detected (N users)` from a generated body file, labelled `monitoring` and `area:workflow`. The `monitoring` label is self-healing — created with `gh label create ... || true`. |
| **Required secrets** | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`. |
| **Cron-only** | Does not fire on push, so the workflow file landing in a PR will not raise an alert on the PR itself — the first real run is the next 08:00 UTC tick after merge. |
| **Concurrency** | `group: monitor-grade-log-divergence` with `cancel-in-progress: false`. |

---

### `refresh-user-count.yml` — Refresh user count badge

| | |
|---|---|
| **Trigger** | Daily `schedule` (`17 6 * * *` — 06:17 UTC); `workflow_dispatch` |
| **Job** | `refresh` |
| **What it does** | Runs `scripts/refresh-user-count.mjs` to refresh `.github/stats/users.json`, the source for the README user-count Shields.io badge (#400). If the file changed, it commits as `chore(stats): refresh user count [skip ci]` and pushes directly to `main`. The commit is authored by the `poke-memory-bot` App identity, so it lands despite branch protection; the `[skip ci]` marker stops the push retriggering any push-triggered workflow. |
| **Required secrets** | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `BOT_APP_PRIVATE_KEY`, `BOT_APP_ID` (var). |
| **Concurrency** | `group: refresh-user-count` with `cancel-in-progress: false`. |

---

## Build gates

Two separate gates catch type/build/test errors at different points:

### Pre-PR gate (`auto-issue.yml` only)

Runs before opening a PR: `npm run typecheck && npm run build && npm test`

- Orchestrator is allowed up to **2 targeted fix attempts** (commit + push + retry).
- After the second failure: post a comment on the issue with the last 80 lines of build output and stop. Branch stays pushed for manual inspection.
- Goal: surface errors in the same run that produced them, before Vercel or CI finds them.

### CI gate (`ci.yml`)

Runs on every `pull_request` event and every push to `main`: the same `typecheck && build && test` triple.

- Named checks: `test` and `e2e` (job IDs). `e2e` aggregates the parallel `e2e-browser` matrix legs into one status so the required-check name is stable. Branch protection requires both by name.
- Concurrent runs on the same ref are cancelled — only the latest push completes.

### Coverage gate (`coverage.yml`)

Runs on every `pull_request` event. Fails the `coverage` job on either a global-floor breach (`coverage.thresholds` in `vitest.config.ts`) or a diff-coverage breach (`scripts/diff-coverage.mjs`, 80% patch bar). See the `coverage.yml` catalog entry above for detail. Not yet a required check — owner must add `coverage` to the `qa` and `main` rulesets to block merge on a breach.

---

## Graceful exit & WIP salvage

When an implement (or continue) run hits its turn cap, times out, or errors mid-flight, the post-step runs with `if: always()` and:

1. **Salvage push** — if uncommitted edits exist in the working tree, stages and commits them as `WIP: halted run on #N`, then pushes to origin. This ensures `/continue` always has a branch to resume from.
2. **Status update** — PATCHes the live `<!-- auto-status -->` comment with a "Run finished" section showing outcome, branch, last commit, and recovery instructions. When the run ends without a PR (turn-cap, timeout, build-gate failure, or deliberate blocker stop), the recovery sub-block includes `@fraserbrookhouse` so the maintainer is notified.
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

## Dispatch throttle: detection and recovery

GitHub applies an undocumented per-repo throttle on `push` and `pull_request` event dispatch when automation density crosses an internal heuristic. This section documents how to identify and recover from it.

### Identifying the throttle

The signature is selective silence: `push` and `pull_request` events stop dispatching across all branches while `issues`, `issue_comment`, and `deployment_status` events continue normally.

Quick check — if the most-recent `push`-triggered run is >20 minutes old during active development, suspect the throttle:

```sh
gh api "repos/fraserbrookhouse/poke-memory/actions/runs?event=push&per_page=1" \
  --jq '.workflow_runs[0].created_at'
```

Compare against:

```sh
gh api "repos/fraserbrookhouse/poke-memory/actions/runs?event=issues&per_page=1" \
  --jq '.workflow_runs[0].created_at'
```

If `issues` events are recent but `push` events stopped 15+ minutes ago, the throttle is active.

### Confirmed non-recoveries (from 2026-05-12 incident)

These do **not** recover dispatch during an active throttle window:

- `gh pr close <N> && gh pr reopen <N>` — `pull_request: reopened` is also suppressed.
- Pushing an empty commit to the PR branch — `push` events are suppressed, so `pull_request: synchronize` does not fire. Vercel picks up the commit but GitHub Actions does not.

### Recovery procedure

1. **Wait for the window to clear.** Anti-abuse throttles typically lift in 15–60 minutes once the dispatch rate drops. Monitor by polling the push-event check above until a run newer than the suspected clear time appears.

2. **Identify stuck PRs.** The `pr-check-monitor` workflow will have posted `<!-- pr-check-monitor:{sha} -->` comments on any PR that had no `test` check dispatched within 20 minutes of opening. Use those comments as your recovery list.

3. **Re-trigger CI on each stuck PR.** Once `push` events resume, push an empty commit to each stuck branch:

```sh
git fetch origin
git checkout <branch-name>
git commit --allow-empty -m "chore: re-trigger CI after dispatch throttle"
git push
```

   The `synchronize` event will now dispatch and CI will pick up the commit.

4. **Verify CI ran.** Confirm the `test` check appears:

```sh
gh api "repos/fraserbrookhouse/poke-memory/commits/<sha>/check-runs?check_name=test" \
  --jq '.check_runs[].status'
```

### Root cause context

The throttle is triggered by automation density, not by any single workflow. High-volume bursts — e.g. 4 PR merges in 15 minutes, each cascading through 6–8 workflows plus parallel issue-comment automation — can exceed GitHub's (undocumented) per-repo heuristic for compute-heavier event types. Reducing steady-state dispatch rate (e.g. removing automatic labelling for issues and PRs) lowers the risk of re-triggering the throttle.

---

## Retrospectives

After each merged PR, `auto-retro.yml` posts a `<!-- auto-retro -->` comment on the closed issue covering:
- **Agents used** — which sub-agents ran
- **What worked** — specific evidence (review finding, planner question that surfaced a risk)
- **What didn't / overhead** — where a round-trip cost more than it returned
- **Lesson** — one transferable rule for future changes

Retros are process reflection only — no code change recommendations. Aggregating patterns across retros into convention (promoting to `AGENTS.md`) is left manual; if a lesson recurs across several retros, add it to `AGENTS.md` by hand.
