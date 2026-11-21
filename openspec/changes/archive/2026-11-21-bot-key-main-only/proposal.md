## Why

Change `bot-token-trusted-steps` (#2424) made five of the eight jobs that mint the poke-memory-bot
token name the GitHub environment `bot`, so the bot's private key can later live only in an
environment that admits `main`. The key cannot leave the repository secrets yet, because three jobs
and two dispatched workflows still depend on it there (its design D7, open items O1 to O3):

- **O1.** `auto-release.yml` `release` and `backmerge-hotfix` run on `pull_request` (closed into
  `main`), whose ref is `refs/pull/N/merge`. A `main`-only environment refuses that ref, so moving
  the key would stop releases, the `qa` reset and hotfix backmerges.
- **O2.** `qa-issue-label.yml` `label` has the same trigger and the same problem: no `status:in-qa`
  labels, and no closing of staged issues at promotion.
- **O3.** `cut-release.yml` and `visual-baseline-update.yml` run `qa` or branch code (`npm ci`,
  tests, Playwright). Dispatched on `main` (the only ref a `main`-only key admits), that code runs in
  `main`'s Actions cache scope, which the Production deploy restores with `tar -P`.

Separately, GitHub blocks `pull_request_target` in public repositories from 2 December 2026 unless an
Actions event policy allows it. `dependabot-hotfix-label.yml` runs on it, so Dependabot security PRs
into `main` would lose their `hotfix` label and fail `Restrict main PR source` again (#2383).

While the key is a repository secret, any workflow file on any branch can mint the token, and the
bot can push to `main` past the required checks. Deleting that secret is the point of the move.

Fixes: poke-memory #2383
Refs: ops #613, #2423

## What Changes

- **`auto-release.yml` runs on `push` to `main` instead of `pull_request` (O1).** A new first job,
  `find-pr`, asks the API which merged PR has the pushed commit as its merge commit: a promotion from
  `qa` runs `release` (cut, push, tag, Release, reset `qa`, dispatch the deploy) as today; any other
  merged PR runs `backmerge-hotfix` as today; a push with no merged PR does neither. The `[skip ci]`
  release commit starts no run. Both minting jobs name `bot`.
- **`qa-issue-label.yml` becomes a `workflow_run` labeller (O2).** A new, unprivileged
  `qa-issue-label-trigger.yml` runs on `pull_request: closed` with no permissions and does nothing
  else. When it succeeds, the labeller runs `main`'s copy on `main`, finds the merged PR through the
  API by the trigger's head branch and head commit, and labels or closes exactly as today with the
  bot token (so closes still start `auto-status.yml` and `auto-close-umbrella.yml`). It names `bot`.
- **`dependabot-hotfix-label.yml` stops using `pull_request_target` (#2383).** The same pattern: a new
  unprivileged `dependabot-hotfix-label-trigger.yml` on `pull_request` into `main`, and a
  `workflow_run` labeller on `main` that checks the PR is open, into `main` and opened by Dependabot,
  then adds `hotfix` with the bot token so the source gate re-runs. It names `bot`.
- **The two dispatched workflows split into a run on `qa` and a follow-up on `main` (O3, OD1 (a)).**
  `cut-release.yml` keeps only `prepare`, still dispatched on `qa`; a new `cut-release-open-pr.yml`
  (`workflow_run`, on `main`, names `bot`) opens, edits or re-drafts the promotion PR from its
  artefact. `visual-baseline-update.yml` keeps `gate` and `regenerate`; a new
  `visual-baseline-push.yml` (`workflow_run`, on `main`, names `bot`) rechecks the maintainer, the
  branch and its tip, and pushes the PNG-only commit as today. A job that runs `qa` or branch code is
  skipped when the run's ref is `main`, so that code never writes `main`'s cache scope.
- **Every `workflow_run` follow-up checks what triggered it**: one named workflow file, from this
  repository, a successful run, the expected event and branch. It never trusts
  `workflow_run.pull_requests` (shown wrong for merged PRs) or an artefact for identity; artefacts
  are data.
- **Guard test end state** (`scripts/workflows-bot-token.test.mjs`): every minting job names `bot`
  with no exceptions (the exception list goes); every minting workflow triggers only on `push` to
  `main`, `schedule`, `issues`, `workflow_run` or `workflow_dispatch`; no workflow uses
  `pull_request_target`; every minting `workflow_run` job checks its triggering file and repository
  and never reads `workflow_run.pull_requests`; every job that runs code from a non-`main` checkout
  is skipped on a `main` ref; exactly eight minting jobs, named.
- **Docs**: the workflow headers, `WORKFLOW.md` (catalogue rows for the four new files and the five
  changed ones, the "Bot token rule", the dispatch refs: `cut-release.yml` and
  `visual-baseline-update.yml` on `qa`, never `main`; `auto-release.yml` and
  `auto-close-umbrella.yml` by hand only on `main`) and `.claude/agents/workflow-expert.md`.
- **After merge (owner steps, not the build; moved to #2427):** open the promotion that carries this
  change from `prepare`'s artefact, verify the first runs, then restrict `bot` to `main`, put the key
  in it (from the App's private key file, or a new App key with Fraser's explicit yes), verify, and
  delete the repository secret.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no
  change, no app code changes.
- **Guest mode (localStorage):** no change.
- **Cloud sync and D1 migrations:** no change; no workflow here touches D1. (No Supabase projects
  remain.)
- **Superuser mode and QA-seed scenarios:** no change.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change.
- **Push notifications and the service worker (offline):** no change.
- **Sign-in:** no change.
- **Privacy notice and sub-processors:** no change, no new processor or data flow.
- **Accessibility:** no change, nothing renders.
- **README screenshots:** no change. The Playwright visual baselines are regenerated by the same job
  in the same image; only the push moves to the follow-up workflow.
- **Changelog fragments and the release:** no fragment (CI only, as the last two workflow changes).
  Releases: same cut (`cut-release.mjs` unchanged), same commit, tag, Release, `qa` reset and deploy
  dispatch, now started by the promotion's push to `main` (seen: the API names promotion #2421 and
  Dependabot PR #2203 from their merge commits, and returns nothing for release commit `9bd148a6`,
  which started no push run). Version bumps and the `version-bump-gate.yml` label are unchanged. The
  daily cron and by-hand runs stay; a by-hand run must be dispatched on `main` once the key moves.
  The `pwa-and-whats-new` requirement "Cutting a release (baseline)" stays true as written.
- **Backmerges:** `backmerge-hotfix` runs the same script for any merged PR into `main` other than
  the promotion (hotfix and Dependabot security PRs); the release path's backmerge is unchanged.
- **Issue board (`auto-status.yml`, `auto-close-umbrella.yml`):** unchanged; the labeller still
  closes with the bot token, so their `issues: closed` runs still start.
- **Dependabot flow:** security PRs into `main` keep getting `hotfix`, now through the trigger and
  the labeller; version-update PRs into `qa` never matched and still do not.
- **Cut-release:** dispatched on `qa` as today; the PR is opened by the follow-up run on `main` a
  minute later, with the same title, body, re-draft and coverage failure. Dispatching on `main` now
  skips `prepare` and opens nothing.
- **Visual baselines:** dispatched as today with the branch input; the bot's commit comes from the
  follow-up run.
- **CI and GitHub Actions:** four new workflow files (two unprivileged triggers, two `workflow_run`
  follow-ups for the dispatched workflows), five changed (`auto-release.yml`, `qa-issue-label.yml`, `dependabot-hotfix-label.yml`,
  `cut-release.yml`, `visual-baseline-update.yml`), the guard test,
  `WORKFLOW.md` and `workflow-expert.md`. None is a required check, and no ruleset names their jobs.
  `cron-health-monitor.yml` judges `auto-release.yml` by its latest run on `main`, which will now
  include push runs (green when they do nothing, a real failure otherwise); its schedule check is
  unchanged. `scripts/workflows-no-backups.test.mjs` asserts the deploy dispatch and `actions: write`
  in `release`, both kept. `pr-check-monitor.yml` only reads push runs as a health hint. Each
  follow-up adds one runner start per trigger, and each run of a job naming `bot` adds a deployment
  record there.

## Removes

- `pull_request` as a trigger of `auto-release.yml` and of the labelling in `qa-issue-label.yml`,
  and `pull_request_target` from the repository altogether (`dependabot-hotfix-label.yml`).
- The `open-pr` job from `cut-release.yml` and the `push` job from `visual-baseline-update.yml`
  (each moves, unchanged in what it does, to its follow-up file).
- The guard test's `ENVIRONMENT_EXCEPTIONS` list, its "no named exception names bot" test, and
  `pull_request_target` in its default-branch triggers.
- The "No `environment: bot`" comments on the three O1 and O2 jobs, `WORKFLOW.md`'s
  `pull_request_target` "trust boundary" and "Activation caveat" rows, its "Loop break: none of the
  triggers is `push`" line (the `[skip ci]` marker becomes the loop break), and the "dispatch on
  `main` once the key moves" instructions.
- The requirement "Jobs that mint the bot token name the bot environment" (its three exceptions and
  its "dispatch on `main`" scenario), replaced by "Only runs on main can mint the bot token".
- After merge, by Fraser: the repository secret `BOT_APP_PRIVATE_KEY`.

## Out of scope

- The settings themselves: restricting `bot` to `main`, setting its secret, deleting the repository
  secret, any new App key. Owner steps in #2427, each with Fraser's explicit yes.
- The rulesets and the bot's bypass: unchanged.
- Allowing `pull_request_target` in an Actions event policy (the other option in #2383): not needed
  once nothing uses it.
- The Production deploy's npm cache: unchanged under the chosen O3 option (design.md, OD1 (a)).
- `preview-upload.yml` and `deploy.yml`: unchanged.
- Dependabot PRs #2380 and #2381 into `main` without the `hotfix` label: not investigated here.

## Owner decisions relied on

- 21 November 2026, about 13:15 UTC: Fraser approved the proposal as recommended, with OD1 (a), the
  split in design D4, and OD2 (a), the promotion opened by hand from `prepare`'s artefact.
- 21 November 2026, about 11:55 UTC: Fraser chose "Proposal now" for open items O1 to O3 of
  `bot-token-trusted-steps`, with the proposed shapes for O1 (push to `main`, find the PR by commit)
  and O2 (unprivileged `pull_request` workflow plus a `workflow_run` labeller keeping the App token),
  O3 to be chosen and justified here, and #2383 folded into the same change.
- 21 November 2026, about 10:15 UTC: every job that mints the bot token names one environment, so the
  key can become `main`-only; leave `auto-release.yml`'s token in its `main` checkout.
- 21 November 2026, about 09:30 UTC: the bot token never meets code that has not reached `main`.
- 19 November 2026: only `main` is trusted to reach production (ops #610).
- Standing rules: agents merge PRs into `qa` once CI is green; promoting `qa` to `main`, settings,
  credentials and anything that costs money are Fraser's.

## Clarifications

- 2026-11-21: Write O1 to O3 as a proposal now, or later? Now (Fraser, about 11:55 UTC).
- 2026-11-21: Fold #2383 into the same change? Yes (Fraser, about 11:55 UTC).
- 2026-11-21: O1 shape? Trigger on `push` to `main` and find the merged PR by commit (Fraser, about
  11:55 UTC, taking D7's recommendation).
- 2026-11-21: O2 shape? Unprivileged `pull_request` workflow plus a `workflow_run` labeller on `main`
  that keeps the App token (Fraser, about 11:55 UTC).
- 2026-11-21: O3? The split into `workflow_run` pairs: `cut-release.yml` keeps `prepare` on `qa`
  with `cut-release-open-pr.yml` on `main`; `visual-baseline-update.yml` keeps `gate` and
  `regenerate` with `visual-baseline-push.yml` on `main` (Fraser, about 13:15 UTC, OD1 (a)).
- 2026-11-21: How is the promotion that carries this change opened, since its PR-opening follow-up
  is not on `main` yet? Dispatch `cut-release.yml` on `qa`, `gh run download` its prepared body, and
  open the draft `qa` to `main` PR by hand with `gh pr create --body-file`, titled like recent
  promotions (Fraser, about 13:15 UTC, OD2 (a)).
- 2026-11-21: Approve the proposal? Yes, as recommended (Fraser, about 13:15 UTC).
