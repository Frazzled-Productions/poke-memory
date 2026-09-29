# Workflow

> ## ⚠️ Partly historical as of 2026-08-16
>
> The **fourteen Claude-driven GitHub Actions workflows were removed** on 2026-08-16:
> `auto-issue`, `auto-pr`, `auto-review`, `auto-resolve`, `auto-retro`,
> `auto-retro-harvest`, `auto-backlog-groom`, `auto-deep-audit`,
> `auto-workflow-suggest`, `auto-app-suggest`, `auto-codequality-suggest`,
> `issue-overlap-scan`, `settings-coverage-audit`, and `auto-digest-fanout`
> (whose four digest producers had all gone).
>
> Agent automation is moving to a **Mac-local loop**, because koinori is a native
> iOS app whose builds need macOS and GitHub-hosted macOS minutes are too
> expensive. See `Frazzled-Productions/frazzled-loop`.
>
> **What this means for this document.** Everything below describing genuine CI
> (`ci`, `coverage`, `e2e`, `codeql`, `visual-regression`, the policy and drift
> gates), the qa-to-main promotion, and the issue conventions is **still current**.
> Everything describing the `auto-*` workflows, the `/go` `/fix` `/continue`
> comment commands, the digest fan-out, and the states they drove is **historical**:
> those triggers no longer exist and nothing responds to them.
>
> This banner is deliberate rather than a rewrite. Describing the replacement
> process would mean inventing one before it has been decided, and a confidently
> wrong process map is worse than an honestly dated one.
>
> The **GitHub Actions catalog** has since been pruned to the workflows that still
> exist (#2020 / #2022): the removed ones, plus the two dead autofix workflows,
> are listed once under [Removed workflows](#removed-workflows).

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
| [workflow-expert](.claude/agents/workflow-expert.md) | Mandatory review on EVERY GitHub Actions / orchestration change - idempotency markers, fork-PR and author guards, required-check names | Yes |

---

## Orchestration playbook

The main agent (Claude in the user's session) orchestrates. Coder agents do not call other agents directly - they receive research findings via the prompt.

Standard flow for non-trivial work:

1. **Plan** - invoke `planner`. It surfaces unknowns tagged as `[EXPERT-RESEARCH]`, `[USER-DECISION + RESEARCH]`, or `[USER-DECISION]`.
2. **Research in parallel** - dispatch specialists (`next16-expert`, `pokeapi-expert`, `srs-expert`, `researcher`) in a single message when their questions are independent. Fold answers into the plan.
3. **Implement** - invoke `ui-coder` and/or `data-coder` with full context (research findings + spec). Run in parallel when their work is independent. **Multi-surface decomposition gate:** a `ui-coder` brief covering 3+ distinct UI surfaces, a locale-by-state matrix on more than one surface, or a new e2e spec alongside surface work must be split into sequential per-surface agents - the hard pre-dispatch check lives in `.claude/agents/ui-coder.md` (#1766/#1767).
4. **E2E** - if the change is user-facing, invoke `playwright` to add or update E2E smoke tests. Pass the diff summary and affected pages.
5. **Review** - invoke `code-reviewer` at the end. Iterate on its punch list.

**When to skip the planner.** Step 1 is skippable. Skip the `planner` invocation when *all* of the following hold:

- the issue body names the **exact files** to change;
- it names **specific line numbers or line ranges** (or an equivalently precise anchor - a named symbol, a single config key);
- it states the **expected outcome** concretely enough to write acceptance criteria from directly;
- there are **zero open design questions** - nothing the planner would tag `[EXPERT-RESEARCH]`, `[USER-DECISION]`, or `[USER-DECISION + RESEARCH]`.

When every box is ticked the issue *is* the plan and a planner round-trip would return precisely what the issue already says - validated by 49 consecutive retros. If any box is unticked (a file is unnamed, an outcome is fuzzy, a design choice is open), run the planner. Implement directly only against an issue that meets the full checklist.

**Planner-skip decision tree (#1248).** A simpler yes/no version of the checklist above, for quick triage:

**Skip the planner when the issue body already contains:**
- Root cause (what is broken and why)
- Fix location (file path or function)
- Fix direction (how the change should work)
- Testable acceptance criteria (what the change should achieve)

If any of the four is missing, run the planner. If all four are present, go straight to implement.

**Record the skip.** When skipping the planner, the orchestrator posts a one-line comment on the issue - `<!-- planner-skipped: <reason> -->` - so the decision is auditable at retro time without a planner round-trip (#1856). Full criteria and the template live in `.claude/agents/planner.md` under "Skip criteria and recording".

When *not* to use a sub-agent: small one-off edits, single-file changes, or anything where the round-trip cost outweighs the value.

**Hard rule - `workflow-expert` reviews EVERY `.github/workflows/**` change.** No exception for mechanical-looking edits: complexity is not the gate, YAML's silent-failure mode is. Three separate incidents (#1859, #1815, #1806) came from bypassing the review because a change "looked mechanical". Additionally, for any change that involves marker-based dedup (HTML-comment idempotency markers) or GitHub search-index lookups, invoke `workflow-expert` **before** writing the change, not only as a reviewer afterwards. GitHub's search index strips HTML comments, so a `<!-- marker -->` dedup that relies on search to find prior comments silently fails - exactly the platform quirk a `workflow-expert` design-time pass surfaces before it costs a fix commit at review time.

**`ux-advisor` before writing onboarding/discoverability code.** On the same design-time pattern as `workflow-expert` before GitHub Actions, invoke `ux-advisor` on the brief **before** dispatching the implementer for any change that adds a user-facing feature, changes how something is displayed, or changes how something is accessed/discovered. The planner's testability + first-contact UX pre-flight (#1276) names this hook; any discoverability gap `ux-advisor` cannot resolve from the existing code becomes a `[USER-DECISION]` open question or a dedicated acceptance criterion. At review time, `code-reviewer` raises a new surface with no declared discovery path as a Concern (the "Discoverability" check in its step-3 list); the check lives in the agent definition.

**Service Worker cache changes (#1247).** vitest cannot surface failures that only manifest under the deployed CDN's URL shape (versioned cache buckets, Vercel `dpl` image params, cache-tag expiry branches). Treat `code-reviewer` as a blocking gate, not advisory, for any change under `app/sw.ts`, `app/sw/**`, or `lib/pwa/**`. See retros #1166 and #1168 for the cases that prompted this.

**Orchestration entrypoints - `/batch-issues` and `/ship`.** Two local slash-commands run the playbook end-to-end so the gate, the in-session `code-reviewer` pass, the issue-first cross-check, and branch-off-`qa` are not re-derived by hand each time:

- **`/batch-issues`** (`.claude/commands/batch-issues.md`) - drains the open backlog in conflict-minimising batches, parallel where safe, draining into `qa` and opening a draft `qa -> main` promotion PR. Use for a backlog pass. Drain protocol (the command file is canonical; these are the load-bearing steps):
  1. Pre-flight: list the backlog, confirm a clean tree, sync `qa` and triage. There is no review workflow to suspend: `auto-review.yml` was removed on 2026-08-16, so the in-session `code-reviewer` is the only review gate (#2021).
  2. Implement per batch: worktree off `origin/qa`, coder agents, in-session `code-reviewer`, `npm run pre-pr`, PR into `qa`.
  3. Close-out: fire the QA preview deploy (`--ref qa`), loop any mini-batch follow-ups, then open the draft `qa -> main` promotion PR.
- **`/ship`** (`.claude/commands/ship.md`, #1718) - the single-change projection of `/batch-issues`: one issue (or one freshly-created issue) → branch off `qa` → implement → `npm run pre-pr` gate → PR into `qa` with `Closes #N` → `code-reviewer` → auto-merge. It **defers** to `/batch-issues` for the gate, review, and branching rules rather than restating them, so the two paths never diverge. Use for one linear change where the batch machinery is overkill.

Both run the same `npm run pre-pr` gate (AGENTS.md "Pre-PR build gate") and the same `code-reviewer` pass; the only difference is batch fan-out vs single change.

---

## Issue lifecycle

Issues sit on the [project board](https://github.com/orgs/Frazzled-Productions/projects/1). Only one transition is automated: **any open -> Done**, by `auto-status.yml` when the issue closes (via `closes #N` on merge, or manually). The intermediate states (Planned, In Progress, PR, Ready to merge) were driven by the removed `auto-issue` / `auto-pr` / `auto-review` workflows and are now set by hand, if at all.

### Commands

The `/go`, `/continue`, `/split`, `/replan`, `/fix` and `/resolve` comment commands were removed with their workflows; nothing responds to them. The only surviving comment command is `/preview` on a PR (OWNER / MEMBER / COLLABORATOR), handled by `vercel-preview-on-ready.yml`, which is currently disabled.

### Backlog ownership

- Backlog lives in GitHub Issues, labelled `priority:now` / `priority:next` / `priority:later`.
- The [Poké Memory roadmap](https://github.com/orgs/Frazzled-Productions/projects/1) is a kanban view over the same issues with a `Priority` field matching those labels.
- **The user owns priorities.** Don't move issues between priority labels or columns without explicit user direction.
- Issues filed from mobile (or anywhere) are labelled manually, or by the monitor workflow that filed them.

---

## Branching model - qa staging flow

`main` is strict and production-tracked; `qa` is the integration branch where batch work is bundled and QA-tested before promotion (#806).

```
Batch PRs ─▶ qa ─▶ (preview deploy + maintainer QA) ─▶ qa→main PR ─▶ main ─▶ release + production
```

| Branch | Ruleset | Who PRs into it |
|---|---|---|
| `main` | `main-protection` - strict-up-to-date; required checks `test`, `e2e`, `Test coverage report`, `Check version bump approval`, `Restrict main PR source` | Only `qa`. A non-`qa` PR needs the `hotfix` label. |
| `qa` | `qa-staging` - required checks `test`, `e2e`, `Test coverage report`, `integration-gate`, `changelog-gate`, `i18n-leak`; **not** strict-up-to-date. Bypass actors: `poke-memory-bot` and the repo admin role. | `/batch-issues`, `/ship`, and one-off feature branches. |

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

**Trust rule for comment/edit-triggered jobs (#1859).** Any job triggered by a user-authorable event (`issue_comment`, `issues: edited`, and similar) must gate on the event author before any secret-bearing or write-token step runs: bot-produced artefacts (idempotency markers, tracking issues) are only trusted when the comment/issue author is `poke-memory-bot[bot]`, and human commands (today only `/preview`) require `author_association` OWNER / MEMBER / COLLABORATOR. Body-content markers alone are attacker-postable and never sufficient.

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

### `dependabot-hotfix-label.yml` - Dependabot hotfix label

| | |
|---|---|
| **Trigger** | `pull_request_target: [opened, synchronize, reopened]` |
| **Job** | `label` (`Apply hotfix label`) |
| **What it does** | Dependabot SECURITY-advisory PRs ignore `target-branch` in `dependabot.yml` and always open against `main`, where they immediately fail the required `Restrict main PR source` check (`main-pr-source-gate.yml`). Auto-retargeting the base to `qa` doesn't stick - Dependabot resets it back to `main` on its next push (#1942) - so this workflow instead applies the `hotfix` label, the bypass `main-pr-source-gate.yml` already understands. Guarded to `github.actor == 'dependabot[bot]'` with `base.ref == 'main'`, so normal version-update PRs (which already target `qa`) never match. |
| **Token** | Mints a `poke-memory-bot` App installation token (`actions/create-github-app-token@v3`, same pattern as `qa-issue-label.yml`) for the label mutation. The default `GITHUB_TOKEN` cannot be used here: GitHub suppresses new workflow runs for events triggered by `GITHUB_TOKEN`, so a `github.token`-applied label would never re-fire `main-pr-source-gate.yml`'s `labeled` trigger and the gate would stay red. |
| **`pull_request_target` trust boundary** | No `actions/checkout`, no execution of PR-head code; only reads `github.event.pull_request` fields and calls `gh pr edit --add-label`. |
| **Activation caveat** | Because `pull_request_target` resolves the workflow definition from the PR's BASE branch, this has no effect on `main`-targeted Dependabot PRs until the file itself is promoted `qa -> main`. Landing it on `qa` alone does not activate it. |
| **Required check** | No - convenience labelling only. |
| **Concurrency** | Cancels concurrent runs on the same PR. |

---

### `migration-check.yml` - Migration drift check

| | |
|---|---|
| **Trigger** | `pull_request` touching `db/migrations/**`, `scripts/check-migrations.mjs`, or the workflow file itself; push to `main` |
| **Job** | `check` |
| **What it does** | Runs `scripts/check-migrations.mjs`, which lists files in `db/migrations/` (excluding the bootstrap `001_initial_sync_schema.sql`), calls the Supabase Management API to list applied migrations, and exits non-zero if any committed file is not in the applied list. **Env-to-branch parity (#1806):** a PR whose base is `qa` is checked against the **QA** project (staging rehearsal); a push to `main` (and a PR into `main`) is checked against **prod**. Routing is purely on `github.event_name` + `pull_request.base.ref` (secrets can't be read in `if:`), so the matching secret set is injected per step. |
| **Required secrets** | `SUPABASE_ACCESS_TOKEN` (Supabase Management-API PAT, account-scoped so it reads BOTH projects) plus the per-project ref: `SUPABASE_PROJECT_REF` (prod, e.g. `nvxvvtvnthsgdxgksmju`) or `QA_SUPABASE_PROJECT_REF` (QA). No separate QA token - the PAT is account-level. The relevant ref must be set before the matching trigger can run; without it the script exits 2 with a clear error (the loud failure mode during the secrets-provisioning window). |
| **Fork PRs** | Skipped (`github.event_name == 'push' || head.repo.fork == false` guard - the push path is gated in explicitly because a bare fork check is falsy on push). No secrets exposed. |
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
| **Why a dedicated workflow** | Snapshot baselines are platform-sensitive. macOS Core Text and Linux font anti-aliasing differ visibly (the reason README screenshots are macOS-only - see AGENTS.md → "Screenshots"). The job runs inside the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` Docker image so baselines are generated AND compared in the same deterministic Linux environment. The image tag MUST track the `@playwright/test` version in `package-lock.json`; `npm run lint:playwright-pin` (in the `lint` chain) fails on any `playwright:vX.Y.Z` tag in the repo that disagrees, so move every tag in the same PR as the package bump (#2074). |
| **Required check** | No - non-blocking, and a non-matching PR does not run it at all. |
| **Concurrency** | Per-ref, `cancel-in-progress: true`. |
| **Updating baselines** | When a UI change intentionally alters a surface, regenerate baselines inside the Docker image - never from macOS. Two paths: (1) **In CI** - dispatch `visual-baseline-update.yml` against the feature branch (owner-gated, refuses `main`/`qa`); it runs the same pinned image, commits the regenerated PNGs as `chore(visual): regenerate baselines [skip ci]`, and pushes to the dispatching branch. (2) **Locally**, from the repo root: `docker run --rm -v "$(pwd)":/work -w /work mcr.microsoft.com/playwright:v1.63.0-noble bash -c 'npm ci && npm run build && (npm start &) && npx wait-on http://localhost:3000 && npm run test:visual -- --update-snapshots'` - then commit the changed PNGs under `e2e/__screenshots__/`. |

---

### `visual-baseline-update.yml` - Visual Baseline Update

| | |
|---|---|
| **Trigger** | `workflow_dispatch` only, with a required `branch` input. |
| **Gate** | The `gate` job refuses to run unless `github.actor == github.repository_owner` (owner-only) and the `branch` input is neither `main` nor `qa`. Defence-in-depth: the push step re-checks the branch name. |
| **Job** | `gate` (owner + branch guard), `regenerate` (snapshot regeneration + commit + push). |
| **What it does** | Runs inside the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` image - the same pin `visual-regression.yml` uses for comparison. Checks out the dispatching branch via a `poke-memory-bot` App installation token, builds the app, serves it, runs `npm run test:visual -- --update-snapshots` to rewrite `e2e/__screenshots__/{visual-chromium,visual-webkit}/*.png`, then commits `chore(visual): regenerate baselines [skip ci]` and pushes to the dispatching branch. If the regeneration produces no diff, the job exits cleanly without an empty commit. |
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

### `auto-status.yml` - Auto Status

| | |
|---|---|
| **Trigger** | `issues: [closed]` |
| **What it does** | Moves the issue to **Done** on the project board - regardless of how it was closed (PR merge, manual close, or `not_planned`) |
| **Note** | The only automated board transition. The others were driven by the removed `auto-issue.yml` / `auto-pr.yml` and are now set by hand. |

---

### `auto-close-umbrella.yml` - Auto Close Umbrella

| | |
|---|---|
| **Trigger** | `issues: [closed]`; `workflow_dispatch` (inputs `issue_number` required, `dry_run` boolean default `true`) |
| **Job** | `close-umbrella` |
| **What it does** | When a child issue closes, finds any OPEN umbrella that tracks it, checks whether ALL of that umbrella's tracked children are now closed, and if so closes the umbrella with a comment noting all tracked items are complete. Saves the maintainer from hand-closing digests / epics once their children ship. |
| **How children are declared** | A task-list of `#N` refs in the umbrella body (`- [ ] #N` / `- [x] #N`). The checkbox tick is not trusted - each child's real state is read from the API. GitHub-native sub-issues are read as a best-effort secondary signal and unioned in; sub-issue API errors are non-fatal. Plain `#N` prose refs are ignored. |
| **Opt-in gate** | Fires only for umbrellas carrying the `auto-close-when-complete` label - the umbrella, not the child, must carry it. Weekly digests (snapshots) should carry it by default; open-ended epics (e.g. #1445) deliberately omit it so they never auto-close prematurely. The maintainer creates the label once (no label-sync manifest exists in `.github/`). |
| **Candidate lookup** | Lists open issues with the gate label and filters locally with jq on the fetched body - never `gh issue list --search '... in:body'`, which the GitHub search index strips. |
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
| **Fork PRs** | Skipped (`head.repo.fork == false` guard - same pattern as `coverage.yml`; fork PRs run with a read-only token and cannot edit issue labels). |
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
| **What it does** | For each cron-driven workflow (`auto-release`, `refresh-user-count`, `monitor-grade-log-divergence`, and `pokeapi-species-monitor`), calls `gh run list --workflow=<file> --event schedule --branch <default-branch>` and checks (a) a scheduled run exists within the expected interval (48h for the daily workflows, 840h for `pokeapi-species-monitor`) and (b) the most recent completed run succeeded - any non-`success`/`skipped` conclusion (`failure`, `timed_out`, `startup_failure`, `cancelled`) counts as unhealthy. On a stale or unhealthy workflow it opens or updates a per-workflow tracking issue. If the `gh run list` call itself errors (transient GitHub API failure), that workflow is skipped for the run rather than treated as stale, so an outage cannot spam a tracking issue for every monitored workflow at once. |
| **Dedup** | A `<!-- cron-health-monitor:{file} -->` HTML marker keyed by workflow filename gives each watched workflow its own tracking issue. Re-runs edit that issue in place and add a re-check comment rather than opening duplicates. When a workflow recovers, the monitor closes its tracking issue automatically. |
| **Why schedule?** | The monitor runs on GitHub's internal cron queue, independently of the workflows it watches - so it still fires even if those workflows have stopped. It cannot detect its own staleness, but the blast radius of one un-monitored monitor is small. |
| **Permissions** | `contents: read`, `actions: read`, `issues: write`. `GITHUB_TOKEN` only - no Claude, no App token, no app checkout. |
| **Why monitor cron workflows?** | GitHub disables scheduled workflows after 60 days of repo inactivity, and a malformed cron or an expired secret can silently stop a workflow firing - none of which produces an alert on its own. `pr-check-monitor` watches open PRs; this watches the schedule-driven workflows themselves. |

---

### `vercel-preview-on-ready.yml` - Vercel Preview on Ready

| | |
|---|---|
| **Status** | **Disabled** (`disabled_manually`). Under the qa staging flow, QA happens on the bundled `qa` branch via `qa-preview-deploy.yml`, so per-PR previews are redundant and were retired to stay within Vercel's deploy rate limit (#814). **Keep it disabled unless per-PR previews are wanted again**: since #2020 the gate no longer waits for an auto-review verdict, so re-enabling (`gh workflow enable "Vercel Preview on Ready"`) fires a preview on every green CI run of every non-`qa` PR head SHA - the deploy volume that hit Vercel's rate limit (#814). |
| **Trigger** | `workflow_run` on `CI` (`completed`); `issue_comment: created` (for `/preview` only) |
| **Gate** | Fires the Vercel Deploy Hook when the `test` check is `success` on the PR's HEAD SHA. The former second condition (a bot-authored `auto-review` LGTM on the same SHA) was removed in #2020: `auto-review.yml` was its only writer, so after 2026-08-16 the gate could never open. Only comments authored by `poke-memory-bot[bot]` count for the idempotency marker (#1859). |
| **Manual override** | A `/preview` PR comment from OWNER / MEMBER / COLLABORATOR bypasses the CI gate and fires the hook unconditionally - for mid-iteration peeks before CI is green. The association is checked at the job trigger as well as in the override step (#1859). |
| **Fork guard** | `workflow_run` arm requires `head_repository.fork == false`; the `issue_comment` arm requires OWNER / MEMBER / COLLABORATOR for `/preview` (#1859), an exact `/preview` command (not a prefix), and a same-repo PR head (`isCrossRepository == false`). |
| **Concurrency** | Keyed on the PR number for both arms (head SHA as fallback), so a `/preview` and a CI completion on one PR queue rather than race past the fired-marker dedup. |
| **Idempotency** | Posts `<!-- vercel-preview-fired:<sha> -->` on the PR after a successful fire; subsequent re-evaluations at the same SHA are no-ops. |
| **Why two triggers** | `workflow_run` drives the automatic path; `issue_comment` exists only for the `/preview` override. |
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
| **Token** | Mints a `poke-memory-bot` App installation token (same as `auto-release.yml`) so the PR behaves like a bot-opened promotion. **Does not merge** - the maintainer's preview QA is the gate. |
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
| **qa reset** | On a `qa -> main` trigger only (`github.event_name == 'pull_request'`), a final step force-updates `qa` to `main` (`git push origin +HEAD:refs/heads/qa`) so the next batch run starts from a clean integration branch. `schedule`/`workflow_dispatch` runs never reset `qa` (it may hold in-progress batch work); when they cut a release they merge `main` into `qa` instead (next row). The reset and the backmerge are mutually exclusive by their `if:`s. |
| **qa backmerge (#2058)** | Every other path that lands a commit on `main` merges `main` back into `qa` straight after its push, via the shared `.github/scripts/backmerge-main-into-qa.sh` (merge, never reset; no-op when `main` is already an ancestor of `qa`; a conflict fails the step with an `::error::` naming the files and leaves `qa` untouched; a merge that would change `.github/workflows/**` on `qa` fails fast without pushing, because the poke-memory-bot App has no `workflows` permission and GitHub refuses workflow-file updates from it (a maintainer merges and pushes by hand, or the App is granted `workflows: write` and `BACKMERGE_ALLOW_WORKFLOW_CHANGES=1` is set); only a non-fast-forward rejection (`qa` moved mid-run) is retried, from a fresh fetch after a 5s backoff, up to 3 attempts, and any other rejection fails at once; the caller's HEAD is restored on exit; tested by `scripts/backmerge-main-into-qa.test.mjs`). The producers: the `schedule`/`workflow_dispatch` release commit (the "Backmerge release into qa" step), a hotfix or Dependabot PR merged into `main` (the `backmerge-hotfix` job), and `refresh-user-count.yml`'s stats commit. **Rule: every new workflow that pushes to `main` must call this script straight after its push**, or `qa` drifts behind `main` (#1959, #1989, #2044). |
| **qa drift guard** | The daily safety net behind both the reset and every backmerge. The reset step is gated on `success()`, so a failed prior step (e.g. a `cut-release` crash) skips it, leaving `qa` un-reset (#1659/#1664); a backmerge can fail on a conflict or on a workflow-file change the App may not push. The sibling `qa-drift-check` job runs on the daily `schedule`/`workflow_dispatch` (not `pull_request`, to avoid racing the reset), checks `git merge-base --is-ancestor origin/main origin/qa`, and opens/updates a marker-keyed (`<!-- qa-drift-check -->`) tracking issue when `main` is not an ancestor of `qa`. The issue lists the `main`-only commits (their subjects name the cause: a failed backmerge via `.github/scripts/backmerge-main-into-qa.sh`, a skipped reset, or a hand push to `main`) and only offers a reset of `qa` when it cannot discard work (`qa` has no commits of its own, or `git merge-tree` shows they add nothing `main` lacks); otherwise it prescribes merging `main` into `qa` (#2058). It is **alert-only** (no auto-reset): `qa` may carry un-promoted batch work a force-reset would destroy, so reconciliation stays human-in-the-loop. The issue auto-closes once `qa` is back in sync. Permissions: `contents: read` + `issues: write` (uses `GITHUB_TOKEN`, no App token / push). |
| **Vercel interaction** | The release commit touches `package.json`, which is in `WATCH_PATHS` in `scripts/vercel-ignored-build.sh` - so Vercel rebuilds and the in-app version banner (`NEXT_PUBLIC_APP_VERSION`) updates. |
| **Prerequisite** | The `poke-memory-bot` App must be a bypass actor on **both** the `main-protection` ruleset (to land the release commit on `main`) and the `qa-staging` ruleset (to force-push the qa reset and push the backmerges). It has no `workflows` permission, so it cannot push a backmerge that changes `.github/workflows/**` (see the qa backmerge row). If a push step fails with a protected-branch error, that is the missing setup. |
| **Concurrency** | `group: auto-release` with `cancel-in-progress: false` - back-to-back merges queue rather than collapse. |

---

### `monitor-grade-log-divergence.yml` - Monitor grade_log divergence

| | |
|---|---|
| **Trigger** | Daily `schedule` (`0 8 * * *` - 08:00 UTC); `workflow_dispatch` (with an optional `threshold` input overriding the default divergence threshold of 0) |
| **Job** | `check` |
| **What it does** | Runs `.github/scripts/check-grade-log-divergence.mjs`, which flags users whose `grade_log` shows activity but whose `card_reviews` table is missing the corresponding rows - the #584 sync-break signature. Only subjects that actually graduated count as orphans (a `grade_log` row with `learning_step IS NULL`, the post-grade step, #2096), and every query joins on `locale`. The SQL is tested against the migrated schema by `lib/sync/integration/grade-log-divergence.test.ts`. If divergence is detected, the workflow updates the open tracking issue whose body starts with `<!-- monitor:grade-log-divergence -->` on line 1 (refreshed body and title plus a recurrence comment), or opens one titled `[monitoring] grade_log divergence detected (N users)`, labelled `monitoring` and `area:workflow`, when none exists (#2010). The lookup is `.github/scripts/find-marker-issue.mjs` (tested by `scripts/find-marker-issue.test.mjs`); a failed lookup, or hitting the 100-issue list limit, fails the step. The body is overwritten on every alerting run, so human notes belong in comments, and removing the `monitoring` label makes the next alert open a new issue. It never auto-closes: the 4-day look-back means "no longer firing" can just mean "aged out". The `monitoring` label is self-healing - created with `gh label create ... || true`. |
| **Required secrets** | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`. |
| **Cron-only** | Does not fire on push, so the workflow file landing in a PR will not raise an alert on the PR itself - the first real run is the next 08:00 UTC tick after merge. |
| **Concurrency** | `group: monitor-grade-log-divergence` with `cancel-in-progress: false`. |

---

### `refresh-user-count.yml` - Refresh user count badge

| | |
|---|---|
| **Trigger** | Daily `schedule` (`17 6 * * *` - 06:17 UTC); `workflow_dispatch` |
| **Job** | `refresh` |
| **What it does** | Runs `scripts/refresh-user-count.mjs` to refresh `.github/stats/users.json`, the source for the README user-count Shields.io badge (#400). If the file changed, it commits as `chore(stats): refresh user count [skip ci]` and pushes directly to `main` (the badge reads the file from `main`). The commit is authored by the `poke-memory-bot` App identity, so it lands despite branch protection; the `[skip ci]` marker stops the push retriggering any push-triggered workflow. A final step then merges `main` into `qa` with `.github/scripts/backmerge-main-into-qa.sh` (the same App token is the `qa-staging` bypass actor), so the stats commit never leaves `qa` behind `main` (#1989, #2058). If that backmerge fails the run goes red even though the stats commit already landed on `main`, deliberately, so the stranded `qa` is seen the same day. |
| **Required secrets** | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `BOT_APP_PRIVATE_KEY`, `BOT_APP_ID` (var). |
| **Concurrency** | `group: refresh-user-count` with `cancel-in-progress: false`. Deliberately not the `auto-release` group: a group holds at most one pending run and a newer pending run cancels it, so sharing could silently drop a queued release. A collision needs a manual dispatch (the crons are 06:17 and 09:00 UTC) and is safe: the losing push to `main` fails non-fast-forward, and the backmerge retries when `qa` moves. |

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

### Removed workflows

Deleted on 2026-08-16 with the rest of the Claude automation (#2003 / #2004): `auto-issue`, `auto-pr`, `auto-review`, `auto-resolve`, `auto-retro`, `auto-retro-harvest`, `auto-backlog-groom`, `auto-deep-audit`, `auto-workflow-suggest`, `auto-app-suggest`, `auto-codequality-suggest`, `auto-digest-fanout`, `issue-overlap-scan`, `settings-coverage-audit`. Deleted in #2022 as dead leftovers: `ci-failure-autofix` and `vercel-failure-autofix` (gated on `auto/issue-*` branches nothing creates, posting `/fix` comments nothing reads), and the `extract-linked-issues.sh` helper only `auto-review.yml` called. Their catalog entries are in git history before those PRs.

---

## Build gates

The local gate and CI catch type/build/test errors at different points:

### Local pre-PR gate (`npm run pre-pr`)

After pushing, before opening the PR, run **`npm run pre-pr`** (`scripts/pre-pr.mjs`, #1716) - it runs the full gate in order, fail-fast: lint -> typecheck -> build -> test -> coverage -> diff-coverage, and exits non-zero on the first failure. This is THE local gate; it mirrors the CI required checks (CI remains the enforcement layer) and removes the per-step skip risk of re-deriving the chain by hand.

- `npm run lint` (em-dash + i18n + pseudo-locale + agents-size) catches errors that do **not** surface in typecheck/build/test, so a hand-run that omits it ships a red PR (#1541).
- The diff-coverage leg is the one that has bitten most (green-locally-then-red on CI's per-diff bar, #1642 / #1646 / #1649): `test:coverage` enforces only the global floor; the 90% per-diff patch bar runs after it against the fresh `coverage/coverage-final.json`. Override the diff base for a main-targeting PR with `DIFF_COVERAGE_BASE=origin/main npm run pre-pr`.
- An opt-in `pre-push` git hook running the same command is documented but not installed by default.

**Pre-PR e2e smoke** for high-surface-area diffs (touching `app/layout.tsx`, `app/page.tsx`, `components/onboarding/**`, `components/Nav.tsx` / `BottomTabBar.tsx` / `MobileNavPaddingWrapper.tsx`, `lib/settings/persistence.ts`, or `playwright.config.ts`): run `scripts/pre-pr-smoke.sh` (chromium-only subset in the pinned Docker image). Same two-attempt budget.

**Push discipline.** Push with an explicit `git push origin <branch>` - never a bare `git push`. A worktree created via `git worktree add -b <branch> origin/qa` sets the branch's upstream to `origin/qa`, so a bare `git push` does NOT update `origin/<branch>`: at best it fast-fails (rejected, harmless), and at worst it silently pushes to `origin/qa` or no-ops, leaving the PR branch stale and CI red on the old commit. Always name the remote and branch (mirrors the `gh pr create --head <branch>` rule). Worked example: a pseudo-locale regen "pushed" but never landed on the PR branch (#1474).

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

The spec body is gated on `PERF_BUDGET=1`. Without the env var, `test.skip(...)` short-circuits the test, so the spec is invisible to `ci.yml`'s `e2e-browser` matrix and to `e2e.yml`'s preview run. The dedicated `perf-budget.yml` workflow is the only place it executes in CI; it runs the same pinned `mcr.microsoft.com/playwright:v1.63.0-noble` image as the other Playwright jobs for parity, builds locally, serves via `npm start`, and runs the spec on chromium and mobile-safari in parallel matrix legs. A `changes` filter mirrors the `e2e-browser` pattern so docs-only PRs report a no-op skip rather than burning the full 10–15 min build per leg.

**Status: non-required initially.** Per #1268, the check runs on every PR but does not gate merge. Promotion to required happens after one week of stable baseline - add the `perf-budget` aggregator job (the single stable check-name produced by this workflow; the matrix legs themselves render as `Perf budget (chromium)` and `Perf budget (mobile-safari)`) to the `qa-staging` and `main-protection` rulesets' required-checks list when the baseline has held without spurious failures. The aggregator mirrors `ci.yml`'s `e2e` pattern so the required-check name stays stable regardless of how the matrix evolves. No spec or workflow change is needed at promotion time.

### `paths-ignore` and label escape hatches don't compose (#1250)

When a workflow uses `paths-ignore` on a `pull_request` trigger, GitHub still fires `labeled` events on the PR, but the workflow re-evaluates `paths-ignore` against the PR's changed files and skips the run. Applying the escape-hatch label has no effect. If you need a label-based override, drop `paths-ignore` and gate the work inside the job (e.g. `if: contains(github.event.pull_request.labels.*.name, 'X')`).

---

## Scope warning

When the planner posts its plan, it assesses scope against four thresholds. When any is crossed, it appends a warning block:

| Threshold | Value |
|---|---|
| Distinct files | ≥ 4 |
| Distinct surfaces | ≥ 3 |
| Infra + logic, with files | ≥ 3 files |
| Acceptance criteria | ≥ 6 |

Before offering `/split`, the planner runs a **coupling check** - it sketches the boundary between proposed children and checks whether they would share surface area (same symbol name, same `localStorage` key or DB table, same leaf module directory, or same file). If coupling is found, `/split` is **not** offered; the warning still fires but the recommendation is to proceed as a single issue.

When children are cleanly independent, the warning includes a numbered **Suggested split** block; file the children by hand (the `/split` command was removed with `auto-issue.yml`).

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

`auto-retro.yml` (per-issue retro comments) and `auto-retro-harvest.yml` (the weekly digest and recurring-pattern filer) were removed on 2026-08-16. [`docs/retros.md`](docs/retros.md) is the frozen digest of the retros they produced, kept as a historical record.

Behavioural-rule lessons (reusable conventions, not specific defects) are promoted to `AGENTS.md` by hand.
