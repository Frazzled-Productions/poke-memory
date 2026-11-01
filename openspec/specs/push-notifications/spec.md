# push-notifications Specification

## Purpose
How Poké Memory sends Web Push: the daily review reminder and the opt-in streak reminder, the hourly
cron routes that send them, how a device subscribes and stays subscribed, and what the service worker
does with a push. Baseline of current behaviour, from code and tests on `qa` at d2456f44 (2 November
2026). It describes what is true today, not what should be. "The routes" means
`app/api/push/send-daily/route.ts` and `app/api/push/send-streak-nudge/route.ts`, shortened below to
`send-daily` and `send-nudge` in citations; their tests are the `route.test.tsx` beside each.

## Requirements

### Requirement: Cron routes check a constant-time bearer secret
Both routes SHALL accept a caller only when the `Authorization` header equals `Bearer <CRON_SHARED_SECRET>`, compared in constant time, and SHALL otherwise answer 401 with an empty body. A missing header, an empty secret or a header of the wrong length SHALL be refused without throwing.

#### Scenario: Correct secret
- **WHEN** a request carries exactly `Bearer <secret>`
- **THEN** `isAuthorized` returns true (`lib/auth/bearerAuth.test.ts:7`)

#### Scenario: Wrong or missing header
- **WHEN** the header is missing, has the wrong secret, the wrong length, a lowercase `bearer` prefix or no prefix
- **THEN** `isAuthorized` returns false (`lib/auth/bearerAuth.test.ts:11-37`) and the route answers 401 with no body (`app/api/push/send-daily/route.test.tsx:413-436`)

#### Scenario: Multi-byte header
- **WHEN** the header holds multi-byte characters
- **THEN** the check returns false without throwing (`lib/auth/bearerAuth.test.ts:41`)

Cites: `lib/auth/bearerAuth.ts:18-30`, `send-daily:592-595`, `send-nudge:190-193`.

### Requirement: A route with missing configuration answers 503
Each route SHALL answer 503 `{ ok: false, error: "misconfigured" }` when the shared secret, a VAPID value, the Supabase URL or the secret key is missing, and this check SHALL run before the bearer check. The secret key SHALL be `SUPABASE_SECRET_KEY`, falling back to `SUPABASE_SERVICE_ROLE_KEY`.

#### Scenario: Secret unset
- **WHEN** `CRON_SHARED_SECRET` or `VAPID_PRIVATE_KEY` is unset
- **THEN** the route answers 503 (`app/api/push/send-daily/route.test.tsx:399-407`, `app/api/push/send-streak-nudge/route.test.tsx:218-224`)

Cites: `send-daily:562-585`, `send-nudge:169-188`, `lib/supabase/keys.ts:20-26`.

### Requirement: Two hourly cron jobs call the routes
The database SHALL schedule `web-push-daily-reminders` and `web-push-streak-nudge`, each at `0 * * * *`, posting an empty JSON body to the URL in Vault (`push_send_url`, `push_streak_nudge_send_url`) with the `cron_shared_secret` Vault value as the bearer token. Where `pg_cron` is missing the migrations SHALL log a notice and carry on. `vercel.json` SHALL define no crons.

#### Scenario: Top of each hour
- **WHEN** the clock reaches minute 0 of any UTC hour
- **THEN** both jobs fire and each route applies its own per-user hour gate (`db/migrations/031_web_push_hourly_cron.sql:57`, `db/migrations/047_get_push_streak_nudge_targets.sql:134`)

#### Scenario: Stock Postgres in CI
- **WHEN** migrations run with no `pg_cron` or `pg_net`
- **THEN** the schedule step becomes a notice and the migration still applies (`db/migrations/031_web_push_hourly_cron.sql:69-72`)

Cites: `db/migrations/031_web_push_hourly_cron.sql:44-73`, `db/migrations/047_get_push_streak_nudge_targets.sql:121-150`, `vercel.json:1-10`.

### Requirement: Cross-user reads go through service-role functions
The routes SHALL read across users only through `get_push_targets`, `get_push_due_cards` and `get_push_streak_days`, which are SECURITY DEFINER with an empty `search_path`, and whose EXECUTE is revoked from PUBLIC, anon and authenticated and granted to `service_role`. `get_push_targets` SHALL return one row per subscription, LEFT JOINed to the owner's settings. The only direct table access SHALL be the dead-endpoint DELETE. `get_push_reviewed_today` SHALL no longer exist.

#### Scenario: Route reads
- **WHEN** `send-daily` runs
- **THEN** it calls the two RPCs and no raw table SELECT (`app/api/push/send-daily/route.test.tsx:463`)

#### Scenario: User with no settings row
- **WHEN** a subscription's owner has no `user_settings` row
- **THEN** the target row still comes back with null settings, and default eligibility applies (`app/api/push/send-daily/route.test.tsx:1870`)

Cites: `db/migrations/046_get_push_targets.sql:45-73`, `:121-125`, `db/migrations/047_get_push_streak_nudge_targets.sql:68-84`, `:112-113`, `db/migrations/048_drop_get_push_reviewed_today.sql:14`, `send-daily:619-620`, `send-daily:829-832`.

### Requirement: A failed read stops the run before any send
Each route SHALL answer 502 with `targets_query_failed` when the targets read fails, `send-daily` SHALL answer 502 `due_query_failed` and `send-nudge` 502 `streak_days_query_failed` when any page of their second read fails, and nothing SHALL have been sent by then. No targets, or none left after a gate, SHALL answer 200 `{ ok: true, sent: 0, deleted: 0 }`.

#### Scenario: RPC error
- **WHEN** `get_push_targets` or `get_push_due_cards` errors
- **THEN** the route answers 502 (`app/api/push/send-daily/route.test.tsx:492-515`)

#### Scenario: Later page errors
- **WHEN** a later `get_push_streak_days` page errors
- **THEN** the route answers 502 rather than acting on partial data (`app/api/push/send-streak-nudge/route.test.tsx:626`)

#### Scenario: Nobody subscribed
- **WHEN** there are no subscriptions
- **THEN** the route answers 200 with zero sent (`app/api/push/send-daily/route.test.tsx:447`)

Cites: `send-daily:619-630`, `send-daily:666-671`, `send-daily:739-751`, `send-nudge:202-219`, `send-nudge:289-301`, `send-nudge:342-344`, `lib/sync/paginatedFetch.ts:31-52`.

### Requirement: The daily reminder goes out at the user's hour
`send-daily` SHALL include a subscription only when the owner's effective UTC hour equals the current UTC hour. With no stored hour the effective hour SHALL be 08 UTC whatever the timezone. With a stored hour (0 to 23, local clock) it SHALL be that hour converted using the UTC offset in force at the moment of the run. A null, blank or invalid timezone SHALL be treated as UTC.

#### Scenario: No preference
- **WHEN** a user has no stored hour, in any timezone, and the run is at 08:00 UTC
- **THEN** they are included, and at any other hour they are not (`lib/push/notificationHour.test.ts:74-85`, `app/api/push/send-daily/route.test.tsx:1538-1557`)

#### Scenario: Stored local hour
- **WHEN** a Europe/London user in BST stores hour 9 and the run is at 08:00 UTC
- **THEN** they are included (`lib/push/notificationHour.test.ts:101`)

#### Scenario: Unknown timezone
- **WHEN** the timezone is null, blank or invalid
- **THEN** the stored hour is read as UTC (`lib/push/notificationHour.test.ts:20-30`, `:123`)

#### Scenario: Half-hour timezone
- **WHEN** the user's offset includes 30 minutes
- **THEN** the run at minute 0 UTC falls 30 minutes into their chosen local hour, because the conversion compares whole local hours (`lib/push/notificationHour.ts:65-81`)

#### Scenario: Local hour repeated or skipped by a clock change
- **WHEN** the stored hour is 1 in Europe/London on the autumn change, or on the spring change
- **THEN** the gate is true at two runs in autumn and at no run in spring (the real function run hourly across 25 October 2026 and 28 March 2027; see poke-memory #2268)

Cites: `lib/push/notificationHour.ts:26`, `:53-82`, `:106-122`, `send-daily:659-664`, `db/migrations/030_user_settings_push_notification_hour.sql:26-28`.

### Requirement: The daily reminder is skipped only when there is nothing to report
For each included subscription, `send-daily` SHALL send unless the owner's due total and new-card estimate are both zero. Sends SHALL run one subscription at a time, in target order, and every device of a user SHALL get its own push.

#### Scenario: Due cards
- **WHEN** a subscriber has due cards
- **THEN** a notification is sent (`app/api/push/send-daily/route.test.tsx:525`)

#### Scenario: Nothing due, new-card room left
- **WHEN** nothing is due and the estimate is above zero
- **THEN** a new-only notification is sent (`app/api/push/send-daily/route.test.tsx:600`)

#### Scenario: Nothing due, caps used up
- **WHEN** nothing is due and the estimate is zero
- **THEN** nothing is sent (`app/api/push/send-daily/route.test.tsx:561`)

Cites: `send-daily:791-812`, `db/migrations/046_get_push_targets.sql:72`.

### Requirement: The due count follows the user's cards, languages and scope
`send-daily` SHALL count non-hidden `card_reviews` rows with `due_date` on or before the user's local today, grouped into one read per local date and paged with a stable order. A row SHALL count only when its locale is in the user's learning locales, its card type is enabled, its alternate-form rule passes and it matches the practice scope. Evolution-edge scope SHALL anchor on the pre-evolution species. Unknown card types and species missing from the lookup SHALL pass.

#### Scenario: Language outside the learning set
- **WHEN** a due row's locale is not in `learningLocales`
- **THEN** it is not counted (`app/api/push/send-daily/route.test.tsx:1724`)

#### Scenario: Alternate forms off
- **WHEN** `alternateFormsEnabled` is false
- **THEN** rows for species id 10000 and above are not counted, on either end of an evolution edge (`app/api/push/send-daily/route.test.tsx:802-838`)

#### Scenario: Practice scope
- **WHEN** a generation, type or preset scope is set
- **THEN** only matching cards count, and an evolution edge is judged on its first species (`app/api/push/send-daily/route.test.tsx:1267`, `:1398`, `:1440`)

#### Scenario: Superuser mode
- **WHEN** a superuser flag is on in a client
- **THEN** the count is unchanged, because the route reads the cloud and has no such flag (`send-daily:561-837`)

Cites: `send-daily:681-688`, `send-daily:729-783`, `send-daily:453-479`, `db/migrations/046_get_push_targets.sql:111-114`.

### Requirement: Settings the routes cannot read fall back to defaults
`send-daily` SHALL parse the settings JSONB permissively, using the app's defaults for a missing or invalid field: evolution cards on, reverse-evolution, cry and alternate forms off, new-card caps of 10, 5, 10 and 10, an empty scope and `["en"]`. English SHALL always be in the learning set, and invalid locale entries SHALL be dropped.

#### Scenario: Never set a language
- **WHEN** `learningLocales` is absent
- **THEN** the user counts as English only (`app/api/push/send-daily/route.test.tsx:1834`)

#### Scenario: Bad entries
- **WHEN** `learningLocales` holds invalid values
- **THEN** they are dropped and English stays (`app/api/push/send-daily/route.test.tsx:1890`)

Cites: `send-daily:281-295`, `send-daily:309-417`.

### Requirement: The new-card estimate is caps minus cards started today
The estimate SHALL be the sum, floored at zero per term, of `maxNewPerDay`, `maxNewReversePerDay`, the shared `maxNewEvolutionPerDay` when either evolution direction is on, and `maxNewCryPerDay` when cry cards are on, each less the eligible rows with `first_seen` equal to today among the rows the due read returned. It SHALL NOT check how many unseen cards exist, and SHALL be the same whatever the scope.

#### Scenario: Started today
- **WHEN** five name cards with `first_seen` today are in the due read
- **THEN** the name term drops by five (`app/api/push/send-daily/route.test.tsx:982`)

#### Scenario: Evolution cap
- **WHEN** both evolution directions are on
- **THEN** the evolution term is added once (`app/api/push/send-daily/route.test.tsx:1072`)

#### Scenario: Scope filters due cards only
- **WHEN** every due card is out of scope
- **THEN** the estimate is unchanged (`app/api/push/send-daily/route.test.tsx:1482`)

#### Scenario: Card started today and not due
- **WHEN** a card first seen today now has a later `due_date`
- **THEN** it is outside the due read and is not subtracted (`db/migrations/046_get_push_targets.sql:112`; see poke-memory #2266)

Cites: `send-daily:508-544`, `send-daily:773-781`.

### Requirement: The daily reminder text
The payload SHALL be `{ title, body, url: "/" }` from the English `pushDaily` catalogue, whatever the app language. One locale with cards due SHALL use the compact form naming that language. Several SHALL lead with the total, then a comma-joined breakdown by endonym, largest first, ties in canonical locale order. Nothing due SHALL use the new-only copy.

#### Scenario: Single language
- **WHEN** one locale has cards due
- **THEN** the body names the count and the language, with the new estimate when above zero (`app/api/push/send-daily/route.test.tsx:239-260`)

#### Scenario: Several languages
- **WHEN** two locales have cards due
- **THEN** the total leads and the breakdown runs largest first (`app/api/push/send-daily/route.test.tsx:300`, `:338`)

#### Scenario: Non-English app language
- **WHEN** a user's app language is Japanese
- **THEN** the notification is still English, because the route has no per-user app language (`send-daily:101-107`, `:149`)

Cites: `send-daily:144-202`, `messages/en.json:1248-1256`.

### Requirement: Dead subscriptions are deleted and other send failures skipped
On a 404 or 410 from a push service each route SHALL delete that row after the send loop. Any other send failure SHALL be logged with the subscription id and status, and the run SHALL carry on. A failed DELETE SHALL still answer 200, reporting `deleted: 0`. The response SHALL be `{ ok: true, sent, deleted }`.

#### Scenario: Gone
- **WHEN** a send returns 410 or 404
- **THEN** the row is deleted (`app/api/push/send-daily/route.test.tsx:651-678`, `app/api/push/send-streak-nudge/route.test.tsx:676`)

#### Scenario: Server error
- **WHEN** a send returns 500
- **THEN** the row stays (`app/api/push/send-daily/route.test.tsx:702`, `app/api/push/send-streak-nudge/route.test.tsx:697`)

Cites: `send-daily:789-836`, `send-nudge:346-381`.

### Requirement: The streak reminder needs opt-in and a local 20:00 hour
`send-nudge` SHALL consider only users whose settings hold `streakNudgeEnabled === true`, and SHALL send only at the run where their local hour is 20, UTC standing in for a null or invalid timezone.

#### Scenario: Not opted in
- **WHEN** the flag is false, or the user has no settings row
- **THEN** they are skipped (`app/api/push/send-streak-nudge/route.test.tsx:297-308`)

#### Scenario: Wrong local hour
- **WHEN** the run is not at the user's local nudge hour
- **THEN** nothing is sent (`app/api/push/send-streak-nudge/route.test.tsx:320`)

#### Scenario: Unknown timezone
- **WHEN** the timezone is null or invalid
- **THEN** both the hour gate and "today" use UTC (`app/api/push/send-streak-nudge/route.test.tsx:476`)

Cites: `send-nudge:72`, `send-nudge:152-155`, `send-nudge:215-219`, `send-nudge:249-254`.

### Requirement: The streak reminder stays clear of the daily reminder
`send-nudge` SHALL skip a user when the nudge's UTC hour and their daily reminder's effective UTC hour are less than 3 hours apart on the 24-hour clock. With no stored hour the daily hour SHALL be 08 UTC. The skip SHALL apply every day, so such a user never gets the nudge while those hours stay close.

#### Scenario: Close together
- **WHEN** the two hours are within 3 hours, across midnight included
- **THEN** the nudge is skipped (`app/api/push/send-streak-nudge/route.test.tsx:340`)

#### Scenario: Well clear
- **WHEN** the hours are 3 or more apart
- **THEN** the nudge goes ahead (`app/api/push/send-streak-nudge/route.test.tsx:357`)

#### Scenario: Default hour near UTC+12
- **WHEN** a user at UTC+12 has no stored hour
- **THEN** the nudge's hour is 08 UTC, equal to the default, and it is always skipped (`send-nudge:253-264`)

Cites: `send-nudge:80`, `send-nudge:256-264`.

### Requirement: Reviewed today comes from the user's local streak days
`send-nudge` SHALL read every `streak_days` row for the remaining candidates through `get_push_streak_days`, paged and ordered by `(user_id, review_date)`, and SHALL treat a user as reviewed today when their local today is among those dates.

#### Scenario: Reviewed today, local
- **WHEN** a Los Angeles or Tokyo user's local today is in their streak days
- **THEN** no nudge is sent (`app/api/push/send-streak-nudge/route.test.tsx:426-442`)

#### Scenario: Not reviewed today, local
- **WHEN** the local today is absent
- **THEN** the user stays eligible (`app/api/push/send-streak-nudge/route.test.tsx:408`, `:460`)

#### Scenario: Learning-step practice
- **WHEN** only learning-step cards were practised and today's streak day exists
- **THEN** no nudge is sent (`app/api/push/send-streak-nudge/route.test.tsx:392`)

#### Scenario: More rows than one page
- **WHEN** the rows pass the PostgREST page cap, or a row repeats across pages
- **THEN** all dates are read and the repeat is harmless (`app/api/push/send-streak-nudge/route.test.tsx:568`, `:651`)

Cites: `send-nudge:289-311`, `send-nudge:317-321`.

### Requirement: The streak reminder needs a streak that is truly at risk
The predicate SHALL be true only when the user has not reviewed today, the effective streak (spent protection dates included) is above zero, and simulating tomorrow's protection step would spend no token. A one-day streak SHALL qualify.

#### Scenario: At risk
- **WHEN** a streak is active and no token is available
- **THEN** the predicate is true (`lib/push/streakNudgePredicate.test.ts:44`)

#### Scenario: A token would bridge the gap
- **WHEN** tomorrow's protection step would spend a token
- **THEN** no nudge is sent (`lib/push/streakNudgePredicate.test.ts:57`, `app/api/push/send-streak-nudge/route.test.tsx:530`)

#### Scenario: Balance too small
- **WHEN** the token balance cannot cover the gap
- **THEN** the predicate is true (`lib/push/streakNudgePredicate.test.ts:86`)

#### Scenario: No streak
- **WHEN** there is no active streak
- **THEN** the predicate is false (`lib/push/streakNudgePredicate.test.ts:21-33`)

Cites: `lib/push/streakNudgePredicate.ts:40-73`, `send-nudge:317-336`.

### Requirement: The streak reminder text
The payload SHALL be `{ title, body, url: "/" }` from the English `pushStreak` catalogue, with the effective streak length in the body, whatever the app language.

#### Scenario: Streak length
- **WHEN** a nudge is built for a streak
- **THEN** the body carries the length (`app/api/push/send-streak-nudge/route.test.tsx:201`), with a singular form for one day (`messages/en.json:1283`)

Cites: `send-nudge:112-121`, `send-nudge:391-397`, `messages/en.json:1281-1284`.

### Requirement: Subscribing stores this device's endpoint and keys
`subscribeToPush` SHALL stop with a named reason when push is unsupported, the VAPID key is missing or permission is not granted, SHALL reuse an existing PushManager subscription or create one with `userVisibleOnly`, and SHALL save the row by delete-then-insert on `(user_id, endpoint)`, because the table has no UPDATE policy. Delete or insert failure SHALL return `persist-failed`, and the local subscription SHALL stay.

#### Scenario: Turning reminders on
- **WHEN** the user turns the toggle on and permission is granted
- **THEN** `subscribeToPush` runs and the toggle shows on (`components/pwa/PushOptIn.test.tsx:156`)

#### Scenario: Failure
- **WHEN** the helper returns a failure reason
- **THEN** the card shows that reason and the toggle stays off (`components/pwa/PushOptIn.test.tsx:195`)

#### Scenario: Key conversion
- **WHEN** a base64url VAPID key is decoded
- **THEN** the bytes are the right length and round-trip (`components/pwa/subscribeHelpers.test.tsx:23-34`)

Cites: `lib/push/subscribe.ts:110-209`.

### Requirement: Turning reminders off removes every device
`unsubscribeFromPush` SHALL delete all of the user's rows first, then unsubscribe the local PushManager, ignoring local errors. If the delete fails it SHALL return `delete-failed` and leave the local subscription. On success the Settings card SHALL also reset `streakNudgeEnabled` to false.

#### Scenario: Toggle off
- **WHEN** the user turns the toggle off
- **THEN** `unsubscribeFromPush` runs and the toggle shows off (`components/pwa/PushOptIn.test.tsx:173`)

#### Scenario: Streak opt-in resets
- **WHEN** the primary toggle goes off
- **THEN** the streak opt-in is saved as false (`components/pwa/PushOptIn.test.tsx:434`)

#### Scenario: Delete fails
- **WHEN** the delete returns an error
- **THEN** the card shows the error (`components/pwa/PushOptIn.test.tsx:213`)

Cites: `lib/push/subscribe.ts:223-257`, `components/pwa/PushOptIn.tsx:148-164`.

### Requirement: Signing out leaves subscriptions in place
Signing out and switching accounts SHALL NOT change `push_subscriptions` or the local subscription: `PushOptIn` SHALL be the only caller of `unsubscribeFromPush`. A device used by two accounts SHALL hold one row for each. Account deletion SHALL remove the rows by `ON DELETE CASCADE`.

#### Scenario: Second account on one device
- **WHEN** a second account subscribes on the same device
- **THEN** the endpoint has one row per user, and the first row stays (`lib/push/subscribe.ts:103-108`; see ops #425)

Cites: `lib/push/subscribe.ts:103-108`, `components/pwa/PushOptIn.tsx:152`, `db/migrations/028_web_push_subscriptions.sql:80`, `:89`.

### Requirement: Opening Settings reconciles the local subscription
When Settings loads with a local subscription, `reconcileSubscription` SHALL look for the signed-in user's row for that endpoint. A matching row, or a failed query, SHALL leave the state alone. With no row it SHALL re-insert one from the local keys, for whichever account is signed in, superuser flags on or off. If the re-insert fails or the keys are missing, the toggle SHALL show off. With no local subscription, the toggle SHALL show off without a server check.

#### Scenario: Row present
- **WHEN** a matching row exists
- **THEN** the result is `in-sync` (`components/pwa/subscribeHelpers.test.tsx:133`)

#### Scenario: Row gone
- **WHEN** no row exists and the re-insert works
- **THEN** the result is `re-inserted` and the toggle shows on (`components/pwa/subscribeHelpers.test.tsx:141`, `components/pwa/PushOptIn.test.tsx:251`)

#### Scenario: Re-insert fails
- **WHEN** the re-insert fails
- **THEN** the result is `disabled` and the toggle shows off (`components/pwa/subscribeHelpers.test.tsx:149`, `components/pwa/PushOptIn.test.tsx:261`)

#### Scenario: Query error
- **WHEN** the SELECT errors
- **THEN** the result is `in-sync`, so the toggle is not falsely turned off (`components/pwa/subscribeHelpers.test.tsx:160`)

#### Scenario: Reminders turned off on another device
- **WHEN** reminders were turned off elsewhere, and Settings opens on a device still holding a local subscription
- **THEN** that device's row is re-inserted (`lib/push/subscribe.ts:353-382`; see ops #424)

Cites: `lib/push/subscribe.ts:315-386`, `components/pwa/PushOptIn.tsx:81-110`.

### Requirement: The Settings card shows only where push can work
`PushOptIn` SHALL render only for a signed-in user, in a browser with service worker, PushManager and Notification support, running as an installed app. While any superuser flag is on, the primary toggle SHALL be replaced by a disabled "Sync paused (superuser)" button. When permission is `denied`, the toggle SHALL be disabled and a device-settings explainer shown. The title, description and messages SHALL be hard-coded English; only the aria-label and streak labels are translated.

#### Scenario: Browser tab or no support
- **WHEN** the app is not standalone, or push is unsupported
- **THEN** the card renders nothing (`components/pwa/PushOptIn.test.tsx:111-123`)

#### Scenario: Guest
- **WHEN** nobody is signed in
- **THEN** the card is not mounted (`app/settings/page.tsx:1864`)

#### Scenario: Superuser flag on
- **WHEN** any superuser flag is on
- **THEN** the paused button shows and clicking does not subscribe (`components/pwa/PushOptIn.test.tsx:280-288`)

#### Scenario: Permission denied
- **WHEN** `Notification.permission` is `denied`
- **THEN** the explainer shows (`components/pwa/PushOptIn.test.tsx:504`)

#### Scenario: Non-English locale
- **WHEN** the app runs in ja, zh-Hans or zh-Hant
- **THEN** the aria-label and streak labels are translated (`components/pwa/PushOptIn.test.tsx:307`, `:460`)

Cites: `components/pwa/PushOptIn.tsx:81-91`, `:166-222`, `:272-296`, `lib/push/subscribe.ts:24-53`, `app/settings/page.tsx:1864-1866`.

### Requirement: The streak toggle depends on the daily toggle
The streak toggle SHALL default off, SHALL stay visible but disabled while the device is not subscribed or a superuser flag is on, and SHALL save `streakNudgeEnabled` through local settings. `AutoSyncOnChange` SHALL send the change to the cloud JSONB when no superuser flag is on.

#### Scenario: Primary off
- **WHEN** the primary toggle is off
- **THEN** the streak toggle is off, disabled and does nothing on click (`components/pwa/PushOptIn.test.tsx:327`, `:398`)

#### Scenario: Primary on
- **WHEN** the device is subscribed
- **THEN** the toggle is usable and saves the choice (`components/pwa/PushOptIn.test.tsx:344`, `:372`)

#### Scenario: Superuser flag on
- **WHEN** a superuser flag is on
- **THEN** the toggle is disabled with the paused reason (`components/pwa/PushOptIn.test.tsx:413-421`)

Cites: `components/pwa/PushOptIn.tsx:68`, `:121-130`, `:250-258`, `components/sync/AutoSyncOnChange.tsx:46-49`, `:54-66`.

### Requirement: The reminder hour is a separate regional setting
The picker SHALL offer "Default (08:00)" and the hours 00:00 to 23:00, SHALL save locally and, for a signed-in user with no superuser flag, SHALL update the `push_notification_hour` column with `pushRegionalPrefs`, without retrying on failure. An update with no existing `user_settings` row SHALL change nothing. A pull SHALL apply a non-null cloud hour and leave the local hour when the cloud value is null.

#### Scenario: Choosing an hour
- **WHEN** a signed-in user picks 19:00
- **THEN** the setting saves and the column is updated (`app/settings/page.tsx:1839-1847`)

#### Scenario: Two devices, hour set
- **WHEN** device A sets an hour and device B pulls
- **THEN** device B takes that hour (`lib/sync/pullAndMerge.ts:485-487`)

#### Scenario: Two devices, hour cleared
- **WHEN** device A goes back to Default and device B pulls
- **THEN** device B keeps its old hour (`lib/sync/pullAndMerge.ts:485-487`; see poke-memory #2270)

#### Scenario: Guest
- **WHEN** nobody is signed in
- **THEN** the hour is saved on the device only (`app/settings/page.tsx:1842`)

Cites: `app/settings/page.tsx:1830-1859`, `lib/sync/settings.ts:80-99`, `lib/sync/pullAndMerge.ts:478-489`, `messages/en.json:328-332`.

### Requirement: The resubscribe route replaces a rotated subscription
`POST /api/push/resubscribe` SHALL parse the JSON body, answer 400 `invalid_json` or `invalid_payload` unless `endpoint`, `p256dh` and `auth` are non-empty strings, then require a session (401 `unauthorized`), delete the caller's row for that endpoint and insert the new one. Failures SHALL answer 500 `delete_failed` or `insert_failed`. It SHALL NOT remove the row for the previous endpoint.

#### Scenario: Signed out
- **WHEN** a valid body arrives with no session
- **THEN** the route answers 401 (`app/api/push/resubscribe/route.test.tsx:83`)

#### Scenario: Bad body
- **WHEN** the body is not JSON, a field is missing or `endpoint` is empty
- **THEN** the route answers 400 (`app/api/push/resubscribe/route.test.tsx:91-108`)

#### Scenario: Success
- **WHEN** the caller is signed in and the body is valid
- **THEN** the delete and insert run and the route answers 200 (`app/api/push/resubscribe/route.test.tsx:114`)

#### Scenario: Database failure
- **WHEN** the delete or the insert fails
- **THEN** the route answers 500 (`app/api/push/resubscribe/route.test.tsx:136-149`)

Cites: `app/api/push/resubscribe/route.ts:22-68`, `lib/auth/requireAuth.ts:33-35`, `lib/api/parseJsonBody.ts:26-27`.

### Requirement: The service worker follows a subscription change
On `pushsubscriptionchange` the service worker SHALL do nothing without a VAPID key, SHALL use the supplied new subscription or subscribe again, and SHALL POST it to `/api/push/resubscribe` with credentials. Any failure SHALL end quietly, leaving the next Settings visit to reconcile.

#### Scenario: Browser supplies the new subscription
- **WHEN** the event carries `newSubscription`
- **THEN** it is posted to the route without subscribing again (`app/sw.ts:886`, `:920-930`)

#### Scenario: Offline or re-subscribe fails
- **WHEN** the subscribe or the POST fails
- **THEN** the handler resolves with no retry (`app/sw.ts:909-913`, `:931-933`)

Cites: `app/sw.ts:880-936`.

### Requirement: The service worker shows every push
On `push` the service worker SHALL show a notification, taking title, body and URL from the JSON payload and using defaults ("Poké Memory", "You have Pokémon reviews waiting.", `/`) for anything missing, empty or unparseable. Every notification SHALL use the tag `poke-memory-daily-reminder` with no `renotify`, so the daily reminder and the streak reminder replace each other.

#### Scenario: Normal payload
- **WHEN** a push arrives with valid JSON
- **THEN** its title and body are shown, with `/icon2` as icon and badge (`app/sw.ts:744-776`)

#### Scenario: Malformed payload
- **WHEN** the JSON cannot be parsed
- **THEN** the default text is shown (`app/sw.ts:760-764`)

#### Scenario: Nudge while the reminder is on screen
- **WHEN** a streak reminder arrives with the daily reminder still showing
- **THEN** it replaces it under the same tag (`app/sw.ts:775`; see poke-memory #2267)

Cites: `app/sw.ts:739-779`.

### Requirement: Tapping a notification opens the app
On `notificationclick` the service worker SHALL close the notification, focus a window already at the target URL, else navigate and focus the first window, else open a new one. A missing URL SHALL mean `/`.

#### Scenario: App closed
- **WHEN** no window is open
- **THEN** a new window opens at the target (`app/sw.ts:817`, `:830`)

#### Scenario: App already there
- **WHEN** a window is at the target
- **THEN** it is focused (`app/sw.ts:807-812`)

#### Scenario: Navigate unavailable or fails
- **WHEN** the first window cannot navigate
- **THEN** a new window opens (`app/sw.ts:818-830`)

Cites: `app/sw.ts:787-833`.

### Requirement: Subscriptions are stored per user and endpoint
`push_subscriptions` SHALL hold one row per `(user_id, endpoint)` with the endpoint, `p256dh`, `auth_secret`, `created_at` and `last_seen_at`, under row-level security with SELECT, INSERT and DELETE policies for the owner and no UPDATE policy. `last_seen_at` SHALL be set on insert and never updated afterwards.

#### Scenario: Another user's row
- **WHEN** a signed-in client reads, adds or deletes a row for a different user
- **THEN** the policies refuse it (`db/migrations/028_web_push_subscriptions.sql:98-105`)

#### Scenario: Re-subscribing
- **WHEN** a device re-subscribes
- **THEN** its row is deleted and inserted again, with a new `created_at` (`lib/push/subscribe.ts:186-203`)

Cites: `db/migrations/028_web_push_subscriptions.sql:78-105`, `lib/push/subscribe.ts:201`, `:378`, `app/api/push/resubscribe/route.ts:60`.

### Requirement: Sync counts subscriptions and nothing reads the count
Each pull SHALL read the caller's row count, returning null on any error without failing the sync, and SHALL dispatch `poke-memory:push-subscriptions-pulled` with the count. No code SHALL listen for that event.

#### Scenario: Count
- **WHEN** the query succeeds
- **THEN** the count is returned, 0 for no rows (`lib/sync/pushSubscriptions.test.ts:41-59`)

#### Scenario: Offline or query error
- **WHEN** the query errors or throws
- **THEN** the result is null and the pull carries on (`lib/sync/pushSubscriptions.test.ts:69-82`)

#### Scenario: Scoped to the user
- **WHEN** the count runs
- **THEN** it filters by the supplied user id (`lib/sync/pushSubscriptions.test.ts:104`)

Cites: `lib/sync/pushSubscriptions.ts:30-48`, `lib/sync/pullAndMerge.ts:592-600`.

## Clarifications

Open calls for the owner, 2 November 2026. Each has a recommendation; none has been decided.

- **Capability name.** Open proposal poke-memory #2204 (`harden-push-delivery`) creates a `push-delivery` capability with its own short baseline of three requirements. Recommendation: when that change is next revised, retarget its delta to `push-notifications` and drop those three, so there is one capability.
- **Where this file lives.** It sits directly in `openspec/specs/` rather than in a change folder, as a baseline alters no behaviour; it matches the Koinori wave 3 baselines. Recommendation: keep it.
- **Is the collision guard's permanent skip intended?** A user at about UTC+10 to UTC+14 or UTC-10 to UTC-12 on the default hour, or anyone whose chosen hour is near 20:00, opts in and never gets a streak reminder, with no word in Settings. It matches the #1950 sign-off, so no issue is filed. Recommendation: confirm it, then add a line to the toggle's description if it stays.
- **Reminder language.** Notifications are English in every locale, as recorded in the route comment (#1504), so no issue is filed. Recommendation: leave it until the route can read a per-user app language.
- **Push due count.** Already filed in #2193 (includes learning-step cards, compares UTC `due_date` with the local day), so it is not repeated here.
- **Service worker cover.** No test runs the `push`, `notificationclick` or `pushsubscriptionchange` handlers, so those requirements cite code. Recommendation: cover them if `app/sw.ts` next changes.
