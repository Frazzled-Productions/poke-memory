## Context

The poke-memory-bot GitHub App token is the bypass actor on `main-protection` and `qa-staging`, so it
is the most powerful credential a workflow here holds: it can push to `main` without the required
checks. `main` is trusted because it changes only through a promotion Fraser merges. `qa` and feature
branches are not: agents merge into `qa` once CI is green. Seven workflows mint the token; three of
them also run code from `qa` or a branch in the same job.

## Baseline (current behaviour, before this change)

Written from `origin/qa` at `d32e2d3c` (identical to `origin/main` for every file below).

- `cut-release.yml` (workflow_dispatch, recent runs dispatched on `qa`): one job mints the token
  (lines 63-68), checks out `qa` with it and `fetch-depth: 0` (70-76, credentials persisted), runs
  `npm ci` (83), refuses when `qa` is not ahead of `main` (88-97), aggregates `Closes #N` from the
  range's commits and their PRs' bodies with the token (99-163), runs `npm run test:coverage` and
  `scripts/diff-coverage.mjs` (165-188), then opens or edits the draft `qa` to `main` PR, re-drafts it
  if it was marked ready, and fails last when coverage is below the bar and the input says so
  (190-269). Concurrency group `auto-release`.
- `visual-baseline-update.yml` (workflow_dispatch): `gate` allows only listed maintainers and refuses
  `main` and `qa` (67-124). `regenerate` (`contents: write`, Playwright container) mints the token
  (153-158), checks out the input branch with it (160-165), sets a global git identity, runs `npm ci`,
  `npm run build` and `npm run test:visual -- --update-snapshots` (190-207), and commits and pushes any
  change under `e2e/__screenshots__/` to the branch (216-236), re-checking the branch guard.
- `qa-issue-label.yml` (pull_request closed, merged, same repository, into `qa` or the promotion into
  `main`): sparse-checks out `.github/scripts` from the event's ref (81-84), mints the token (86-91),
  and in one step with the token as `GH_TOKEN` labels referenced issues `status:in-qa` (into `qa`,
  parsing with `bash .github/scripts/parse-closing-refs.sh`, line 146) or closes every `status:in-qa`
  issue and strips the label (promotion).
- `auto-release.yml`: `release` and `backmerge-hotfix` check out `main` with the token (86-92,
  248-252) and run only `main`'s files (`cut-release.mjs`, `extract-changelog-section.mjs`,
  `backmerge-main-into-qa.sh`, `npm install --package-lock-only --ignore-scripts`); `qa-drift-check`
  uses `GITHUB_TOKEN`. The release cut itself is specified in `pwa-and-whats-new` ("Cutting a release
  (baseline)").
- `auto-status.yml` (issues closed) checks out the default branch, `main`, and runs `main`'s
  `set-project-status.sh`; `auto-close-umbrella.yml` and `dependabot-hotfix-label.yml` check out
  nothing.

## Root cause

**Current behaviour.** Dispatching `cut-release.yml` on 20 November 2026 (run 44802961478) minted the
bot token, wrote it to a credentials file included from the checkout's `.git/config`, then ran `qa`'s
`npm ci` and test suite for four minutes before the post-job cleanup removed it. Any install script,
test or script in that tree could read the token and push to `main`. `visual-baseline-update.yml`
does the same with a feature branch, and `qa-issue-label.yml` runs `qa`'s parser in the step whose
environment holds the token.

**Expected behaviour.** No process started from `qa` or branch content can reach the bot token or the
private key it is minted from. Those trees run only in jobs with read-only `GITHUB_TOKEN`; the job
that holds the bot token runs only `main`'s files, or nothing from the checkout at all.

**Unchanged behaviour** (each becomes a regression check):
- WHEN `cut-release.yml` is dispatched with `qa` ahead of `main` THEN it SHALL CONTINUE TO open, or
  edit in place, one draft PR from `qa` into `main`, opened by the bot so its CI runs, with the same
  title, `## Closes` list and coverage section.
- WHEN that PR was marked ready THEN a re-dispatch SHALL CONTINUE TO return it to draft.
- WHEN aggregate coverage is below the bar and `coverage_fail_on_breach` is true THEN the run SHALL
  CONTINUE TO fail after the PR is updated.
- WHEN `qa` is not ahead of `main` THEN no PR SHALL CONTINUE TO be opened.
- WHEN a maintainer dispatches `visual-baseline-update.yml` on a feature branch whose baselines change
  THEN one bot commit SHALL CONTINUE TO land on that branch, regenerated in the pinned Playwright
  image, and the branch's PR CI SHALL CONTINUE TO run.
- WHEN the branch input is `main` or `qa`, or the actor is not listed THEN the run SHALL CONTINUE TO be
  refused before anything is built.
- WHEN a PR merges into `qa`, or the promotion merges into `main` THEN `qa-issue-label.yml` SHALL
  CONTINUE TO label, or close and unlabel, the same issues.
- WHEN a promotion merges or the daily cron runs THEN `auto-release.yml` SHALL CONTINUE TO cut,
  push, tag, backmerge or reset `qa`, and dispatch the deploy, exactly as today.

**What was tried before.** Nothing for this symptom. Change `preview-upload-trust-main` (#2415) fixed
the same shape for the Cloudflare preview token (trusted files from `main`, the PR's output read as
data); its final review found this issue.

**Evidence.**
- Seen: run 44802961478 (`cut-release.yml`, 20 November 2026, dispatched on `qa`): the checkout's
  inputs show `token: ***`, `ref: qa`, `persist-credentials: true`; at 19:31:54 it wrote
  `http.https://github.com/.extraheader` into `/home/runner/work/_temp/git-credentials-<id>.config`
  and added `includeIf.gitdir:.../.git.path` pointing at it; at 19:33:02 `npm ci` ran `qa`'s
  `preinstall` (`node scripts/check-node-version.mjs`); `npm run test:coverage` followed; "Removing
  credentials config" appears only in the post-job cleanup at 19:36:13, then "Token revoked".
- Seen: run 40351416345 (`visual-baseline-update.yml`, 26 October 2026, branch
  `openspec/favourite-everywhere`): the same credentials file under `/__w/_temp/`, then `npm ci`,
  `npm run build` and the push.
- Seen: run 44834360575 (`qa-issue-label.yml`, PR #2417 into `qa`): the checkout ran
  `git checkout --progress --force -B qa refs/remotes/origin/qa`, and the step with the bot token as
  `GH_TOKEN` piped into `bash .github/scripts/parse-closing-refs.sh`.
- Seen: run 44890783883 (`migration-check.yml`, `persist-credentials: false`): checkout writes the
  credentials for its own fetch and removes them ("Removing credentials config") before the next step
  starts, so a later step finds none.
- Cited: `gh api repos/Frazzled-Productions/poke-memory/rulesets/16176438` and `/16499371`
  (21 November 2026): `main-protection` and `qa-staging` each have one rule,
  `required_status_checks`, and one bypass actor, Integration 3646025, `bypass_mode: always`.
  `baseline-main-safety` (17354972) still blocks deletion and non-fast-forward pushes on `main` for
  everyone but organisation admins.
- Cited: the App installation's permissions are `contents: write`, `issues: write`,
  `pull_requests: write` and projects, with no `workflows` permission (#2419 said otherwise; corrected
  there on 21 November 2026).
- Cited: `package-lock.json` marks 8 packages `hasInstallScript: true`, and `package.json:9` has a
  `preinstall`, so `npm ci` always runs repository and third-party code.
- Seen: a prototype of the guard test, run against `.github/workflows` on `qa`, failed exactly three
  jobs (`cut-release` in `cut-release.yml`, `label` in `qa-issue-label.yml`, `regenerate` in
  `visual-baseline-update.yml`), each for both "runs repository code from a non-main checkout" and
  "non-main checkout persists credentials", and passed the other five minting jobs; against sketches of
  the fixed jobs it passed all three (exit 1, then exit 0).
- Seen: a shallow clone at a recorded commit can commit and push to the branch with the credential
  given as `git -c http.extraheader=...` on the push alone; afterwards `git config --local --list`
  holds no header (local bare-repository test).
- Seen: the bot's first-parent commits on `main` since 1 June 2026 are 24 `chore(release)` commits and
  15 `chore(stats)` refreshes, nothing else.

**Hypotheses ruled out.**
- "`auto-release.yml` has the same fault": no. Both token jobs check out `ref: main` (lines 91, 251) and
  run only `main`'s files; its one `npm` call is `--package-lock-only --ignore-scripts`. The prototype
  passes both jobs.
- "The other minting workflows have it": `auto-status.yml` runs on `issues` events, so its default
  checkout is `main`; `auto-close-umbrella.yml` and `dependabot-hotfix-label.yml` check out nothing.
- "Revoking the token at the end limits the damage": it is valid for the whole job (four minutes in
  the run above) and revoked only in the post step.
- "Minting the token after the untrusted steps, in the same job, is enough": inferred not. Earlier
  steps run as the same user on the same machine (root in the Playwright container), so they can leave
  a process running or change files and the environment later steps use; and the mint action's post
  step receives its inputs, including the private key, again at the end of the job.

**First wrong step.** `cut-release.yml:63-83`: one job both mints the token (with it on the checkout)
and runs `qa`'s `npm ci` and tests. The same fault: `visual-baseline-update.yml:153-207` and
`qa-issue-label.yml:81-91` with line 146.

**Failing test first.** `scripts/workflows-bot-token.test.mjs`, red on today's workflows for the three
jobs above, before any workflow edit.

**Always-on signal.** That guard test runs in `npm test` on every PR, so a new workflow or job that
pairs the token with branch code fails CI.

## Decisions

### D1. Two jobs, not a late mint in one job

The job that runs `qa` or branch code gets read-only `GITHUB_TOKEN` and `persist-credentials: false`,
and passes its results on as an artefact. A second job (`needs:` the first) starts on a fresh runner,
mints the token there and runs nothing from the checkout. Minting late in one job was rejected (see
"Hypotheses ruled out"). Cost: one extra runner start per dispatch and an artefact kept one day.

### D2. `cut-release.yml`: everything except the PR call moves to the first job

- `prepare` (`contents: read`, `pull-requests: read`): checkout `qa`, `fetch-depth: 0`,
  `persist-credentials: false`; `npm ci`; the "qa must be ahead" guard; the `Closes` aggregation with
  `GH_TOKEN: ${{ github.token }}` (commits and PR bodies are readable with it; the repository is
  public); the coverage run; and the body assembly, written to `promotion-pr/body.md`. Outputs:
  `diffcov_status` and `closes_count`.
- `open-pr` (keeps the name "Open/update the qa->main promotion PR"; no `GITHUB_TOKEN` permissions,
  no checkout): mint the token, download the artefact, check both outputs are whole numbers, then the
  same `gh pr list`, `edit`, `ready --undo` or `create --draft` calls with `--repo`, and the same
  final coverage failure. The body is only ever passed as `--body-file`.
- The "Ensure both branches are fetched" step stays: the repository is public, so it needs no
  credentials, and `fetch-depth: 0` already fetches every branch.

### D3. `visual-baseline-update.yml`: the push job checks out the regenerated commit

- `regenerate` (`contents: read`): checkout the branch with `persist-credentials: false`; record
  `git rev-parse HEAD` as output `sha` and whether anything under `e2e/__screenshots__/` changed as
  `changed`; upload `e2e/__screenshots__/` as artefact `visual-baselines`. The global identity step
  goes; `safe.directory` stays if a git command still needs it in the container.
- `push` (`needs: [gate, regenerate]`, `if: needs.regenerate.outputs.changed == 'true'`,
  `ubuntu-latest`, no container): re-check the branch guard; mint the token; checkout `sha` (checked to
  be 40 hex characters) with `persist-credentials: false`; download the artefact to `$RUNNER_TEMP`;
  fail if it holds a symlink or anything but `.png` files; copy them into `e2e/__screenshots__/`
  keeping their paths; commit with the bot identity given by `git -c`; and push
  `HEAD:refs/heads/<branch>` with the token as a one-off `http.extraheader` on that command only. If
  the branch moved since `regenerate`, the push is rejected as non-fast-forward and the run fails,
  as a moved branch fails today.
- Nothing from the branch runs in `push`: no `npm`, no build, no script. A fresh clone has no hooks.

### D4. `qa-issue-label.yml`: `main`'s parser

The sparse checkout gains `ref: main` and `persist-credentials: false`. `parse-closing-refs.sh` is the
same on `main` and `qa` today and last changed on 29 September 2026; a future parser change reaches the
labelling at the next promotion. Inlining the parser was rejected: it has its own tests.

### D5. `auto-release.yml`, `auto-status.yml`: no change

They run only `main`'s files, which is what the rule allows. Their persisted token is how the release
push, the tags, the backmerge and the `qa` reset authenticate.

### D6. Guard test

`scripts/workflows-bot-token.test.mjs` reads every workflow as text (as
`scripts/workflows-no-backups.test.mjs` does; no YAML library is a direct dependency), splits it into
jobs, and for each job whose steps use `actions/create-github-app-token` with `BOT_APP_PRIVATE_KEY`
fails when (a) a checkout's ref is not `main` (no ref counts as `main` only for workflows triggered
solely by `issues`, `issue_comment`, `schedule` or `pull_request_target`) and any step runs `npm`,
`npx`, `node <file>` or a repository script, or (b) such a checkout lacks `persist-credentials: false`.
It also asserts the three fixed jobs keep their shape: `prepare` and `regenerate` mint no token, and
`open-pr` has no checkout.

## Risks

- **The PR or push is made with `GITHUB_TOKEN` by mistake**, so CI does not start on it. Check: the
  guard asserts `open-pr` and `push` use the minted token; after merge, the first dispatch shows the
  promotion PR's checks running (task 2.1).
- **`open-pr` cannot download the artefact with no permissions.** `actions/download-artifact` uses the
  run's own runtime token for artefacts from the same run, not `GITHUB_TOKEN`. Check: task 2.1; if it
  fails, add `actions: read`.
- **The artefact path layout differs** (upload strips the common prefix). Check: the copy step is run
  locally against a fixture laid out as `upload-artifact` lays it out (task 1.3).
- **A shallow checkout cannot push.** Shown not to be a problem in the local test above; the build
  may still use `fetch-depth: 0` if the runner disagrees.
- **Cut-release runs while this lands.** A run dispatched on `qa` uses `qa`'s copy of the workflow,
  so the fix applies from the first dispatch after this merges into `qa`, before promotion.

## What this does not close

A workflow file is itself code from its ref. Where the bot's key is stored and which refs may use it is
tracked privately in ops #613; it needs a settings change, which is Fraser's.
