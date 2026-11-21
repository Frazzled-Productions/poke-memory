## MODIFIED Requirements

### Requirement: Opening the promotion PR
`cut-release.yml`, dispatched by hand on `qa`, SHALL check out `qa` with read-only `GITHUB_TOKEN`,
run its install, the `Closes` aggregation and coverage, and upload the PR body. Then
`cut-release-open-pr.yml`, a `workflow_run` run on `main`, SHALL mint the bot token, check out
nothing, and open, edit or re-draft one draft PR from `qa` into `main` from that artefact. Below-bar
coverage SHALL fail that run after the PR is updated, unless the input says not to.

#### Scenario: qa is ahead of main
- **WHEN** a maintainer dispatches `cut-release.yml` on `qa` and `qa` has commits `main` lacks
- **THEN** the follow-up run opens a draft PR from `qa` into `main` titled "Promote qa to main" as the bot, and its CI runs

#### Scenario: The promotion PR was already marked ready
- **WHEN** an open promotion PR is marked ready and the workflow is dispatched again
- **THEN** that PR's body is replaced and it is returned to draft, and no second PR is opened

#### Scenario: Nothing to promote
- **WHEN** `qa` has no commits that `main` lacks
- **THEN** the dispatched run fails, the follow-up does not act, the bot token is never minted, and no PR is opened

#### Scenario: Coverage below the bar
- **WHEN** aggregate diff coverage is below the bar and `coverage_fail_on_breach` is true
- **THEN** the PR is opened or updated with the breakdown and the follow-up run then fails

#### Scenario: qa's tests fail
- **WHEN** `qa`'s coverage run fails before writing its report
- **THEN** the dispatched run fails, the bot token is never minted, and the PR is left as it was

#### Scenario: Dispatched on main
- **WHEN** someone dispatches `cut-release.yml` on `main`
- **THEN** `prepare` is skipped, no `qa` code runs in `main`'s cache scope, and the follow-up does not act

#### Scenario: A branch fakes the dispatched workflow
- **WHEN** a branch adds a workflow named "Cut Release" from another file, or a run of it comes from a ref other than `qa`
- **THEN** the follow-up does not act, because it checks the triggering file, event, branch and repository

### Requirement: Regenerating visual baselines
`visual-baseline-update.yml` SHALL take a branch from a listed maintainer, refuse `main` and `qa`,
record its tip, and regenerate the screenshots from that tip without the bot token, in the pinned
Playwright image, in a run not on `main`. `visual-baseline-push.yml`, a `workflow_run` run on
`main`, SHALL recheck the maintainer, the branch and that its tip is unchanged, build a commit from
only the PNG files without checking out the branch, then mint the token for the push alone.

#### Scenario: Baselines change
- **WHEN** a listed maintainer dispatches the workflow for a feature branch whose screenshots differ
- **THEN** one bot commit with the new PNG files lands on that branch and the branch's PR checks run

#### Scenario: Nothing changed
- **WHEN** the regenerated screenshots match the committed ones
- **THEN** no baselines artefact is uploaded, the follow-up pushes nothing, and the bot token is never minted

#### Scenario: The branch moved meanwhile
- **WHEN** someone pushes to the branch after its tip was recorded
- **THEN** the follow-up sees a different tip, mints no token, pushes nothing and fails

#### Scenario: The artefact holds something else
- **WHEN** the uploaded screenshots include a symlink or a file that is not a PNG
- **THEN** the follow-up refuses them and pushes nothing

#### Scenario: The branch plants a symlink among the screenshots
- **WHEN** the branch holds a symlink under `e2e/__screenshots__/` and the artefact holds a file of the same name
- **THEN** the follow-up writes no branch file to disk, refuses the symlinked path, and pushes nothing

#### Scenario: A long-lived branch or an unlisted actor
- **WHEN** the input is `main` or `qa`, or the dispatcher is not a listed maintainer
- **THEN** the run is refused before anything is built, and the follow-up refuses it again

#### Scenario: Dispatched on main
- **WHEN** someone dispatches `visual-baseline-update.yml` on `main`
- **THEN** `regenerate` is skipped, no branch code runs in `main`'s cache scope, and nothing is pushed

### Requirement: Labelling issues staged on qa
When a same-repository PR merges into `qa`, `qa-issue-label.yml` SHALL add `status:in-qa` to each
issue it references with a closing keyword; when the promotion merges into `main`, it SHALL close
every `status:in-qa` issue and remove the label. It SHALL run as a `workflow_run` on `main` after
the unprivileged `qa-issue-label-trigger.yml`, find the PR through the API by head branch and head
commit, and use the bot token and `main`'s parser.

#### Scenario: A PR into qa closes two issues
- **WHEN** a PR whose body says "Closes #1 #2" merges into `qa`
- **THEN** issues 1 and 2 get `status:in-qa` and stay open

#### Scenario: The promotion merges
- **WHEN** the `qa` to `main` promotion PR merges
- **THEN** every open `status:in-qa` issue is closed by the bot with a comment naming the promotion, the label is removed, and `auto-status.yml` and `auto-close-umbrella.yml` run for each close

#### Scenario: The parser changed on qa only
- **WHEN** a change to `parse-closing-refs.sh` is on `qa` but not yet on `main`
- **THEN** labelling uses `main`'s parser until the next promotion

#### Scenario: The run payload names another PR
- **WHEN** the triggering run's `pull_requests` list is empty or names a different, open PR
- **THEN** the labeller ignores it and acts only on the merged PR whose head commit matches the run

#### Scenario: Closed without merging, or from a fork
- **WHEN** a PR is closed unmerged, or a fork's PR merges
- **THEN** the trigger workflow skips, the labeller does not act, and no token is minted

## ADDED Requirements

### Requirement: Only runs on main can mint the bot token
Every job that mints the poke-memory-bot token SHALL name the GitHub environment `bot`, with no
exceptions, so a key kept only there, admitting `main`, is minted only by runs on `main`. Each such
workflow SHALL trigger only on `push` to `main`, `schedule`, `issues`, `workflow_run` or
`workflow_dispatch`, and no workflow SHALL use `pull_request_target`.
`scripts/workflows-bot-token.test.mjs` SHALL fail otherwise.

#### Scenario: A new minting job leaves out the environment
- **WHEN** a change adds a job that mints the bot token without `environment: bot`
- **THEN** `scripts/workflows-bot-token.test.mjs` fails in CI

#### Scenario: A minting workflow gains a pull request trigger
- **WHEN** a change adds `pull_request` or `pull_request_target` to a workflow with a minting job, or `pull_request_target` to any workflow
- **THEN** `scripts/workflows-bot-token.test.mjs` fails in CI

#### Scenario: The key is still a repository secret
- **WHEN** a job naming `bot` runs before the key is moved into the `bot` environment
- **THEN** it mints the token from the repository secret and behaves as before

#### Scenario: A branch adds its own minting job after the key moved
- **WHEN** the key is only in a `bot` environment that admits `main` and a workflow file on a branch mints the token in a run on that branch
- **THEN** a job naming `bot` is refused before it starts and a job without it reads no key, so no token is minted

#### Scenario: Auto Release dispatched on qa after the key moved
- **WHEN** someone dispatches `auto-release.yml` on `qa` after the key moved
- **THEN** `release` is refused by the environment before minting and nothing is pushed

### Requirement: Releasing after a push to main
`auto-release.yml` SHALL run on each push to `main` and find, through the API, the merged PR whose
merge commit is the pushed commit. A promotion from `qa` SHALL run the release and reset `qa`; any
other merged PR SHALL run the hotfix backmerge; a push with no merged PR SHALL do neither. The
`[skip ci]` release commit SHALL start no run. The daily cron and a dispatch on `main` SHALL cut and
backmerge as before.

#### Scenario: Promotion merged
- **WHEN** a `qa` to `main` promotion merges with fragments present
- **THEN** the run on that push cuts the release, pushes commit and tag, creates the Release, resets `qa` to `main` and dispatches the deploy on `main`

#### Scenario: Hotfix or Dependabot PR merged into main
- **WHEN** a PR whose head is not `qa` merges into `main`
- **THEN** `backmerge-hotfix` merges `main` into `qa` and no release runs on that push

#### Scenario: The release commit lands
- **WHEN** the bot pushes the `[skip ci]` release commit to `main`
- **THEN** no new `auto-release.yml` run starts

#### Scenario: A direct push
- **WHEN** an admin pushes to `main` with no merged PR
- **THEN** the run does nothing, as before

### Requirement: Branch code never runs on a main ref
A job that checks out `qa`, a branch or a commit other than `main` and runs code from it SHALL be
skipped when the run's ref is `main`, so that code never writes `main`'s Actions cache scope, which
every branch and the Production deploy can restore. `scripts/workflows-bot-token.test.mjs` SHALL
fail on such a job without that condition.

#### Scenario: A new job forgets the condition
- **WHEN** a change adds a job that checks out `qa` and runs `npm ci` without skipping on `refs/heads/main`
- **THEN** `scripts/workflows-bot-token.test.mjs` fails in CI

#### Scenario: Production deploy after a qa dispatch
- **WHEN** `cut-release.yml` ran on `qa` and wrote the npm cache, and `main` then deploys
- **THEN** the Production job restores only caches written in runs on `main`

### Requirement: Follow-up runs check what triggered them
A `workflow_run` workflow that mints the bot token SHALL act only on a successful run of the one
workflow file it names, from this repository, with the expected event and branch. It SHALL find a
PR only through the API by the triggering run's head branch and head commit, never from
`workflow_run.pull_requests` or an artefact, and SHALL treat every artefact as data: plain files,
validated values, passed through `env:`.

#### Scenario: A failed triggering run
- **WHEN** the triggering run fails or is skipped
- **THEN** the follow-up does not act and mints no token

#### Scenario: A workflow with the same name on a branch
- **WHEN** a branch adds a workflow with the triggering workflow's name from another file
- **THEN** the follow-up does not act, because the triggering file differs

#### Scenario: A bad artefact value
- **WHEN** an artefact value from the triggering run is not the expected shape, such as a status that is not a whole number
- **THEN** the follow-up fails before minting the token

### Requirement: Labelling Dependabot security PRs as hotfixes
When Dependabot opens or updates a PR into `main`, `dependabot-hotfix-label.yml` SHALL add the
`hotfix` label with the bot token, so `Restrict main PR source` re-runs and passes. It SHALL run as
a `workflow_run` on `main` after the unprivileged `dependabot-hotfix-label-trigger.yml`, never on
`pull_request_target`, and act only on an open PR into `main` opened by Dependabot. This is the
baseline of the earlier workflow with its trigger changed.

#### Scenario: A security PR opens against main
- **WHEN** Dependabot opens a security PR into `main`
- **THEN** the bot adds `hotfix` and `Restrict main PR source` re-runs and passes

#### Scenario: Already labelled
- **WHEN** Dependabot updates a PR into `main` that already carries `hotfix`
- **THEN** the labeller changes nothing

#### Scenario: Someone else's PR into main
- **WHEN** a PR into `main` is not opened by Dependabot
- **THEN** the trigger workflow skips and no label is added

#### Scenario: A version update into qa
- **WHEN** Dependabot opens a version-update PR into `qa`
- **THEN** neither workflow acts

#### Scenario: After 2 December 2026
- **WHEN** GitHub blocks `pull_request_target` in public repositories
- **THEN** the labelling still runs, because no workflow here uses it

## REMOVED Requirements

### Requirement: Jobs that mint the bot token name the bot environment

**Reason**: It allowed three exceptions (`auto-release.yml` `release` and `backmerge-hotfix`,
`qa-issue-label.yml` `label`) and told the dispatched workflows to move to `main`; this change moves
all three onto `main` refs and keeps the dispatched workflows off `main`.

**Migration**: Replaced by "Only runs on main can mint the bot token" (no exceptions, triggers only
from `main`), "Branch code never runs on a main ref" and "Follow-up runs check what triggered them".
