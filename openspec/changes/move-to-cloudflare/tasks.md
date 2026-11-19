## 1. Platform

- [ ] 1.1 OpenNext build with `cacheComponents: false`, `open-next.config.ts` (static-assets cache), `app/test-error` force-dynamic, the changelog generated at build time. Verify: `npm run build` and `npm run cf:build` exit 0; `lib/changelog` tests green.
- [ ] 1.2 `wrangler.jsonc`: Worker `poke-memory` and `env.preview` (`poke-memory-preview`), D1 and R2 bindings in the EU, two Cron Triggers on production only, `DEPLOY_ENV` and `BETTER_AUTH_URL` vars. Verify: `wrangler deploy --dry-run` for both envs exits 0.
- [ ] 1.3 `worker/index.ts` with `scheduled` and `cronRoutesFor` (design D2 table). Verify: `lib/cron/schedule.test.ts` covers every row and a non-matching hour, written failing first.
- [ ] 1.4 `lib/outbound.ts`: sends only when `DEPLOY_ENV` is `cloudflare-production`. Verify: unit test; push and Discord route tests assert no send in preview.
- [ ] 1.5 Local development notes (Node 24, `wrangler dev`, the sprites and audio EBADF workaround) in `docs/local-dev.md`. Verify: a `wrangler dev` smoke returns 200 for `/`, `/pokedex`, `/settings`.

## 2. Database and authorisation

- [ ] 2.1 `db/d1/migrations/0001_schema.sql` (Postgres 001 to 051 in SQLite) and `0002_auth.sql` (Better Auth). Verify: migrations apply to a fresh local D1; trigger tests ported from `db/tests/` and the Postgres integration suite pass on the D1 test database.
- [ ] 2.2 `lib/db/scope.ts` (`forUser`), `lib/db/tables.ts`, `lib/db/errors.ts`, `lib/db/env.ts`, and the node:sqlite D1 test shim. Verify: scope tests (user pinned on reads and writes, other user refused, unknown column refused, type conversion), written failing first.
- [ ] 2.3 `scripts/check-scoped-queries.mjs` in `npm run lint`. Verify: its test fails on a planted raw query outside `lib/db/` and passes on the tree.
- [ ] 2.4 `lib/db/system.ts` for cross-user jobs, importable only from the cron, push-send, Discord and feedback routes. Verify: an ESLint fixture importing it elsewhere fails lint.

## 3. Data gateway and browser client

- [ ] 3.1 `POST /api/db` with the validated wire format (design D5): tables, columns, operators and RPC names allowlisted; session required; `user_id` pinned. Verify: route tests for each operation, 401 without a session, 400 on unknown names, 403 on another user's id.
- [ ] 3.2 `lib/db/client.ts`, the browser client with the supabase-js subset the app uses, returning `{ data, error, count }` with Postgres-style codes. Verify: contract tests run the same query through the client and the gateway against the D1 test database.
- [ ] 3.3 RPCs in the Worker: `merge_user_settings` (deep merge keeping nulls, compare-and-swap, the migration 038 regression guard with `23514`), `reset_all_progress` (cooldown, tombstone), `delete_account` (data, Discord posts, Better Auth user). Verify: tests ported from the Postgres RPC integration tests, red first where behaviour is new.
- [ ] 3.4 Every browser call site moves from `lib/supabase/client.ts` to the new client (`lib/sync/**`, `lib/push/subscribe.ts`, components and pages). Verify: the existing sync tests pass unchanged apart from imports; a parity test runs `pullSession`, `pushSession`, `pushSingleCard` (including a `23514` rejection), settings, streak and grade-log legs against the D1 test database.
- [ ] 3.5 Cross-user tests: user B can neither read nor change user A's rows through any table or RPC. Verify: `lib/db/crossUser.test.ts` green, and red when the pin in `scope.ts` is removed.

## 4. Sign-in

- [ ] 4.1 Better Auth server (`lib/auth/server.ts`, `app/api/auth/[...all]/route.ts`): username plugin with the existing rule, GitHub, Google, linking, UUID ids, D1. Verify: route tests for username sign-up, sign-in, bad credentials (one answer), sign-out.
- [ ] 4.2 bcrypt compatibility: copied `$2a$`/`$2b$` hashes verify with bcryptjs and are rehashed to scrypt on success. Verify: test with a known bcrypt hash; the stored hash changes prefix after sign-in.
- [ ] 4.3 Per-IP throttle on username sign-up and sign-in from `rate_limit_buckets` in D1. Verify: test, the 6th attempt in the window is refused as today.
- [ ] 4.4 Browser side: `lib/auth/client.ts`, `AuthContext` on `useSession`, `actions.ts`, `LinkIdentitiesSection`, `callback-complete` as the OAuth callback target, `requireAuth` from request headers, the mock-auth seam ported. Verify: existing component tests updated; e2e `auth.spec.ts` green on a local build with mock auth.
- [ ] 4.5 Account deletion removes the Better Auth user, sessions and accounts with the data. Verify: delete-account test checks every table is empty for that user.

## 5. Server routes and scheduled jobs

- [ ] 5.1 `/api/sync`, `/api/export`, `/api/push/resubscribe` on the session and the scope helper. Verify: their route tests, plus two-user tests.
- [ ] 5.2 `/api/push/send-daily` and `/api/push/send-streak-nudge` with the target queries in `lib/db/system.ts` (ports of `get_push_targets`, `get_push_due_cards`, `get_push_streak_days`, `get_push_streak_nudge_targets`), VAPID from Worker secrets, the delivery helper unchanged. Verify: route tests, and system-query tests against the D1 test database matching the Postgres RPC tests.
- [ ] 5.3 `/api/feedback` stores feedback and sends the Discord bug notification itself (`ctx.waitUntil`); `/api/discord/notify` and `/api/discord/digest` read D1. Verify: route tests, including the stored message id and its deletion.
- [ ] 5.4 `/api/cron/feedback-retention`, `/api/cron/reconcile-grade-log`, `/api/cron/rate-limit-cleanup`, each with the bearer check. Verify: route tests ported from the `pg_cron` SQL behaviour.
- [ ] 5.5 `/api/cron/backup`: every table to R2 as SQL, objects over 90 days deleted. Verify: test with a fake bucket; a restore of the file into a fresh test database gives the same row counts; a real run against `poke-memory-backups-preview`.

## 6. Optimiser

- [ ] 6.1 Check #2392: does the current item building give `NotEnoughData`? Verify: a test on a realistic synthetic log with the native binding; the finding commented on #2392.
- [ ] 6.2 `/settings/optimiser` with COOP and COEP on that path only, the wasm optimiser in a Web Worker, the weekly limit and minimum reviews, the superuser write guard, every state translated. Verify: e2e in Chromium on a production build (`crossOriginIsolated` true there and not on `/settings`), unit tests for the states, locale tests in en, ja, zh-Hans, zh-Hant.
- [ ] 6.3 Remove `/api/srs/optimize` and the native binding. Verify: build exits 0 with no `.node` file in `.open-next`.

## 7. Analytics, Sentry and copy

- [ ] 7.1 `0003_events.sql`, `POST /api/event`, `FunnelTracker` sending `app_open` there; Vercel Analytics and Speed Insights removed; the Cloudflare Web Analytics beacon when its token is set. Verify: events route tests (no personal fields stored, rate limit, bad body), layout test.
- [ ] 7.2 Sentry environment from `DEPLOY_ENV`. Verify: `sentryPrivacy` tests updated.
- [ ] 7.3 Privacy notice, terms, `docs/dpia.md`, `docs/cookies-pecr.md`, README, `docs/sync.md`, `docs/persistence.md`, `docs/nextjs.md`, AGENTS.md lines that name Supabase or Vercel. Verify: `grep -ri "supabase\|vercel"` over app, components, lib and docs lists only history and the cutover notes; privacy page test updated.
- [ ] 7.4 One `changed` changelog fragment. Verify: `npm run lint:changelog`.

## 8. CI, deploys and the data copy

- [ ] 8.1 `deploy.yml` (production on `main`, a preview version per PR with comment), `scripts/cloudflare/seed-preview.mjs`. Verify: actionlint clean; workflow-expert review; a manual preview upload succeeds.
- [ ] 8.2 `e2e.yml` on the preview URL, `migration-check.yml` and `integration-tests.yml` on D1; Vercel workflows, `vercel.json` and `scripts/vercel-ignored-build.*` removed. Verify: actionlint; CI green on the build PR.
- [ ] 8.3 `scripts/cloudflare/copy-from-supabase.mjs` with row counts. Verify: a CI-safe rehearsal from the local Postgres container into a local D1; then the approved read-only rehearsal from production into the preview database, with the row-count comparison recorded on #2393 (counts only).
- [ ] 8.4 Test deploy to `poke-memory-preview.frasers-account.workers.dev` with secrets copied from Vercel (approved 19 November 2026; no Supabase keys, no VAPID private key or Discord webhook on the preview). Verify: the smoke script returns 200 for the main routes and a username sign-in works there.
- [ ] 8.5 Remove `@supabase/*`, `lib/supabase/**` and the `supabase-keys` code. Verify: `grep -r "@supabase" app components lib` is empty; build and tests green.

## 9. Checks

- [ ] 9.1 Full gate: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build`, `npm run cf:build`, the e2e smoke subset. Verify: exit codes and counts in the PR body.
- [ ] 9.2 `/opsx:verify move-to-cloudflare`, blast-radius, then the final review; confirmed findings fixed. Verify: findings and fixes listed in the PR body.

## 10. Owner steps (moved)

- [ ] 10.1 Worker secrets that cannot be copied (a new `BETTER_AUTH_SECRET` for production at cutover), the OAuth callback URLs at GitHub and Google, the `CLOUDFLARE_API_TOKEN` repo secret, the R2 read token, the Web Analytics token, the cutover day and the 14-day deletions. Verify: listed on #2393.
