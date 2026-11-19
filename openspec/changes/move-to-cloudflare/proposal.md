## Why

Hosting costs about $104 a month, and Poké Memory is the largest part of it: Supabase Pro and Vercel Pro.
On 19 November 2026 Fraser decided to move every company app to Cloudflare Workers with D1, staged, for
about $5 a month (ops decision 0018, programme ops #610). This is stage 4, Poké Memory. A local trial the
same day ran the whole app on Workers with Cache Components off, Better Auth and the schema on D1, and the
optimiser as wasm in the browser (ops `research/hosting-cost-cut-2026-11-19.md`).

Fixes: none (programme step; refs ops #610, #2392 checked along the way)

## What Changes

- **Hosting:** the app builds with OpenNext into one Cloudflare Worker (`poke-memory`), Cache Components
  off. Pages that were partially prerendered render per request. Reachable only at
  `poke-memory.frasers-account.workers.dev` until the cutover.
- **Database:** one D1 database, EU jurisdiction, with the schema translated from the 51 Postgres
  migrations. The card regression guards, tombstones and push limits stay as SQLite triggers; the
  settings deep merge, its regression guard, reset, account deletion and the push target queries move
  into the Worker.
- **Authorisation:** row-level security is replaced by one scope helper that pins every per-user query
  to the session user, a CI rule that fails any raw query on a per-user table outside it, and two-user
  tests for every route and table.
- **Browser data access:** a small client with the same query shape the sync code uses today sends each
  query to `POST /api/db`, which runs it through the scope helper. The sync logic itself is unchanged.
- **Sign-in:** Better Auth on D1 replaces Supabase Auth: username and password, GitHub, Google, linking
  between them. Existing accounts, usernames and passwords are copied; bcrypt hashes keep working and
  are upgraded on the next sign-in. Sessions are not copied: **every signed-in player signs in once more,
  with no notice**, and keeps their data.
- **Scheduled work:** two Worker Cron Triggers replace the six `pg_cron` jobs and the `pg_net` calls
  (daily reminders, streak nudges, the weekly Discord digest, feedback retention, the grade-log orphan
  check, rate-limit clean-up). The Discord bug notification is sent by the feedback route instead of a
  database trigger. A seventh job writes a nightly backup to R2, kept 90 days.
- **Optimiser:** runs in the browser on its own cross-origin-isolated page (`/settings/optimiser`)
  instead of a Node function; the same weekly limit and minimum review count.
- **Analytics:** Vercel Analytics and Speed Insights are removed; the one custom event (`app_open`) is
  counted per day in our own D1 table, and page views come from Cloudflare Web Analytics.
- **Deploys and previews:** a deploy workflow on `main`, and a preview version per pull request on a
  separate Worker with its own seeded database. The Vercel workflows go.
- **Data copy:** a rehearsable script copies Supabase into D1 and checks row counts. The live copy and
  DNS switch are owner steps (#2393), not part of this change.

## Capabilities

### New Capabilities
- `hosting-and-data`: where the app runs, the D1 database and its location, the scope helper and its CI
  rule, the data gateway, scheduled jobs, backups, previews and deploys, the events table, the data copy.

### Modified Capabilities
- `accounts-and-auth`: Better Auth replaces Supabase Auth (callback, session reading, sign-up, sign-in,
  linking, deletion, one more sign-in after the move).
- `cloud-sync`: rows go through the data gateway; database guards are D1 triggers or Worker code with the
  same codes; the settings merge and its guard in the Worker.
- `push-notifications`: the cron jobs are Worker Cron Triggers; target queries in the Worker.
- `feedback-and-operator-tools`: the bug notification is sent from the Worker; the digest and retention
  run from the Worker's schedule.
- `srs-scheduling`: the optimiser runs in the browser on its own page.
- `pwa-and-whats-new`: the changelog is read from a generated module.
- `local-data-and-backup`: a privacy-notice requirement: Cloudflare instead of Supabase and Vercel,
  data at rest in the EU, deleted data can remain in backups for up to 90 days.
- `supabase-keys`: removed (no Supabase keys remain).
- `new-card-order`, `journey-badges-and-sharing`, `settings-onboarding-and-i18n`, `stats-and-streaks`:
  requirements that named Supabase, RLS or the old clients now name the gateway and D1; behaviour unchanged.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey:** no visible change. They render
  per request instead of from a prerendered shell. Journey, Stats and Pasture read the cloud through
  the same sync helpers, now over the gateway (`app/journey/page.tsx`, `app/stats/page.tsx`,
  `app/pasture/page.tsx` create the browser client).
- **Settings:** the optimiser section links to its new page; account linking, force pull, reset and
  delete account call the new client and Better Auth (`components/auth/LinkIdentitiesSection.tsx`,
  `components/settings/ForcePullSection.tsx`). Sign-in sheet copy is unchanged.
- **What's new:** reads the changelog from a generated module instead of the filesystem; same content.
- **Guest mode (localStorage):** no change; guests never call the database.
- **Cloud sync and Supabase migrations (both projects):** no new Supabase migration and no change at
  Supabase. The Postgres migrations stay in `db/migrations/` as history until 14 days after cutover. All
  sync legs (cards, settings, streak, grade log, regional prefs, push count, reset, delete) go through
  `POST /api/db`; the unload beacon and Background Sync replay keep `POST /api/sync`. Pull-before-push,
  the regression codes (`23514`) and structural-error handling are unchanged (proved by running the
  existing sync tests against the new client and the D1 test database).
- **Superuser mode and QA-seed scenarios:** no change; the write guard is in the browser and still
  suppresses every cloud write, including the optimiser's.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** new strings only on the optimiser page (states:
  running, done, not enough reviews, weekly limit, unsupported browser, error), translated in all four
  locales and the pseudo-locale. The privacy notice is English only, as today.
- **Push notifications and the service worker (offline):** reminders and nudges send from the same
  routes, triggered by the Worker's schedule at the same UTC hours. The VAPID key pair is new and lives in
  Worker secrets (owner ruling, 19 November 2026: the old private key could not be read back); each
  signed-in browser with permission granted moves its subscription to the new key on its next load. The service worker's `/api/sync` replay and
  `/api/push/resubscribe` keep their URLs and use the Better Auth cookie (same origin, credentials
  included). `/api/db` and `/api/auth/*` are under `/api/`, which the service worker never caches
  (`lib/pwa/cacheStrategy.ts:128`).
- **Sign-in:** see accounts-and-auth. GitHub and Google need the new callback URLs registered (#2393).
- **Privacy notice and sub-processors:** Cloudflare (hosting, database in the EU, backups, page-view
  analytics) replaces Supabase and Vercel; Sentry is unchanged; the session cookie's name changes; the
  RLS paragraph becomes the scope-helper one. `docs/dpia.md` and `docs/cookies-pecr.md` follow. Terms
  (`app/terms/page.tsx:119`) name Cloudflare.
- **Discord digest and bug notifications:** same messages, same channel, same weekly time; sent from the
  Worker. Deleting feedback (retention or account deletion) still deletes the stored Discord post.
- **Sentry:** same privacy scrubbing; environment names become `cloudflare-production` and
  `cloudflare-preview`; it runs under `nodejs_compat` (trial).
- **Accessibility (keyboard, screen reader, reduced motion):** the optimiser page uses a live region for
  progress and the existing button styles; nothing else changes.
- **README screenshots:** no change (no visible change on the six surfaces).
- **Changelog fragments and the release:** one `changed` fragment ("everyone signs in once more" is not
  announced, per decision 0018; the fragment says the app moved host and the optimiser runs on the
  device). Release: the first qa-to-main promotion after this lands is the cutover (Open call 1).
- **CI and GitHub Actions:** new `deploy.yml`; `e2e.yml` targets the preview Worker; `migration-check.yml`
  and `integration-tests.yml` use D1; the Vercel workflows and `vercel.json` go; the scoped-query rule
  joins `npm run lint`. Every workflow change gets a `workflow-expert` review.

## Removes

- `@supabase/supabase-js`, `@supabase/ssr`, `lib/supabase/**`, the `supabase-keys` capability and its
  key fallbacks, `/api/auth/callback` (`exchangeCodeForSession`).
- `@vercel/analytics`, `@vercel/speed-insights`, `vercel.json`, `scripts/vercel-ignored-build.sh` and its
  test, and the workflows `qa-preview-deploy`, `vercel-preview-on-ready`, `vercel-failure-autofix`,
  `stale-preview-check`.
- `/api/srs/optimize` and the native `@open-spaced-repetition/binding` (with its `serverExternalPackages`
  entry).
- The Postgres integration suite (`lib/sync/integration/**` on `postgres:15`), replaced by the D1 suite.
- `maxDuration` exports (ignored by Workers).
- After the 14-day fallback, in the cutover issue: `db/migrations/`, `docs/supabase-capacity.md`.

## Out of scope

- The cutover: secrets, OAuth callback URLs, the live data copy, DNS, deleting Supabase or Vercel (#2393).
- Turning Cache Components back on (when OpenNext PR #1318 is fixed and tested).
- A shared package with the other apps (only once three apps use the same code, decision 0018).
- Moving the optimiser's grade-log read or any sync rule to the server.

## Owner decisions relied on

- 2026-10-21: every change goes through OpenSpec with spec on touch.
- 2026-10-22: never archive by hand.
- 2026-11-19 (decision 0018): Cloudflare Workers + D1; Cache Components off; optimiser in the browser on
  a cross-origin-isolated page; Better Auth with username and password, GitHub and Google, account
  linking; users sign in once more with no notice; scope helper + CI rule + cross-user tests; our own
  events table instead of `@vercel/analytics`; nightly D1 export to R2 kept 90 days; EU jurisdiction;
  per-PR previews; short-freeze cutover; 14-day fallback.
- 2026-11-19, about 20:00: Fraser pre-approved that agents write this proposal and build it on a PR
  overnight, with no cutover and no live change; he reviews in the morning.

## Clarifications

No grilling round was held: Fraser pre-approved the overnight proposal and build (2026-11-19, about
20:00), and decision 0018 settled the main calls. Each open call below has the answer the documents
assume.

- 2026-11-19 Decision 0018 grilling (ops #607): order, D1 EU, Better Auth, re-sign-in without notice,
  scope helper, events table, backups, previews, cutover and fallback, as listed above.
- 2026-11-19 Fraser: R2 and Workers Paid enabled on the company account (about 20:20), so test deploys
  run on the paid plan and the backup bucket exists (`poke-memory-backups`, EU).
- 2026-11-19 Open call 1: when may the build land on `qa`? Assumed: only once the cutover date is set,
  because the next qa-to-main promotion after it switches production to Cloudflare and Vercel's build of
  `main` would no longer work against Supabase. Until then the build PR stays open and is rebased.
- 2026-11-19 Open call 2: browser data access through one generic gateway (`POST /api/db`, allowlisted
  tables, columns, operators and RPCs, user pinned) rather than one route per operation. Assumed: the
  gateway, because it keeps the sync code and its tests unchanged and can do no more than the anon key
  could under RLS. The alternative costs a rewrite of every sync module.
- 2026-11-19 Open call 3: the optimiser on its own page (`/settings/optimiser`) rather than isolating
  the whole Settings page. Assumed: its own page, so cross-origin images and embeds elsewhere keep
  working.
- 2026-11-19 Open call 4: preview Workers get a seeded test database (two test users, cards, a grade
  log) rather than a copy of real data. Assumed: seeded, so no personal data leaves production.
- 2026-11-19 Fraser (about 20:30): agents may copy the app's secret values from its Vercel environment
  onto the test and live Workers (Supabase keys are replaced, not copied; GitHub and Google client
  secrets may be copied, their callback URLs stay his step), and may rehearse the data copy read-only
  from the live Supabase database into the preview D1, comparing row counts, deleting the dump files
  afterwards. No writes to live Supabase or the live D1, and no push or Discord sends from the test
  Worker.
- 2026-11-19 Consequence, built in: outbound sends (Web Push and Discord) happen only when `DEPLOY_ENV`
  is `cloudflare-production`; the preview Worker has no Cron Triggers and no VAPID private key or
  Discord webhook. The rehearsal leaves real data in the preview database until Fraser decides to wipe
  and reseed it (Open call 4 then applies).
- 2026-11-19 Spec review findings folded in (no owner call needed): the settings field is
  `fsrsWeightsOptimizedAt`; VAPID required only in production; IPs from `CF-Connecting-IP`; the
  `usernames` table moves onto Better Auth's `user`; sign-out revokes all sessions; the Discord embed's
  dashboard link becomes the row id; the copy keeps timestamps and skips unknown push hosts; the
  optimiser's five-minute lock goes. Dependency: `harden-push-delivery` must archive before this change,
  because this delta modifies a requirement that change adds (its last task is in #2378).
- 2026-11-19 Open call 5: deleted data can stay in the 90-day backups (and D1's 30-day history), which
  the privacy notice now says instead of "deleted immediately and permanently". Assumed: disclose it, as
  decision 0018's backups make it true.
- 2026-11-19 Fraser (about 21:30): new secrets are generated rather than copied, because Vercel stores the
  app's environment values as sensitive and never returns them. A new VAPID key pair, so existing push
  subscriptions stop at cutover; the build re-subscribes a signed-in player with permission automatically
  on their next visit. Discord webhooks, the Sentry auth token and the GitHub and Google client secrets
  are his steps (#2393).
