## Why

`preview-upload.yml` (change `preview-deploy-guard`, #2412, on `main` since promotion #2414) checks out
the pull request's **base** branch and runs that branch's `wrangler.jsonc`, `npm ci` (package.json and
lockfile), `scripts/cloudflare/seed-preview.mjs` and `e2e/auth.spec.ts` next to
`CLOUDFLARE_PREVIEW_API_TOKEN` (lines 76 and 214). For a PR into `qa` that base is `qa`, whose ruleset
`qa-staging` has only required status checks: no pull-request or approval rule, and agents merge into
`qa` once CI is green. So a CI-green change that reaches `qa` could add an install script that runs
with the token, or point `env.preview` at the production database for every later `qa` preview. It is
latent: no token exists yet, and ops #612 (creating it) waits on this fix. Same finding as koinori #2936
F1.

The same workflow also writes D1 (the PR's migrations and the seed), so the preview token would need a
D1 permission. Fraser ruled on 20 November 2026 that the token is Workers-only, limited to
`poke-memory-preview` (ops #612), so the preview database follows `main` from the trusted deploy
instead, as Koinori's tutor proxy already does.

Fixes: poke-memory #2415

## What Changes

- **Trusted files come from `main`, whatever the base.** Both checkouts in `preview-upload.yml`
  (`upload` and `preview-e2e`) use `ref: main` instead of the PR's base branch. `wrangler.jsonc`,
  `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `playwright.config.ts` and the auth
  specs are therefore `main`'s for every PR, into `qa` or `main`.
- **From the artefact, only the bundle and the assets.** The Worker bundle and static assets are
  uploaded as they are (`--no-bundle`), with the existing refusals (symlinks, non-files). Nothing from
  the artefact is executed. `deploy.yml`'s `preview` job stops copying `db/d1/migrations` into the
  artefact.
- **The preview upload no longer touches D1.** Its "Apply D1 migrations (preview)", seed and "Load the
  seed" steps go, so its token needs only Workers permissions on `poke-memory-preview`.
- **The preview database follows `main`.** `deploy.yml`'s production job (environment `Production`,
  `main` only, which already holds the production token) applies `main`'s migrations to the preview
  database and loads `main`'s seed after it deploys production, on every push or dispatch on `main`.
- **A PR that differs from `main` in a trusted file or adds a migration** still gets a preview,
  uploaded with `main`'s bindings against the preview database at `main`'s schema. Read-only GitHub
  compare calls (`main...` the PR head and `main...` its base branch) list the differences: the run prints a notice, and the PR
  comment has one line naming the trusted files that differ (they reach previews at the next
  promotion) and, for a new migration, one line saying the preview runs against `main`'s schema until
  the migration reaches `main`.
- **Guard test.** `scripts/workflows-no-backups.test.mjs` fails if any checkout in
  `preview-upload.yml` uses a ref other than `main` (today it locks in `base.ref`), if
  `preview-upload.yml` calls `wrangler d1` or the seed, or if the production job stops migrating and
  seeding the preview database.
- **Docs** that say "the base branch's config" or that previews apply the PR's migrations are
  corrected.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no
  change, no app code changes.
- **Guest mode (localStorage):** no change, nothing on the device changes.
- **Cloud sync and D1 migrations:** production migrations (`deploy.yml`, `wrangler d1 migrations apply
  DB --remote`) are unchanged. The preview database (`poke-memory-preview`, shared by
  `qa.pokememory.com` and every `pr-<n>` version) now gets `main`'s migrations from the production job
  instead of each PR's own `.sql` files from the preview upload. A PR's migration reaches it only once
  promoted. (No Supabase projects remain.)
- **`qa.pokememory.com`:** its live deployment is still deployed by hand from `qa` (unchanged). Its
  database now also gets `main`'s migrations and a fresh seed of the two test users on every deploy of
  `main`, and no unmerged PR can change its schema (design, "What changes for qa.pokememory.com").
- **Superuser mode and QA-seed scenarios:** the seed script is unchanged and still writes only the two
  `preview-tester-*` users, now from the production job on each deploy of `main` rather than on each
  preview upload.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change.
- **Push notifications and the service worker (offline):** no change; the preview Worker still has no
  Cron Triggers and no outbound sends, now guaranteed by `main`'s `env.preview` rather than the base's.
- **Sign-in:** no app change. The preview auth specs run `main`'s `e2e/auth.spec.ts`; a PR into `qa`
  that changes sign-in is checked by its own copy in `ci.yml` as today. Reseeding signs the two test
  users out (the seed deletes their sessions, as it always did).
- **Privacy notice and sub-processors:** no change, no new processor or data flow.
- **Accessibility, README screenshots:** no change, nothing renders differently.
- **Changelog fragments and the release:** no fragment, no player-facing change (CI only, like
  `preview-deploy-guard`). The promotion PR (base `main`) and Dependabot PRs into `main` get previews
  as today, minus the migration and seed steps.
- **CI and GitHub Actions:** `.github/workflows/preview-upload.yml`, `.github/workflows/deploy.yml`
  (production job gains three preview-database steps after the production deploy; the `preview` job
  stops copying migrations; comments), the guard test, and the docs that said the preview upload
  applies migrations or uses the base branch's files: `WORKFLOW.md` (Migration check, Deploy and
  Preview upload sections), `AGENTS.md` (migrations bullet), `docs/persistence.md`, `docs/testing.md`,
  `.claude/agents/workflow-expert.md`, `.claude/agents/playwright.md`, `.claude/agents/d1-expert.md`,
  `.claude/agents/data-coder.md` and `.claude/commands/batch-issues.md`. None of these jobs is a
  required check. The Playwright image in `preview-upload.yml` now always matches the
  lockfile it runs against (both `main`'s).

## Removes

- The two `ref: ${{ github.event.workflow_run.pull_requests[0].base.ref }}` checkouts and the "base
  branch's wrangler.jsonc" step name and notices in `preview-upload.yml`.
- From `preview-upload.yml`: the migrations refusal and move, "Apply D1 migrations (preview)", the
  seed and "Load the seed" steps, and the `PREVIEW_TEST_PASSWORD` reference (it moves to the
  production job).
- From `deploy.yml`'s `preview` job: copying `db/d1/migrations` into `preview-bundle`.
- The guard test assertion that every checkout ref equals the base ref.
- The requirement wording "with the base branch's `wrangler.jsonc`", "the base branch's auth specs"
  and the untrusted-bundle clause about non-`.sql` migrations.

## Out of scope

- Creating the preview token (Fraser, ops #612): Workers-only, one per repo, limited to
  `poke-memory-preview`.
- A pull-request or approval rule on `main` or `qa` (a GitHub settings change, Fraser's). `main` has
  none either; its trust comes from `Restrict main PR source` (head `qa`, or the `hotfix` label, applied
  by Fraser or by the bot on Dependabot security PRs) and Fraser owning promotions.
- How `qa.pokememory.com`'s live deployment is made (by hand from `qa` today); automating it is a
  separate question.
- koinori #2936 (the same fix in koinori's tutor proxy upload). website, koinori-web and plan-bee only
  preview PRs into `main`, so they are unaffected.

## Owner decisions relied on

- 19 November 2026: only `main` may use the tokens that reach Cloudflare (ops #610).
- 20 November 2026, about 22:00 UTC: Fraser chose to fix both koinori #2936 and poke-memory #2415 now,
  before the preview token is created.
- 20 November 2026, about 22:20 UTC: Fraser approved the proposal, ruled decision 1 (upload with
  `main`'s files and name the differences), and ruled that the preview upload no longer touches D1 and
  the preview database follows `main` from the trusted deploy.
- Standing rule: agents merge PRs into `qa` once CI is green; promoting `qa` to `main` is Fraser's.

## Clarifications

- 2026-11-20: Fix koinori #2936 and poke-memory #2415 now or later? Now, before the token exists
  (Fraser, about 22:00 UTC).
- 2026-11-20: Which files are trusted? Everything that runs or configures a run: `wrangler.jsonc`,
  `package.json`, `package-lock.json`, `.nvmrc`, the seed script, `playwright.config.ts` and the auth
  specs, all from `main` (agent design within the brief).
- 2026-11-20: Approve the proposal? Yes: both checkouts use `main`; from the artefact only the bundle
  and assets are used and nothing in it executes (Fraser, about 22:20 UTC).
- 2026-11-20: What does a `qa` PR whose trusted files differ from `main` see (decision 1)? Upload with
  `main`'s files, and name the differing trusted files in a run notice and one line of the PR comment,
  from a read-only GitHub compare call (Fraser, about 22:20 UTC).
- 2026-11-20: Does the preview upload still write the preview database? No. The token is Workers-only
  (one per repo, limited to `poke-memory-preview`, created later in ops #612); migrating and seeding
  the preview D1 moves to `main`'s trusted deploy (`deploy.yml`, environment `Production`), so the
  preview database follows `main`'s migrations and seed, as Koinori does. A PR's own `.sql` migrations
  are no longer applied; a PR that adds one still gets a preview, and its comment says the preview runs
  against `main`'s schema until the migration reaches `main` (Fraser, about 22:20 UTC).
- 2026-11-20: Where in the production job do the preview-database steps go? After "Deploy the Worker",
  so a preview-database failure can never hold back a production deploy; it turns the run red after
  production is live (agent design within the ruling; Koinori runs its preview migrations before its
  deploy).
