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

Fixes: poke-memory #2415

## What Changes

- **Trusted files come from `main`, whatever the base.** Both checkouts in `preview-upload.yml`
  (`upload` and `preview-e2e`) use `ref: main` instead of the PR's base branch. `wrangler.jsonc`,
  `package.json`, `package-lock.json`, `.nvmrc`, the seed script, `playwright.config.ts` and the auth
  specs are therefore `main`'s for every PR, into `qa` or `main`.
- **From the artefact, only the bundle and the migrations.** Unchanged in substance: the Worker bundle
  and static assets are uploaded as they are (`--no-bundle`), and the PR's `.sql` migrations replace
  `main`'s `db/d1/migrations` and are applied to the preview database only, with the existing refusals
  (symlinks, non-files, non-`.sql` migrations). Nothing from the artefact is executed.
- **A PR into `qa` whose app needs config not yet on `main`** still gets a preview: built from the PR,
  uploaded with `main`'s bindings, the PR's migrations applied, `main`'s seed loaded. If the PR (or
  `qa` under it) changes a trusted file, the run prints a notice and the PR comment says which files
  differ from `main` and that they reach previews at the next promotion (open decision 1).
- **Guard test.** `scripts/workflows-no-backups.test.mjs` fails if any checkout in
  `preview-upload.yml` uses a ref other than `main`; today it locks in `base.ref`.
- **Docs** that say "the base branch's config" are corrected to `main`.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no
  change, no app code changes.
- **Guest mode (localStorage):** no change, nothing on the device changes.
- **Cloud sync and D1 migrations:** no change to the app or production. Preview migrations are still
  the PR's own `.sql` files (`preview-upload.yml:128-129`), now applied with `main`'s `wrangler.jsonc`;
  production migrations (`deploy.yml`) are untouched. (No Supabase projects remain.)
- **Superuser mode and QA-seed scenarios:** no change. The preview seed script now always runs from
  `main`; it writes only the two test users (`seed-preview.mjs`).
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change.
- **Push notifications and the service worker (offline):** no change; the preview Worker still has no
  Cron Triggers and no outbound sends, now guaranteed by `main`'s `env.preview` rather than the base's.
- **Sign-in:** no app change. The preview auth specs run `main`'s `e2e/auth.spec.ts`; a PR into `qa`
  that changes sign-in is checked by its own copy in `ci.yml` as today.
- **Privacy notice and sub-processors:** no change, no new processor or data flow.
- **Accessibility, README screenshots:** no change, nothing renders differently.
- **Changelog fragments and the release:** no fragment, no player-facing change (CI only, like
  `preview-deploy-guard`). The promotion PR (base `main`) and Dependabot PRs into `main` behave
  exactly as today.
- **CI and GitHub Actions:** `.github/workflows/preview-upload.yml`, the guard test, comments in
  `deploy.yml` (lines 18-20, 150-151), `WORKFLOW.md` (the Preview upload section),
  `.claude/agents/workflow-expert.md` and `.claude/agents/playwright.md`. None of these jobs is a
  required check. The Playwright image in `preview-upload.yml` now always matches the lockfile it
  runs against (both `main`'s), removing a skew `qa` could have caused.

## Removes

- The two `ref: ${{ github.event.workflow_run.pull_requests[0].base.ref }}` checkouts and the "base
  branch's wrangler.jsonc" step name and notices in `preview-upload.yml`.
- The guard test assertion that every checkout ref equals the base ref.
- The requirement wording "with the base branch's `wrangler.jsonc`" and "the base branch's auth specs".

## Out of scope

- Creating the preview token (Fraser, ops #612). Its scope needs a look there: this workflow applies
  migrations and loads the seed with `wrangler d1 ... --remote`, which needs a D1 permission, while
  ops #612 describes a Workers-only token with no D1 (inferred from the Cloudflare API, not run).
- A pull-request or approval rule on `main` or `qa` (a GitHub settings change, Fraser's). `main` has
  none either; its trust comes from `Restrict main PR source` (head `qa`, or the owner-applied `hotfix`
  label) and Fraser owning promotions.
- koinori #2936 (the same fix in koinori's tutor proxy upload). website, koinori-web and plan-bee only
  preview PRs into `main`, so they are unaffected.

## Owner decisions relied on

- 19 November 2026: only `main` may use the tokens that reach Cloudflare (ops #610).
- 20 November 2026, about 22:00 UTC: Fraser chose to fix both koinori #2936 and poke-memory #2415 now,
  before the preview token is created.
- Standing rule: agents merge PRs into `qa` once CI is green; promoting `qa` to `main` is Fraser's.

## Open decision

1. **What a PR into `qa` sees when it changes a trusted file not yet on `main`.**
   Recommended: upload with `main`'s files and say so (a run notice plus one line in the PR comment
   listing the differing files), so testers know why a binding or seed change is missing until the next
   promotion. Alternatives: upload silently (smallest, but a broken preview looks like a bug in the PR);
   skip the upload for such PRs (no misleading preview, but none at all until the promotion); or preview
   only PRs into `main`, as website, koinori-web and plan-bee do (simplest, but every `qa` PR loses its
   preview).

## Clarifications

- 2026-11-20: Fix koinori #2936 and poke-memory #2415 now or later? Now, before the token exists
  (Fraser, about 22:00 UTC).
- 2026-11-20: Which files are trusted? Everything that runs or configures a run: `wrangler.jsonc`,
  `package.json`, `package-lock.json`, `.nvmrc`, the seed script, `playwright.config.ts` and the auth
  specs, all from `main` (agent design within the brief).
- 2026-11-20: Whose migrations reach the preview database? Still the PR's `.sql` files, which reach
  only the preview database, which the PR's preview code can reach anyway (unchanged from
  `preview-deploy-guard` D3).
- 2026-11-20: What a `qa` PR needing config not yet on `main` sees? Open, decision 1 above.
