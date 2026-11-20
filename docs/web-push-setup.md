# Web Push setup

Manual one-off setup for the daily review reminder and streak nudge Web Push
features (issue #1056, migration 028), as they run on Cloudflare Workers
(decision 0018, OpenSpec change `move-to-cloudflare`, design D2 and D8).

## Architecture summary

- Two Cron Triggers in `wrangler.jsonc` (`0 * * * *` and `*/30 * * * *`)
  call the Worker's `scheduled` handler (`worker/index.ts`).
  `cronRoutesFor` (`lib/cron/schedule.ts`) maps each firing to app routes;
  the hourly one runs `POST /api/push/send-daily` and
  `POST /api/push/send-streak-nudge` every hour. Each route is called
  through the Worker's own fetch handler (no network hop) with
  `Authorization: Bearer <CRON_SHARED_SECRET>`, and its status is logged
  as `[cron] POST <route> -> <status>` (`lib/cron/run.ts`). A failing
  route does not stop the others.
- The daily route only notifies users whose own reminder hour is the
  current UTC hour. It verifies the bearer token in constant time, reads
  every target through the named cross-user queries in `lib/db/system.ts`,
  fans out per-user pushes via the `web-push` npm package (under
  `nodejs_compat`), and deletes any subscriptions the push service reports
  as dead (410 / 404).
- Pushes are sent only where `outboundAllowed()` (`lib/outbound.ts`) holds,
  that is when `DEPLOY_ENV` is `cloudflare-production`. Anywhere else the
  routes compute the same targets, log how many they would have sent and
  return `wouldSend`; the VAPID private key is then not needed. The preview
  Worker (`poke-memory-preview`) has no Cron Triggers and no VAPID private
  key, so it can never message a real person.
- The client subscribes via `pushManager.subscribe()` from inside an
  installed PWA on iOS / Android / desktop Chromium. The opt-in toggle
  lives on the Settings page and is hidden outside `display-mode:
  standalone` or for guests.

## One-off setup checklist

Run these once per Worker. There is no Vault and no `pg_cron`: the schedule
is in `wrangler.jsonc` and deploys with the Worker.

### 1. Generate a VAPID key pair

```
npx web-push generate-vapid-keys
```

This prints two base64url strings:

```
Public Key:  <NEXT_PUBLIC_VAPID_PUBLIC_KEY>
Private Key: <VAPID_PRIVATE_KEY>
```

Keep both somewhere secure (a password manager). Production and the preview
Worker build with the same public key; only production holds the private key.

### 2. Generate a shared cron secret

```
openssl rand -base64 32
```

This is `CRON_SHARED_SECRET`. The scheduled handler sends it and the routes
compare it byte for byte; if it is missing, the handler logs
`[cron] CRON_SHARED_SECRET is not set` and runs nothing.

### 3. Set the Worker secrets

```
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT        # mailto:hello@pokememory.com
npx wrangler secret put CRON_SHARED_SECRET
```

Add `--env preview` only for a secret the preview Worker needs; it needs
none of these three. For `wrangler dev`, put local test values in the
gitignored `.dev.vars` (names listed at the top of `wrangler.jsonc`).

### 4. Set the public key as a build variable

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined into the browser bundle by
`next build`, so it is a build-time value, not a Worker secret. Set it as
the repository variable `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; `deploy.yml` passes
it to both the production and the preview build. Never give the private key
or the cron secret a `NEXT_PUBLIC_` prefix: that leaks them to every client
bundle.

### 5. Verify

- The Settings page on a signed-in installed PWA shows a "Daily review
  reminder" toggle. Turning it on prompts for notification permission
  and inserts a row into `push_subscriptions`.
- Locally, fire the hourly trigger with `npx wrangler dev --test-scheduled`
  and request `/__scheduled?cron=0+*+*+*+*` (see `docs/local-dev.md`). The
  local Worker is not production, so the routes report `wouldSend`.
- In production, tail the Worker's logs (`npx wrangler tail poke-memory`)
  across the hour. A successful run logs
  `[cron] POST /api/push/send-daily -> 200`, and the route returns
  `{ ok: true, sent: N, deleted: M }`.

## The key pair at cutover

The move to Cloudflare uses a new VAPID key pair (owner ruling, 19 November
2026: the old private key could not be read back). Subscriptions made with
the old public key get no more pushes. On each load, a signed-in browser
whose notification permission is already granted and whose subscription
carries a different key moves to the current key automatically
(`reconcileVapidKey` in `lib/push/subscribe.ts`, run from
`components/sync/SignInPull.tsx`): it unsubscribes, deletes the old row,
subscribes again with no permission prompt and stores the new endpoint. If
subscribing again fails, the old row is still deleted and Settings shows
reminders off on that device. It is skipped while a superuser flag is on.

## Operational notes

- **Subscription cleanup.** The route deletes any subscription that
  returns 410 (Gone) or 404 (Not Found) from the push service. Other
  errors are logged as `[push] sendNotification failed` with the
  subscription id and skipped - a single bad endpoint does not block
  the rest of the batch.
- **Time limits.** Both send routes share `lib/push/deliver.ts`: each send
  has a 10 second socket timeout and a 15 second overall limit, at most 20
  sends run at once, and no new send starts 240 seconds after the route
  started (a Cron Trigger invocation may take 15 minutes). A send past a
  limit counts as failed and its row stays. Devices left when the 240
  seconds run out are logged as `[push] devices not reached`; they are not
  retried, so they get the next day's reminder.
- **Known push services only.** An endpoint must be https on an Apple,
  Google (FCM), Mozilla or Microsoft push host (`lib/push/endpoints.ts`,
  repeated as a CHECK on `push_subscriptions` in
  `db/d1/migrations/0001_schema.sql`). `resubscribe` returns 400 for any
  other host and the database refuses the insert. Rows on another host are
  skipped at send time, kept, and logged as
  `[push] rows on an unknown host skipped`; Settings shows the toggle off
  on that device and deletes its row.
- **At most 10 subscriptions per account.** A `BEFORE INSERT` trigger
  (migration 049, now `push_subscriptions_enforce_limit_trigger` in
  `0001_schema.sql`) deletes the least recently subscribed rows so an
  account keeps 10. The replaced device gets its row back the next time
  Settings is opened on it.
- **Schedule changes.** Leave the trigger hourly. Each user's reminder hour
  comes from `push_notification_hour`, so a trigger that fires once a day
  would only reach the users due in that hour. A schedule change is a code
  change to `wrangler.jsonc` and `lib/cron/schedule.ts` (with its tests).
- **Secret rotation.** `npx wrangler secret put CRON_SHARED_SECRET` with the
  new value; the scheduled handler and the routes read the same secret, so
  there is no second copy to keep in step. Rotating the VAPID key pair means
  a new private key secret and a new `NEXT_PUBLIC_VAPID_PUBLIC_KEY` build
  variable deployed together; browsers then move to the new key on their
  next load, as at cutover.
- **Disabling the feature.** Remove the hourly entry from `triggers.crons`
  in `wrangler.jsonc` and deploy (this also stops the other hourly jobs), or
  delete the secret (`npx wrangler secret delete CRON_SHARED_SECRET`), which
  stops every scheduled route until it is set again.
