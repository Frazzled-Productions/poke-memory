## MODIFIED Requirements

### Requirement: The app runs as one Cloudflare Worker with Cache Components off

The app SHALL build with `@opennextjs/cloudflare` into one Worker, `poke-memory`, with
`cacheComponents: false`. Pages that were partially prerendered SHALL render per request, and nothing
SHALL revalidate at runtime, so the incremental cache is the static-assets cache.
`/test-error` SHALL be `force-dynamic`. Since the cutover (#2393) the Worker SHALL be reachable only at
`pokememory.com`, with its workers.dev address off.

#### Scenario: A page that used to be prerendered

- **WHEN** a player opens `/pokedex` on the Worker
- **THEN** the page renders for that request and matches what `next start` serves

#### Scenario: Build with the deliberate throw

- **WHEN** `npm run cf:build` runs
- **THEN** it exits 0, because `/test-error` is not prerendered

#### Scenario: Offline after a visit

- **WHEN** a player who has visited before opens the app with no connection
- **THEN** the service worker serves the cached shell as it does today, since per-request rendering changes nothing on the device

#### Scenario: The old production address

- **WHEN** someone opens `poke-memory.frasers-account.workers.dev` after a production deploy
- **THEN** Cloudflare does not serve the app there, while `https://pokememory.com` still answers 200

#### Scenario: A deploy and the custom domain

- **WHEN** `deploy.yml` deploys `poke-memory`
- **THEN** the `pokememory.com` Worker Custom Domain, attached in Cloudflare and not listed as a route in `wrangler.jsonc`, is left as it is, so a deploy never re-takes DNS

#### Scenario: The preview address

- **WHEN** a version of `poke-memory-preview` is uploaded
- **THEN** it keeps its workers.dev address, because `env.preview` sets `workers_dev: true`

#### Scenario: Config drifts back

- **WHEN** a change sets the top-level `workers_dev` to true, or drops `workers_dev: true` from `env.preview`
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

Source: design D1, `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`; change `production-deploy-guard`.

### Requirement: Main deploys production and each pull request gets a preview

`.github/workflows/deploy.yml` SHALL build, apply D1 migrations and deploy `poke-memory` on a push or
dispatch on `main`, from the GitHub environment `Production`, which admits only `main` and alone holds
the Cloudflare and Sentry tokens. A published Release SHALL NOT deploy; `auto-release.yml` SHALL
dispatch the deploy after its release commit. Pull request previews SHALL run in the environment
`Preview`, and without a token the jobs SHALL skip with a notice.

#### Scenario: Pull request opened

- **WHEN** a pull request is opened and the `Preview` environment holds a token
- **THEN** a version of the separate Worker `poke-memory-preview`, with its own D1 database and bucket, is uploaded, aliased `pr-<number>`, and its URL is commented on the PR

#### Scenario: A job outside Production

- **WHEN** any job not in the `Production` environment reads `secrets.CLOUDFLARE_API_TOKEN`
- **THEN** it gets nothing, because there is no repository-level copy

#### Scenario: No token

- **WHEN** the job's environment holds no Cloudflare token (every pull request today, Dependabot and forks)
- **THEN** the deploy jobs skip with a notice and the run is green

#### Scenario: Release

- **WHEN** a `qa` to `main` promotion merges and `auto-release.yml` pushes the `[skip ci]` release commit
- **THEN** it dispatches `deploy.yml` on `main`, and the production job deploys the released version from the `Production` environment

#### Scenario: Dispatch on another branch

- **WHEN** someone dispatches `deploy.yml` on a branch other than `main`
- **THEN** the production job is skipped, and the environment would refuse it anyway

#### Scenario: Guard drifts

- **WHEN** a change drops `environment: Production` or the `main` check from the production job, adds the release trigger back, or removes the dispatch from `auto-release.yml`
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

#### Scenario: End-to-end tests

- **WHEN** a preview version was uploaded for a pull request
- **THEN** the auth specs run against the preview version URL

Source: design D11, `.github/workflows/deploy.yml`, `.github/workflows/auto-release.yml`; Fraser's ruling of 19 November 2026 (ops #610); change `production-deploy-guard`.
