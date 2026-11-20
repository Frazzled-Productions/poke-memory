## MODIFIED Requirements

### Requirement: The app runs as one Cloudflare Worker with Cache Components off

The app SHALL build with `@opennextjs/cloudflare` into one Worker, `poke-memory`, with
`cacheComponents: false`. Pages that were partially prerendered SHALL render per request, and nothing
SHALL revalidate at runtime, so the incremental cache is the static-assets cache.
`/test-error` SHALL be `force-dynamic`. Since the cutover (#2393) the Worker SHALL be reachable only at
`pokememory.com`, with its workers.dev address off. The preview Worker `poke-memory-preview` SHALL be
reachable at `qa.pokememory.com` (a Worker Custom Domain attached in Cloudflare, not a route in
`wrangler.jsonc`) and at its workers.dev address, with `BETTER_AUTH_URL` set to
`https://qa.pokememory.com`.

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

#### Scenario: Sign-in on the qa address

- **WHEN** a tester signs in with a seeded username on `https://qa.pokememory.com`
- **THEN** sign-in succeeds, because the preview Worker's `BETTER_AUTH_URL` is that origin, and the workers.dev address and `pr-<n>` aliases stay trusted origins

#### Scenario: Config drifts back

- **WHEN** a change sets the top-level `workers_dev` to true, or drops `workers_dev: true` from `env.preview`
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

Source: design D1, `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`; changes `production-deploy-guard`, `qa-on-preview-worker`.
