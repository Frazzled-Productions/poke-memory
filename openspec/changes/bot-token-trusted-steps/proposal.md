## Why

Three workflows hand the poke-memory-bot token to a job that also runs code from `qa` or a feature
branch. `cut-release.yml` checks out `qa` with the token and leaves it in the checkout's git config
while it runs `qa`'s `npm ci` (install scripts) and test suite; `visual-baseline-update.yml` does the
same with the dispatched branch's `npm ci`, build and Playwright run; `qa-issue-label.yml` runs `qa`'s
copy of a repository script in the step that holds the token. The bot is the bypass actor on the
`main-protection` and `qa-staging` rulesets, so code that reads the token can push to `main` past the
required checks, and a push to `main` deploys production. `qa` takes agent PRs once CI is green, so a
compromised dependency or a bad change on `qa` would be enough. Nothing shows it has happened: the
bot's commits on `main` since June are release commits and user-count refreshes only.

Fixes: poke-memory #2419

## What Changes

- **Code from `qa` or a branch runs only in a job with no bot token.** That job checks out with
  `persist-credentials: false` and read-only `GITHUB_TOKEN`, and hands its results on as an artefact.
- **A second job holds the token and runs nothing from the checkout.** It mints the token after the
  first job finishes, on a fresh runner, and only opens or edits the PR or pushes.
- **`cut-release.yml`** becomes two jobs. The first checks out `qa`, aggregates the `Closes` list
  (reading commits and PR bodies with `GITHUB_TOKEN`), runs the coverage gate and writes the PR body.
  The second mints the token, checks out nothing, and opens, edits or re-drafts the draft promotion PR
  from that body, then fails the run on below-bar coverage as today.
- **`visual-baseline-update.yml`** keeps its `gate` job. `regenerate` loses the token and
  `contents: write`, checks out the branch without credentials, regenerates the screenshots and
  uploads them with the commit it used. A new `push` job mints the token, checks out that commit
  without credentials, copies in only PNG files under `e2e/__screenshots__/` (refusing symlinks and
  anything else), commits, and pushes with the token passed to that one `git push`.
- **`qa-issue-label.yml`** checks out `main`'s `.github/scripts` (sparse, `persist-credentials: false`)
  instead of the merged branch's, so the parser that runs next to the token is `main`'s.
- **Guard test** `scripts/workflows-bot-token.test.mjs`: fails if a job that mints the bot token
  checks out anything but `main` and runs repository code, or checks out anything but `main` without
  `persist-credentials: false`. Red on today's three workflows, green after.
- **Docs**: the workflow headers, `WORKFLOW.md` (the three sections' Token rows) and
  `.claude/agents/workflow-expert.md` state the rule.
- **`auto-release.yml` is unchanged.** It checks out `main` and runs only `main`'s scripts, so keeping
  the token in its checkout (needed for the release push, tags and the backmerge into `qa`) is within
  the rule. New capability `bot-automation` records that as a baseline next to the changed workflows.

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
- **README screenshots:** no change. The Playwright visual baselines under `e2e/__screenshots__/` are
  regenerated exactly as today (same image, same command); only who pushes them changes.
- **Changelog fragments and the release:** no fragment (CI only, as `preview-upload-trust-main`).
  `auto-release.yml`, `cut-release.mjs` and the backmerge script are unchanged; the promotion PR is
  still a bot-opened draft with the same title, body sections and coverage gate, so its CI still runs
  and `qa-issue-label.yml` still closes the staged issues on merge.
- **CI and GitHub Actions:** `cut-release.yml`, `visual-baseline-update.yml`, `qa-issue-label.yml`,
  one new guard test, `WORKFLOW.md` and `.claude/agents/workflow-expert.md`. None of these workflows
  is a required check; job names that change are not referenced by any ruleset or monitor
  (`cron-health-monitor.yml` and `pr-check-monitor.yml` name none of them). `auto-status.yml`,
  `auto-close-umbrella.yml` and `dependabot-hotfix-label.yml` mint the token but check out only `main`
  or nothing: no change. Each split adds one runner start per dispatch.

## Removes

- The bot token as `token:` on the checkouts in `cut-release.yml` and `visual-baseline-update.yml`,
  and the credentials those checkouts persisted.
- The bot token as `GH_TOKEN` for `cut-release.yml`'s read-only `Closes` aggregation (it becomes
  `GITHUB_TOKEN`).
- `contents: write` on `visual-baseline-update.yml`'s `regenerate` job, and its global git identity
  step (the identity moves to the `push` job's commit).
- `qa-issue-label.yml`'s checkout of the merged branch.

## Out of scope

- Where the bot's private key is stored and which refs may use it: tracked privately in ops #613
  (needs Fraser: a settings change).
- The rulesets and the bot's bypass: unchanged; this change touches no GitHub setting.
- koinori: checked for the same pattern; it is not there (no App token, PAT or repository secret).
  Two related findings are in koinori #2948.

## Owner decisions relied on

- 21 November 2026, about 09:30 UTC: Fraser chose "Fix now via OpenSpec": keep the bot token out of
  checkout (`persist-credentials: false`) and hand it only to the step that pushes or opens the PR, so
  no job runs `qa` or branch code while the token is reachable; check koinori for the same pattern.
- 19 November 2026: only `main` is trusted to reach production (ops #610).
- Standing rule: agents merge PRs into `qa` once CI is green; promoting `qa` to `main` is Fraser's.

## Clarifications

- 2026-11-21: Fix #2419 now or later? Now, via OpenSpec, with the token out of checkout and given only
  to the step that pushes or opens the PR (Fraser, about 09:30 UTC).
- 2026-11-21: Check koinori for the same pattern? Yes, report and file one issue if found (Fraser,
  about 09:30 UTC). Not found; koinori #2948 records two related exposures.
- 2026-11-21: Two jobs, or one job that mints the token after the untrusted steps? Two jobs, because
  earlier steps on the same runner can alter what later steps run (agent design within the ruling;
  open for Fraser, decision 1).
- 2026-11-21: Does `qa-issue-label.yml` belong in this change? Yes, it runs `qa`'s parser next to the
  token (agent finding; open for Fraser, decision 2).
- 2026-11-21: Does `auto-release.yml` change? No: it checks out `main` and runs only `main`'s code, so
  its token stays in its checkout for the release push and backmerge (agent finding; open for Fraser,
  decision 3).
