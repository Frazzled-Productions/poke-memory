## Context

The poke-memory-bot App token is the bypass actor on `main-protection` and `qa-staging`, so a run
that mints it can push to `main` past the required checks, and a push to `main` deploys production.
Change `bot-token-trusted-steps` (on `qa` at f4d2458f, #2424) kept the token away from `qa` and
branch code inside a run, and made five minting jobs name the environment `bot`. Its design D7 shows
why that is not enough while the key is a repository secret: a workflow file is itself code from its
ref, so any branch can add a job that mints the token. Once `BOT_APP_PRIVATE_KEY` lives only in a
`bot` environment whose deployment branch rule is `main`, and the repository secret is gone, only a
job naming `bot` in a run whose ref is `refs/heads/main` can read it. This change removes the last
reasons the repository secret is needed (D7's O1 to O3) and the `pull_request_target` trigger GitHub
blocks from 2 December 2026 (#2383).

## Baseline (current behaviour, before this change)

Written from `origin/qa` at `bda0fc44`.

- `auto-release.yml`: triggers `pull_request` (closed, into `main`), `schedule` (09:00 UTC) and
  `workflow_dispatch` (lines 46-56). `release` runs for a merged PR whose head is `qa`, or for the
  cron and dispatch (70-73); it mints the token (79-84), checks out `main` with it (86-92), cuts the
  release, pushes commit and tag, backmerges into `qa` on the cron and dispatch path (151-169),
  creates the Release, resets `qa` to `main` on the PR path (183-203) and dispatches `deploy.yml` on
  `main` (205-215). `backmerge-hotfix` runs for any other merged PR into `main` (233-236) and runs
  `backmerge-main-into-qa.sh` from a `main` checkout. Neither names an environment.
- `qa-issue-label.yml`: `pull_request: closed` (56-58); one job, `label`, for a merged same-repository
  PR into `qa` or the promotion into `main` (69-74); sparse checkout of `main`'s `.github/scripts`
  without credentials (92-98); mints the token (100-105); labels `status:in-qa` (into `qa`) or closes
  every `status:in-qa` issue and strips the label (promotion), reading the PR body from the event and
  commits through `gh` (107-182). No environment (comment at 77-80).
- `dependabot-hotfix-label.yml`: `pull_request_target` (opened, synchronize, reopened) (44-46); `label`
  runs when the actor is `dependabot[bot]` and the base is `main` (55-57), names `bot` (62), mints the
  token and adds `hotfix` unless present (66-89). It checks out nothing. No spec covers it; the new
  requirement "Labelling Dependabot security PRs as hotfixes" is its baseline plus this change.
- `cut-release.yml`: `prepare` (dispatched on `qa`) checks out `qa` without credentials, restores and
  saves the npm cache (`setup-node` `cache: 'npm'`, line 92), runs `npm ci`, the guard, the `Closes`
  aggregation and coverage, and uploads `promotion-pr/body.md`; `open-pr` (`needs: prepare`, names
  `bot`) mints the token and opens, edits or re-drafts the draft PR (253-335).
- `visual-baseline-update.yml`: `gate` (line 83: maintainer and branch checks, records the tip), `regenerate` (164)
  (checks out that tip, runs the branch's `npm ci`, build and Playwright), `push` (names `bot`, builds
  a PNG-only commit with git plumbing, mints, pushes).
- `deploy.yml` `production` (`environment: Production`, Cloudflare and Sentry tokens) restores the npm
  cache with `setup-node` (line 93); so does `preview-upload.yml` (line 105).
- `scripts/workflows-bot-token.test.mjs` lists the three O1 and O2 jobs in `ENVIRONMENT_EXCEPTIONS`
  (lines 23-27) and treats `pull_request_target` as a default-branch trigger (line 30).
- The `bot` environment does not exist yet (`gh api repos/.../environments` lists only `Preview` and
  `Production`, 21 November 2026): no job naming it has run from `main`.

## Root cause

**Current behaviour.** The repository secret `BOT_APP_PRIVATE_KEY` cannot be deleted without
breaking releases, hotfix backmerges and `status:in-qa` labelling, because those three jobs run on
`pull_request` refs that a `main`-only environment refuses; and the two dispatched workflows cannot
move to `main` without putting `qa` or branch code into `main`'s cache scope. From 2 December 2026
the Dependabot labelling stops whatever happens to the key.

**Expected behaviour.** Every job that mints the token names `bot`, runs only in a run whose ref is
`main`, and runs no `qa`, branch or PR code; nothing else needs the repository secret, so it can be
deleted. No workflow uses `pull_request_target`.

**Unchanged behaviour** (each becomes a regression check):
- WHEN a `qa` to `main` promotion merges with fragments present THEN the release commit, tag and
  GitHub Release SHALL CONTINUE TO be made, `qa` SHALL CONTINUE TO be reset to `main`, and
  `deploy.yml` SHALL CONTINUE TO be dispatched on `main`.
- WHEN the daily cron runs or a maintainer dispatches `auto-release.yml` on `main` THEN it SHALL
  CONTINUE TO cut any fragments and backmerge the release commit into `qa`, with no reset.
- WHEN a hotfix or Dependabot PR merges into `main` THEN `main` SHALL CONTINUE TO be merged into `qa`.
- WHEN a same-repository PR merges into `qa` THEN its referenced issues SHALL CONTINUE TO get
  `status:in-qa`; WHEN the promotion merges THEN every `status:in-qa` issue SHALL CONTINUE TO be
  closed by the bot (starting `auto-status.yml` and `auto-close-umbrella.yml`) and unlabelled.
- WHEN Dependabot opens or updates a PR into `main` THEN it SHALL CONTINUE TO get `hotfix` from the
  bot, and `Restrict main PR source` SHALL CONTINUE TO re-run and pass.
- WHEN `cut-release.yml` is dispatched on `qa` with `qa` ahead THEN one draft promotion PR SHALL
  CONTINUE TO be opened or edited by the bot, re-drafted if ready, with the same body, and the run
  SHALL CONTINUE TO fail after the update on below-bar coverage when asked to.
- WHEN a maintainer dispatches `visual-baseline-update.yml` for a feature branch whose baselines
  change THEN one bot commit of PNG files SHALL CONTINUE TO land on that branch; `main`, `qa` and
  unlisted actors SHALL CONTINUE TO be refused.

**What was tried before.** `bot-token-trusted-steps` (#2419, #2424) named `bot` where it could and
recorded O1 to O3 as open items; nothing has tried to move the three jobs. #2383 (weekly review,
2 November) listed two options for `pull_request_target`: allow it by workflow file in an Actions
event policy, or move to `workflow_run` or a schedule.

**Evidence.**
- Seen: `pull_request` runs here use the merge ref: CI run 44897235034 (PR #2425) checked out
  `refs/remotes/pull/2425/merge` ("[new ref] 53cd38b2... -> pull/2425/merge"). GitHub's docs give
  `GITHUB_REF` for `pull_request` as `refs/pull/<n>/merge` (cited), which an environment admitting
  only `main` refuses.
- Seen: `auto-release.yml` runs 44891167542, 44805967274, 44742447956 and 44731973832 were all
  `pull_request` events (head `qa`): every recent release came through the refused path. Run
  44784439692 (`schedule`) ran on `main`.
- Seen: `qa-issue-label.yml` runs 44897205637 (#2424 into `qa`), 44834360575 (#2415 into `qa`) and
  44891167534 (promotion #2421) were `pull_request` events.
- Seen: `dependabot-hotfix-label.yml` run 44806324416 was a `pull_request_target` event by
  `dependabot[bot]` and logged "PR #2403 already carries the 'hotfix' label; nothing to do."
- Cited: GitHub changelog, 2 November 2026: from 2 December 2026, `pull_request_target` is blocked by
  default in public repositories (Free, Team, Enterprise Cloud) unless an Actions event policy allows
  it; it says nothing about `workflow_run`.
- Seen: `workflow_run.pull_requests` cannot identify a merged PR. The API's `pull_requests` for run
  44897205637 (merged #2424) and 44834360575 (merged #2415) is empty, and for run 44891167534 (merged
  promotion #2421) it lists #2426, the next, still open, promotion PR. It is matched live against
  open PRs on the head branch.
- Seen: the API identifies the merged PR from data GitHub sets, not from the PR: `GET
  commits/{sha}/pulls` returns #2421 (base `main`, head `qa`, `merge_commit_sha` equal) for
  promotion merge `607efbe2`, #2203 (Dependabot, squash) for `e9f6b9fa`, and nothing for the bot's
  release commit `9bd148a6`; `GET pulls?state=closed&head=Frazzled-Productions:<branch>` filtered to
  `merged_at` set and `head.sha` equal to the run's `head_sha` returns exactly #2424 for run
  44897205637 and exactly #2421 for run 44891167534.
- Seen: the release commit `9bd148a6` ("chore(release): v0.12.0 (minor) [skip ci]") started no
  `push` run (its runs are Dependabot `dynamic` runs and a `release` event only), although
  `deploy.yml` runs on push to `main`.
- Seen: Production deploy run 44891167049 restored `node-cache-Linux-x64-npm-fa368f66...` with
  `tar -xf .../cache.tzst -P -C /home/runner/work/poke-memory/poke-memory`. Cited: GitHub's cache
  docs: a run can restore caches from its own branch and the default branch, so a run on `main`
  never restores a cache written in `qa`'s or a feature branch's scope, while caches written in a
  run on `main` are readable by every branch.
- Cited: Dependabot-triggered runs are restricted (read-only token, Dependabot secrets only) for
  `pull_request`, `pull_request_review`, `pull_request_review_comment`, `push`, `create`,
  `deployment` and `deployment_status`; `workflow_run` is not in that list (GitHub docs,
  "Troubleshooting Dependabot on GitHub Actions").

**Hypotheses ruled out.**
- "Allow `pull_request_target` for this one workflow in an Actions event policy" (#2383 option 1):
  its runs use the default branch ref, so `bot` would admit them, but it needs a settings change and
  keeps a trigger GitHub now blocks by default. The `workflow_run` pattern needs no setting.
- "Identify the PR from `workflow_run.pull_requests`, as `preview-upload.yml` does": wrong for merged
  PRs (seen above). It works for `preview-upload.yml` because its PRs are open.
- "Pass the PR number in an artefact": the trigger runs the PR's own copy of its workflow file, so
  the artefact is the PR's to write; the head branch and head commit come from GitHub instead.
- "Use `commits/{sha}/pulls` for PRs merged into `qa`": the API returns only open PRs for a commit
  not on the default branch (GitHub docs), so it is used only for pushes to `main`.

**First wrong step.** `auto-release.yml:49-51` and `qa-issue-label.yml:56-58` start privileged
minting jobs from `pull_request`, a trigger whose ref is the PR's merge ref, not `main`; and
`dependabot-hotfix-label.yml:44-46` depends on `pull_request_target`. For O3, `cut-release.yml`
`prepare` and `visual-baseline-update.yml` `regenerate` have no guard against running on a `main`
ref, so the only safe dispatch ref today is `qa`, which a `main`-only key refuses.

**Failing test first.** The extended `scripts/workflows-bot-token.test.mjs` (D6), red on today's
workflows: the three exceptions lack `bot`, `auto-release.yml` and `qa-issue-label.yml` trigger on
`pull_request`, `dependabot-hotfix-label.yml` on `pull_request_target`, `cut-release.yml` and
`visual-baseline-update.yml` mint, and `prepare` and `regenerate` lack the `main` skip.

**Always-on signal.** The same test, in `npm test` on every PR.

## Decisions

### D1. `auto-release.yml` runs on `push` to `main` (O1)

- Triggers: `push: branches: [main]`, `schedule` and `workflow_dispatch` (no `pull_request`).
- New first job `find-pr` (`contents: read`, `pull-requests: read`, `GITHUB_TOKEN`, no checkout,
  always runs): on a push, `gh api repos/$REPO/commits/$SHA/pulls` keeps the PR with `merged_at` set,
  `merge_commit_sha` equal to the pushed SHA and base `main`; outputs `kind` (`promotion` when its
  head is `qa`, as today's `head.ref == 'qa'`; `hotfix` for any other; `none` with no such PR or on
  another event) and `number` (whole number, checked). One matching PR at most; more fails the job.
- `release` (`needs: find-pr`, `environment: bot`) runs when the event is not `push` or `kind` is
  `promotion`; its steps swap `github.event_name == 'pull_request'` for `== 'push'` (reset `qa`) and
  `!= 'pull_request'` for `!= 'push'` (backmerge the release). Everything else stays.
- `backmerge-hotfix` (`needs: find-pr`, `environment: bot`) runs when `kind` is `hotfix`, using
  `number` for its commit message through `env:`.
- Loop break: the release commit carries `[skip ci]`, which GitHub honours for `push` (seen above);
  tags and the `qa` reset are not pushes to `main`. A direct push with no merged PR (an admin
  bypass) does nothing, as today.
- `qa-drift-check` is unchanged.

### D2. `qa-issue-label.yml` becomes a `workflow_run` labeller (O2)

- New `qa-issue-label-trigger.yml` ("QA Issue Label trigger"): `pull_request: closed`, `permissions:
  {}`, one job with today's filter (merged, not a fork, into `qa` or the promotion into `main`) and a
  single `run: true` step. No checkout, no secret.
- `qa-issue-label.yml` keeps its name and job `label`: `workflow_run` on the trigger, completed;
  `environment: bot`; job `if:` requires `conclusion == 'success'`, `event == 'pull_request'`,
  `path == '.github/workflows/qa-issue-label-trigger.yml'` and `head_repository.full_name ==
  github.repository`. It finds the PR with `gh api "repos/$REPO/pulls?state=closed&head=$OWNER:$HEAD_BRANCH"`
  filtered to `merged_at` set, `head.sha == workflow_run.head_sha` and a base of `qa` (or `main` with
  head `qa`): none is a notice and a green run, more than one fails. Then today's script, with the
  body and base read from that API object instead of the event. Sparse checkout of `main`'s
  `.github/scripts` without credentials, as today.
- Concurrency: `qa-issue-label-${{ github.event.workflow_run.head_sha }}`.

### D3. `dependabot-hotfix-label.yml` without `pull_request_target` (#2383)

- New `dependabot-hotfix-label-trigger.yml`: `pull_request` (opened, synchronize, reopened) into
  `main`, job `if: github.actor == 'dependabot[bot]'`, `permissions: {}`, `run: true`.
- `dependabot-hotfix-label.yml`: `workflow_run` on that trigger, completed; `environment: bot`; the
  same job `if:` checks as D2 (path `.github/workflows/dependabot-hotfix-label-trigger.yml`) plus
  `workflow_run.actor.login == 'dependabot[bot]'`. It finds the open PR by head branch, base `main`
  and `head.sha`, requires `user.login == 'dependabot[bot]'`, and adds `hotfix` unless present.
  The App-made `labeled` event re-runs `Restrict main PR source`, as today.

### D4. The dispatched workflows split into a run off `main` and a follow-up on `main` (O3)

Chosen by Fraser on 21 November 2026 (OD1 (a)).

- **`cut-release.yml`** keeps only `prepare`, dispatched on `qa` as today, with job
  `if: github.ref != 'refs/heads/main'`. Its artefact `promotion-pr` gains `meta.txt` with
  `diffcov_status`, `closes_count` and `fail_on_breach` (job outputs and inputs do not cross runs).
- **New `cut-release-open-pr.yml`** ("Cut Release: open PR"): `workflow_run` on "Cut Release",
  completed; job `open-pr`, `environment: bot`, `permissions: actions: read` (to download another
  run's artefact); `if:` success, `event == 'workflow_dispatch'`, `head_branch == 'qa'`, path
  `.github/workflows/cut-release.yml`, same repository; concurrency group `auto-release`. It downloads
  the artefact by `run-id`, validates `meta.txt` (two whole numbers and `true` or `false`) and
  `body.md` as today, then runs today's `open-pr` script unchanged. The mint comes after the checks.
- **`visual-baseline-update.yml`** keeps `gate` and `regenerate` (job `if:` adds
  `github.ref != 'refs/heads/main'`); `regenerate` uploads `visual-baselines` only when something
  changed, plus `visual-baseline-target` (`branch.txt`, `sha.txt`).
- **New `visual-baseline-push.yml`** ("Visual Baseline Push"): `workflow_run` on "Visual Baseline
  Update", completed; job `push`, `environment: bot`, `permissions: actions: read`; `if:` success,
  `event == 'workflow_dispatch'`, `head_branch == 'qa'` (built narrower than first written,
  `!= 'main'`, after the final review), path
  `.github/workflows/visual-baseline-update.yml`, same repository. It rechecks
  `workflow_run.triggering_actor.login` with `gate`'s maintainer rule; reads branch and SHA from the
  target artefact as data (branch equals the one in the run title, `run-name: "Visual Baseline Update
  for <branch>"`, which `qa`'s file sets before any job runs, so branch code that re-uploads the
  artefact cannot redirect the push; passes `git check-ref-format --branch`, is not `main` or `qa`;
  SHA is 40 hex characters; the artefact is uploaded by `gate`, before any branch code runs); requires `git ls-remote` to show that SHA as the branch tip (else "the branch
  moved", nothing pushed); then today's validation, plumbing commit, mint and push, unchanged. No
  `visual-baselines` artefact means nothing changed: a notice, no mint.
- Why this option: the code that is not on `main` never runs in a run on `main`, so it never writes
  `main`'s cache scope, which every branch and the Production deploy can read; nothing depends on
  every future secret-holding job remembering to skip the cache. It is the pattern `preview-upload.yml`
  already uses (ops #612). Cost: two more files and about a minute of latency per dispatch. The
  bodies and outputs remain written by `qa` or branch code, exactly as today: validated data.

### D5. Rules every `workflow_run` follow-up keeps

- It names exactly one triggering workflow and checks `workflow_run.path` and
  `head_repository.full_name` in its job `if:`, because `workflows:` matches by display name and a
  branch can add a workflow with the same name.
- It identifies a PR only through the API by `head_branch` and `head_sha`, never from
  `workflow_run.pull_requests` or an artefact.
- It checks out only `main` (no ref means the default branch for `workflow_run`), or nothing.
- Artefacts are untrusted bytes: plain files only, values validated, passed to scripts through
  `env:`, never spliced as expressions.
- GitHub runs `workflow_run` workflows only from the default branch, so each follow-up takes effect
  only once it is on `main`.

### D6. Guard test end state

`scripts/workflows-bot-token.test.mjs` keeps checks (a) and (b) and the key-use count, and:
- every minting job names `environment: bot`; `ENVIRONMENT_EXCEPTIONS` and its staleness test go;
- every minting workflow's triggers are a subset of `push`, `schedule`, `issues`, `workflow_run` and
  `workflow_dispatch`, and a `push` trigger lists only `branches: [main]`;
- no workflow file uses `pull_request_target`;
- `DEFAULT_BRANCH_TRIGGERS` becomes `issues`, `issue_comment`, `schedule` and `workflow_run`;
- every minting job in a `workflow_run` workflow has an `if:` naming `github.event.workflow_run.path`
  and `head_repository.full_name`, and no minting job reads `workflow_run.pull_requests`;
- every job with an explicit non-`main` checkout that runs code has a job `if:` containing
  `github.ref != 'refs/heads/main'`;
- the minting jobs are exactly: `auto-release.yml/release`, `auto-release.yml/backmerge-hotfix`,
  `qa-issue-label.yml/label`, `dependabot-hotfix-label.yml/label`, `cut-release-open-pr.yml/open-pr`,
  `visual-baseline-push.yml/push`, `auto-status.yml/done` and `auto-close-umbrella.yml/close-umbrella`;
- the shape checks move with the jobs: `cut-release.yml` and `visual-baseline-update.yml` mint
  nothing; `open-pr` and `push` keep today's checks (no checkout, minted token on `gh` and the push,
  plumbing only, mint after the commit is built); the two triggers have `permissions: {}` and no
  step but `run: true`.

### D7. Docs

Workflow headers; `WORKFLOW.md`: sections for the four new files, the changed rows (Trigger, Token,
Loop break, dispatch refs) and the "Bot token rule" with no exceptions; `.claude/agents/workflow-expert.md`:
the follow-up rules in D5 and "never dispatch `cut-release.yml` or `visual-baseline-update.yml` on
`main`".

## Decisions taken by Fraser (21 November 2026, about 13:15 UTC)

Both were decided as recommended: OD1 (a) and OD2 (a). The options are kept for the record.

- **OD1. How O3 is closed.** (a, recommended) The split in D4: code not on `main` never runs on a
  `main` ref, so `main`'s cache scope stays trusted with no rule for future jobs; cost two files and
  a minute per dispatch. (b) Keep each workflow as one run, dispatch it on `main`, and drop the npm
  cache from `deploy.yml` `production` and `preview-upload.yml` (about a minute slower per deploy),
  with a guard that no environment job restores a cache: fewer files, but `qa` and branch code would
  write `main`'s cache scope, which every branch's CI restores, so a poisoned entry would reach all
  CI runs and any future job that forgets the rule. (c) Both: (a) plus dropping the cache as defence
  in depth; most work, little extra protection once (a) holds.
- **OD2. Opening the promotion that carries this change.** Its PR-opening follow-up is not on `main`
  until that promotion merges, and `main`'s `cut-release.yml` would run `qa`'s code on a `main` ref.
  (a, recommended) Dispatch `cut-release.yml` on `qa` and open the draft PR from its artefact by hand
  (`gh run download`, `gh pr create --body-file`, #2427 item 4.1): same body and `Closes` list, no
  `main` cache exposure, two commands once. (b) Dispatch on `main` once: one command, but `qa`'s
  `npm ci` and tests run once in `main`'s cache scope. (c) Open it with a hand-written body: loses the
  `Closes` list, so issues merged into `qa` before the promotion and not labelled would stay open.

## Migration

- Promote `bot-token-trusted-steps` (on `qa` now, open promotion PR #2426) first, as planned; this
  change builds on its jobs.
- Between this build's merge into `qa` and its promotion, `workflow_run` follow-ups are not active:
  PRs merged into `qa` get no `status:in-qa` label, and a `cut-release.yml` dispatch on `qa` opens no
  PR. The promotion body's `## Closes` list (OD2) closes those issues natively when it merges into
  `main`, the default branch. The shorter the window, the fewer issues rely on that list.
- When the promotion merges, its push runs the new `auto-release.yml` from `main` (find-pr names the
  promotion), and the merge ref's copy, which no longer has `pull_request`, starts nothing; its
  `pull_request: closed` event runs the new trigger, and the new labeller on `main` closes the staged
  issues.
- A `visual-baseline-update.yml` dispatch on `qa` in that window regenerates and uploads, but nothing
  pushes until `visual-baseline-push.yml` is on `main`.
- `dependabot-hotfix-label.yml` keeps working on `pull_request_target` until 2 December 2026 or the
  promotion, whichever is first. If the promotion lands after 2 December, a Dependabot security PR
  opened in between needs `hotfix` by hand.
- Then #2427: restrict `bot` to `main`, add the key, verify, delete the repository secret.

## Risks

- **A `workflow_run` started by a Dependabot run gets Dependabot's restrictions.** Not in GitHub's
  restricted list (cited), but not shown here. Check: #2427 item 4.4 on the next security PR; fallback
  is adding `hotfix` by hand and reopening #2383.
- **`commits/{sha}/pulls` lags the push and `find-pr` says `none` for a promotion.** Not seen. A
  `Merge pull request #N from ...` commit with no PR named fails `find-pr` (found in the final
  review: a green no-op would hide it); a squash merge with none named is a green no-op, which the
  drift check catches the next day. Check: #2427 item 4.2.
- **A merged PR whose head commit message holds `[skip ci]` starts no push run**: no release or
  backmerge for it. For a promotion (merge commit, message from the title) only the title matters.
  For a squash-merged hotfix or Dependabot PR the message is the PR body (the repository's squash
  setting), and a Dependabot body can quote an upstream `[skip ci]` commit (2 of 118 Dependabot PRs
  did): its backmerge is then skipped, where the old `pull_request` trigger ran it. The drift check
  opens its issue the next day; the same body already skips `deploy.yml`'s push. Changing the
  squash setting is Fraser's call (noted in the build PR).
- **A Dependabot PR that conflicts with `main`** starts no `pull_request` run, so it gets `hotfix`
  only once Dependabot rebases it (`pull_request_target` ran regardless).
- **Two PRs with the same head branch and head commit merged** (D2 lookup): fails loudly, no labels.
- **The trigger workflows run the PR's own copy**, so a PR can delete its trigger and skip its own
  labelling. Effect: a missing label, caught by the promotion's `Closes` list; never a token.
- **The key moves before this change is on `main`**: releases, labelling and the hotfix label stop.
  Check: #2427 orders the move after items 4.1 to 4.5.

## What this does not close

The settings themselves (environment rule, environment secret, deleting the repository secret, any new
App key) are Fraser's, in #2427 and tracked privately in the ops repo.
