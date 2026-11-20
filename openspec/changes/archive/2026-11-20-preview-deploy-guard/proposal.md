## Why

koinori #2925 F3 (high, latent) applies here too. `deploy.yml`'s `preview` job runs on
`pull_request` in the environment `Preview`, and uploads the PR's build with the PR's own
`wrangler.jsonc` and `package.json`. A same-repo pull request can edit `env.preview` to bind the
production D1 database, and Cloudflare asks no permission on bound resources, so a token limited to
the preview Worker would still let that preview read and write production data. The PR can also edit
the workflow itself, and `Preview` has no branch rule, so any check inside a `pull_request` workflow
can be deleted by the same PR. It is inert today only because `Preview` holds no token.

F4 (low): the preview job reads `secrets.CLOUDFLARE_API_TOKEN`, so with no environment secret it would
fall back to a repository or organisation secret of that name.

Fixes: none (Refs koinori #2925, ops #610; after-merge steps in #2411).

## What Changes

- **The pull request job only builds.** `deploy.yml`'s `preview` job loses `environment: Preview`
  and every secret. It builds as before, bundles the Worker with
  `wrangler deploy --dry-run --env preview --outdir`, and uploads the artefact `preview-bundle`
  (Worker bundle, static assets, D1 migrations; one day).
- **A trusted workflow uploads.** New `preview-upload.yml`, on `workflow_run` of Deploy, which GitHub
  runs from the default branch. For a successful same-repo PR run into `qa` or `main`, it runs in
  `Preview` on a GitHub-hosted runner, checks out the PR's base branch, `npm ci` from it, refuses
  symlinks and non-`.sql` migrations in the artefact, applies migrations and the seed to the preview
  database, uploads the bundle as it is (`--no-bundle`, `--config wrangler.jsonc`) and comments the
  URL. The preview auth specs move with it and run from the base branch.
- **A token name of its own (F4).** `CLOUDFLARE_PREVIEW_API_TOKEN`, an environment secret in
  `Preview`; without it the upload skips with a notice. No token is created by this change.
- **`Preview` admits only `main`** (set after this reaches `qa`, #2411), so no `pull_request`, `push`
  or dispatch run on another ref can read its secret.
- **Guard tests.** `scripts/workflows-no-backups.test.mjs` fails if a `pull_request` job names
  `Preview` or a Cloudflare secret, if anything but `preview-upload.yml` uploads a preview, or if that
  workflow checks out anything but the base branch.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no
  change, no app code changes.
- **Guest mode (localStorage), cloud sync, D1 migrations:** no change to the app. Preview migrations
  now apply from `preview-upload.yml` (the PR's `.sql` files, base branch's config); production
  migrations are unchanged.
- **Superuser mode and QA-seed scenarios:** no change; the seed script now runs from the base branch.
- **Locales:** no change.
- **Push notifications and the service worker (offline):** no change; the preview Worker still has no
  Cron Triggers and no outbound sends.
- **Sign-in:** no change. The preview auth specs run the base branch's copy of `e2e/auth.spec.ts`.
- **Privacy notice and sub-processors:** no change.
- **Accessibility, README screenshots:** no change.
- **Changelog fragments and the release:** no fragment, nothing a player sees (no `app/`,
  `components/` or `lib/` change).
- **CI and GitHub Actions:** `deploy.yml`, new `preview-upload.yml`, `package.json` (drops
  `cf:upload-preview`), the guard tests, and the docs: `WORKFLOW.md`, `AGENTS.md`,
  `docs/persistence.md`, `docs/testing.md`, `.claude/agents/{workflow-expert,playwright,data-coder,d1-expert}.md`,
  `.claude/commands/batch-issues.md`. Previews and their auth specs show on the `Preview upload` run,
  not on the PR's checks; none was a required check.

## Removes

- `environment: Preview`, the Cloudflare secrets, the upload, migration, seed and comment steps from
  `deploy.yml`'s `preview` job, and its `preview-e2e` job (moved to `preview-upload.yml`).
- The `cf:upload-preview` npm script: `opennextjs-cloudflare upload` imports the compiled
  `open-next.config` from `.open-next/`, which would execute PR code next to the token.
- The requirement wording that previews run in `Preview` from the pull request.

## Out of scope

- Creating the preview token (Fraser, once all five repos have this on `main`; #2411).
- Promoting `qa` to `main` (Fraser). Until then `preview-upload.yml` is not active and no preview is
  uploaded.
- The account-wide reach of a D1 write token: the preview token, once it exists, can still write any
  D1 database; only trusted code holds it.

## Owner decisions relied on

- 19 November 2026: only `main` may use the token that writes the live D1 and the production Worker
  (ops #610).
- 20 November 2026: Fraser approved finishing the move's leftovers, including koinori #2925's deploy
  guard fixes in every repo, as one PR per repo with change and build.

## Clarifications

- 2026-11-20: Which base branches may get a preview? `qa` and `main`, the work base and the default
  branch (shared design for koinori #2925).
- 2026-11-20: The secret's name? `CLOUDFLARE_PREVIEW_API_TOKEN`, in `Preview` only (shared design, F4).
- 2026-11-20: Whose migrations reach the preview database? The PR's `.sql` files, applied with the
  base branch's config; they reach only the preview database, which the PR's preview code can reach
  anyway (agent design within the brief; see design D3).
