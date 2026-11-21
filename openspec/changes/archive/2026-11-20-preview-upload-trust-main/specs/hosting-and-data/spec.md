## MODIFIED Requirements

### Requirement: Main deploys production and each pull request gets a preview

`deploy.yml` SHALL build, migrate and deploy `poke-memory` on a push or dispatch on `main`, from the
environment `Production`, which admits only `main` and alone holds the Cloudflare and Sentry tokens;
a published Release SHALL NOT deploy. For a pull request it SHALL only build the `preview-bundle`
artefact, with no environment or secret. `preview-upload.yml` SHALL upload it from `Preview`, which
admits only `main`, using `main`'s config, dependencies and specs and never writing D1, or skip.

#### Scenario: Pull request opened

- **WHEN** a same-repository pull request into `qa` or `main` builds successfully and `Preview` holds `CLOUDFLARE_PREVIEW_API_TOKEN`
- **THEN** a version of the separate Worker `poke-memory-preview`, with its own D1 database, is uploaded with `main`'s bindings, aliased `pr-<number>`, and its URL is commented on the PR

#### Scenario: A pull request edits its preview bindings or workflow

- **WHEN** a pull request points `env.preview` in `wrangler.jsonc` at the production database, or edits `deploy.yml` to read the preview secret
- **THEN** its preview is still uploaded with `main`'s `wrangler.jsonc`, and a job on its ref is refused the `Preview` environment, so it gets no token

#### Scenario: A change on qa edits a trusted file

- **WHEN** a change merged into `qa` but not yet promoted edits `wrangler.jsonc`, `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `playwright.config.ts` or the end-to-end specs
- **THEN** the next `qa` pull request's preview is still uploaded and tested with `main`'s copies, so nothing from that change runs next to the token before Fraser promotes it, and the run notice and one line of the PR comment name those files

#### Scenario: A pull request adds a migration

- **WHEN** a pull request into `qa` adds a `.sql` file under `db/d1/migrations`
- **THEN** its preview is still uploaded, its migration is not applied, and the PR comment says the preview runs against `main`'s schema until the migration reaches `main`

#### Scenario: Listing the differences fails

- **WHEN** a read-only GitHub compare call between `main` and the PR head or its base branch fails
- **THEN** the run prints a warning and the preview is still uploaded

#### Scenario: An untrusted bundle

- **WHEN** the `preview-bundle` artefact holds a symlink or something other than files and directories
- **THEN** `preview-upload.yml` refuses it and uploads nothing

#### Scenario: A job outside Production

- **WHEN** any job not in the `Production` environment reads `secrets.CLOUDFLARE_API_TOKEN`
- **THEN** it gets nothing, because there is no repository-level copy

#### Scenario: No token

- **WHEN** `Preview` holds no `CLOUDFLARE_PREVIEW_API_TOKEN` (every pull request today, Dependabot and forks)
- **THEN** the upload skips with a notice and the run is green, and the pull request's own build still runs

#### Scenario: Before the next promotion

- **WHEN** this workflow is on `qa` but not yet on `main`
- **THEN** no preview is uploaded, because GitHub runs `workflow_run` workflows only from the default branch

#### Scenario: Release

- **WHEN** a `qa` to `main` promotion merges and `auto-release.yml` pushes the `[skip ci]` release commit
- **THEN** it dispatches `deploy.yml` on `main`, and the production job deploys the released version from the `Production` environment

#### Scenario: Dispatch on another branch

- **WHEN** someone dispatches `deploy.yml` on a branch other than `main`
- **THEN** the production job is skipped, and the environment would refuse it anyway

#### Scenario: Guard drifts

- **WHEN** a change drops `environment: Production` or the `main` check from the production job, adds the release trigger back, removes the dispatch from `auto-release.yml`, names `Preview` or a Cloudflare secret in a `pull_request` job, uploads a preview from any other workflow, checks out anything but `main` in `preview-upload.yml`, or adds a `wrangler d1` call or the seed to it
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

#### Scenario: End-to-end tests

- **WHEN** a preview version was uploaded for a pull request
- **THEN** `main`'s auth specs run against the preview version URL

Source: design D11, `.github/workflows/deploy.yml`, `.github/workflows/preview-upload.yml`, `.github/workflows/auto-release.yml`; Fraser's rulings of 19 November 2026 (ops #610) and 20 November 2026; changes `production-deploy-guard`, `preview-deploy-guard` (koinori #2925 F3 and F4) and `preview-upload-trust-main` (#2415).

### Requirement: Preview databases hold seeded test data

`scripts/cloudflare/seed-preview.mjs` SHALL seed the preview database with two test users, cards and a
grade log, and no personal data. `deploy.yml`'s production job SHALL apply `main`'s migrations to the
preview database and load the seed after each production deploy; no other workflow SHALL write it.
Real data SHALL reach it only through the owner-approved copy rehearsal, and stays until the owner
decides to wipe and reseed it.

#### Scenario: Preview data

- **WHEN** someone signs in on a seeded preview with a test user
- **THEN** they see seeded data only

#### Scenario: After a rehearsal

- **WHEN** the copy rehearsal has loaded real data into the preview database
- **THEN** the preview still sends no push or email

#### Scenario: Main is deployed

- **WHEN** a push or dispatch on `main` deploys production
- **THEN** the production job then applies `main`'s migrations to `poke-memory-preview` with `--env preview` and reloads the two test users, so `qa.pokememory.com` and every `pr-<n>` version run against `main`'s schema

#### Scenario: The preview database step fails

- **WHEN** applying the preview migrations or loading the seed fails
- **THEN** production is already deployed and stays live, and the Deploy run is red

#### Scenario: Guard drifts

- **WHEN** a change removes the preview migrations or seed from the production job, or moves them before "Deploy the Worker"
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

Source: design D11, proposal Open call 4, `scripts/cloudflare/seed-preview.mjs`, `.github/workflows/deploy.yml`; change `preview-upload-trust-main` D3 (Fraser's ruling of 20 November 2026).
