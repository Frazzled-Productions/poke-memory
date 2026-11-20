## MODIFIED Requirements

### Requirement: No GitHub workflow reads production data

No GitHub workflow SHALL query the production D1 database. Only `deploy.yml` SHALL read
`secrets.CLOUDFLARE_API_TOKEN`, which can write D1, and only `preview-upload.yml` SHALL read
`secrets.CLOUDFLARE_PREVIEW_API_TOKEN`.

#### Scenario: A workflow queries production

- **WHEN** a pull request adds a workflow step that runs `wrangler d1 execute --remote` without `--env preview`, calls the D1 REST query API, or runs the removed monitor scripts or their query helper
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

#### Scenario: Another workflow takes the token

- **WHEN** a workflow other than `deploy.yml` reads `secrets.CLOUDFLARE_API_TOKEN`, or one other than `preview-upload.yml` reads `secrets.CLOUDFLARE_PREVIEW_API_TOKEN`
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

Source (planned): design D13, owner ruling 20 November 2026, `scripts/workflows-no-backups.test.mjs`; change `preview-deploy-guard`.

### Requirement: Main deploys production and each pull request gets a preview

`.github/workflows/deploy.yml` SHALL build, apply D1 migrations and deploy `poke-memory` on a push or
dispatch on `main`, from the GitHub environment `Production`, which admits only `main` and alone holds
the Cloudflare and Sentry tokens. A published Release SHALL NOT deploy; `auto-release.yml` SHALL
dispatch the deploy after its release commit. For a pull request, `deploy.yml` SHALL only build and
bundle the preview Worker, with no environment and no secret, and upload it as the artefact
`preview-bundle`. `.github/workflows/preview-upload.yml`, on `workflow_run` of Deploy, SHALL upload it
from the environment `Preview`, which admits only `main`, with the secret
`CLOUDFLARE_PREVIEW_API_TOKEN` and the PR's base branch's `wrangler.jsonc`; without that secret it
SHALL skip with a notice.

#### Scenario: Pull request opened

- **WHEN** a same-repository pull request into `qa` or `main` builds successfully and `Preview` holds `CLOUDFLARE_PREVIEW_API_TOKEN`
- **THEN** a version of the separate Worker `poke-memory-preview`, with its own D1 database, is uploaded with the base branch's bindings, aliased `pr-<number>`, and its URL is commented on the PR

#### Scenario: A pull request edits its preview bindings or workflow

- **WHEN** a pull request points `env.preview` in `wrangler.jsonc` at the production database, or edits `deploy.yml` to read the preview secret
- **THEN** its preview is still uploaded with the base branch's `wrangler.jsonc`, and a job on its ref is refused the `Preview` environment, so it gets no token

#### Scenario: An untrusted bundle

- **WHEN** the `preview-bundle` artefact holds a symlink, something other than files and directories, or a migration that is not a `.sql` file
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

- **WHEN** a change drops `environment: Production` or the `main` check from the production job, adds the release trigger back, removes the dispatch from `auto-release.yml`, names `Preview` or a Cloudflare secret in a `pull_request` job, uploads a preview from any other workflow, or checks out anything but the base branch in `preview-upload.yml`
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

#### Scenario: End-to-end tests

- **WHEN** a preview version was uploaded for a pull request
- **THEN** the base branch's auth specs run against the preview version URL

Source: design D11, `.github/workflows/deploy.yml`, `.github/workflows/preview-upload.yml`, `.github/workflows/auto-release.yml`; Fraser's ruling of 19 November 2026 (ops #610); changes `production-deploy-guard` and `preview-deploy-guard` (koinori #2925 F3 and F4).
