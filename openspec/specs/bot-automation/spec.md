# bot-automation Specification

## Purpose
The GitHub workflows that act as the poke-memory-bot App: opening the `qa` to `main` promotion PR,
regenerating visual baselines, labelling issues staged on `qa`, and the rule that keeps the bot's
token away from code that has not reached `main`. The bot can bypass the `main` and `qa` rulesets.
The promotion, baseline and labelling requirements are the baseline of today's behaviour (spec on
touch) with change `bot-token-trusted-steps` applied; the release cut is in `pwa-and-whats-new`.

## Requirements

### Requirement: The bot token never meets code from outside main
A job that mints the poke-memory-bot token SHALL check out only `main`, or check out another ref with
`persist-credentials: false` and run nothing from it. Code from `qa` or a branch (`npm ci`, builds,
tests, repository scripts) SHALL run only in jobs without the bot token and hand results on as an
artefact read as data. `scripts/workflows-bot-token.test.mjs` SHALL fail on any job that breaks this.

#### Scenario: An install script on qa looks for the token
- **WHEN** a package installed by `qa`'s `npm ci` in `cut-release.yml` reads the checkout's git config and environment
- **THEN** it finds no bot token and no private key, because that job never mints one and its checkout kept no credentials

#### Scenario: A new workflow pairs the token with branch code
- **WHEN** a change adds a job that mints the bot token and runs `npm` or a repository script from a `qa`, branch or pull request checkout
- **THEN** `scripts/workflows-bot-token.test.mjs` fails in CI

#### Scenario: Release run (baseline)
- **WHEN** a promotion merges into `main` or the daily release cron runs
- **THEN** `auto-release.yml` checks out `main` with the bot token in the checkout and runs only `main`'s scripts to commit, tag, push, backmerge or reset `qa`, as before this change

#### Scenario: Issue closed (baseline)
- **WHEN** an issue closes
- **THEN** `auto-status.yml` runs `main`'s `set-project-status.sh` with the bot token, as before this change, in a job that names the `bot` environment

### Requirement: Jobs that mint the bot token name the bot environment
Every job that mints the poke-memory-bot token SHALL name the GitHub environment `bot`, so a key kept
only there, admitting `main`, is minted only by runs on `main`. The only exceptions SHALL be
`auto-release.yml` `release` and `backmerge-hotfix` and `qa-issue-label.yml` `label` (they run on
`pull_request` refs), named in `scripts/workflows-bot-token.test.mjs`. `cut-release.yml` and
`visual-baseline-update.yml` SHALL name `qa` or the branch explicitly, so they work dispatched on
`main`.

#### Scenario: A new minting job leaves out the environment
- **WHEN** a change adds a job that mints the bot token without `environment: bot` and the job is not one of the three exceptions
- **THEN** `scripts/workflows-bot-token.test.mjs` fails in CI

#### Scenario: The key is still a repository secret
- **WHEN** a job naming `bot` runs before the key is moved into the `bot` environment
- **THEN** it mints the token from the repository secret and behaves as before

#### Scenario: Dispatched on qa after the key moved
- **WHEN** the key is only in a `bot` environment that admits `main` and someone dispatches `cut-release.yml` on `qa`
- **THEN** `prepare` runs, `open-pr` is refused by the environment before minting, and no PR is opened or edited

#### Scenario: An exception moves to main
- **WHEN** one of the three exceptions starts naming `environment: bot`
- **THEN** the guard test fails until its exception entry is removed, so the list stays true

### Requirement: Opening the promotion PR
`cut-release.yml`, dispatched by hand, SHALL open or edit one draft PR from `qa` into `main` with an
aggregated `## Closes` list and the aggregate diff coverage. A first job with read-only
`GITHUB_TOKEN` SHALL check out `qa` and run its install and coverage; a second SHALL mint the bot
token, check out nothing, and open, edit or re-draft the PR from the first job's artefact. Below-bar
coverage SHALL fail the run after the PR is updated, unless the input says not to.

#### Scenario: qa is ahead of main
- **WHEN** a maintainer dispatches `cut-release.yml` and `qa` has commits `main` lacks
- **THEN** the bot opens a draft PR from `qa` into `main` titled "Promote qa to main" and its CI runs

#### Scenario: The promotion PR was already marked ready
- **WHEN** an open promotion PR is marked ready and the workflow is dispatched again
- **THEN** that PR's body is replaced and it is returned to draft, and no second PR is opened

#### Scenario: Nothing to promote
- **WHEN** `qa` has no commits that `main` lacks
- **THEN** the first job fails, the bot token is never minted, and no PR is opened

#### Scenario: Coverage below the bar
- **WHEN** aggregate diff coverage is below the bar and `coverage_fail_on_breach` is true
- **THEN** the PR is opened or updated with the breakdown and the run then fails

#### Scenario: qa's tests fail
- **WHEN** `qa`'s coverage run fails before writing its report
- **THEN** the run fails, the bot token is never minted, and the PR is left as it was

### Requirement: Regenerating visual baselines
`visual-baseline-update.yml` SHALL take a branch from a listed maintainer, refuse `main` and `qa`, and
record its tip before branch code runs. A job without the bot token SHALL check out that tip with
`persist-credentials: false` and regenerate the screenshots in the pinned Playwright image. A second
job SHALL build a commit on that tip from only the PNG files, never checking out the branch, then
mint the token and give it to the push alone.

#### Scenario: Baselines change
- **WHEN** a listed maintainer dispatches the workflow on a feature branch whose screenshots differ
- **THEN** one bot commit with the new PNG files lands on that branch and the branch's PR checks run

#### Scenario: Nothing changed
- **WHEN** the regenerated screenshots match the committed ones
- **THEN** the push job does not run and the bot token is never minted

#### Scenario: The branch moved meanwhile
- **WHEN** someone pushes to the branch after regeneration started
- **THEN** the bot's push is rejected as non-fast-forward and the run fails, leaving the branch as pushed

#### Scenario: The artefact holds something else
- **WHEN** the uploaded screenshots include a symlink or a file that is not a PNG
- **THEN** the push job refuses them and pushes nothing

#### Scenario: The branch plants a symlink among the screenshots
- **WHEN** the branch holds a symlink under `e2e/__screenshots__/` and the artefact holds a file of the same name
- **THEN** the push job writes no branch file to disk, refuses the symlinked path, and pushes nothing

#### Scenario: A long-lived branch or an unlisted actor
- **WHEN** the input is `main` or `qa`, or the dispatcher is not a listed maintainer
- **THEN** the run is refused before anything is built

### Requirement: Labelling issues staged on qa
`qa-issue-label.yml` SHALL, when a same-repository PR merges into `qa`, add `status:in-qa` to each
issue it references with a closing keyword, and when the promotion merges into `main`, close every
`status:in-qa` issue and remove the label. The parser it runs next to the bot token SHALL be `main`'s
`.github/scripts/parse-closing-refs.sh`, checked out with `persist-credentials: false`.

#### Scenario: A PR into qa closes two issues
- **WHEN** a PR whose body says "Closes #1 #2" merges into `qa`
- **THEN** issues 1 and 2 get `status:in-qa` and stay open

#### Scenario: The promotion merges
- **WHEN** the `qa` to `main` promotion PR merges
- **THEN** every open `status:in-qa` issue is closed with a comment naming the promotion, and the label is removed

#### Scenario: The parser changed on qa only
- **WHEN** a change to `parse-closing-refs.sh` is on `qa` but not yet on `main`
- **THEN** labelling uses `main`'s parser until the next promotion
