## Why

Poké Memory has served pokememory.com from the Cloudflare Worker since 12:18 UTC on 20 November 2026
(#2393). Three loose ends remain from the switch:

- The repository-level `CLOUDFLARE_API_TOKEN` can write every D1 database in the account, and any
  pull request workflow from a same-repo branch can read it. Fraser ruled on 19 November 2026 (ops
  #610) that only `main` may use that token, as on the company site and Plan Bee.
- The production Worker still answers on `poke-memory.frasers-account.workers.dev`, a second address
  for the live app.
- Source maps never upload: `SENTRY_AUTH_TOKEN` lives only in the `Production` environment, which no
  job uses, and `SENTRY_ORG` and `SENTRY_PROJECT` are unset.

Fixes: none (steps of #2393; Refs ops #610).

## What Changes

- **Production deploys run in the GitHub environment `Production`**, whose deployment branch rule
  admits only `main` and which holds `CLOUDFLARE_API_TOKEN` and `SENTRY_AUTH_TOKEN`. The
  repository-level token is deleted once a guarded `main` deploy succeeds.
- **Releases deploy by dispatch, not by the Release event.** The release commit carries `[skip ci]`,
  so its push starts nothing; `deploy.yml` used to deploy on `release: published`, but a Release's
  ref is its tag, which the environment refuses. `auto-release.yml` now ends by dispatching
  `deploy.yml` on `main` whenever it pushed a release commit, and `deploy.yml` loses the release
  trigger.
- **Pull request previews get no token.** The preview job runs in the environment `Preview`, which
  holds none, so it skips with a notice. A token limited to the preview Worker cannot also be
  limited to the preview database (Cloudflare's D1 write permission is account-wide), so previews
  stay off until such a token exists.
- **The production Worker's workers.dev address is off** (`workers_dev: false`); the preview Worker
  keeps its address. The custom domain stays attached in Cloudflare, not listed as a route, as on
  the company site.
- **Sentry logs in CI.** `silent` becomes `!process.env.CI`, so the deploy log shows whether source
  maps uploaded. The repo variables `SENTRY_ORG` and `SENTRY_PROJECT` are set from Fraser's slugs.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no
  change, no app code changes.
- **Guest mode (localStorage), cloud sync, Supabase migrations:** no change. D1 migrations still
  apply from the production job only.
- **Superuser mode and QA-seed scenarios:** no change, but the preview database is no longer
  migrated or reseeded by pull requests while previews are off.
- **Locales:** no change.
- **Push notifications and the service worker (offline):** no change. Cron Triggers stay on the
  production Worker; service bindings do not use the workers.dev address.
- **Sign-in:** no change. `BETTER_AUTH_URL` is already `https://pokememory.com`; nothing points at
  the production workers.dev address (`git grep` finds only a preview alias in a test).
- **Privacy notice and sub-processors:** no change.
- **Accessibility, README screenshots:** no change.
- **Changelog fragments and the release:** no fragment, nothing a player sees. The release now
  reaches production by dispatch instead of the Release event.
- **CI and GitHub Actions:** `deploy.yml`, `auto-release.yml` (new `actions: write`, one new last
  step), the docs in `WORKFLOW.md`, `.claude/commands/batch-issues.md` and
  `.claude/agents/workflow-expert.md`, and the guard tests in `scripts/workflows-no-backups.test.mjs`.
  `/batch-issues` step "Get the `qa` preview" now has no preview to wait for.

## Removes

- The `release: published` trigger in `deploy.yml` and its "deploy the tip of `main`, not the tag"
  checkout ref.
- The repository-level secret `CLOUDFLARE_API_TOKEN` (after the first guarded deploy).
- The production Worker's workers.dev address.

## Out of scope

- A token limited to the preview Worker so previews come back (as for Koinori, koinori #2916).
- The other #2393 steps (bug-report email retention, leftover backup copies, the 14-day deletions).
- Sentry release health or alerts.

## Owner decisions relied on

- 19 November 2026: only `main` may use the token that writes the live D1 and the production Worker
  (ops #610).
- 20 November 2026: promotions to `main` approved for the switch's small follow-up fixes.

## Clarifications

- 2026-11-20: Turn the production workers.dev address off, as for the company site and Plan Bee? Yes
  (Fraser, via the switch brief).
- 2026-11-20: How does a release deploy when the environment refuses tag refs? `auto-release.yml`
  dispatches `deploy.yml` on `main` after its push (agent design within the brief, which named this
  option).
