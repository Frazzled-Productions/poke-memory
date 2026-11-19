## 1. Platform

- [x] 1.1 OpenNext build with `cacheComponents: false`, `open-next.config.ts` (static-assets cache), `app/test-error` force-dynamic, the changelog generated at build time. Verify: `npm run build` and `npm run cf:build` exit 0; `lib/changelog` tests green. Done: `npm run build` and `npm run cf:build` exit 0 (integration branch, 19 November 2026).
- [x] 1.2 `wrangler.jsonc`: Worker `poke-memory` and `env.preview` (`poke-memory-preview`), D1 and R2 bindings in the EU, two Cron Triggers on production only, `DEPLOY_ENV` and `BETTER_AUTH_URL` vars. Verify: `wrangler deploy --dry-run` for both envs exits 0. Done: preview deployed with `opennextjs-cloudflare deploy --env preview` (exit 0); production `wrangler deploy --dry-run` exits cleanly.
- [x] 1.3 `worker/index.ts` with `scheduled` and `cronRoutesFor` (design D2 table). Verify: `lib/cron/schedule.test.ts` covers every row and a non-matching hour, written failing first. Done: `lib/cron/schedule.test.ts`; `--test-scheduled` dispatched the hourly and half-hourly routes.
- [x] 1.4 `lib/outbound.ts`: sends only when `DEPLOY_ENV` is `cloudflare-production`. Verify: unit test; push and Discord route tests assert no send in preview. Done: `lib/outbound.test.ts`; push and Discord route tests assert no send outside production.
- [x] 1.5 Local development notes (Node 24, `wrangler dev`, the sprites and audio EBADF workaround) in `docs/local-dev.md`. Verify: a `wrangler dev` smoke returns 200 for `/`, `/pokedex`, `/settings`. Done: `docs/local-dev.md`; `wrangler dev` smoke returned 200 for seven pages.

## 2. Database and authorisation

- [x] 2.1 `db/d1/migrations/0001_schema.sql` (Postgres 001 to 051 in SQLite) and `0002_auth.sql` (Better Auth). Verify: migrations apply to a fresh local D1; trigger tests ported from `db/tests/` and the Postgres integration suite pass on the D1 test database. Done: `db:migrate:local` applies 0001 to 0003; `lib/db/schema.test.ts` trigger tests green.
- [x] 2.2 `lib/db/scope.ts` (`forUser`), `lib/db/tables.ts`, `lib/db/errors.ts`, `lib/db/env.ts`, and the node:sqlite D1 test shim. Verify: scope tests (user pinned on reads and writes, other user refused, unknown column refused, type conversion), written failing first. Done: `lib/db/scope.test.ts`, `tables.test.ts`, `errors.test.ts`, the node:sqlite shim.
- [x] 2.3 `scripts/check-scoped-queries.mjs` in `npm run lint`. Verify: its test fails on a planted raw query outside `lib/db/` and passes on the tree. Done: `scripts/check-scoped-queries.test.mjs` (35 tests) and in `npm run lint`.
- [x] 2.4 `lib/db/system.ts` for cross-user jobs, importable only from the cron, push-send, Discord and feedback routes. Verify: an ESLint fixture importing it elsewhere fails lint. Done: ESLint `no-restricted-imports` with lint fixtures.

## 3. Data gateway and browser client

- [x] 3.1 `POST /api/db` with the validated wire format (design D5): tables, columns, operators and RPC names allowlisted; session required; `user_id` pinned. Verify: route tests for each operation, 401 without a session, 400 on unknown names, 403 on another user's id. Done: `app/api/db/route.test.ts`; on the preview Worker 401 without a session, 403 for another user's id.
- [x] 3.2 `lib/db/client.ts`, the browser client with the supabase-js subset the app uses, returning `{ data, error, count }` with Postgres-style codes. Verify: contract tests run the same query through the client and the gateway against the D1 test database. Done: `lib/db/client.test.ts`, `lib/db/clientGateway.test.ts`.
- [x] 3.3 RPCs in the Worker: `merge_user_settings` (deep merge keeping nulls, compare-and-swap, the migration 038 regression guard with `23514`, the optimiser's weekly limit on `fsrsWeightsOptimizedAt`), `reset_all_progress` (cooldown, tombstone), `delete_account` (data, Discord posts, Better Auth user). Verify: tests ported from the Postgres RPC integration tests, red first where behaviour is new. Done: `lib/db/rpc/*.test.ts`; removing the 038 guard or the deep merge turned 4 tests red.
- [x] 3.4 Every browser call site moves from `lib/supabase/client.ts` to the new client (`lib/sync/**`, `lib/push/subscribe.ts`, components and pages). Verify: the existing sync tests pass unchanged apart from imports; a parity test runs `pullSession`, `pushSession`, `pushSingleCard` (including a `23514` rejection), settings, streak and grade-log legs against the D1 test database. Done: parity test `lib/db/clientGateway.test.ts` runs the real sync functions over D1.
- [x] 3.5 Cross-user tests: user B can neither read nor change user A's rows through any table or RPC. Verify: `lib/db/crossUser.test.ts` green, and red when the pin in `scope.ts` is removed. Done: `lib/db/crossUser.test.ts` (83 tests); 17 failed with the pin removed from `scope.ts`.

## 4. Sign-in

- [x] 4.1 Better Auth server (`lib/auth/server.ts`, `app/api/auth/[...all]/route.ts`): username plugin with the existing rule, GitHub, Google, linking, UUID ids, D1. Verify: route tests for username sign-up, sign-in, bad credentials (one answer), sign-out. Done: `lib/auth/server.test.ts`; username sign-up and sign-in worked on the preview Worker.
- [x] 4.2 bcrypt compatibility: copied `$2a$`/`$2b$` hashes verify with bcryptjs and are rehashed to scrypt on success. Verify: test with a known bcrypt hash; the stored hash changes prefix after sign-in. Done: bcrypt verify and rehash test; a copied user signs in with the same id.
- [x] 4.3 Per-IP throttle on username sign-up and sign-in from `rate_limit_buckets` in D1. Verify: test, the 6th attempt in the window is refused as today. Done: `lib/db/rateLimit.test.ts`; keyed on CF-Connecting-IP.
- [x] 4.4 Browser side: `lib/auth/client.ts`, `AuthContext` on `useSession`, `actions.ts`, `LinkIdentitiesSection`, `callback-complete` as the OAuth callback target, `requireAuth` from request headers, the mock-auth seam ported. Verify: existing component tests updated; e2e `auth.spec.ts` green on a local build with mock auth. Done: component tests; `e2e/auth.spec.ts` ported (auth-real runs on a local Worker in CI).
- [x] 4.5 Account deletion removes the Better Auth user, sessions and accounts with the data. Verify: delete-account test checks every table is empty for that user. Done: `lib/db/authUser.test.ts` checks every table; delete_account on the preview Worker ended the session.
- [x] 4.6 Re-sign-in after the move: a device holding progress for the same user id is not shown the keep-local or keep-cloud picker; sign-out revokes every session; any `?error=` code shows the sign-in error. Verify: component and route tests for each. Done: callback-complete arrival-owner test, sign-out-everywhere test, `?error=` banner test.

## 5. Server routes and scheduled jobs

- [x] 5.1 `/api/sync`, `/api/export`, `/api/push/resubscribe` on the session and the scope helper. Verify: their route tests, plus two-user tests. Done: route tests with two users on D1.
- [x] 5.2 `/api/push/send-daily` and `/api/push/send-streak-nudge` with the target queries in `lib/db/system.ts` (ports of `get_push_targets`, `get_push_due_cards`, `get_push_streak_days`, `get_push_streak_nudge_targets`), VAPID from Worker secrets, the delivery helper unchanged. Verify: route tests, and system-query tests against the D1 test database matching the Postgres RPC tests. Done: system-query tests across time zones and DST; preview `send-daily` returned sent 0.
- [x] 5.3 `/api/feedback` stores feedback and sends the Discord bug notification itself (`ctx.waitUntil`); `/api/discord/notify` and `/api/discord/digest` read D1. Verify: route tests, including the stored message id and its deletion. Done: feedback and Discord route tests, message id stored and deleted.
- [x] 5.4 `/api/cron/feedback-retention`, `/api/cron/reconcile-grade-log`, `/api/cron/rate-limit-cleanup`, each with the bearer check. Verify: route tests ported from the `pg_cron` SQL behaviour. Done: cron route tests; every CRON_ROUTES path runs through `runCronRoutes`.
- [x] 5.5 `/api/cron/backup`: every table to R2 as SQL, objects over 90 days deleted. Verify: test with a fake bucket; a restore of the file into a fresh test database gives the same row counts; a real run against `poke-memory-backups-preview`. Done: real run on the preview wrote `d1/2026-11-19.sql` (7.6 MB) to `poke-memory-backups-preview`; downloaded through the REST API and restored locally, `check-restore.mjs` passed for 13 tables.

## 6. Optimiser

- [x] 6.1 Check #2392: does the current item building give `NotEnoughData`? Verify: a test on a realistic synthetic log with the native binding; the finding commented on #2392. Done: `lib/srs/optimizer.fit.test.ts` red with `NotEnoughData` before the fix; finding posted on #2392.
- [x] 6.2 `/settings/optimiser` with COOP and COEP on that path only, the wasm optimiser in a Web Worker, the weekly limit and minimum reviews, the superuser write guard, every state translated. Verify: e2e in Chromium on a production build (`crossOriginIsolated` true there and not on `/settings`), unit tests for the states, locale tests in en, ja, zh-Hans, zh-Hant. Done: `e2e/optimiser.spec.ts` 4/4 in Chromium on a production build; preview Worker sends COOP and COEP on `/settings/optimiser` only.
- [x] 6.3 Remove `/api/srs/optimize` and the native binding. Verify: build exits 0 with no `.node` file in `.open-next`. Done: build exits 0; no `.node` file in `.open-next`.

## 7. Analytics, Sentry and copy

- [x] 7.1 `0003_events.sql`, `POST /api/event`, `FunnelTracker` sending `app_open` there; Vercel Analytics and Speed Insights removed; the Cloudflare Web Analytics beacon when its token is set. Verify: events route tests (no personal fields stored, rate limit, bad body), layout test. Done: `lib/db/analyticsEvents.test.ts`, layout test.
- [x] 7.2 Sentry environment from `DEPLOY_ENV`; the `/test-error` page is a 404 when `DEPLOY_ENV` is `cloudflare-production`. Verify: `sentryPrivacy` and test-error tests updated. Done: Sentry init tests; `app/test-error/page.test.tsx`.
- [ ] 7.3 Privacy notice, terms, `docs/dpia.md`, `docs/cookies-pecr.md`, README, `docs/sync.md`, `docs/persistence.md`, `docs/nextjs.md`, AGENTS.md lines that name Supabase or Vercel. Verify: `grep -ri "supabase\|vercel"` over app, components, lib and docs lists only history and the cutover notes; privacy page test updated.
- [x] 7.4 One `changed` changelog fragment. Verify: `npm run lint:changelog`. Done: `changelog.d/unreleased/2393-move-to-cloudflare.md`, `lint:changelog` passes.

## 8. CI, deploys and the data copy

- [ ] 8.1 `deploy.yml` (production on `main`, a preview version per PR with comment), `scripts/cloudflare/seed-preview.mjs`. Verify: actionlint clean; workflow-expert review; a manual preview upload succeeds.
- [ ] 8.2 `e2e.yml` on the preview URL, `migration-check.yml` and `integration-tests.yml` on D1; Vercel workflows, `vercel.json` and `scripts/vercel-ignored-build.*` removed. Verify: actionlint; CI green on the build PR.
- [x] 8.3 `scripts/cloudflare/copy-from-supabase.mjs` with row counts. Verify: a CI-safe rehearsal from the local Postgres container into a local D1; then the approved read-only rehearsal from production into the preview database, with the row-count comparison recorded on #2393 (counts only). Done: rehearsal into the preview D1, every row count matched (posted on #2393); unit tests on invented data.
- [x] 8.4 Test deploy to `poke-memory-preview.frasers-account.workers.dev` with secrets copied from Vercel (approved 19 November 2026; no Supabase keys, no VAPID private key or Discord webhook on the preview). Verify: the smoke script returns 200 for the main routes and a username sign-in works there. Done (secrets generated, not copied, per the 21:30 ruling): `poke-memory-preview.frasers-account.workers.dev` returned 200 for ten routes, username sign-up and sign-in worked.
- [x] 8.5 Remove `@supabase/*`, `lib/supabase/**` and the `supabase-keys` code. Verify: `grep -r "@supabase" app components lib` is empty; build and tests green. Done: no `@supabase` import in app, components or lib; build and tests green.

## 9. Checks

- [ ] 9.1 Full gate: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build`, `npm run cf:build`, the e2e smoke subset. Verify: exit codes and counts in the PR body.
- [ ] 9.2 `/opsx:verify move-to-cloudflare`, blast-radius, then the final review; confirmed findings fixed. Verify: findings and fixes listed in the PR body.

## 10. Owner steps (moved)

- [x] ~~10.1 Worker secrets that cannot be copied (a new `BETTER_AUTH_SECRET` for production at cutover), the OAuth callback URLs at GitHub and Google, the `CLOUDFLARE_API_TOKEN` repo secret, the R2 read token, the Web Analytics token, the cutover day and the 14-day deletions. Verify: listed on #2393.~~ Moved to #2393 (19 November 2026).
