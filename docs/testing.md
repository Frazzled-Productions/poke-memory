# Testing

Canonical reference for poke-memory test tooling. The generic discipline (test in/out of every
state, verify by running the app not just green CI, de-flake in the FULL suite, coverage ratchets
upward only, absence-only is insufficient) is in `ops/standards/conventions.md` → Testing
discipline; AGENTS.md (Testing) carries the non-negotiable headline rules. This file holds the
mechanics and worked examples.

## Unit / component (vitest)

Two projects in `vitest.config.ts`, partitioned by directory: the **`node`** project
(`lib/**/*.test.ts(x)`, env `node`, pure logic) and the **`jsdom`** project
(`components/**/*.test.tsx`, `app/**/*.test.tsx`, env `jsdom` + `vitest.setup.ts`, all React
rendering). A hook can live in `lib/`, but a test calling `renderHook` must live under
`components/` or it fails in CI with `ReferenceError: document is not defined`.

## De-flake run (full suite)

Re-run the whole project (`npx vitest run --project <node|jsdom>`) and ideally the changed-files
run (`npx vitest run --project <proj> --changed origin/qa`), not the single file. Worked example:
the #1464 `PwaInstallNudge` de-flake (PR #1469: `act()` + `getByText`) passed file-alone but
deterministically broke the `test` job in the full-suite / `--changed` run (`getByText` has no
retry, so it hard-failed against the component's async mount render) and had to be reverted
(#1470).

## Integration (vitest + local Postgres)

`lib/sync/integration/` runs against a local `postgres:15` container - no Supabase Pro/branch quota
(#464 / #545 replaced PR #531's branching approach). Opt-in locally:
`VITEST_INTEGRATION=1 npm run test:integration`. CI's `integration-tests.yml` runs on PRs touching
`lib/sync/**`, `app/api/sync/**`, `db/migrations/**`, `lib/gradelog/**`, or itself (#611); the
`integration-tests` label is the escape hatch. In scope: `apply-migrations.test.ts`, `rls.test.ts`,
`regression-trigger.test.ts`. `auth.uid()` is polyfilled via `SET LOCAL "request.jwt.claims"` in a
transaction.

**Any change that adds or edits a `db/migrations/*.sql` file must run this suite locally before
push** - `npm test` does not execute SQL, so a migration that fails to parse (e.g. a nested
`DO $$...$$` colliding with an outer `DO $$...$$` on the same empty dollar-tag) passes the normal
gate and only goes red on CI's `integration` job. Give nested PL/pgSQL blocks a distinct tag
(`$func$`, `$digest$`) or extract a top-level function and call it from the cron/trigger body
(#1653, 2026-06-09).

**Calling a Postgres RPC with a new action/enum value requires BOTH a migration** (teaching the
function body and any CHECK constraint) **AND a real-RPC integration test** against the local
container. A mocked-RPC unit test proves the caller's branching but not the DB contract; the
mismatch ships silently (#1883: the feedback throttle was green despite the action being unknown to
the DB). Model: `RATE_LIMIT_ACTIONS` in `lib/auth/rateLimitIp.ts` is the single source of truth;
`rate-limit.test.ts` iterates it and calls the real RPC for each action.

## Coverage gate (#824)

`npm run test:coverage` runs the fast suite under v8 with two gates: a **global floor** in
`coverage-floor.json` (the single source of truth - do not hardcode the numbers elsewhere; #1333),
and **diff coverage** (`scripts/diff-coverage.mjs`, 90% patch bar on changed product lines,
excludes test files / generated seed / non-product dirs). Both run in the `coverage` workflow on
every PR.

## E2E (Playwright)

Smoke tests in `e2e/` run against Vercel previews via `e2e.yml`; config in `playwright.config.ts`.

- **Scope**: guest-mode only. **Projects**: `chromium` + `mobile-safari` (Webkit, iPhone 14
  viewport). **Base URL**: `PLAYWRIGHT_BASE_URL`. **Run locally**: `npm run test:e2e` (after
  `npx playwright install`).
- **Node version must match CI** (the major baked into
  `mcr.microsoft.com/playwright:v1.60.0-noble`). Run `nvm use` (`.nvmrc` pins the recommended e2e
  Node major; `package.json` `engines.node` is a deliberately looser `>=20` floor). Running under
  Node 26 produces local-only failures (#657 / #614).
- **Selectors**: prefer `getByRole` / `getByText` / `getByLabel` over CSS or test IDs; match the
  accessible names in the markup.
- **When to add**: any new page, new interactive flow, or change to an existing user-facing flow.
  Bar is smoke-level happy path. An absence-only suite (asserting the feature is
  hidden/disabled/absent) is **not** sufficient - at least one test must assert the feature renders
  and its core interaction succeeds. One spec file per feature area.

### Layout/flex changes need a local `mobile-safari` run, not just chromium (#1837 / #1876)

Webkit diverges from Chromium on flex height propagation: `overflow-hidden` + `flex-1 min-h-0` can
collapse a flex child to zero computed height (clicks land on a sibling), `min-h-0` on a button
zeroes its cross-axis height (use `h-full`), and an empty placeholder div is still hit-testable on
Webkit (add `pointer-events-none`). A flex/height change to a shared review container
(`ReviewSession`, `ReviewCardLayout`, the minigame) MUST be validated locally on the
`mobile-safari` project against a prod build (`npm run build` + `npm run start`,
`PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test <spec> --project=mobile-safari`)
before push - a chromium-only check ships green-locally / red-on-CI.

### The service worker bypasses `page.route` stubs (#1650)

This is a PWA with an active service worker, so `page.route('**/api/...')` does not reliably
intercept fetches the SW mediates - the request hits the real (env-less) endpoint, which 500s in
the e2e job, and the test fails on the wrong state (misdiagnosed the #1622 feedback-modal e2e). For
API-submit flows, either set `serviceWorkers: 'block'` on the relevant project/context, OR assert
only up to the user interaction (form fills, submit enabled) in e2e and cover the network
round-trip (success/error branches) in unit tests with a mocked fetch. Do not assert a stubbed
network result in e2e. Worked example: the feedback test in `e2e/settings.spec.ts`.

**The SW only registers in a production build**, so a spec exercising offline/precache/SW-caching
behaviour MUST be validated against a local prod build (`npm run build` + `npm run start`, then
Playwright against `localhost`), never `npm run dev`: structural-only validation ships a
green-locally / red-on-CI spec (#1773 - the SW was not controlling the page when `setOffline`
fired, so `page.reload` got `net::ERR_FAILED`; warm + reload + await `serviceWorker.controller`
before going offline).

## Mandatory coverage rules (state and locale)

Non-negotiable for every user-facing change, in the implementer's unit/component **and** e2e tests,
and re-checked by the orchestrator at close-out (#1302 / #1327 shipped three broken headline
behaviours that passed unit tests, CI, and review).

### State coverage

When a fresh preview can't reach a data-dependent state, drive it via QA-seed scenarios (#1326) or
superuser flags (see [superuser.md](superuser.md)). Verify locale switched, seed applied, empty
branch, eyeballing exempted surfaces too (memory: `feedback_verify_core_mechanics_by_running_app`).

### Locale coverage

**Test names and labels in EVERY supported locale** (`en`, `ja`, `zh-Hans`, `zh-Hant`) on every
surface that renders them, for both axes (`appLocale` for chrome, `pokemonNameLocale` for names).
This **includes allowlisted / perf-exempted surfaces** (e.g. the Pokédex grid): lint-rule exemption
(#1327) is not render-correctness exemption - add a locale-rendering test there too and resolve
names via the pure resolver `lib/pokemon/localeNames.ts::getLocaleName`.

### Localising a number can break a `\d+` assertion

Numbers rendered via `Intl.NumberFormat` / next-intl `useFormatter().number()` / an ICU `#` gain
locale digit-grouping (`26,645`, or a narrow-NBSP separator). Update any unit/e2e assertion
matching the raw number with `\d+` to tolerate the separator, and grep `e2e/` + tests when touching
number rendering (#1408).
