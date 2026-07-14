# Workflow

This is the **process map** for poke-memory - how work flows through this repo end-to-end. It covers the sub-agent roster, orchestration playbook, GitHub Actions catalog, issue lifecycle, build gates, and retrospectives.

For implementation conventions (caching, SRS, PokéAPI integration, file ownership), see [AGENTS.md](AGENTS.md).

**Update rule:** update this file in the same commit that changes a workflow, automation, or orchestration behavior - no separate docs-only commit.

---

## Sub-agent roster

Custom agents live in `.claude/agents/`. Invoke via the Agent tool with `subagent_type: "<name>"`.

| Agent | Role | Read-only? |
|---|---|---|
| [planner](.claude/agents/planner.md) | Designs implementation plans; surfaces unknowns before any code is written; runs the pre-flight staleness (#1322), AC-quality (#1321), centralisation, and testability + first-contact UX (#1276) checks before drafting a plan | Yes |
| [next16-expert](.claude/agents/next16-expert.md) | Next.js 16 API, caching, routing, rendering questions | Yes |
| [pokeapi-expert](.claude/agents/pokeapi-expert.md) | PokéAPI endpoint selection, schemas, caching strategy - low-frequency: the dataset is build-time-seeded, so invoke only when changing the seed script or adding a data category | Yes |
| [srs-expert](.claude/agents/srs-expert.md) | Spaced-repetition algorithm design and scheduler-code review (data-coder implements) | No |
| [supabase-expert](.claude/agents/supabase-expert.md) | Supabase Auth + RLS + schema design for persisted user data (currently FSRS scheduling state on `card_reviews`, plus `streak_days`, `user_settings`, `grade_log`) | Yes |
| [researcher](.claude/agents/researcher.md) | Generalist investigation that doesn't fit a specialist | Yes |
| [ui-coder](.claude/agents/ui-coder.md) | Pages, layouts, components, styling | No |
| [data-coder](.claude/agents/data-coder.md) | API routes, Server Actions, persistence, integrations | No |
| [playwright](.claude/agents/playwright.md) | E2E smoke tests after user-facing changes; owns `e2e/**` | No |
| [code-reviewer](.claude/agents/code-reviewer.md) | Independent diff review at the end of a change, including synchronous-scale perf-budget impact (count of items processed synchronously, module-load JSON parses) - see #1234 / #1263 - acceptance-criteria coverage cross-checked against the linked issue's body (resolved via `closes/fixes/resolves #N` in PR body, branch name, or commit messages, with an uncovered criterion raised as a Blocker, closing the partial-scope gap surfaced by #1259 / #1260), and a fragmentation check that raises any new direct field access on a domain concept (`p.displayName`, inline date formatting, ad-hoc mastery check, inline class-name literal) as a Blocker tagged "fragmentation" - see #1328 and AGENTS.md "Single source of truth for shared concepts" | Yes |
| [privacy-expert](.claude/agents/privacy-expert.md) | Data-protection / compliance advice - GDPR/UK-GDPR controller obligations, Children's Code, PECR/cookies, privacy notice + Terms drafting, DPIA upkeep, sub-processor classification | Yes |
| [i18n-expert](.claude/agents/i18n-expert.md) | Multi-locale design - `pokemonNameLocale` vs. `appLocale`, transliteration sources (rōmaji, pinyin), message catalogs, `next-intl` routing, locale-aware sync, `<lang>` placement, adding a new locale | Yes |
| [ux-advisor](.claude/agents/ux-advisor.md) | Information architecture, feature discoverability, onboarding patterns, empty/locked-state design, accessibility - invoked on the brief for any change adding a user-facing feature or changing how something is displayed/discovered; advises, `ui-coder` implements | Yes |
| [workflow-expert](.claude/agents/workflow-expert.md) | Reviews GitHub Actions / orchestration changes - idempotency markers, salvage patterns, fork-PR guard, cycle caps | Yes |

---

## Orchestration playbook

The main agent (Claude in the user's session) orchestrates. Coder agents do not call other agents directly - they receive research findings via the prompt.

Standard flow for non-trivial work:

1. **Plan** - invoke `planner`. It surfaces unknowns tagged as `[EXPERT-RESEARCH]`, `[USER-DECISION + RESEARCH]`, or `[USER-DECISION]`.
2. **Research in parallel** - dispatch specialists (`next16-expert`, `pokeapi-expert`, `srs-expert`, `researcher`) in a single message when their questions are independent. Fold answers into the plan.
3. **Implement** - invoke `ui-coder` and/or `data-coder` with full context (research findings + spec). Run in parallel when their work is independent.
4. **E2E** - if the change is user-facing, invoke `playwright` to add or update E2E smoke tests. Pass the diff summary and affected pages.
5. **Review** - invoke `code-reviewer` at the end. Iterate on its punch list.

**When to skip the planner.** Step 1 is skippable. Skip the `planner` invocation when *all* of the following hold:

- the issue body names the **exact files** to change;
- it names **specific line numbers or line ranges** (or an equivalently precise anchor - a named symbol, a single config key);
- it states the **expected outcome** concretely enough to write acceptance criteria from directly;
- there are **zero open design questions** - nothing the planner would tag `[EXPERT-RESEARCH]`, `[USER-DECISION]`, or `[USER-DECISION + RESEARCH]`.

When every box is ticked the issue *is* the plan and a planner round-trip would return precisely what the issue already says - validated by 25+ consecutive retros. If any box is unticked (a file is unnamed, an outcome is fuzzy, a design choice is open), run the planner. Implement directly only against an issue that meets the full checklist.

**Planner-skip decision tree (#1248).** A simpler yes/no version of the checklist above, for quick triage:

**Skip the planner when the issue body already contains:**
- Root cause (what is broken and why)
- Fix location (file path or function)
- Acceptance criteria (what the change should achieve)

If any of the three is missing, run the planner. If all three are present, go straight to implement.

When *not* to use a sub-agent: small one-off edits, single-file changes, or anything where the round-trip cost outweighs the value.

**Hard rule - `workflow-expert` before writing GitHub Actions.** For any change to `.github/workflows/**` that involves marker-based dedup (HTML-comment idempotency markers) or GitHub search-index lookups, invoke `workflow-expert` **before** writing the change, not only as a reviewer afterwards. GitHub's search index strips HTML comments, so a `<!-- marker -->` dedup that relies on search to find prior comments silently fails - exactly the platform quirk a `workflow-expert` design-time pass surfaces before it costs a fix commit at auto-review time.

**`ux-advisor` before writing onboarding/discoverability code.** On the same design-time pattern as `workflow-expert` before GitHub Actions, invoke `ux-advisor` on the brief **before** dispatching the implementer for any change that adds a user-facing feature, changes how something is displayed, or changes how something is accessed/discovered. The planner's testability + first-contact UX pre-flight (#1276) names this hook; any discoverability gap `ux-advisor` cannot resolve from the existing code becomes a `[USER-DECISION]` open question or a dedicated acceptance criterion. At review time, `code-reviewer` raises a new surface with no declared discovery path as a Concern (the "Discoverability" check in its step-3 list) - auto-review.yml is unchanged, the check lives in the agent definition.

**Orchestration entrypoints - `/batch-issues` and `/ship`.** Two local slash-commands run the playbook end-to-end so the gate, the in-session `code-reviewer` pass, the issue-first cross-check, and branch-off-`qa` are not re-derived by hand each time:

- **`/batch-issues`** (`.claude/commands/batch-issues.md`) - drains the open backlog in conflict-minimizing batches, parallel where safe, draining into `qa` and opening a draft `qa -> main` promotion PR. Use for a backlog pass.
- **`/ship`** (`.claude/commands/ship.md`, #1718) - the single-change projection of `/batch-issues`: one issue (or one freshly-created issue) → branch off `qa` → implement → `npm run pre-pr` gate → PR into `qa` with `Closes #N` → `code-reviewer` → auto-merge. It **defers** to `/batch-issues` for the gate, review, and branching rules rather than restating them, so the two paths never diverge. Use for one linear change where the batch machinery is overkill.

Both run the same `npm run pre-pr` gate (AGENTS.md "Pre-PR build gate") and the same `code-reviewer` pass; the only difference is batch fan-out vs single change.

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

## Branching model - qa staging flow

`main` is strict and production-tracked; `qa` is the integration branch where batch work is bundled and QA-tested before promotion (#806).

```
Batch PRs ─▶ qa ─▶ (preview deploy + maintainer QA) ─▶ qa→main PR ─▶ main ─▶ release + production
```

| Branch | Ruleset | Who PRs into it |
|---|---|---|
| `main` | `main-protection` - strict-up-to-date; required checks `test`, `e2e`, `Check version bump approval`, `Restrict main PR source` | Only `qa`. A non-`qa` PR needs the `hotfix` label. |
| `qa` | `qa-staging` - required checks `test`, `e2e`; **not** strict-up-to-date. Bypass actors: `poke-memory-bot` and the repo admin role. | `/batch-issues`, the `auto` pipeline, and one-off feature branches. |

**Why `qa` exists.** `main`'s strict-up-to-date rule forces every queued PR to rebase + re-run CI one at a time - the serial-rebase tax. A GitHub merge queue would remove it but is unavailable for personal-account repos (#797). `qa` is non-strict, so `/batch-issues` merges PRs back-to-back with no rebase tax, then promotes the bundled result to `main` in a single PR.

**The flow:**

1. `/batch-issues` opens each batch PR against `qa` and drains them straight in (no rebase tax).
2. At end of drain it fires `qa-preview-deploy.yml` (a Vercel preview of `qa`) and opens a **draft** `qa -> main` PR carrying every `Closes #N`.
3. The maintainer tests the preview, marks the draft ready, and merges `qa -> main`. The full required suite runs against strict `main`.
4. The merge triggers `auto-release.yml`: it cuts the release, pushes the `[skip ci]` release commit to `main` (Vercel deploys production), then resets `qa` to `main` so the next batch starts clean.

**Batch-drain pre-flight: aggregate coverage check.** Diff coverage is gated per-PR, but a set of PRs that each clear the 90% patch bar individually can still leave the *aggregate* `qa -> main` diff below the bar - a UI-heavy PR with E2E but thin unit coverage is the usual culprit. This surfaces as a failed `qa -> main` promotion needing a dedicated catch-up PR. To catch it before the drain rather than after, run the diff-coverage gate against the whole `qa`-vs-`main` diff before initiating a batch drain:

1. Run `npm run test:coverage` once to produce `coverage/coverage-final.json` (the `json` reporter). The script reads this file; it does not run the suite itself.
2. Pipe the aggregate diff into the gate: `git diff origin/main...origin/qa | node scripts/diff-coverage.mjs`. The script reads a unified diff on **stdin** - it has no diff-range argument. (`npm run test:diff-coverage` is the per-PR shortcut and defaults to `origin/qa...HEAD` - override the base with `DIFF_COVERAGE_BASE` - so it is not the right invocation for this `main...qa` aggregate check.)

A non-zero exit means the aggregate patch coverage is below the 90% bar; fold the gap into the batch as an extra test-only change. Do this at drain start, not at promotion time.

**Hotfix bypass.** A genuine hotfix can skip `qa` by opening a PR straight into `main` with the `hotfix` label - `main-pr-source-gate.yml` checks for it. Only the repo owner applies the label.

**Managing `qa`.** `qa` is the loose branch: the repo admin role and `poke-memory-bot` are bypass actors on the `qa-staging` ruleset, so the owner can fast-forward or reset `qa` directly (the `/batch-issues` pre-flight relies on this) and `auto-release.yml` can force-push the post-release reset. `main-protection` has no owner bypass - `main` stays strict for everyone.

**Note on `closes #N`.** GitHub auto-closes a linked issue only when the PR merges into the *default* branch. A batch PR merged into `qa` does not close its issue; the `qa -> main` promotion PR carries the aggregated `Closes #N` lines and closes them all on merge.

---

## GitHub Actions catalog

**Trust rule for comment/edit-triggered jobs (#1859).** Any job triggered by a user-authorable event (`issue_comment`, `issues: edited`, and similar) must gate on the event author before any secret-bearing or write-token step runs: bot-produced artefacts (review verdicts, digests, idempotency markers) are only trusted when the comment/issue author is `poke-memory-bot[bot]`, and human commands (`/preview`, `/resolve`) require `author_association` OWNER / MEMBER / COLLABORATOR. Body-content markers alone are attacker-postable and never sufficient.

### `ci.yml` - CI

| | |
|---|---|
| **Trigger** | `pull_request` (any), push to `main` |
| **Jobs** | `changes` (path classification), `test` (`typecheck && build && test`), `e2e-browser` (Playwright matrix - `chromium` + `mobile-safari` legs run in parallel inside the official Playwright container), `e2e` (aggregator over the matrix legs) |
| **What it does** | `test` runs `npm ci && npm run typecheck && npm run build && npm test`. `e2e-browser` runs the Playwright smoke suite split by browser project so the two projects run as parallel matrix legs (#643). The `changes` job classifies the PR so `test`/`e2e` inner steps no-op on docs-only changes. |
| **Required checks** | `test` and `e2e` are `ci.yml`'s two required status checks (not the workflow name `CI`); `main`'s full required set also includes `Check version bump approval` and `Restrict main PR source` (see Branching model). `e2e` is a thin aggregator over the `e2e-browser` matrix, so the required-check name stays stable when matrix legs are added or renamed. The `qa` ruleset requires only `test` + `e2e`. `main-protection` enforces strict-up-to-date; the bot app bypasses for auto-merges. |
| **Concurrency** | Cancels concurrent runs on the same ref - only the latest push on a branch completes. |

---

### `version-bump-gate.yml` - Version bump gate

| | |
|---|---|
| **Trigger** | `pull_request` (opened, synchronize, reopened, labeled, unlabeled) |
| **Job** | `gate` |
| **What it does** | Scans `changelog.d/unreleased/*.md` frontmatter for `kind: minor-bump` or `kind: major-bump`. If found and the PR lacks the `version-bump:approved` label, the job fails. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard - fork contributors cannot apply the label, so running on fork PRs would produce an unresolvable failure). |
| **Required check** | Yes - `Check version bump approval` is a required status check on the `main-protection` ruleset. |
| **Concurrency** | Cancels concurrent runs on the same PR. |

---

### `main-pr-source-gate.yml` - Main PR source gate

| | |
|---|---|
| **Trigger** | `pull_request` into `main` (opened, synchronize, reopened, labeled, unlabeled) |
| **Job** | `gate` (check name `Restrict main PR source`) |
| **What it does** | Fails any PR into `main` whose head branch is not `qa`, unless the PR carries the `hotfix` label. Enforces the qa staging flow - `main` only takes promotion PRs from `qa`. |
| **Hotfix bypass** | The `hotfix` label lets a non-`qa` PR through. Same approval pattern as `version-bump:approved`; only the repo owner applies it. A `labeled` event re-runs the gate so adding the label to an open PR clears it. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard - same pattern as `version-bump-gate.yml`). |
| **Required check** | Yes - `Restrict main PR source` is a required status check on the `main-protection` ruleset. |
| **Concurrency** | Cancels concurrent runs on the same PR. |

---

### `migration-check.yml` - Migration drift check

| | |
|---|---|
| **Trigger** | `pull_request` touching `db/migrations/**`, `scripts/check-migrations.mjs`, or the workflow file itself; push to `main` |
| **Job** | `check` |
| **What it does** | Runs `scripts/check-migrations.mjs`, which lists files in `db/migrations/` (excluding the bootstrap `001_initial_sync_schema.sql`), calls the Supabase Management API to list applied migrations, and exits non-zero if any committed file is not in the applied list. **Env-to-branch parity (#1806):** a PR whose base is `qa` is checked against the **QA** project (staging rehearsal); a push to `main` (and a PR into `main`) is checked against **prod**. Routing is purely on `github.event_name` + `pull_request.base.ref` (secrets can't be read in `if:`), so the matching secret set is injected per step. |
| **Required secrets** | `SUPABASE_ACCESS_TOKEN` (Supabase Management-API PAT, account-scoped so it reads BOTH projects) plus the per-project ref: `SUPABASE_PROJECT_REF` (prod, e.g. `nvxvvtvnthsgdxgksmju`) or `QA_SUPABASE_PROJECT_REF` (QA). No separate QA token - the PAT is account-level. The relevant ref must be set before the matching trigger can run; without it the script exits 2 with a clear error (the loud failure mode during the secrets-provisioning window). |
| **Fork PRs** | Skipped (`github.event_name == 'push' || head.repo.fork == false` guard - same pattern as `auto-review.yml`, with the push path gated in explicitly). No secrets exposed. |
| **Required check** | No - informational. Failure flags the gap; the recovery action is to run `mcp__supabase__apply_migration` against the named file. |
| **Concurrency** | Cancels concurrent runs on the same ref. |

---

### `e2e.yml` - E2E

| | |
|---|---|
| **Trigger** | `deployment_status` (Vercel webhook) |
| **Gate** | Runs only when: deployment state is `success`, environment is not `Production`, and creator is `vercel[bot]` |
| **Job** | `playwright` |
| **What it does** | Installs chromium + webkit, runs Playwright smoke tests against the Vercel preview URL (`deployment_status.target_url`), uploads the HTML report as an artifact (14-day retention) |
| **Required check** | No - non-blocking. Promote to required once flake rate is proven stable. |
| **Concurrency** | Serialized per deployment ID (`cancel-in-progress: false`) |
| **Scope** | Guest-mode flows, plus signed-in UI flows via the mock-auth seam (see below). Page loads, navigation, card flip, grade buttons, key sections on Stats / Pokédex / Settings; the signed-in avatar / sign-out / nav, the conflict picker, and the superuser cloud-write-guard surfaces. |

The functional Playwright projects are `chromium`, `mobile-safari`, `desktop-webkit`, and `mobile-chrome` (see `playwright.config.ts`). `ci.yml`'s `e2e-browser` matrix runs `chromium` + `mobile-safari`; `desktop-webkit` and `mobile-chrome` widen local and dispatch coverage for Safari-desktop and Chrome-mobile quirks. All four functional projects ignore `e2e/visual.spec.ts`, and `npm run test:e2e` names the four functional projects explicitly - so a developer run on macOS never compares against Linux-generated baselines. The visual snapshot spec runs only under the `visual-chromium` / `visual-webkit` projects via `npm run test:visual`, driven by `visual-regression.yml` below.

---

### `visual-regression.yml` - Visual Regression

| | |
|---|---|
| **Trigger** | `pull_request` (`opened`, `synchronize`, `reopened`, `labeled`) and `workflow_dispatch` |
| **Gate** | A `decide` job runs on every PR and sets `run=true` when `dorny/paths-filter` matches `components/**`, `app/**/*.tsx`, `app/globals.css`, `e2e/visual.spec.ts`, `playwright.config.ts`, or the workflow file itself - OR the PR carries the `visual-regression` label (escape hatch). `workflow_dispatch` always runs. Mirrors `integration-tests.yml`'s decide-job pattern. |
| **Job** | `decide` (path/label gate), `visual` (snapshot compare) |
| **What it does** | Builds the app and serves it, then runs `e2e/visual.spec.ts` under the `visual-chromium` + `visual-webkit` projects (`npm run test:visual`). The spec asserts `toHaveScreenshot()` for the two deterministic README surfaces (Stats, Journey) at a mobile and a desktop viewport. Practice, Pasture and Pokédex are excluded because their renders are not pixel-stable across runs (random card pick, `Math.random()` facts, and lazy sprite-decode races under the parallel worker pool) - see `e2e/visual.spec.ts` for the per-surface rationale. Committed baselines under `e2e/__screenshots__/` are compared with a fuzzy tolerance (`threshold: 0.25`, `maxDiffPixelRatio: 0.02` in `playwright.config.ts`), not byte-for-byte; on a mismatch the HTML report (expected/actual/diff) is uploaded as an artifact. |
| **Why a dedicated workflow** | Snapshot baselines are platform-sensitive. macOS Core Text and Linux font anti-aliasing differ visibly (the reason README screenshots are macOS-only - see AGENTS.md → "Screenshots"). The job runs inside the pinned `mcr.microsoft.com/playwright:v1.60.0-noble` Docker image so baselines are generated AND compared in the same deterministic Linux environment. The image tag MUST track the `@playwright/test` version in `package-lock.json`. |
| **Required check** | No - non-blocking, and a non-matching PR does not run it at all. |
| **Concurrency** | Per-ref, `cancel-in-progress: true`. |
| **Updating baselines** | When a UI change intentionally alters a surface, regenerate baselines inside the Docker image - never from macOS. Two paths: (1) **In CI** - dispatch `visual-baseline-update.yml` against the feature branch (owner-gated, refuses `main`/`qa`); it runs the same pinned image, commits the regenerated PNGs as `chore(visual): regenerate baselines [skip ci]`, and pushes to the dispatching branch. (2) **Locally**, from the repo root: `docker run --rm -v "$(pwd)":/work -w /work mcr.microsoft.com/playwright:v1.60.0-noble bash -c 'npm ci && npm run build && (npm start &) && npx wait-on http://localhost:3000 && npm run test:visual -- --update-snapshots'` - then commit the changed PNGs under `e2e/__screenshots__/`. |

---

### `visual-baseline-update.yml` - Visual Baseline Update

| | |
|---|---|
| **Trigger** | `workflow_dispatch` only, with a required `branch` input. |
| **Gate** | The `gate` job refuses to run unless `github.actor == github.repository_owner` (owner-only) and the `branch` input is neither `main` nor `qa`. Defence-in-depth: the push step re-checks the branch name. |
| **Job** | `gate` (owner + branch guard), `regenerate` (snapshot regeneration + commit + push). |
| **What it does** | Runs inside the pinned `mcr.microsoft.com/playwright:v1.60.0-noble` image - the same pin `visual-regression.yml` uses for comparison. Checks out the dispatching branch via a `poke-memory-bot` App installation token, builds the app, serves it, runs `npm run test:visual -- --update-snapshots` to rewrite `e2e/__screenshots__/{visual-chromium,visual-webkit}/*.png`, then commits `chore(visual): regenerate baselines [skip ci]` and pushes to the dispatching branch. If the regeneration produces no diff, the job exits cleanly without an empty commit. |
| **Why an App token** | The push must be able to bypass branch protection on whatever feature-flow branch the dispatcher names (`GITHUB_TOKEN` cannot). The `[skip ci]` marker prevents the regenerated baselines from immediately re-firing `ci.yml` / `migration-check.yml`. |
| **Required check** | No - manual dispatch only. |
| **Concurrency** | Per-branch input, `cancel-in-progress: false` (a queued regeneration should finish, not be cancelled by a second dispatch). |

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
  **Preview** environment scope (Preview only - **never** Production).
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

### `coverage.yml` - Coverage

| | |
|---|---|
| **Trigger** | `pull_request` (any), `workflow_dispatch` |
| **Job** | `coverage` |
| **What it does** | Runs `npm ci && npm run test:coverage` (vitest v8 provider), enforces two coverage gates, then posts the coverage summary (statements / branches / functions / lines) plus the diff-coverage result as a PR comment. The comment is keyed on the `<!-- coverage-report -->` HTML marker, so re-runs update the existing comment instead of posting duplicates (same idempotency pattern as `pr-check-monitor.yml`). The comment posts on both pass and fail. |
| **Gates (#824)** | **Global floor** - values in `coverage-floor.json` at the repo root, imported by `vitest.config.ts`'s `coverage.thresholds`. `vitest run --coverage` exits non-zero if overall coverage regresses. **Diff coverage** - `scripts/diff-coverage.mjs` cross-references the PR's added/changed lines against the v8 per-statement hit counts in `coverage/coverage-final.json` and requires changed product lines to hit a 90% patch bar. The coverage step no longer carries `continue-on-error`; either gate failing fails the job. The numbers deliberately do not appear in this row, AGENTS.md, or the PR-comment template - they come from `coverage-floor.json` to prevent the drift #1333 cleaned up. The `/batch-issues` end-of-session ratchet updates the JSON file only. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard - fork PRs run with a read-only token and cannot post comments). |
| **Required check** | Yes - `coverage` (`Test coverage report`) is a required check on both the `qa-staging` and `main-protection` rulesets. Either gate failing (global floor or 90% diff-coverage patch bar) blocks merge. The diff-coverage gate uses `pull_request.base.sha` as the base, so it is correct for `qa`-targeting PRs (#1742). |
| **Concurrency** | Cancels concurrent runs on the same ref. |

---

### `changelog-gate.yml` - Changelog Gate

| | |
|---|---|
| **Trigger** | `pull_request` (opened, synchronize, reopened, labeled) |
| **Job** | `changelog-gate` |
| **What it does** | Uses `dorny/paths-filter` to classify the PR diff. If it touches a user-facing surface (`app/**`, `components/**`, `lib/**`) but adds **zero** `changelog.d/unreleased/*.md` files, the job fails - unless the PR carries the `no-changelog` escape-hatch label (for genuinely internal-only changes that nonetheless touch those paths). Promotes the previously prose-only "add a fragment unless internal-only" rule into CI (#1741). `lint:changelog` validates fragment *format*; this gate enforces *presence*. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard). |
| **Required check** | No - not yet on a ruleset. Promote once stable. |
| **Concurrency** | Cancels concurrent runs on the same ref. |

---

### `i18n-leak.yml` - i18n Leak

| | |
|---|---|
| **Trigger** | `pull_request` (all PRs, no workflow-level path filter) + `workflow_dispatch`. An internal `dorny/paths-filter` decides whether to run the gate (`components/**`, `app/**/*.tsx`, `messages/**`) or pass as a no-op, so the `i18n-leak` check ALWAYS reports and is safe as a required check (#1785). |
| **Job** | `i18n-leak` |
| **What it does** | Runs `npm run test:i18n-leak` - the English-leak / pseudo-locale render gate. Components under test render via `renderPseudo()` (the sentinel-bracketed `xx-pseudo` catalogue); any user-facing string not in the catalogue and not on the allowlist is an untranslated English leak and fails the job. Promotes the strongest locale-correctness guardrail from prose-only enforcement (#1737). On a PR touching none of the i18n paths the job is a no-op pass (it still reports). No build needed. |
| **Required check** | Yes - required on the `qa-staging` ruleset. Because the job always reports (no-op pass on non-i18n PRs), a non-matching PR resolves to pass rather than being blocked by a never-reported required check (#1785). |
| **Concurrency** | Cancels concurrent runs on the same ref. |

---

### `codeql.yml` - CodeQL

| | |
|---|---|
| **Trigger** | `pull_request` (opened, synchronize, reopened); push to `main`; weekly `schedule` (`0 9 * * 1` - Monday 09:00 UTC) |
| **Job** | `analyze` |
| **What it does** | Runs GitHub's CodeQL security scan over the `javascript-typescript` language pack with the `security-extended` query suite. No `autobuild` step - CodeQL v3 source-traces JS/TS without a build, keeping the scan fast; generated `.next/` output is out of scope. The weekly cron catches newly-published CVEs and dependency drift that no push would otherwise trigger. |
| **Permissions** | `security-events: write` (uploads results to the Security tab), `contents: read`, `actions: read`. |
| **Concurrency** | Scheduled runs get a per-`run_id` group with `cancel-in-progress: false`, so a push to `main` during the weekly window cannot cancel the scan. Push and PR runs share a per-event-type+ref group and may cancel stale siblings. |

---

### `integration-tests.yml` - Integration Tests

| | |
|---|---|
| **Trigger** | `pull_request` (opened, synchronize, reopened, labeled); `workflow_dispatch` |
| **Jobs** | `decide` (gate), `integration`, `integration-gate` (aggregator) |
| **What it does** | The `decide` job runs on every PR and uses `dorny/paths-filter` to check whether the PR touches the cloud-write surface (`lib/sync/**`, `app/api/sync/**`, `db/migrations/**`, `lib/gradelog/**`, or this workflow file). If a path matches, the PR carries the `integration-tests` label, or the run is a manual dispatch, the `integration` job runs the DB-backed suite (`npm run test:integration`) against a `postgres:15` service container - migration apply, RLS isolation, and the regression trigger. No Supabase API calls, no branch quota. The `integration-gate` aggregator then reports a single stable status (skipped `integration` == pass). |
| **Why a gate job** | A bare `on.pull_request.paths:` filter would also filter out `labeled` events on PRs that don't touch the paths, breaking the label escape hatch. The cheap `decide` job combines "paths OR label" so the opt-in label still works. |
| **Required check** | Yes (#1738) - `integration-gate` is a required status check on the `qa-staging` ruleset. It is a thin always-reporting aggregator over `decide` + `integration`: a PR outside the path filter resolves to skipped == pass and is not blocked; a real `integration` failure fails the gate. Modelled on `ci.yml`'s `e2e` aggregator so the required-check name stays stable. |
| **Concurrency** | Cancels concurrent runs on the same ref. |

---

### `auto-issue.yml` - Auto Issue Worker

Handles five commands: `plan`, `implement`, `continue`, `split`, and `replan`.

#### Plan job

| | |
|---|---|
| **Trigger** | Issue labeled `auto` |
| **What it does** | Invokes the `planner` sub-agent; posts `<!-- auto-plan -->` comment; moves issue to **Planned** on the project board |
| **Scope check** | Planner assesses scope (≥4 files, ≥3 surfaces, infra+logic, ≥6 acceptance criteria) and runs a coupling check before offering `/split` |
| **Overlap annotation** | If the issue has `<!-- overlap-scan:i+j:<kind> -->` markers, the orchestrator extracts the verbatim reason from each marker's comment body and passes the list to the planner, which appends a `**Related issues:**` section to the plan (one `- #<num> (<kind>): <reason>` line per linked issue) - informational only |
| **Salvage** | Post-step runs with `if: always()` - if the orchestrator halts before posting the plan, it salvages `/tmp/plan-body.md` to the issue |

#### Implement job

| | |
|---|---|
| **Trigger** | Maintainer (OWNER / MEMBER / COLLABORATOR) comments `/go` on an open `auto`-labelled issue |
| **Conflict gate** | Checks for `<!-- overlap-scan:i+j:conflict -->` markers linked to open issues; refuses to proceed if unresolved |
| **Staleness gate** | Parses `<!-- plan-meta: base=<sha> files=<list> -->` from the most recent `<!-- auto-plan -->` comment; runs `git diff --name-only <base>..origin/qa -- <files>` (implement PRs target `qa`); non-empty intersection → posts a comment naming the conflicting files and the commits that touched them, then exits 1. Missing `plan-meta` (older plans) → warning only, proceeds. Empty `files=` → proceeds. Comment `/replan` to recover. |
| **What it does** | Runs the orchestration playbook (plan → research → implement → review), pushes a branch, runs the build gate, opens a PR **into `qa`** (the staging branch - `main` only takes promotion PRs) |
| **Build gate** | `npm run typecheck && npm run build && npm test` - up to 2 fix attempts before stopping without a PR |
| **Git credential** | `claude-code-action` URL-embeds the App installation token (passed via `github_token:`) into the origin remote, so subprocess pushes authenticate as `poke-memory-bot` and CI fires on the resulting `synchronize` events. Do NOT add a `git config --global http.https://github.com/.extraheader` step in front of the action - that layers a Bearer header on top of the URL-embedded Basic auth, GitHub rejects the dual-auth request, and the action's internal `git fetch origin main --depth=1` fails before Claude is invoked. |
| **Post-step** | Runs `if: always()` - salvages uncommitted edits as a `WIP: halted run on #N` commit, verifies the branch on origin before advertising `/continue`, updates the live status comment |
| **Project status** | Moves to **In Progress** on start; to **PR** when a PR opens |

#### Continue job

| | |
|---|---|
| **Trigger** | Maintainer comments `/continue` on an open `auto`-labelled issue |
| **Pre-flight** | Guards against existing open PR; parses branch name from the last `<!-- auto-status -->` comment; verifies branch exists on origin |
| **What it does** | Checks out the saved branch and resumes implementation from where it left off; follows the same workflow as implement |
| **Git credential** | Same as the implement job - `claude-code-action`'s URL-embedded App token handles subprocess pushes. No global git credential step. |
| **WIP handling** | If the last commit subject starts with `WIP:`, the resumed orchestrator inspects `git diff HEAD~1` and amends or reverts before continuing |

#### Split job

| | |
|---|---|
| **Trigger** | Maintainer comments `/split` on an open `auto`-labelled issue |
| **What it does** | Parses numbered titles from the `**Suggested split:**` block in the most recent planner comment; creates a child issue per title; links as native GitHub sub-issues; inherits the parent's `priority:*` label plus `auto` |
| **Cascade** | Each child gets the `auto` label, which triggers its own plan run - the planner breaks the work down further without manual intervention |
| **Idempotency** | Posts `<!-- auto-split:N -->` marker *before* the create loop; re-runs bail when the marker exists |

#### Replan job

| | |
|---|---|
| **Trigger** | Maintainer comments `/replan` on an open `auto`-labelled issue |
| **What it does** | Mirrors the plan job - invokes `planner`, posts a fresh `<!-- auto-plan -->` comment, moves issue to **Planned** |
| **Use case** | Recovery after a staleness gate refusal (`/go` blocked because `origin/qa` moved into planned files); also useful when scope has changed since the original plan |
| **Overlap annotation** | Same as plan job - overlap-scan markers are parsed and passed to the planner, which appends a `**Related issues:**` section to the plan |
| **Salvage** | Same `if: always()` post-step as the plan job |

---

### `auto-pr.yml` - Auto PR Fix

| | |
|---|---|
| **Trigger** | Maintainer (OWNER / MEMBER / COLLABORATOR), or the `poke-memory-bot` GitHub App, posts `/fix` on a PR |
| **Cycle cap** | 3 auto-review cycles per PR (counted by `<!-- auto-review:N -->` markers). After 3, the workflow posts a stop comment and exits. |
| **LGTM short-circuit** | Bare `/fix` on an already-approved PR does nothing - the orchestrator posts a note and stops. `/fix <inline findings>` overrides and forces a fix run using the inline body as the punch list. |
| **CI pre-flight** | Before the agent runs, a bash step fetches the PR's `statusCheckRollup` for the `test` check and sets `CI_FAILING_AT_HEAD=true` in the environment when CI is currently failing. The agent prompt checks this env var first: if `true`, the LGTM short-circuit is bypassed unconditionally, and the CI error excerpt in `FIX_COMMENT_BODY` becomes the punch list. This prevents the race where a queued fix run inherits a stale LGTM verdict from a previous cycle. |
| **Review producer** | `auto-pr.yml` does **not** run `code-reviewer` or post an `<!-- auto-review:N -->` comment itself. It addresses findings, commits, and pushes - and stops. The push fires `auto-review.yml` on `synchronize`, which is the **single** review producer: it reviews the resulting diff, posts the next `auto-review:N` comment, and kicks the next `/fix` if needed. Previously both workflows posted reviews, racing to compute the same `N` and producing duplicate `auto-review:N` comments with conflicting verdicts (and a corrupted cycle counter). |
| **No-progress guard** | If a fix cycle produces zero commits, nothing is pushed - no `synchronize` event fires, so no new review runs and the chain ends. |
| **What it does** | Reads the latest `<!-- auto-review:N -->` comment (or the inline `/fix` body), addresses findings, commits, and pushes. The run ends at the push; `auto-review.yml` reviews the pushed commit. |
| **Git credential** | `actions/checkout` writes the App token to the repo-local `.git/config`. `claude-code-action`'s `git-config.ts` then unsets that local extraheader and embeds the App token directly in the remote URL (`https://x-access-token:${TOKEN}@github.com/...`), so subprocess fetches and pushes authenticate as `poke-memory-bot`. No global git credential is set: doing so injects a second `Authorization` header (Bearer) on top of the URL-embedded Basic auth, which GitHub rejects, and the action's `git fetch origin main --depth=1` step fails before Claude is invoked. |
| **Project status** | Moves to **In Progress** during the fix. The post-fix **PR** / **Ready to merge** transition is owned by `auto-review.yml` when it reviews the pushed commit. |

---

### `auto-resolve.yml` - Auto Resolve

| | |
|---|---|
| **Trigger** | Maintainer (OWNER / MEMBER / COLLABORATOR) or `poke-memory-bot` posts `/resolve` on an open PR |
| **Fork guard** | Fork PRs are excluded - `isCrossRepository` is fetched via `gh pr view` and the job bails early if true |
| **Pre-flight** | Retries `mergeableState` up to 3× while `UNKNOWN` (posts a warning comment if still `UNKNOWN` after 3 retries); exits with a comment if already `CLEAN` |
| **Fast-path** | If merging the PR's base branch (`origin/<base>`) cleanly succeeds, runs the build gate (`typecheck` / `build` / `test`), then pushes and posts `<!-- auto-resolve:N -->` - no Claude invocation |
| **Conflict path** | Claude resolves each conflicted file; reads both sides + recent main history per file; bails if any file is under `lib/srs/`, `db/migrations/`, or is `next.config.ts`, or if more than 5 files conflict |
| **Build gate** | `npm run typecheck && npm run build && npm test` - two attempts. On second failure, posts last 80 lines of output and stops without pushing |
| **Idempotency** | `<!-- auto-resolve:N -->` marker (N = count of existing resolve comments + 1) is posted in the summary; concurrent `/resolve` comments queue via `cancel-in-progress: false` and the second run finds a clean PR |
| **What it does** | Merges the PR's base branch (`qa` for staged work, `main` for hotfixes) into the PR branch, resolves conflicts, runs the build gate, pushes, and posts an `<!-- auto-resolve:N -->` summary listing each conflicted file and how it was resolved |

---

### `auto-review.yml` - Auto Review

| | |
|---|---|
| **Trigger** | `pull_request: [opened, synchronize, reopened, ready_for_review]` |
| **Gate** | Skip-list (inverted from the earlier allow-list - see #469): drafts, fork PRs (`head.repo.fork == false`), base branches other than `main` or `qa`, the `qa -> main` promotion PR (`head.ref == 'qa'`), Dependabot PRs, `chore(release):` titles, and `[skip ci]` in the title or body are all skipped. So it reviews PRs into `qa` (one-off and `auto`-pipeline PRs) and into `main` (hotfixes). `/batch-issues` disables the workflow during its drain, since batch PRs get the in-session `code-reviewer` instead (#814). |
| **Single review producer** | `auto-review.yml` posts every `auto-review:N` comment - the first review on PR open and every follow-up review after a `/fix` push (which arrives as a `synchronize` event). `auto-pr.yml` only fixes and pushes; it never posts a review. This is the design that removes the duplicate-post race. |
| **Cycle-aware review** | First review (no prior `auto-review:N` comments) reviews the full diff. A follow-up review of a `/fix` push verifies the prior Blocker/Concern findings are resolved and flags only genuine **new** regressions the fix introduced - it does not re-scan untouched code for fresh nitpicks or escalate severities, so the bar does not drift between cycles. |
| **Linked-issue resolution** | A pre-action step parses `closes/fixes/resolves #N` (case-insensitive) from the PR body, branch name, and commit messages via `.github/scripts/extract-linked-issues.sh`, deduplicates the issue numbers, runs `gh issue view` for each, and writes the bodies to `/tmp/linked-issues.md`. The `claude-code-action@v1` prompt then `cat`s that file and briefs the `code-reviewer` sub-agent to cross-check the diff against every acceptance criterion in the linked issue(s). An uncovered criterion is raised as a **Blocker** (anchored on `issue #N:criterion text`, not a file:line). If no issue can be resolved, the file is empty and the prompt notes "no linked issue - coverage check skipped"; the diff-quality checks still run. This is the reviewer-side counterpart of the implementer cross-check in the coder sub-agents; together they close the partial-scope gap surfaced by #1259 / #1260. |
| **Severity calibration** | `Blocker` / `Concern` / `Nit` / `Praise`, calibrated strictly: `Concern` is reserved for real correctness/security/convention problems in the changed code; hypothetical, pre-existing, or stylistic items are `Nit`. A `Needs fixes` verdict needs at least one Blocker or Concern, so over-tagging Nits as Concerns is what burns extra fix cycles. |
| **Idempotency** | Each review comment includes `<!-- auto-review-sha:<head-sha> -->` on row 2; re-triggers at the same SHA are skipped. |
| **Auto-fix trigger** | When verdict is `Needs fixes` and the cycle count is below 2 (i.e. there is at most one existing auto-review), automatically posts a `<!-- auto-review-autofix:N -->` `/fix` comment (N = the new review number) - which triggers `auto-pr.yml` without manual intervention. The marker is cycle-specific, so idempotent re-runs skip a duplicate post. The existing cycle cap (3) and no-progress guard still hold. |
| **LGTM mention** | When verdict is `Looks good to me`, the comment body includes `@fraserbrookhouse` so the maintainer receives a GitHub notification. |
| **What it does** | Runs `code-reviewer` sub-agent; posts `<!-- auto-review:N -->` comment; upgrades project status to **Ready to merge** if verdict is `Looks good to me`; auto-posts `/fix` if verdict is `Needs fixes` |
| **Check gate** | Final job step exits non-zero when the latest verdict scoped to the current head SHA is `Needs fixes` - PR checks show red until a `/fix` cycle lands an approval at a new SHA |

**Service Worker cache changes (#1247).** vitest cannot surface failures that only manifest under the deployed CDN's URL shape (versioned cache buckets, Vercel `dpl` image params, cache-tag expiry branches). Treat `code-reviewer` as a blocking gate, not advisory, for any change under `app/sw.ts`, `app/sw/**`, or `lib/pwa/**`. See retros #1166 and #1168 for the cases that prompted this.

---

### `auto-retro.yml` - Auto Retro

| | |
|---|---|
| **Trigger** | `issues: [closed]` |
| **Skips** | Issues closed as `not_planned`; issues with no linked merged PR; issues already having an `<!-- auto-retro -->` comment |
| **What it does** | Fetches the PR diff and metadata; posts a single `<!-- auto-retro -->` comment on the closed issue covering: which sub-agents ran, what worked, what was overhead, and one transferable lesson |
| **Scope** | Process reflection only - no code change recommendations |

---

### `auto-retro-harvest.yml` - Auto Retro Harvest

| | |
|---|---|
| **Trigger** | Weekly cron Monday 10:00 UTC + `workflow_dispatch` |
| **Inputs** | Every `<!-- auto-retro -->` comment posted by `auto-retro.yml` across closed issues. Purely additive - does not change `auto-retro.yml`'s per-issue behaviour. |
| **Output 1 - digest** | Regenerates `docs/retros.md` wholesale, aggregating every retro most-recent-first, and commits it to `qa` (`docs(retros): refresh retrospectives digest [skip ci]`). Regenerating the whole file each run is the idempotency mechanism - no per-entry markers, a no-op commit is skipped via `git diff --cached --quiet`. |
| **Output 2 - recurring-pattern auto-file** | When the *same concrete problem* recurs across **≥ 3 distinct retros**, files exactly one tracking issue for that pattern. Behavioural-rule lessons (reusable conventions) are not filed - they stay in the digest only. There is deliberately no per-lesson filer. |
| **Idempotency key** | Per-pattern body marker `<!-- auto-retro-pattern:<slug> -->`. A pattern with an open marker-carrying issue - or a closed one within the last 60 days - is not re-filed. The slug is derived from the concrete problem, not the contributing issues, so it is stable across runs. |
| **Issue-filing rules** | Auto-filed issues are `priority:later` only - never `auto`, never `priority:now`/`priority:next`. The user owns promotion. One issue per cluster; contributing retro comments linked as evidence. |
| **No-op** | Zero retros found → writes nothing, files nothing. No cluster reaching 3 → digest still refreshed, no issues filed. |
| **Auth** | `actions/create-github-app-token@v3` with `vars.BOT_APP_ID` / `secrets.BOT_APP_PRIVATE_KEY`; `permissions` `contents: write` (commit the digest) + `issues: write` (file tracking issues), rest read |

---

### `auto-status.yml` - Auto Status

| | |
|---|---|
| **Trigger** | `issues: [closed]` |
| **What it does** | Moves the issue to **Done** on the project board - regardless of how it was closed (PR merge, manual close, or `not_planned`) |
| **Note** | All other project-status transitions are driven from `auto-issue.yml` and `auto-pr.yml`. This workflow owns only the terminal **Done** state. |

---

### `auto-close-umbrella.yml` - Auto Close Umbrella

| | |
|---|---|
| **Trigger** | `issues: [closed]`; `workflow_dispatch` (inputs `issue_number` required, `dry_run` boolean default `true`) |
| **Job** | `close-umbrella` |
| **What it does** | When a child issue closes, finds any OPEN umbrella that tracks it, checks whether ALL of that umbrella's tracked children are now closed, and if so closes the umbrella with a comment noting all tracked items are complete. Saves the maintainer from hand-closing digests / epics once their children ship. |
| **How children are declared** | A task-list of `#N` refs in the umbrella body (`- [ ] #N` / `- [x] #N`). The checkbox tick is not trusted - each child's real state is read from the API. GitHub-native sub-issues are read as a best-effort secondary signal and unioned in; sub-issue API errors are non-fatal. Plain `#N` prose refs are ignored. |
| **Opt-in gate** | Fires only for umbrellas carrying the `auto-close-when-complete` label - the umbrella, not the child, must carry it. Weekly digests (snapshots) should carry it by default; open-ended epics (e.g. #1445) deliberately omit it so they never auto-close prematurely. The maintainer creates the label once (no label-sync manifest exists in `.github/`). |
| **Candidate lookup** | Lists open issues with the gate label and filters locally with jq on the fetched body - never `gh issue list --search '... in:body'`, which the GitHub search index strips (same caveat as `auto-retro-harvest.yml`). |
| **Child-reopened** | No `reopened` trigger by design - reopening a child leaves the umbrella closed; a human reopens it if needed. Avoids open/close thrash. |
| **Batch-close race** | A `qa -> main` promotion PR closing ~20 issues fires ~20 runs against the same umbrella; the "already closed" guard plus `cancel-in-progress: false` make this safe (first run closes, the rest find it closed). |
| **Dry run** | `workflow_dispatch` with `dry_run: true` posts a `[DRY RUN] Would close ...` comment instead of closing. |
| **Token** | Repo-scoped App token via `actions/create-github-app-token@v3` (mirrors `auto-status.yml`). No board move - this workflow only closes the issue. |
| **Required check** | No - board / backlog hygiene, does not gate merge. |
| **Concurrency** | `auto-close-umbrella-${{ github.event.issue.number || github.event.inputs.issue_number }}` (the manual-dispatch branch produces a distinct key), `cancel-in-progress: false`. |

---

### `qa-issue-label.yml` - QA Issue Label

| | |
|---|---|
| **Trigger** | `pull_request: [closed]`, guarded to merged PRs only |
| **Job** | `label` (check name `Label referenced issues`) |
| **What it does** | Bridges the gap left by GitHub auto-closing `closes #N` issues only on the default branch. When a PR merges into `qa`, it parses the PR body and commit messages for `closes/fixes/resolves #N` keywords and adds the `status:in-qa` label to each referenced issue - a board signal that the work is done and staged. When the `qa -> main` promotion PR merges (`base: main`, `head: qa`), GitHub auto-closes those issues on `main`, so this run strips the now-stale `status:in-qa` label for tidiness. |
| **Label creation** | The `status:in-qa` label (colon-namespaced, consistent with `priority:*`) is created idempotently on first run via `gh label create ... \|\| true`. The workflow owns the label - it is not created by hand. |
| **Scope** | Label only. Project-board column transitions are deliberately left to `auto-status.yml`; this workflow never touches board columns. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard - same pattern as `auto-review.yml`; fork PRs run with a read-only token and cannot edit issue labels). |
| **Idempotency** | `gh label create ... \|\| true` no-ops once the label exists; `--add-label` / `--remove-label` are idempotent by nature, so a re-run changes nothing. |
| **Required check** | No - board hygiene only, does not gate merge. |
| **Concurrency** | Serialized per PR (`cancel-in-progress: false`). |

---

### `pr-check-monitor.yml` - PR Check Monitor

| | |
|---|---|
| **Trigger** | `schedule: '*/15 * * * *'` (every 15 minutes); `workflow_dispatch` |
| **What it does** | Lists all open, non-draft, non-fork PRs older than 20 minutes and calls `GET /repos/{owner}/{repo}/commits/{sha}/check-runs?check_name=test` for each. If no check run exists (CI was never dispatched), posts a `<!-- pr-check-monitor:{sha} -->` comment on the PR with recovery instructions. |
| **Dedup** | The SHA-scoped HTML marker prevents duplicate alerts on the same HEAD commit. Re-running on a healthy PR (CI dispatched) produces no comment. |
| **Why schedule?** | `schedule`-triggered workflows operate on GitHub's internal cron queue, independently of webhook dispatch - they continue firing even when `push`/`pull_request` event dispatch is throttled. |
| **Permissions** | `contents: read`, `pull-requests: write`. `GITHUB_TOKEN` only - no Claude, no App token. |
| **Recovery time** | A stuck PR typically receives an alert within 30 minutes of the 20-minute threshold passing (15-minute cron interval plus GitHub cron jitter, which can exceed 15 minutes under load). |

---

### `cron-health-monitor.yml` - Cron Health Monitor

| | |
|---|---|
| **Trigger** | `schedule: '0 10 * * 1'` (weekly, Monday 10:00 UTC); `workflow_dispatch` |
| **What it does** | For each cron-driven workflow (`auto-release`, `refresh-user-count`, `monitor-grade-log-divergence`, the four weekly digests `auto-workflow-suggest` / `auto-codequality-suggest` / `auto-app-suggest` / `auto-backlog-groom`, and the monthly `auto-deep-audit`), calls `gh run list --workflow=<file> --event schedule --branch <default-branch>` and checks (a) a scheduled run exists within the expected interval (48h for daily workflows, 240h for weekly, 840h for monthly) and (b) the most recent completed run succeeded - any non-`success`/`skipped` conclusion (`failure`, `timed_out`, `startup_failure`, `cancelled`) counts as unhealthy. On a stale or unhealthy workflow it opens or updates a per-workflow tracking issue. If the `gh run list` call itself errors (transient GitHub API failure), that workflow is skipped for the run rather than treated as stale, so an outage cannot spam a tracking issue for every monitored workflow at once. |
| **Dedup** | A `<!-- cron-health-monitor:{file} -->` HTML marker keyed by workflow filename gives each watched workflow its own tracking issue. Re-runs edit that issue in place and add a re-check comment rather than opening duplicates. When a workflow recovers, the monitor closes its tracking issue automatically. |
| **Why schedule?** | The monitor runs on GitHub's internal cron queue, independently of the workflows it watches - so it still fires even if those workflows have stopped. It cannot detect its own staleness, but the blast radius of one un-monitored monitor is small. |
| **Permissions** | `contents: read`, `actions: read`, `issues: write`. `GITHUB_TOKEN` only - no Claude, no App token, no app checkout. |
| **Why monitor cron workflows?** | GitHub disables scheduled workflows after 60 days of repo inactivity, and a malformed cron or an expired secret can silently stop a workflow firing - none of which produces an alert on its own. `pr-check-monitor` watches open PRs; this watches the schedule-driven workflows themselves. |

---

### `issue-overlap-scan.yml` - Issue Overlap Scan

| | |
|---|---|
| **Trigger** | Issues labeled `auto`; `workflow_dispatch` (manual) |
| **Scope** | Only `priority:now` and `priority:next` issues |
| **Kinds** | `merge` (duplicate intent), `overlap` (same area, partial intersection), `conflict` (mutually exclusive - one blocks the other) |
| **Markers** | Posts `<!-- overlap-scan:i+j:<kind> -->` on both issues in each pair; de-dupes on exact (i, j, kind) across runs |
| **Load-bearing** | `conflict` markers are checked by `auto-issue.yml`'s implement job - `/go` refuses to run on an issue with an unresolved conflict marker linked to an open issue |
| **Plan annotation** | When overlap-scan markers exist on an issue, the plan-job and replan-job append a `**Related issues:**` section to the plan body (one line per linked issue, format `#<num> (<kind>): <reason>`) - informational only, does not affect scope decisions |

---

### `auto-workflow-suggest.yml` - Weekly Workflow Digest

| | |
|---|---|
| **Trigger** | Weekly cron Monday 09:00 UTC + `workflow_dispatch` |
| **Idempotency key** | ISO week string in issue title (`Weekly workflow review - YYYY-Www`). Checks all states (open + closed). |
| **Inputs** | Retro comments (last 30d), PR review comments on `auto/*` PRs (last 30d), WIP-salvage commits (last 30d), agent invocation patterns in merged PR bodies |
| **Output** | One digest issue per ISO week, ≤5 curated items, each with evidence links and a priority label recommendation |
| **No-op** | Skips silently when nothing crosses the relevance threshold or when a digest issue already exists for the week |
| **Scope** | Only proposes changes to `.github/workflows/**`, `.claude/agents/**`, `WORKFLOW.md`, or `AGENTS.md` - never app code or individual issue filings |
| **Label** | Digest issue is labelled `area:workflow`; label is created if absent |

---

### `auto-codequality-suggest.yml` - Weekly Code-Quality Digest

| | |
|---|---|
| **Trigger** | Weekly cron Wednesday 09:00 UTC + `workflow_dispatch` |
| **Idempotency key** | ISO week string in issue title (`Weekly code-quality review - YYYY-Www`). Checks all states (open + closed). |
| **Inputs** | Files changed in `app/**`, `components/**`, `lib/**`, `db/**` in the last 30 days |
| **Signal constraints** | A - Recency filter (only recently-changed files); B - Recurrence filter (only patterns spanning ≥2 files) |
| **Output** | One digest issue per ISO week, ≤5 curated items, each with file paths, a concrete evidence snippet, and a `- [ ] File this as an issue <!-- proposal:N -->` checkbox |
| **No-op** | Skips silently when nothing crosses the recurrence threshold or when a digest issue already exists for the week |
| **Scope** | Tech debt, missing tests, dead code, and accessibility gaps within `app/**`, `components/**`, `lib/**`, or `db/**` - never workflow files, feature ideas, or individual issue filings |
| **Label** | Digest issue is labelled `area:app`; label is created if absent |

---

### `auto-app-suggest.yml` - Weekly Feature Ideas Digest

| | |
|---|---|
| **Trigger** | Weekly cron Thursday 09:00 UTC + `workflow_dispatch` |
| **Idempotency key** | ISO week string in issue title (`Weekly feature ideas - YYYY-Www`). Checks all states (open + closed). |
| **Inputs** | Open enhancement issues (clusters/gaps); user-facing pages under `app/**/page.tsx` and `components/**`; README "Features" section vs. codebase; last 3 CHANGELOG releases; latest `auto-workflow-suggest` digest (UX themes) |
| **Output** | One digest issue per ISO week, ≤5 proposals, each with surface, why-it-matters, priority, and a `- [ ] File this as an issue <!-- proposal:N -->` checkbox |
| **No-op** | Skips silently when nothing crosses the bar or when a digest issue already exists for the week |
| **Scope** | User-facing behaviour changes only - explicitly forbids refactors, test additions, dead-code removal, dependency bumps, accessibility gaps, and CI/workflow changes |
| **Labels** | Digest issue is labelled `area:app`, `enhancement`, `priority:later`; labels are created if absent |

---

### `auto-digest-fanout.yml` - Digest Fan-out

| | |
|---|---|
| **Trigger** | `issues: [edited]` |
| **Guard** | Issue authored by `poke-memory-bot[bot]` AND body contains `<!-- auto-codequality-suggest -->` or `<!-- auto-app-suggest -->` (#1859 - digest bodies are user-editable, so the marker alone is spoofable) |
| **Permissions** | `issues: write` only - never touches the git tree |
| **Concurrency** | `digest-fanout-{issue}`, `cancel-in-progress: false` - queues runs, never cancels, so each re-trigger after a body PATCH does a fast no-op |
| **What it does** | For each proposal whose `- [ ] File this as an issue <!-- proposal:N -->` checkbox is newly checked: extracts the title and `**Priority:**` label, creates a child issue (with `area:app` and the extracted priority, never `auto`), writes ` → filed as #N` onto the proposal heading as an idempotency marker, then posts a single summary comment on the parent |
| **Idempotency** | The `→ filed as #N` back-marker on the heading is the source of truth - checked proposals that already carry a marker are skipped unconditionally |
| **Un-check behaviour** | Un-checking a filed proposal does NOT close or delete the child - manual cleanup only (out of scope for v1) |
| **Auth** | `actions/create-github-app-token@v3` with `vars.BOT_APP_ID` / `secrets.BOT_APP_PRIVATE_KEY` |

---

### `auto-backlog-groom.yml` - Weekly Backlog Grooming Digest

| | |
|---|---|
| **Trigger** | Weekly cron Friday 09:00 UTC + `workflow_dispatch` |
| **Idempotency key** | ISO week string in issue title (`Weekly backlog grooming - YYYY-Www`). Checks all states (open + closed). |
| **Inputs** | All open issues across `priority:now`, `priority:next`, `priority:later`; comment threads for retro signals, blocking cross-references, and overlap-scan conflict markers |
| **Staleness thresholds** | `priority:now` ≥ 4 weeks, `priority:next` ≥ 8 weeks, `priority:later` ≥ 16 weeks |
| **Move types** | Promote, Demote, Leapfrog, Flag stale |
| **Output** | One digest issue per ISO week, ≤5 curated proposals, each citing a specific named signal |
| **No-op** | Skips silently when nothing crosses the signal bar or when a digest issue already exists for the week |
| **Scope** | Proposals only - never edits labels or moves issues |
| **Label** | Digest issue is labelled `area:backlog`; label is created if absent |

---

### `auto-deep-audit.yml` - Monthly Deep Audit

| | |
|---|---|
| **Trigger** | Monthly cron 1st of the month 08:00 UTC + `workflow_dispatch` (optional `axis` input forces a single axis) |
| **Rotation** | One rotating workflow covering four axes. Keyed on calendar month: code-quality (#739) and test-coverage (#741) run **every** month; workflow-structural (#743) runs in months 1/4/7/10; sub-agent roster (#744) runs in months 2/5/8/11. A normal month runs two axes; a quarter-boundary month runs three. |
| **Idempotency key** | Per-axis dated comment marker `<!-- auto-deep-audit:<axis>:YYYY-MM -->` on the umbrella issue. An axis whose marker for the current month already exists is skipped. |
| **Inputs** | Full codebase (no recency window) - distinguishes a deep audit from the 30-day `auto-*-suggest.yml` digests. Code-quality scans `app/**`/`components/**`/`lib/**`/`db/**`; workflow scans `.github/workflows/**` plus `gh run list` history; sub-agent scans `.claude/agents/**`. |
| **Output** | A fresh dated report comment on the **existing** umbrella issue (#739/#741/#743/#744 - reused, never re-spawned), plus one scoped follow-up issue per finding (≤8 per axis), each labelled `priority:later`. |
| **No-op** | If an axis finds nothing actionable it still posts a marker-carrying "no findings" comment (so idempotency holds) and files no issues. |
| **Issue-filing rules** | Follow-up issues are `priority:later` only - never `auto`, never `priority:now`/`priority:next`. The user owns promotion. |
| **Auth** | `actions/create-github-app-token@v3` with `vars.BOT_APP_ID` / `secrets.BOT_APP_PRIVATE_KEY`; minimal `permissions` (`issues: write`, rest read) |

---

### `settings-coverage-audit.yml` - Settings Coverage Audit

| | |
|---|---|
| **Trigger** | `pull_request` (opened/synchronize/reopened) path-filtered to `lib/settings/**`, `lib/superuser/**`, `components/superuser/**`, `components/settings/**`, `app/settings/**` + `workflow_dispatch`. Event-driven rather than cron - settings-coverage drift (#738, exemplar #731) is introduced by code changes, not by the calendar. |
| **Idempotency key** | Monthly dated comment marker `<!-- settings-coverage-audit:YYYY-MM -->` on umbrella issue #738. Several settings PRs in one month trigger the audit once, not once per PR. |
| **Inputs** | Full-codebase audit of every `UserSettings` field and every superuser flag against every code path that should honour it (card-type render paths, daily caps, practice scope, secondary surfaces). |
| **Output** | A dated report comment on existing umbrella issue #738, plus one scoped `priority:later` follow-up issue per missed-path finding (≤8). |
| **No-op** | Posts a marker-carrying "no missed paths" comment when clean; files no issues. Advisory - never fails the job or blocks the PR. |
| **Fork PRs** | Skipped (`head.repo.fork == false` guard - fork PRs run with a read-only token and cannot post comments or create issues). |
| **Auth** | `actions/create-github-app-token@v3` with `vars.BOT_APP_ID` / `secrets.BOT_APP_PRIVATE_KEY`; minimal `permissions` (`issues: write`, rest read) |

---

### `vercel-failure-autofix.yml` - Vercel Auto-fix

| | |
|---|---|
| **Trigger** | `deployment_status: failure` on branches matching `auto/issue-*` |
| **Requires** | `VERCEL_TOKEN` repo secret (Vercel personal access token scoped to the account owning the deployment). No-op when the secret is absent. |
| **What it does** | Fetches the error excerpt from Vercel's events API; posts a `/fix` comment on the PR - which triggers `auto-pr.yml`'s fix cycle |
| **Idempotency** | Skips if a `<!-- vercel-autofix -->` comment was posted on the same PR in the last 10 minutes (Vercel sometimes fires multiple `failure` events for one deployment) |

---

### `ci-failure-autofix.yml` - CI Auto-fix

| | |
|---|---|
| **Trigger** | `workflow_run` on `CI` workflow `completed` with `conclusion == 'failure'`, branches matching `auto/issue-*` |
| **What it does** | Finds the failed `test` job, fetches the last 80 lines of its log, and posts a `/fix` comment on the PR - which triggers `auto-pr.yml`'s fix cycle |
| **Idempotency** | Skips if a `<!-- ci-autofix:$RUN_ID -->` comment already exists on the PR - exact match by run ID, so re-delivery of the same `workflow_run` event is a no-op |
| **Cycle-cap interaction** | `auto-pr.yml`'s 3-cycle cap does not prevent this workflow from posting a `/fix` on the next CI failure. On a capped PR, `auto-pr.yml` will silently drop the comment; no further fix cycles run, but stale `/fix` comments may accumulate. |
| **Race-condition guard** | When a `/fix` posted by this workflow queues behind an active `auto-pr.yml` run, the queued run may encounter an LGTM verdict posted by the active run even though CI is still red. `auto-pr.yml`'s CI pre-flight step (`Check CI status at HEAD`) detects this: it reads the PR's `statusCheckRollup` before the agent starts and sets `CI_FAILING_AT_HEAD=true` when CI is failing. The agent bypasses the LGTM short-circuit when that env var is set, so the fix cycle runs regardless of what auto-review verdict was posted by the previous cycle. |
| **Coupling** | Job selector matches by name `"test"` (the API-returned display name). After any `ci.yml` change, verify the name with `gh api repos/{owner}/{repo}/actions/runs/{id}/jobs --jq '.jobs[].name'` and update the `jq` selector in the `Fetch failing job log` step if needed. |

---

### `vercel-preview-on-ready.yml` - Vercel Preview on Ready

| | |
|---|---|
| **Status** | **Disabled** (`disabled_manually`). Under the qa staging flow, QA happens on the bundled `qa` branch via `qa-preview-deploy.yml`, so per-PR previews are redundant and were retired to stay within Vercel's deploy rate limit (#814). Re-enable with `gh workflow enable "Vercel Preview on Ready"` if per-PR previews are wanted again. |
| **Trigger** | `workflow_run` on `CI` (`completed`); `issue_comment: created` |
| **Gate** | Fires the Vercel Deploy Hook only when both conditions hold on the same HEAD SHA: the `test` check is `success` AND the latest **bot-authored** `<!-- auto-review:N -->` comment scoped to that SHA carries `Verdict: Looks good to me`. The auto-review SHA scope comes from the `<!-- auto-review-sha:<sha> -->` row that `auto-review.yml` writes on every comment. Only comments authored by `poke-memory-bot[bot]` count for the verdict, the idempotency marker, and the `issue_comment` trigger itself (#1859). |
| **Manual override** | A `/preview` PR comment from OWNER / MEMBER / COLLABORATOR bypasses both gates and fires the hook unconditionally - for mid-iteration peeks before LGTM. The association is checked at the job trigger as well as in the override step (#1859). |
| **Fork guard** | `workflow_run` arm requires `head_repository.fork == false`; the `issue_comment` arm requires bot authorship for review-marker comments and OWNER / MEMBER / COLLABORATOR for `/preview` (#1859). |
| **Idempotency** | Posts `<!-- vercel-preview-fired:<sha> -->` on the PR after a successful fire; subsequent re-evaluations at the same SHA are no-ops. |
| **Why two triggers** | CI and auto-review run independently; whichever finishes second flips the gate. Both events re-evaluate against the current HEAD SHA, so order doesn't matter. |
| **qa promotion PRs** | Skipped - a `qa -> main` PR's head branch is `qa`, and its preview is handled by `qa-preview-deploy.yml`. Firing here too would double-deploy `qa`. |
| **Required secrets** | `VERCEL_DEPLOY_HOOK_URL`, `BOT_APP_PRIVATE_KEY`, `BOT_APP_ID` (var). |
| **Context** | `vercel.json` sets `git.deploymentEnabled = { "**": false, "main": true }`, so non-`main` branches do not auto-deploy. This workflow is the path that creates preview deployments for batch / feature PRs. Production deploys on `main` are unaffected. `e2e.yml` triggers on the `deployment_status` that Vercel fires when the gated preview deploys, so it inherits the gate. |

---

### `qa-preview-deploy.yml` - QA Preview Deploy

| | |
|---|---|
| **Trigger** | `workflow_dispatch` only |
| **Job** | `deploy` |
| **What it does** | Fires the Vercel Deploy Hook with `?ref=qa`, creating a preview deployment of the `qa` staging branch. Invoked by the `/batch-issues` skill at the end of its queue drain (`gh workflow run "QA Preview Deploy"`), or manually from the Actions tab. |
| **Why a dedicated workflow** | The deploy-hook URL is a repo secret, so the deploy must be fired server-side, not from the local `/batch-issues` session. `?ref=qa` is hardcoded - dispatching from the default branch would otherwise resolve `github.ref` to `main`. |
| **Required secrets** | `VERCEL_DEPLOY_HOOK_URL`. |
| **Concurrency** | `group: qa-preview-deploy` with `cancel-in-progress: false`. |

---

### `stale-preview-check.yml` - Stale qa preview check

| | |
|---|---|
| **Trigger** | `schedule` (daily `30 8 * * *` cron, 08:30 UTC, after the auto-release window) and `workflow_dispatch`. |
| **Job** | `check` |
| **What it does** | Compares `origin/qa`'s tip SHA with the head SHA of the most recent `QA Preview Deploy` run. When they diverge and an open `qa -> main` promotion PR exists, upserts a marker comment on that PR (HTML marker `<!-- stale-preview-check -->`) linking to the `QA Preview Deploy` dispatch URL. When the preview catches up, removes the marker comment. |
| **Why a dedicated workflow** | The `/batch-issues` skill's wrap-up rule "re-fire the preview after any qa-landing mini-batch work" only fires inside an active session. When mini-batch work lands on `qa` outside a session (a manual PR, an `/auto` run, a follow-up direct push), nobody re-fires the deploy and the maintainer QAs against a stale preview. This cron catches that gap. (#1333.) |
| **Permissions** | `contents: read`, `pull-requests: write`, `actions: read` - the third is required so `gh run list --workflow="QA Preview Deploy"` can read past run metadata under `GITHUB_TOKEN`. |
| **Idempotency** | The marker comment is upserted (patched in place) rather than appended, so a missed cron tick does not produce a stack of duplicate comments. |
| **Required secrets** | None (uses `GITHUB_TOKEN`). |
| **Concurrency** | Default; no concurrency group. The work is cheap (a few API calls) and runs once per day. |

---

### `cut-release.yml` - Cut Release

| | |
|---|---|
| **Trigger** | `workflow_dispatch` only. Any maintainer dispatches it to open the correct `qa -> main` promotion PR for a **hand-rolled** release (the path `/batch-issues` automates at end of drain; #1715). |
| **What it does** | (1) Computes the `origin/main..origin/qa` range and parses `closes/fixes/resolves #N` from both the range's commit messages and each linked merged PR's body (the same keyword set GitHub honours, mirroring `qa-issue-label.yml`), aggregating a `## Closes` section so the promotion closes every referenced issue on merge. (2) Runs the aggregate diff-coverage gate over the whole `qa`-vs-`main` diff (`git diff origin/main...origin/qa \| node scripts/diff-coverage.mjs`, WORKFLOW.md "Batch-drain pre-flight") and surfaces the result in the PR body. (3) Opens, or edits in place if already open, the `qa -> main` PR as a **draft** with the body + summary. |
| **Why** | A hand-rolled promotion opened by hand skips the aggregated `Closes #N` and the aggregate diff-coverage check. The v0.10.35 release missed every `Closes #N` (11 issues left open, reconciled manually + the #1714 label safety net) and skipped the aggregate check. This makes the correct promotion PR a single dispatch, whether or not the batch came through `/batch-issues` (it reads the live range, not session state). |
| **Idempotency** | Looks up an existing open PR (`--base main --head qa`) and edits it; never opens a duplicate on re-dispatch. |
| **Coverage breach** | Below-bar aggregate diff coverage fails the job *after* the PR is opened/updated (so the maintainer still gets the PR), unless the `coverage_fail_on_breach` dispatch input is set false (annotate-only). |
| **Token** | Mints a `poke-memory-bot` App installation token (same as `auto-release.yml`) so the PR behaves like a bot-opened promotion and `auto-review.yml`'s `head.ref == 'qa'` skip applies. **Does not merge** - the maintainer's preview QA is the gate. |
| **Concurrency** | Shares `group: auto-release` (`cancel-in-progress: false`) so a dispatch cannot race a release run touching the same qa/main state. |

---

### `auto-release.yml` - Auto Release

| | |
|---|---|
| **Trigger** | `pull_request` (`closed`) into `main` - the primary trigger, a merged `qa -> main` promotion PR; `schedule` (daily `0 9 * * *` cron - 09:00 UTC) as a safety net; `workflow_dispatch` for manual cuts. The job `if:` filters the `pull_request` trigger to merged PRs whose head branch is `qa`. |
| **Gate** | Each run cuts at most one release - `cut-release.mjs` writes `skip=true` when no fragments exist. The release commit + tag are a `push` to `main`, which does not match the `pull_request`/`schedule`/`workflow_dispatch` triggers, so the release commit cannot re-fire the workflow. |
| **What it does** | Runs `.github/scripts/cut-release.mjs`: scans `changelog.d/unreleased/*.md` fragments, groups bullets by `kind` into Keep-a-Changelog subsections, decides bump type (`minor-bump` fragment or Added/Changed/Removed/Deprecated → minor; only Fixed/Security → patch), writes the new `## [X.Y.Z]` section into `CHANGELOG.md`, bumps `package.json`, deletes consumed fragments (`git rm changelog.d/unreleased/*.md`), commits as `chore(release): vX.Y.Z (TYPE) [skip ci]`, tags `vX.Y.Z`, pushes commit + tag to `main`, and creates a matching GitHub Release with the assembled section as the body |
| **Fragment parsing** | `cut-release.mjs` and the PR-time lint (`scripts/lint-changelog-fragments.mjs`, in the `lint` chain) share one parser, `scripts/lib/changelog-fragment.mjs`, so the lint accepts exactly what the cut accepts. The parser tolerates extra front-matter keys (e.g. `issue:`); only `kind:` is required. Before #1664 a strict cut-side regex diverged from the tolerant lint and an `issue:`-bearing fragment broke the cut. |
| **No-op condition** | No `*.md` files in `changelog.d/unreleased/` → script writes `skip=true` and the workflow exits cleanly. Internal-only changes without a fragment do not trigger a release. |
| **Bootstrap** | One-time: on first run, if no `v0.1.0` tag exists, creates `v0.1.0` at SHA `cddb3a8` (last commit whose CHANGELOG content matched the current `[0.1.0]` section) and the matching GitHub Release. Subsequent runs no-op the bootstrap. |
| **Loop break** | Structural: none of the triggers (`pull_request`, `schedule`, `workflow_dispatch`) is `push`, so the release commit landing on `main` cannot re-fire this workflow. The `[skip ci]` marker on the release commit is defence in depth only - it suppresses the `push`-triggered workflows (`ci.yml`, `migration-check.yml`) on that commit, but it is not what stops `auto-release.yml` from looping. |
| **qa reset** | On a `qa -> main` trigger only (`github.event_name == 'pull_request'`), a final step force-updates `qa` to `main` (`git push origin +HEAD:refs/heads/qa`) so the next batch run starts from a clean integration branch. `schedule`/`workflow_dispatch` runs skip this - `qa` may hold in-progress batch work. |
| **qa drift guard** | The reset step is gated on `success()`, so a failed prior step (e.g. a `cut-release` crash) skips it, leaving `qa` un-reset (#1659/#1664). The sibling `qa-drift-check` job runs on the daily `schedule`/`workflow_dispatch` (not `pull_request`, to avoid racing the reset), checks `git merge-base --is-ancestor origin/main origin/qa`, and opens/updates a marker-keyed (`<!-- qa-drift-check -->`) tracking issue when `main` is not an ancestor of `qa`. It is **alert-only** (no auto-reset): `qa` may carry un-promoted batch work a force-reset would destroy, so reconciliation stays human-in-the-loop. The issue auto-closes once `qa` is back in sync. Permissions: `contents: read` + `issues: write` (uses `GITHUB_TOKEN`, no App token / push). |
| **Vercel interaction** | The release commit touches `package.json`, which is in `WATCH_PATHS` in `scripts/vercel-ignored-build.sh` - so Vercel rebuilds and the in-app version banner (`NEXT_PUBLIC_APP_VERSION`) updates. |
| **Prerequisite** | The `poke-memory-bot` App must be a bypass actor on **both** the `main-protection` ruleset (to land the release commit on `main`) and the `qa-staging` ruleset (to force-push the qa reset). If a push step fails with a protected-branch error, that is the missing setup. |
| **Concurrency** | `group: auto-release` with `cancel-in-progress: false` - back-to-back merges queue rather than collapse. |

---

### `monitor-grade-log-divergence.yml` - Monitor grade_log divergence

| | |
|---|---|
| **Trigger** | Daily `schedule` (`0 8 * * *` - 08:00 UTC); `workflow_dispatch` (with an optional `threshold` input overriding the default divergence threshold of 5) |
| **Job** | `check` |
| **What it does** | Runs `.github/scripts/check-grade-log-divergence.mjs`, which flags users whose `grade_log` shows activity but whose `card_reviews` table is missing the corresponding rows - the #584 sync-break signature. If divergence is detected, the workflow opens an issue titled `[monitoring] grade_log divergence detected (N users)` from a generated body file, labelled `monitoring` and `area:workflow`. The `monitoring` label is self-healing - created with `gh label create ... || true`. |
| **Required secrets** | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`. |
| **Cron-only** | Does not fire on push, so the workflow file landing in a PR will not raise an alert on the PR itself - the first real run is the next 08:00 UTC tick after merge. |
| **Concurrency** | `group: monitor-grade-log-divergence` with `cancel-in-progress: false`. |

---

### `refresh-user-count.yml` - Refresh user count badge

| | |
|---|---|
| **Trigger** | Daily `schedule` (`17 6 * * *` - 06:17 UTC); `workflow_dispatch` |
| **Job** | `refresh` |
| **What it does** | Runs `scripts/refresh-user-count.mjs` to refresh `.github/stats/users.json`, the source for the README user-count Shields.io badge (#400). If the file changed, it commits as `chore(stats): refresh user count [skip ci]` and pushes directly to `main`. The commit is authored by the `poke-memory-bot` App identity, so it lands despite branch protection; the `[skip ci]` marker stops the push retriggering any push-triggered workflow. |
| **Required secrets** | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `BOT_APP_PRIVATE_KEY`, `BOT_APP_ID` (var). |
| **Concurrency** | `group: refresh-user-count` with `cancel-in-progress: false`. |

---

### `pokeapi-species-monitor.yml` - PokéAPI Species Monitor

| | |
|---|---|
| **Trigger** | Monthly `schedule` (`0 7 1 * *` - 07:00 UTC on the 1st); `workflow_dispatch`. Gated `if: github.repository == 'Frazzled-Productions/poke-memory'`. |
| **Job** | `monitor` |
| **What it does** | Detects upstream species growth (#1739, parent #1644). One HTTP call reads the live `/pokemon-species` `count`; it compares against the seeded default-form count derived from `lib/pokemon/generated-core.json` filtered to `isDefaultForm` (1025 today). On growth it opens, or updates in place (HTML marker `<!-- pokeapi-species-monitor -->`), a `priority:later` tracking issue listing the new species ids; no-op when counts match. The re-seed + binary review stay human-driven (no auto-PR). Species-count-to-species-count avoids the 10001+ mega/regional/gigantamax trap - never switch to `/pokemon`, never use the raw 1174 record count. |
| **Why not a failure monitor** | The alert IS the issue. The job exits 0 on growth (it files/updates the issue), so `cron-health-monitor.yml` does not flag it as failing. |
| **Health watch** | Registered in `cron-health-monitor.yml`'s `WORKFLOWS` list at 840h tolerance (matching the monthly `auto-deep-audit` entry). |
| **Required check** | No - cron, not a PR gate. |
| **Concurrency** | `group: pokeapi-species-monitor` with `cancel-in-progress: false`. |

---

## Build gates

Two separate gates catch type/build/test errors at different points:

### Local pre-PR gate (`npm run pre-pr`)

After pushing, before opening the PR, run **`npm run pre-pr`** (`scripts/pre-pr.mjs`, #1716) - it runs the full gate in order, fail-fast: lint -> typecheck -> build -> test -> coverage -> diff-coverage, and exits non-zero on the first failure. This is THE local gate; it mirrors the CI required checks (CI remains the enforcement layer) and removes the per-step skip risk of re-deriving the chain by hand.

- `npm run lint` (em-dash + i18n + pseudo-locale + agents-size) catches errors that do **not** surface in typecheck/build/test, so a hand-run that omits it ships a red PR (#1541).
- The diff-coverage leg is the one that has bitten most (green-locally-then-red on CI's per-diff bar, #1642 / #1646 / #1649): `test:coverage` enforces only the global floor; the 90% per-diff patch bar runs after it against the fresh `coverage/coverage-final.json`. Override the diff base for a main-targeting PR with `DIFF_COVERAGE_BASE=origin/main npm run pre-pr`.
- An opt-in `pre-push` git hook running the same command is documented but not installed by default.

**Pre-PR e2e smoke** for high-surface-area diffs (touching `app/layout.tsx`, `app/page.tsx`, `components/onboarding/**`, `components/Nav.tsx` / `BottomTabBar.tsx` / `MobileNavPaddingWrapper.tsx`, `lib/settings/persistence.ts`, or `playwright.config.ts`): run `scripts/pre-pr-smoke.sh` (chromium-only subset in the pinned Docker image). Same two-attempt budget.

**Push discipline.** Push with an explicit `git push origin <branch>` - never a bare `git push`. A worktree created via `git worktree add -b <branch> origin/qa` sets the branch's upstream to `origin/qa`, so a bare `git push` does NOT update `origin/<branch>`: at best it fast-fails (rejected, harmless), and at worst it silently pushes to `origin/qa` or no-ops, leaving the PR branch stale and CI red on the old commit. Always name the remote and branch (mirrors the `gh pr create --head <branch>` rule). Worked example: a pseudo-locale regen "pushed" but never landed on the PR branch (#1474).

### Pre-PR gate (`auto-issue.yml` only)

Runs before opening a PR: `npm run typecheck && npm run build && npm test`

- Orchestrator is allowed up to **2 targeted fix attempts** (commit + push + retry).
- After the second failure: post a comment on the issue with the last 80 lines of build output and stop. Branch stays pushed for manual inspection.
- Goal: surface errors in the same run that produced them, before Vercel or CI finds them.

### CI gate (`ci.yml`)

Runs on every `pull_request` event and every push to `main`: the same `typecheck && build && test` triple.

- Named checks: `test` and `e2e` (job IDs). `e2e` aggregates the parallel `e2e-browser` matrix legs into one status so the required-check name is stable. Branch protection requires both by name.
- Concurrent runs on the same ref are cancelled - only the latest push completes.

### Coverage gate (`coverage.yml`)

Runs on every `pull_request` event. Fails the `coverage` job on either a global-floor breach (`coverage.thresholds` in `vitest.config.ts`) or a diff-coverage breach (`scripts/diff-coverage.mjs`, 90% patch bar). See the `coverage.yml` catalog entry above for detail. `coverage` (`Test coverage report`) is a required check on both the `qa-staging` and `main-protection` rulesets as of #1742, so a breach blocks merge.

### Visual-regression gate (`visual-regression.yml`)

Runs on PRs that touch rendered UI (`components/**`, `app/**/*.tsx`, `app/globals.css`) or carry the `visual-regression` label. Compares committed Playwright screenshot baselines (`e2e/__screenshots__/`) against a fresh render of the two deterministic README surfaces (Stats, Journey) at a mobile and a desktop viewport, across the Chromium and WebKit engines. Practice, Pasture and Pokédex are excluded because their renders are not pixel-stable across runs (see `e2e/visual.spec.ts`). The job runs inside the pinned `mcr.microsoft.com/playwright` Docker image so Linux font rendering is deterministic; baselines are generated AND compared in the same image. A mismatch fails the `visual` job and uploads an expected/actual/diff report. Not a required check, and a non-matching PR does not run it. When a UI change is an intended visual update, regenerate baselines inside the Docker image (see the `visual-regression.yml` catalog entry above) and commit the changed PNGs in the same PR. For an in-CI one-click regeneration, dispatch `visual-baseline-update.yml` against the feature branch - it runs the same pinned image, refuses to push to `main` or `qa`, and is owner-gated. See the `visual-regression.yml` catalog entry for the exact local `docker run` command and the `visual-baseline-update.yml` entry for the CI path.

### Perf budget gate (`perf-budget.yml`)

Runs `e2e/perf-budget.spec.ts` on every pull request and on pushes to `main` / `qa`. The spec measures fresh-visitor time-to-interactive on the practice page with empty `storageState` (no localStorage, no IndexedDB seed) - it pre-dismisses the onboarding modal via `addInitScript`, navigates to `/`, and waits for the above-fold interactive element (the Reveal button or a documented end-state heading) to become visible. The wall-clock figure is logged on every run (look for `[perf-budget] project=...` in the job output) so the baseline can be tracked over time, and the assertion fails the job if it exceeds the per-project budget.

Current budgets, defined as the `BUDGETS` constant in `e2e/perf-budget.spec.ts`:

| Project | Budget |
|---|---|
| `chromium` | 5000 ms |
| `mobile-safari` | 8000 ms |

**Ratchet down only.** When a perf-improving change lowers the measured time meaningfully, lower the budget in the same PR so future regressions are caught at the new baseline. **Never** raise a budget to make a red run pass - investigate the cause first. A deliberate, justified regression (e.g. a feature that materially expands the seed payload) is the only case for raising a budget, and the PR description must explain why.

The spec body is gated on `PERF_BUDGET=1`. Without the env var, `test.skip(...)` short-circuits the test, so the spec is invisible to `ci.yml`'s `e2e-browser` matrix and to `e2e.yml`'s preview run. The dedicated `perf-budget.yml` workflow is the only place it executes in CI; it runs the same pinned `mcr.microsoft.com/playwright:v1.60.0-noble` image as the other Playwright jobs for parity, builds locally, serves via `npm start`, and runs the spec on chromium and mobile-safari in parallel matrix legs. A `changes` filter mirrors the `e2e-browser` pattern so docs-only PRs report a no-op skip rather than burning the full 10–15 min build per leg.

**Status: non-required initially.** Per #1268, the check runs on every PR but does not gate merge. Promotion to required happens after one week of stable baseline - add the `perf-budget` aggregator job (the single stable check-name produced by this workflow; the matrix legs themselves render as `Perf budget (chromium)` and `Perf budget (mobile-safari)`) to the `qa-staging` and `main-protection` rulesets' required-checks list when the baseline has held without spurious failures. The aggregator mirrors `ci.yml`'s `e2e` pattern so the required-check name stays stable regardless of how the matrix evolves. No spec or workflow change is needed at promotion time.

### `paths-ignore` and label escape hatches don't compose (#1250)

When a workflow uses `paths-ignore` on a `pull_request` trigger, GitHub still fires `labeled` events on the PR, but the workflow re-evaluates `paths-ignore` against the PR's changed files and skips the run. Applying the escape-hatch label has no effect. If you need a label-based override, drop `paths-ignore` and gate the work inside the job (e.g. `if: contains(github.event.pull_request.labels.*.name, 'X')`).

---

## Graceful exit & WIP salvage

When an implement (or continue) run hits its turn cap, times out, or errors mid-flight, the post-step runs with `if: always()` and:

1. **Salvage push** - if uncommitted edits exist in the working tree, stages and commits them as `WIP: halted run on #N`, then pushes to origin. This ensures `/continue` always has a branch to resume from.
2. **Status update** - PATCHes the live `<!-- auto-status -->` comment with a "Run finished" section showing outcome, branch, last commit, and recovery instructions. When the run ends without a PR (turn-cap, timeout, build-gate failure, or deliberate blocker stop), the recovery sub-block includes `@fraserbrookhouse` so the maintainer is notified.
3. **Recovery footer** - only advertises `/continue` when the branch is confirmed on origin via `git ls-remote`. Falls back to `/go` if the salvage push itself failed.

When resuming via `/continue`, the orchestrator checks `git log -1 --format=%s`. If the subject starts with `WIP:`, it inspects `git diff HEAD~1` and amends or reverts the WIP commit before continuing.

**After a halt, decide before retrying (#1249):**
- If the halted diff is already complete and the plan is a verbatim line-by-line spec, open the PR directly from the WIP commit rather than retrying the pipeline.
- If the diff is incomplete or the plan needs interpretation, `/continue` to resume the pipeline.

Retrying a complete-but-halted change tends to produce a second WIP commit and a follow-up cleanup PR (#1208 → #1217 + #1223).

---

## Scope warning & `/split`

When the planner posts its plan, it assesses scope against four thresholds. When any is crossed, it appends a warning block:

| Threshold | Value |
|---|---|
| Distinct files | ≥ 4 |
| Distinct surfaces | ≥ 3 |
| Infra + logic, with files | ≥ 3 files |
| Acceptance criteria | ≥ 6 |

Before offering `/split`, the planner runs a **coupling check** - it sketches the boundary between proposed children and checks whether they would share surface area (same symbol name, same `localStorage` key or DB table, same leaf module directory, or same file). If coupling is found, `/split` is **not** offered; the warning still fires but the recommendation is to proceed as a single issue.

When children are cleanly independent, the warning includes a numbered **Suggested split** block. Commenting `/split` triggers the split job (see [auto-issue.yml](#auto-issueyml--auto-issue-worker) above).

---

## Dispatch throttle: detection and recovery

GitHub applies an undocumented per-repo throttle on `push` and `pull_request` event dispatch when automation density crosses an internal heuristic. This section documents how to identify and recover from it.

### Identifying the throttle

The signature is selective silence: `push` and `pull_request` events stop dispatching across all branches while `issues`, `issue_comment`, and `deployment_status` events continue normally.

Quick check - if the most-recent `push`-triggered run is >20 minutes old during active development, suspect the throttle:

```sh
gh api "repos/Frazzled-Productions/poke-memory/actions/runs?event=push&per_page=1" \
  --jq '.workflow_runs[0].created_at'
```

Compare against:

```sh
gh api "repos/Frazzled-Productions/poke-memory/actions/runs?event=issues&per_page=1" \
  --jq '.workflow_runs[0].created_at'
```

If `issues` events are recent but `push` events stopped 15+ minutes ago, the throttle is active.

### Confirmed non-recoveries (from 2026-05-12 incident)

These do **not** recover dispatch during an active throttle window:

- `gh pr close <N> && gh pr reopen <N>` - `pull_request: reopened` is also suppressed.
- Pushing an empty commit to the PR branch - `push` events are suppressed, so `pull_request: synchronize` does not fire. Vercel picks up the commit but GitHub Actions does not.

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
gh api "repos/Frazzled-Productions/poke-memory/commits/<sha>/check-runs?check_name=test" \
  --jq '.check_runs[].status'
```

### Root cause context

The throttle is triggered by automation density, not by any single workflow. High-volume bursts - e.g. 4 PR merges in 15 minutes, each cascading through 6–8 workflows plus parallel issue-comment automation - can exceed GitHub's (undocumented) per-repo heuristic for compute-heavier event types. Reducing steady-state dispatch rate (e.g. removing automatic labelling for issues and PRs) lowers the risk of re-triggering the throttle.

---

## Retrospectives

After each merged PR, `auto-retro.yml` posts a `<!-- auto-retro -->` comment on the closed issue covering:
- **Agents used** - which sub-agents ran
- **What worked** - specific evidence (review finding, planner question that surfaced a risk)
- **What didn't / overhead** - where a round-trip cost more than it returned
- **Lesson** - one transferable rule for future changes

Retros are process reflection only - no code change recommendations.

A single retro comment on a closed issue is effectively write-once and unread. `auto-retro-harvest.yml` (weekly cron) closes that loop:

- **Digest** - it regenerates [`docs/retros.md`](docs/retros.md), one most-recent-first surface aggregating every retro, and commits it to `qa`. That is the place to read retros in bulk.
- **Recurring-pattern auto-file** - when the *same concrete problem* recurs across **≥ 3 retros**, it files one `priority:later` tracking issue for that pattern (idempotent on a `<!-- auto-retro-pattern:<slug> -->` marker). So "several retros independently grumbled about this" becomes a tracked backlog item instead of being lost.

Behavioural-rule lessons (reusable conventions, not specific defects) are still promoted to `AGENTS.md` by hand - the harvest job deliberately does not file issues for them, since they are not issue-shaped.
