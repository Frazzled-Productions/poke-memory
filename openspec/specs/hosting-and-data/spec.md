# hosting-and-data Specification

## Purpose
Where Poké Memory runs and where signed-in players' data lives: one Cloudflare Worker built with
OpenNext, one D1 database in the EU, the scope helper that pins every per-user query to the session
user (with its CI rule and cross-user tests), the data gateway the browser uses, the scheduled jobs,
outbound sends, nightly backups, per-PR previews and deploys, the events table, and the rehearsable copy
from Supabase. Company decision 0018 (19 November 2026) and the `move-to-cloudflare` change set it up.

## Requirements

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

### Requirement: One D1 database in the EU holds the cloud data

All cloud data SHALL live in one D1 database created with the EU jurisdiction and bound to the Worker.
Its schema SHALL be Postgres migrations 001 to 051 translated to SQLite (`0001_schema.sql`), Better
Auth's tables (`0002_auth.sql`), the events table (`0003_events.sql`) and the drop of the Discord-only
`feedback_discord_posts` table (`0004_drop_feedback_discord_posts.sql`), in `db/d1/migrations/`.

#### Scenario: Fresh database

- **WHEN** the D1 migrations are applied to an empty local D1
- **THEN** they apply cleanly, and the trigger tests ported from the Postgres suite pass against it

#### Scenario: Location

- **WHEN** the production or preview database is created
- **THEN** it is created with the `eu` jurisdiction

Source (planned): design D3, `db/d1/migrations/`.

### Requirement: Row guards stay in the database with the same codes

The card regression guards, the `updated_at` stamp, the reset tombstone checks, the streak
future-date check, the push subscription limits and the username CHECKs SHALL stay in D1 as SQLite
triggers or CHECK constraints. A guard or CHECK failure SHALL reach callers as code `23514`, and a
unique violation as `23505`, as Postgres raised them.

#### Scenario: A guard fires

- **WHEN** a write lowers `reps` on a stored card row
- **THEN** the trigger aborts it and the caller sees code `23514`

#### Scenario: Duplicate username

- **WHEN** a second account is given an existing username
- **THEN** the insert fails with `23505`

Source (planned): design D3, `db/d1/migrations/0001_schema.sql`, `lib/db/errors.ts`.

### Requirement: The scope helper pins every per-user query to the session user

Every query on a per-user table SHALL go through `forUser(db, userId)` in `lib/db/scope.ts`, with
`userId` taken from the session only. Every read SHALL bind `user_id` to that user, every written row
SHALL have its `user_id` set to that user, and a row naming any other user SHALL be refused with 403
and code `42501` before any SQL runs.

#### Scenario: Two users

- **WHEN** user B reads `card_reviews`
- **THEN** only B's rows come back, whatever filters B sends

#### Scenario: A row naming another user

- **WHEN** user B upserts a row whose `user_id` is user A's
- **THEN** the answer is 403 with code `42501` and A's rows are unchanged

#### Scenario: A row with no user id

- **WHEN** a signed-in user inserts a `streak_days` row without `user_id`
- **THEN** the row is stored under the session user

Source (planned): design D4, `lib/db/scope.ts`.

### Requirement: Table and column names are allowlisted and types converted

The scope helper SHALL check every table and column name against `lib/db/tables.ts` and refuse an
unknown one with a class 42 code (`42703` for a column) before any SQL runs. The same list SHALL convert
types (0/1 to booleans, JSON text to objects), so callers see the shapes supabase-js returned.

#### Scenario: Unknown column

- **WHEN** a query names a column not on the allowlist
- **THEN** it is refused with code `42703` and no SQL runs

#### Scenario: Booleans and JSON

- **WHEN** a `card_reviews` row with `seen_in_pasture` stored as 1 is read
- **THEN** the caller receives `true`, and `user_settings.settings` arrives as an object

Source (planned): design D4, `lib/db/tables.ts`.

### Requirement: Cross-user work uses one system module

Work that reads or writes across users (cron routes, push sends, feedback, backups) SHALL use
`lib/db/system.ts`, whose functions are each named for their one job. ESLint SHALL refuse an import of
it outside `app/api/cron/**`, `app/api/push/send-*`, `app/api/feedback/**` and `app/api/stats/users`.

#### Scenario: System module imported from a page

- **WHEN** a file under `components/` imports `lib/db/system.ts`
- **THEN** lint fails

#### Scenario: Push send reads targets

- **WHEN** `send-daily` runs
- **THEN** it reads every subscriber through a named function in `lib/db/system.ts`

Source (planned): design D4, `lib/db/system.ts`, `eslint.config.mjs`.

### Requirement: CI fails a raw per-user query outside lib/db

`scripts/check-scoped-queries.mjs`, run by `npm run lint`, SHALL fail when a file outside `lib/db/`
calls `.prepare(`, `.exec(` or `.batch(` on a D1 binding, or holds SQL naming a per-user table
(`card_reviews`, `user_settings`, `streak_days`, `grade_log`, `push_subscriptions`, `feedback`,
`rate_limit_buckets`, `user`, `session`, `account`). Better Auth's own queries
run inside the library and are outside the rule.

#### Scenario: Planted raw query

- **WHEN** a component calls `env.DB.prepare("SELECT * FROM card_reviews")`
- **THEN** `npm run lint` fails and names the file

#### Scenario: The tree as built

- **WHEN** the rule runs on the change as merged
- **THEN** it passes

Source (planned): design D4, `scripts/check-scoped-queries.mjs`.

### Requirement: Two-user tests cover every route and table

Every route and every gateway table and RPC SHALL have a test with two users proving that user B can
neither read nor change user A's rows.

#### Scenario: The pin is removed

- **WHEN** the `user_id` binding in `scope.ts` is deleted
- **THEN** `lib/db/crossUser.test.ts` fails

#### Scenario: Reset by another user

- **WHEN** user B calls `reset_all_progress`
- **THEN** user A's cards, grade log and streak days are unchanged

Source (planned): design D4, `lib/db/crossUser.test.ts`.

### Requirement: The browser reaches the database only through the data gateway

`lib/db/client.ts` SHALL give the browser the supabase-js query subset the app uses, serialise each
query to a fixed JSON shape and post it to `POST /api/db`, which SHALL run it through the scope helper
and answer `{ data, error, count }` as supabase-js did. An upsert SHALL run as one atomic D1 `batch()`.
A network failure SHALL resolve to `{ data: null, error }` in the client, never a throw.

#### Scenario: Offline

- **WHEN** the device has no connection and the sync code runs a query
- **THEN** the client returns `{ data: null, error }`, so the caller takes its existing failure path

#### Scenario: Upsert with one bad row

- **WHEN** an upsert batch holds a row that a guard refuses
- **THEN** no row of the batch is written and the error carries `23514`, as one Postgres statement behaved

#### Scenario: Count only

- **WHEN** the client asks for `count: "exact", head: true` on `card_reviews`
- **THEN** the answer has the user's row count and no rows

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on
- **THEN** the browser's write guard sends no write to the gateway, and reads still go through it

Source (planned): design D5, `lib/db/client.ts`, `app/api/db/route.ts`.

### Requirement: The gateway allows only what row-level security allowed

The gateway SHALL accept only the tables `card_reviews`, `user_settings`, `streak_days`, `grade_log`
and `push_subscriptions`; per table only the operations its row-level security policies allowed; the
allowlisted columns, the filter operators `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `is` and
`not-is`, with `order`, `range` and `limit`; and the RPCs `reset_all_progress`, `delete_account` and
`merge_user_settings`. Upserts on `grade_log` and `streak_days` SHALL never update a stored row.

#### Scenario: Table not on the gateway

- **WHEN** a signed-in browser queries `feedback` or `rate_limit_buckets`
- **THEN** the answer is 400 and nothing is read

#### Scenario: Update on push subscriptions

- **WHEN** a signed-in browser sends an `update` on `push_subscriptions`
- **THEN** the answer is 403 with `42501`, as no update policy existed under row-level security

#### Scenario: A repeated grade

- **WHEN** a browser upserts a `grade_log` entry that is already stored, with a different grade and
  without `ignoreDuplicates`
- **THEN** the stored grade is unchanged: the upsert runs as `ON CONFLICT DO NOTHING` whatever the
  request asks, as `grade_log` had no update policy

#### Scenario: Unknown RPC

- **WHEN** the browser calls an RPC not on the list
- **THEN** the answer is 400 with a class 42 code

Source (planned): design D5, `lib/db/tables.ts`, `app/api/db/route.ts`.

### Requirement: Gateway refusals keep the codes the sync code expects

A request with no session SHALL answer 401 with an error code outside classes 22, 23 and 42. An
unknown table, column, operator or RPC SHALL answer 400 with a class 42 code. A row naming another
user, or an operation the table does not allow, SHALL answer 403 with `42501`. Guard and unique failures SHALL pass through as `23514` and `23505`.

#### Scenario: Guest request

- **WHEN** `POST /api/db` arrives with no session
- **THEN** the answer is 401, no SQL runs, and the client reports a plain failure, not a rejection or a structural error

#### Scenario: Session expires during review

- **WHEN** a grade push reaches the gateway after the session expired
- **THEN** the push fails without recording a structural error, and retries after the next sign-in

Source (planned): design D4 and D5, `lib/db/errors.ts`.

### Requirement: Scheduled work runs from two Worker Cron Triggers

The production Worker SHALL have two Cron Triggers, `0 * * * *` and `*/30 * * * *`, and no other
scheduler. `cronRoutesFor(cron, now)` in `lib/cron/schedule.ts` SHALL map each firing to the app's
routes at UTC times. The `scheduled` handler SHALL call each route through the Worker's own fetch
handler with the bearer secret, await it with `ctx.waitUntil` and log its status; a failing route SHALL
NOT stop the others.

#### Scenario: Every hour

- **WHEN** the hourly trigger fires at 15:00 UTC on a Wednesday
- **THEN** only `POST /api/push/send-daily` and `POST /api/push/send-streak-nudge` run

#### Scenario: Monday 09:00

- **WHEN** the hourly trigger fires at 09:00 UTC on a Monday
- **THEN** the two push routes and `POST /api/cron/feedback-digest` run

#### Scenario: Daily jobs

- **WHEN** the hourly trigger fires at 02:00 and at 03:00 UTC
- **THEN** `POST /api/cron/backup` runs at 02:00 and `POST /api/cron/feedback-retention` at 03:00, each with the two push routes

#### Scenario: Sunday 04:00

- **WHEN** the hourly trigger fires at 04:00 UTC on a Sunday
- **THEN** `POST /api/cron/reconcile-grade-log` runs with the two push routes

#### Scenario: 08:00 every day

- **WHEN** the hourly trigger fires at 08:00 UTC on any day
- **THEN** `POST /api/cron/grade-log-divergence` runs with the two push routes

#### Scenario: Every 30 minutes

- **WHEN** the `*/30` trigger fires at 14:30 or 15:00 UTC
- **THEN** `POST /api/cron/rate-limit-cleanup` runs, and nothing else from that trigger

#### Scenario: One route fails

- **WHEN** the retention route answers 500 at 03:00
- **THEN** the push routes in the same firing still run and both statuses are logged

#### Scenario: Called from outside without the secret

- **WHEN** anyone posts to `/api/cron/backup` without the bearer secret
- **THEN** the route answers 401 and does nothing

Source (planned): design D2, `worker/index.ts`, `lib/cron/schedule.ts`, `wrangler.jsonc`.

### Requirement: Outbound sends happen only in production

Web Push sends and the feedback emails SHALL happen only when `DEPLOY_ENV` is `cloudflare-production`
(`lib/outbound.ts`). Anywhere else the routes SHALL do their reads and log what they would have sent.
The preview Worker SHALL have no Cron Triggers, no VAPID private key and no Resend key.

#### Scenario: Preview loaded with rehearsal data

- **WHEN** someone calls `send-daily` on the preview Worker with the bearer secret while it holds copied real data
- **THEN** the route reads its targets, logs the count it would have sent and messages nobody

#### Scenario: Bug report on a preview

- **WHEN** a bug report is sent on a preview version
- **THEN** the row is stored and no email is sent

#### Scenario: Production

- **WHEN** `DEPLOY_ENV` is `cloudflare-production` and a subscriber is due
- **THEN** the push is sent

Source (planned): design D2, proposal Clarifications (19 November 2026, about 20:30), `lib/outbound.ts`.

### Requirement: Nightly backups go to R2 and are kept 90 days

`POST /api/cron/backup`, at 02:00 UTC, SHALL write every table as gzipped SQL `INSERT` statements, one a
line, to the R2 bucket `poke-memory-backups` (EU jurisdiction) at `d1/poke-memory/YYYY-MM-DD.sql.gz`,
then a manifest with the export time, the dump's key, size, SHA-256 and per-table row counts at
`d1/poke-memory/YYYY-MM-DD.json` and, last, `d1/poke-memory/latest.json`, then delete dumps and manifests
dated more than 90 days ago. Only the production Worker SHALL have the bucket binding.

#### Scenario: Nightly run

- **WHEN** the 02:00 firing runs on 20 November 2026
- **THEN** `d1/poke-memory/2026-11-20.sql.gz`, `d1/poke-memory/2026-11-20.json` and an updated
  `d1/poke-memory/latest.json` exist in the bucket

#### Scenario: Old object

- **WHEN** the run finds a dump dated 91 days ago
- **THEN** it and its manifest are deleted, and one dated 90 days ago stays, as does `latest.json`

#### Scenario: The export fails

- **WHEN** the write to R2 fails, or the bucket binding or prefix is missing
- **THEN** the route logs `d1-backup: export FAILED: <reason>`, emails that line (see "Backup and monitor failures email an alert") and answers 502, or 503 for the missing binding

#### Scenario: Round trip

- **WHEN** a dump is gunzipped and restored into a fresh migrated test database
- **THEN** every table has the same rows as the source

#### Scenario: Rows today's triggers would refuse

- **WHEN** the database holds rows the copy kept with triggers bypassed, such as 11 push subscriptions
  for one user or a streak date in 2099
- **THEN** the file drops the triggers before its rows and recreates them verbatim after, so the
  restore keeps every such row, with identical counts and values

#### Scenario: A value with a line break

- **WHEN** a feedback message holds a line break
- **THEN** its `INSERT` stays on one line and the restored message is unchanged

#### Scenario: Preview Worker

- **WHEN** a pull request's preview version runs
- **THEN** it has no backups bucket binding, no backup prefix and no Cron Triggers

Source (planned): design D10, `app/api/cron/backup/route.ts`, `lib/db/backup.ts`.

### Requirement: The restore check runs monthly inside Cloudflare

The production Worker SHALL run a restore check on the Cron Trigger `0 4 1 * *` (04:00 UTC on the 1st)
through its own bucket binding. It SHALL fail unless the newest dump matches its SHA-256, decompresses,
holds each table's row count (an empty table counts as 0) and is at most 3 days old. It SHALL log one
`d1-backup: restore-check ok` or `d1-backup: restore-check FAILED` line, with keys and counts only, and
rethrow on failure.

#### Scenario: Healthy backup

- **WHEN** the check runs on 1 December 2026 after the export at 02:00 that day
- **THEN** it logs `d1-backup: restore-check ok` with the dump's key and the per-table counts

#### Scenario: Empty table

- **WHEN** a table has no rows, so the dump has no `INSERT` line for it
- **THEN** the check counts it as 0 and passes

#### Scenario: Export stopped

- **WHEN** the newest export is more than 3 days old
- **THEN** the check logs `d1-backup: restore-check FAILED:` naming the stale export and the invocation fails

#### Scenario: Corrupt dump

- **WHEN** the dump's SHA-256 differs from the manifest, it does not decompress, or a table's rows differ
  from the manifest's count
- **THEN** the check logs `d1-backup: restore-check FAILED:` with every problem found, emails that line,
  and the invocation fails

Source (planned): design D10, owner ruling 20 November 2026, `lib/db/backup.ts`, `worker/index.ts`.

### Requirement: No GitHub workflow touches the backups

No GitHub workflow SHALL read, write or list the backups or dump the database to a runner.

#### Scenario: A workflow reaches for the backups

- **WHEN** a pull request adds a workflow step that names `poke-memory-backups`, calls the R2 API or
  `wrangler r2`, runs `wrangler d1 export`, or fetches a backup key
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

Source (planned): design D10, owner ruling 20 November 2026, `scripts/workflows-no-backups.test.mjs`.

### Requirement: Backup and monitor failures email an alert

A failed backup export, restore check or divergence check, and a detected divergence, SHALL each send
one email through the Resend REST API with the Worker secret `RESEND_API_KEY`, from `RESEND_FROM`
(`Poké Memory <hello@frazzledproductions.com>`, production only) to `hello@frazzledproductions.com`,
holding counts, keys and 8-character user id prefixes only. Sending SHALL never throw, and the task
SHALL still log its FAILED line and rethrow or answer its error status.

#### Scenario: The restore check fails with the key set

- **WHEN** the monthly restore check finds no `latest.json` and `RESEND_API_KEY` is set
- **THEN** one email goes to Resend with the subject `Poké Memory: D1 restore-check FAILED` and the FAILED line as its text, and the invocation still fails

#### Scenario: No key yet

- **WHEN** a task fails before the cutover has set `RESEND_API_KEY`
- **THEN** the Worker logs `d1-backup: alert not sent: no RESEND_API_KEY` (or the monitor's tag), sends nothing, and the task still fails

#### Scenario: Resend refuses or is unreachable

- **WHEN** Resend answers an error status, or the request throws
- **THEN** the Worker logs `alert not sent: <reason>` and the task's own failure is unchanged

#### Scenario: A healthy night

- **WHEN** the export and the restore check pass
- **THEN** no email is sent

Source (planned): design D10 and D13, owner ruling 20 November 2026, `lib/alertEmail.ts`, `lib/db/backup.ts`, `app/api/cron/backup/route.ts`.

### Requirement: The grade_log divergence check runs in the Worker

`POST /api/cron/grade-log-divergence`, at 08:00 UTC daily, SHALL run the three divergence queries
(Options A, B and C, `lib/db/system/gradeLogDivergence.ts`) through the D1 binding and alert on any
user above the threshold of 0, answering counts only and logging one line.

#### Scenario: Nothing diverges

- **WHEN** every graded subject has its `card_reviews` row, or is still in its learning steps
- **THEN** the route answers `{ ok: true, diverged: false, users: 0 }`, logs `grade-log-divergence: ok` and sends nothing

#### Scenario: A graduated orphan

- **WHEN** a user graduated a card today and has no `card_reviews` row for it
- **THEN** the route answers `{ ok: true, diverged: true, users: 1 }`, logs `grade-log-divergence: DIVERGED`, and emails a report naming Option C with the user's 8-character id prefix, never the full id

#### Scenario: A query fails

- **WHEN** a divergence query throws
- **THEN** the route logs `grade-log-divergence: FAILED: <reason>`, emails that line and answers 502

Source (planned): design D13, `app/api/cron/grade-log-divergence/route.ts`, `lib/db/system/gradeLogDivergence.ts`.

### Requirement: The user-count badge is served by the Worker

`GET /api/stats/users` SHALL answer the number of accounts as Shields.io endpoint JSON
(`schemaVersion` 1, `label` "users", `message` the count, `color` "blue", `cacheSeconds` 3600) with
`Cache-Control: public, max-age=3600`, and nothing else about any account. The README user-count badge
SHALL read it. When the count fails it SHALL answer 503 with `Cache-Control: no-store`.

#### Scenario: Two accounts

- **WHEN** the database holds two accounts
- **THEN** the route answers `message: "2"` and the badge shows "users 2"

#### Scenario: The database is unavailable

- **WHEN** the count throws
- **THEN** the route answers 503, uncached, and logs `[stats/users] count failed`

Source (planned): design D13, `app/api/stats/users/route.ts`, `lib/db/system/stats.ts`, `README.md`.

### Requirement: No GitHub workflow reads production data

No GitHub workflow SHALL query the production D1 database, and only `deploy.yml` SHALL hold
`CLOUDFLARE_API_TOKEN`, which can write D1.

#### Scenario: A workflow queries production

- **WHEN** a pull request adds a workflow step that runs `wrangler d1 execute --remote` without `--env preview`, calls the D1 REST query API, or runs the removed monitor scripts or their query helper
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

#### Scenario: Another workflow takes the token

- **WHEN** a workflow other than `deploy.yml` names `CLOUDFLARE_API_TOKEN`
- **THEN** `scripts/workflows-no-backups.test.mjs` fails

Source (planned): design D13, owner ruling 20 November 2026, `scripts/workflows-no-backups.test.mjs`.

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

### Requirement: Preview databases hold seeded test data

`scripts/cloudflare/seed-preview.mjs` SHALL seed the preview database with two test users, cards and a
grade log, and no personal data. Real data SHALL reach a preview database only through the
owner-approved copy rehearsal, and stays until the owner decides to wipe and reseed it.

#### Scenario: Preview data

- **WHEN** someone signs in on a seeded preview with a test user
- **THEN** they see seeded data only

#### Scenario: After a rehearsal

- **WHEN** the copy rehearsal has loaded real data into the preview database
- **THEN** the preview still sends no push or email

Source (planned): design D11, proposal Open call 4, `scripts/cloudflare/seed-preview.mjs`.

### Requirement: App opens are counted per day with no personal data

The `app_open` event, with its `userType` and `progressBucket` properties, SHALL be posted to
`POST /api/event` and counted per UTC day in a D1 table holding only the day, the event name, the two
buckets and a count: no IP address, user agent, user id or page address. The route SHALL refuse a bad
body with 400 and rate-limit per event name. `@vercel/analytics` and `@vercel/speed-insights` SHALL be
gone.

#### Scenario: A guest opens the app

- **WHEN** a new guest opens the app
- **THEN** the count for today, `app_open`, `new` and their bucket goes up by one, and no other field is stored

#### Scenario: A player signed in before the move

- **WHEN** a player who has not yet signed in again opens the app with local progress
- **THEN** the event counts them as `returning_guest`, because they have no session yet

#### Scenario: Offline

- **WHEN** the app opens with no connection
- **THEN** the event is lost and nothing else is affected

#### Scenario: Unknown event name

- **WHEN** the body names an event other than `app_open`
- **THEN** the route answers 400 and stores nothing

Source (planned): design D9, `db/d1/migrations/0003_events.sql`, `app/api/event/route.ts`,
`components/analytics/FunnelTracker.tsx`.

### Requirement: Page views come from Cloudflare Web Analytics when configured

The layout SHALL load the Cloudflare Web Analytics beacon only when `NEXT_PUBLIC_CF_BEACON_TOKEN` is set
at build time.

#### Scenario: Preview build

- **WHEN** a preview is built without the beacon token
- **THEN** no Cloudflare Web Analytics script is on the page

#### Scenario: Production build with the token

- **WHEN** production is built with the token set
- **THEN** the beacon script is on every page

Source (planned): design D9, `app/layout.tsx`.

### Requirement: A rehearsable copy moves Supabase data into D1 and checks row counts

`scripts/cloudflare/copy-from-supabase.mjs` SHALL read a Postgres connection read-only and write one
SQL file for `wrangler d1 execute --file`, then print row counts per table for both sides. It SHALL be
rehearsed in CI from the local Postgres container, loaded with the migrations and fixtures, into a
local D1. The live copy and the DNS switch are owner steps (#2393).

#### Scenario: Counts match

- **WHEN** the rehearsal imports the file into a fresh D1
- **THEN** every table, `push_subscriptions` included, has the same count on both sides, and each copied row keeps its stored timestamps

#### Scenario: A count differs

- **WHEN** a table's count differs after import
- **THEN** the script names the table and both counts and exits non-zero

#### Scenario: Rehearsal against production

- **WHEN** the owner-approved rehearsal reads production into the preview database
- **THEN** nothing is written to Supabase, only counts are recorded on #2393, and the dump files are deleted afterwards

Source (planned): design D12, proposal Clarifications (19 November 2026, about 20:30).

### Requirement: The copy maps accounts and passwords and copies no sessions

The copy SHALL write app tables row for row; `auth.users` to `user` with the same id and email and the
username from `usernames`; GitHub and Google identities to `account`, keyed by the provider's user id;
bcrypt password hashes to `credential` accounts; and no sessions.

#### Scenario: Username account

- **WHEN** a username account is copied
- **THEN** it keeps its user id and username, and its bcrypt hash is stored for the `credential` provider

#### Scenario: Account with GitHub and Google

- **WHEN** a user has both identities
- **THEN** both `account` rows point at the same user id

#### Scenario: Sessions

- **WHEN** the copy runs
- **THEN** no session row is written, so every player signs in once more

Source (planned): design D12.
