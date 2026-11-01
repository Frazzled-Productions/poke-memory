# cloud-sync Specification

## Purpose
How a signed-in player's review state moves between the device and Supabase: the pull and merge, the
per-grade push and its fallbacks, the grade log, the sync status, and the database rules that guard
them. This is the baseline: current behaviour on `qa` at d2456f44, written from code and tests, not
what it should be. A requirement that records behaviour which looks wrong says so and names the issue.
Line references are to that commit.

## Requirements

### Requirement: Local-first storage, with the cloud for signed-in players only (baseline)

The app SHALL treat device storage as the working copy. Every pull and push SHALL do nothing without
both a client and a user id, so a guest never touches the cloud. Sync failures SHALL NOT interrupt
review: `pullAndMerge` never throws and reports `"ok"`, `"error"` or `"skipped"`.

#### Scenario: Guest mode

- **WHEN** `pullAndMerge` is called with no client or no user id
- **THEN** it returns `"skipped"` and makes no request

#### Scenario: Card pull fails

- **WHEN** `pullSession` returns null
- **THEN** `pullAndMerge` returns `"error"` and local state is unchanged

Source: `lib/sync/pullAndMerge.ts:137`, `lib/sync/pullAndMerge.ts:148`, `lib/sync/pullAndMerge.ts:629`, `lib/sync/usePerGradeSync.ts:199`, `lib/sync/useOnlineReconnectSync.ts:65`.

### Requirement: Superuser mode writes nothing to the cloud (baseline)

While any superuser flag is on, the push paths SHALL receive a null client and user. Sign-in and
visibility pulls SHALL still read, with `superuserPaused` set, which suppresses the locale push-back
and the grade-log re-push. The reconnect path receives null too, so it neither pulls nor pushes.

#### Scenario: Superuser flag on during a sign-in pull

- **WHEN** a pull runs with `superuserPaused` true and the merged locales differ from the cloud
- **THEN** local settings update and no `pushSettings` or grade-log upsert is sent

Source: `components/sync/AutoSyncOnChange.tsx:48`, `components/sync/OnlineReconnectSync.tsx:21`, `components/sync/SignInPull.tsx:17`, `components/sync/SyncOnVisible.tsx:19`, `lib/sync/pullAndMerge.ts:458`, `lib/sync/pullAndMerge.ts:576`, `components/review/ReviewSession.tsx:1122`.

### Requirement: What starts a pull (baseline)

A pull SHALL run once per transition of the user id to a non-null value (cold load included), after
`guardAccountSwitch` has finished; when the tab returns after at least 30 seconds hidden, unless the
route is `/` or a review session is active; and on the browser `online` event or a service worker
replay message, which are not gated on an active session.

#### Scenario: Back to the tab on the practice page

- **WHEN** the tab becomes visible after 60 seconds hidden on route `/`
- **THEN** no pull runs

#### Scenario: Same user re-renders

- **WHEN** the auth hook re-renders with the user id already pulled
- **THEN** no second pull runs; signing out resets this, so a later sign-in pulls again

Source: `lib/sync/useSignInPull.ts:42`, `lib/sync/useSignInPull.ts:49`, `lib/sync/useVisibilityPull.ts:10`, `lib/sync/useVisibilityPull.ts:12`, `lib/sync/useVisibilityPull.ts:59`, `lib/sync/useOnlineReconnectSync.ts:80`, `lib/sync/useOnlineReconnectSync.ts:152`, `lib/sync/useOnlineReconnectSync.ts:167`.

### Requirement: Pulls read every row in a stable order (baseline)

`pullSession`, `pullStreak` and `pullGradeLog` SHALL page through `fetchAllPages` (1000 rows a page,
stopping at a short page, null if any page errors), each with a total `.order()` before `.range()`.
`pullSession` SHALL drop rows with a null `subject_key`.

#### Scenario: Exactly one full page

- **WHEN** a table holds exactly 1000 rows for the user
- **THEN** a second request confirms there are no more, and all 1000 are returned

#### Scenario: A later page errors

- **WHEN** the second page returns an error
- **THEN** the whole fetch returns null

Source: `lib/sync/paginatedFetch.ts:31`, `lib/sync/paginatedFetch.ts:40`, `lib/sync/paginatedFetch.ts:45`, `lib/sync/cloud.ts:382`, `lib/sync/cloud.ts:390`, `lib/sync/streak.ts:52`, `lib/sync/gradeLog.ts:172`, `lib/sync/pagination-order.test.ts`.

### Requirement: Per-card merge rule (baseline)

`mergeCloudIntoLocalSilent` SHALL match on `(card_type, subject_key, locale)`. With no `lastPullAt`, a
matched card takes the cloud only if it has no `lastReview` and no `firstSeen`. Otherwise it SHALL keep
local when `lastReview >= lastPullAt.slice(0, 10)`; take the cloud when `updated_at` is absent or later
than `lastPullAt`; and keep local in every other case. Local cards with no cloud row are unchanged.

#### Scenario: First pull, device has progress

- **WHEN** `lastPullAt` is null and the local card has a `lastReview`
- **THEN** the local card is kept over the cloud row

#### Scenario: Another device graded the card since the last pull

- **WHEN** the local `lastReview` is before the pull date and the cloud `updated_at` is later than `lastPullAt`
- **THEN** the card takes the cloud state, keeping in-memory fields such as `learningStep`

#### Scenario: Graded on the pull date on this device

- **WHEN** the local `lastReview` equals the date of `lastPullAt`, whatever the cloud row says
- **THEN** the local card is kept

#### Scenario: Timestamp comparison

- **WHEN** `updated_at` is compared with `lastPullAt`
- **THEN** they are compared as strings, and "The pull cursor" covers a row skipped here

Source: `lib/sync/cloud.ts:507`, `lib/sync/cloud.ts:617`, `lib/sync/cloud.ts:633`, `lib/sync/cloud.ts:646`, `lib/sync/cloud.ts:652`, `lib/sync/cloud.test.ts:511`, `lib/sync/cloud.test.ts:534`, `lib/sync/cloud.test.ts:545`, `lib/sync/cloud.test.ts:557`.

### Requirement: Cloud rows with no local card are added (baseline)

When seed data is passed, a cloud row with no local card SHALL be built from the seed and appended, so
progress in other enrolled languages arrives on a new device. A row whose type or subject cannot be
resolved against the seed SHALL be dropped. On a device with no session, the base session SHALL be
built from settings already applied by this pull.

#### Scenario: Japanese progress on a fresh device

- **WHEN** the session holds only `en` cards and the cloud has a `ja` name row
- **THEN** a `ja` card is appended with the cloud state

#### Scenario: Species not in the seed

- **WHEN** a cloud row names a species the seed lacks
- **THEN** no card is added and the merge continues

Source: `lib/sync/cloud.ts:528`, `lib/sync/cloud.ts:668`, `lib/sync/cloud.ts:679`, `lib/sync/pullAndMerge.ts:331`, `lib/sync/cloud.test.ts:687`, `lib/sync/cloud.test.ts:749`.

### Requirement: A cloud row seen but never reviewed is reset on read (baseline)

A cloud row with `first_seen` set and `last_review` null SHALL be applied as a new card (FSRS fields
zero, `firstSeen` null, `seenInPasture` false, cloud `due_date` kept) with a console warning. Missing
`hidden_since`, `seen_in_pasture` and `locale` SHALL read as null, false and `"en"`.

#### Scenario: In-step row in the cloud

- **WHEN** a pulled row has `first_seen` set and `last_review` null
- **THEN** the card becomes new, and it is not left as introduced but never reviewed

Source: `lib/sync/cloud.ts:433`, `lib/sync/cloud.ts:436`, `lib/sync/cloud.ts:439`, `lib/sync/cloud.ts:441`.

### Requirement: The pull cursor (baseline)

At the end of a pull, `pullAndMerge` SHALL re-read the sync status, then write `lastPullAt` as the
latest `updated_at` among the pulled rows, whether or not the merge applied them, plus
`lastSettingsPullAt`, `lastSeenResetAt` and `ownerUserId`; other fields keep their fresh values.

This looks like a bug: a row skipped once is older than the cursor from then on, so it is never applied
unless the card changes again (#2230).

#### Scenario: Two devices grade the same card on the same day

- **WHEN** this device keeps its local card under the same-day rule, and a later pull carries the same cloud row
- **THEN** the card stays at its local state, on that pull and on later days

#### Scenario: Pull finds no rows

- **WHEN** the user has no `card_reviews` rows
- **THEN** `lastPullAt` is the device clock at that moment

#### Scenario: A push fails while a pull is running

- **WHEN** `markPushFailed` runs between the start and end of a pull
- **THEN** the final write keeps `lastPushFailed` true

#### Scenario: Session save fails

- **WHEN** `saveSession` reports a failure
- **THEN** `pullAndMerge` returns `"error"` and writes no cursor

Source: `lib/sync/pullAndMerge.ts:351`, `lib/sync/pullAndMerge.ts:619`, `lib/sync/pullAndMerge.ts:622`, `lib/sync/cloud.ts:402`.

### Requirement: Cold-load wake-up (baseline)

`pullAndMerge` SHALL dispatch `SYNC_PULL_APPLIED_EVENT` only if local had no session or an entirely
pristine one and the merge changed a `lastReview` or `firstSeen` or added cards.

#### Scenario: Pull lands after the practice page mounted

- **WHEN** the saved session is pristine and the pull brings progress
- **THEN** the event fires so `ReviewSession` refreshes

#### Scenario: Pull during a review

- **WHEN** any local card has progress
- **THEN** the event does not fire

Source: `lib/sync/pullAndMerge.ts:59`, `lib/sync/pullAndMerge.ts:301`, `lib/sync/pullAndMerge.ts:360`, `lib/sync/pullAndMerge.ts:99`.

### Requirement: Settings blob, last write wins (baseline)

Each pull SHALL read the `user_settings` row in one query. A null or empty blob counts as no cloud
settings. A non-empty blob SHALL be applied over `DEFAULT_SETTINGS` when this device has no stored
settings, or the row's `updated_at` is later than `lastSettingsPullAt`, or both are null. The merge
SHALL keep device-local keys and favourite keys the blob lacks, and leave out the two locale sets. A
settings pull failure is non-fatal.

#### Scenario: Cloud settings are newer

- **WHEN** the row's `updated_at` is later than `lastSettingsPullAt`
- **THEN** the blob is applied, `appVisitCount` and `activePokemonNameLocale` stay as they were, and the last-pushed snapshot is saved before `saveSettings`, so the listener sees no difference

#### Scenario: Reset-only row

- **WHEN** the row has `last_reset_at` but an empty blob
- **THEN** no settings are applied and the tombstone check still runs

Source: `lib/sync/settings.ts:204`, `lib/sync/settings.ts:224`, `lib/sync/pullAndMerge.ts:161`, `lib/sync/pullAndMerge.ts:206`, `lib/sync/pullAndMerge.ts:218`, `lib/sync/pullAndMerge.ts:234`, `lib/sync/pullAndMerge.ts:255`, `lib/settings/lastPushedSnapshot.ts:41`, `lib/settings/lastPushedSnapshot.ts:79`.

### Requirement: Settings push sends only changed keys (baseline)

`AutoSyncOnChange` SHALL diff saved settings against the last-pushed snapshot by top-level key, leaving
out device-local keys, and send only a non-empty patch through `merge_user_settings`, which deep-merges
and sets `updated_at`. With no snapshot, keys equal to their default SHALL be left out. The snapshot
SHALL advance only after a successful push. A rejected or failed push warns and waits for the next save.

#### Scenario: First push from a device

- **WHEN** there is no snapshot and a sub-object equals its default
- **THEN** that key is not sent, so it cannot overwrite a richer cloud value

#### Scenario: Push fails

- **WHEN** `pushSettings` returns false
- **THEN** the snapshot stays put and the next save resends those keys

Source: `components/sync/AutoSyncOnChange.tsx:63`, `components/sync/AutoSyncOnChange.tsx:66`, `components/sync/AutoSyncOnChange.tsx:73`, `lib/settings/lastPushedSnapshot.ts:114`, `lib/settings/lastPushedSnapshot.ts:119`, `lib/sync/settings.ts:30`, `db/migrations/037_merge_user_settings_deep.sql:9`, `db/migrations/037_merge_user_settings_deep.sql:14`.

### Requirement: The database refuses settings that lose data (baseline)

A BEFORE UPDATE trigger on `user_settings` SHALL raise 23514 when an update removes a streak spend date,
drops the balance with no new spend, removes a badge, turns off a one-way onboarding flag or lowers an
onboarding counter (unless `onboardingResetAt` advanced), or removes a learning locale not in
`removedLocales`.

#### Scenario: Stale device drops a badge

- **WHEN** an update's `earnedBadges` lacks a badge id the row holds
- **THEN** the update fails with 23514 and `pushSettings` returns false

Source: `db/migrations/038_user_settings_reject_regression_trigger.sql:38`, `db/migrations/038_user_settings_reject_regression_trigger.sql:95`, `db/migrations/038_user_settings_reject_regression_trigger.sql:142`, `db/migrations/038_user_settings_reject_regression_trigger.sql:235`, `db/migrations/038_user_settings_reject_regression_trigger.sql:252`.

### Requirement: Locale sets union across devices (baseline)

On every pull with a cloud blob, `learningLocales` and `removedLocales` SHALL be merged from the values
held before the blob was applied: removed is the union, learning is the union minus removed, with
`"en"` always present and never removable. The active locale SHALL fall back when no longer enrolled.
Only if the cloud lacks the merged sets, and not paused by superuser mode, SHALL the result be pushed
back, fire-and-forget. A change to the active locale alone SHALL NOT push.

#### Scenario: Tombstone on another device

- **WHEN** the cloud lists `ja` in `removedLocales` and this device has `ja` enrolled and active
- **THEN** `ja` leaves the local set and the active locale falls back

#### Scenario: Local enrolment not yet in the cloud

- **WHEN** this device has `zh-Hans` enrolled and the cloud does not, with no tombstone
- **THEN** the union is saved and pushed back

Source: `lib/sync/pullAndMerge.ts:194`, `lib/sync/pullAndMerge.ts:395`, `lib/sync/pullAndMerge.ts:402`, `lib/sync/pullAndMerge.ts:415`, `lib/sync/pullAndMerge.ts:458`, `lib/sync/settings.ts:263`, `lib/sync/settings.ts:280`.

### Requirement: Regional prefs and banner dismissals (baseline)

Each pull SHALL copy non-null `timezone`, `date_format` and `push_notification_hour` columns over local
values and save only on a difference. Invalid values read as null. These columns are written through
their own `update`, which creates no row. Cloud `dismissedMtBannerLocales` SHALL be added to the
standalone localStorage keys, never removing a local dismissal, whenever a blob is present.

#### Scenario: Cloud timezone is null

- **WHEN** the row has a `date_format` and no `timezone`
- **THEN** the date format is applied and the local timezone is kept

#### Scenario: No settings row yet

- **WHEN** `pushRegionalPrefs` runs and the user has no row
- **THEN** nothing is created and it returns true

Source: `lib/sync/pullAndMerge.ts:271`, `lib/sync/pullAndMerge.ts:478`, `lib/sync/pullAndMerge.ts:489`, `lib/sync/settings.ts:77`, `lib/sync/settings.ts:106`, `lib/sync/settings.ts:131`, `lib/sync/settings.ts:136`.

### Requirement: Streak days union across devices (baseline)

`pullAndMerge` SHALL union cloud and local streak dates, sorted and deduplicated, and on a change save
them, dispatch `STREAK_UPDATED_EVENT` and bump the session storage key. `AutoSyncOnChange` SHALL upsert
all local dates on `STREAK_UPDATED_EVENT`, ignoring duplicates. A failure in either direction warns and
never changes the sync result. The database SHALL reject a date later than tomorrow.

#### Scenario: Streak earned on a phone

- **WHEN** the cloud has a date the laptop lacks
- **THEN** the laptop saves the union and open views update

Source: `lib/sync/pullAndMerge.ts:508`, `lib/sync/pullAndMerge.ts:511`, `lib/sync/streak.ts:18`, `lib/sync/streak.ts:65`, `components/sync/AutoSyncOnChange.tsx:81`, `db/migrations/021_streak_days_no_future_date.sql:25`.

### Requirement: Grade log storage (baseline)

The grade log SHALL be stored in IndexedDB, in localStorage when IndexedDB is unavailable, with
`occurredAt` as each entry's key. Legacy entries without one get a deterministic value from their date
and position. If any stored entry fails the shape check, the whole log reads as empty. Only the
localStorage path trims, oldest first, to 4.5 MB, keeping at least 100 entries. Writers fire
`GRADE_LOG_CHANGED_EVENT`; `appendGradeEntry` also fires `GRADE_LOG_APPENDED_EVENT`.

#### Scenario: Legacy entries on one date

- **WHEN** two stored entries for a date have no `occurredAt`
- **THEN** they get noon UTC and noon UTC plus 1 ms

#### Scenario: One corrupt entry

- **WHEN** one stored entry has an invalid grade
- **THEN** `loadGradeLog` returns an empty log

Source: `lib/gradelog/persistence.ts:93`, `lib/gradelog/persistence.ts:99`, `lib/gradelog/persistence.ts:132`, `lib/gradelog/persistence.ts:140`, `lib/gradelog/persistence.ts:175`, `lib/gradelog/persistence.ts:200`, `lib/gradelog/persistence.ts:258`, `lib/gradelog/persistence.ts:305`, `lib/gradelog/persistence.test.ts`.

### Requirement: Grade log push and pull (baseline)

A new entry that is not held SHALL be pushed from `GRADE_LOG_APPENDED_EVENT`. Grade-log upserts SHALL
use `(user_id, occurred_at)` with duplicates ignored, through one column mapping. A push result SHALL be
`"rejected"` only for SQLSTATE class 22 or 23, otherwise `"failed"`. Each pull SHALL union the cloud log
by `occurredAt`, local winning a tie, and save and notify only when the length changes. A failure warns
and never changes the sync result.

#### Scenario: RLS denial is not a row rejection

- **WHEN** an upsert fails with 42501
- **THEN** the result is `"failed"`, not `"rejected"`

#### Scenario: Cloud adds nothing

- **WHEN** every cloud entry's `occurredAt` is already local
- **THEN** nothing is written and no event fires

Source: `components/sync/AutoSyncOnChange.tsx:93`, `lib/sync/gradeLogPush.ts:17`, `lib/sync/gradeLog.ts:17`, `lib/sync/gradeLog.ts:38`, `lib/sync/gradeLog.ts:110`, `lib/sync/gradeLog.ts:112`, `lib/sync/gradeLog.ts:207`, `lib/sync/pullAndMerge.ts:551`, `lib/sync/pullAndMerge.ts:560`, `db/migrations/006_grade_log.sql:18`.

### Requirement: Grade log re-push (baseline)

After a successful `pullGradeLog`, and not under superuser mode, `pullAndMerge` SHALL push local entries
the cloud lacks. It SHALL send oldest first, at most 1000 rows and 25 requests a cycle, 200 rows a request.
A rejected batch SHALL be bisected, and a single rejected row remembered for this page load. A
`"failed"` result SHALL stop the leg for the cycle and remember nothing.

#### Scenario: One poisoned row in a batch

- **WHEN** the server rejects a batch of 200 with one bad row
- **THEN** the batch is halved until the bad row stands alone, the others land, and it is not retried this page load

#### Scenario: Server error mid-cycle

- **WHEN** a request returns a 5xx
- **THEN** the leg stops, nothing is blacklisted, and the entries wait for a later cycle

#### Scenario: Grade pull failed

- **WHEN** `pullGradeLog` returns null
- **THEN** nothing is re-pushed

#### Scenario: Entries left out

- **WHEN** an entry fails `isGradeLogEntry`, is dated before the UTC date of `last_reset_at`, is held in this tab, is not older than `HELD_COPY_STALE_MS`, or was rejected this page load
- **THEN** it is not sent this cycle

Source: `lib/sync/pullAndMerge.ts:576`, `lib/sync/gradeLogRepush.ts:20`, `lib/sync/gradeLogRepush.ts:23`, `lib/sync/gradeLogRepush.ts:26`, `lib/sync/gradeLogRepush.ts:33`, `lib/sync/gradeLogRepush.ts:50`, `lib/sync/gradeLogRepush.ts:74`, `lib/sync/gradeLogRepush.ts:112`, `lib/sync/gradeLogRepush.ts:137`, `lib/sync/gradeLogRepush.ts:141`, `lib/sync/gradeLogRepush.test.ts:125`, `lib/sync/gradeLogRepush.test.ts:189`.

### Requirement: Per-grade push queue (baseline)

`enqueueGrade` SHALL coalesce by card id and locale, push on a 200 ms debounce and persist on a 500 ms
debounce. An in-step card (`firstSeen` set, `lastReview` null) SHALL NOT be queued. With no client or
user it SHALL clear the persisted queue and queue nothing. A drain SHALL push each card, keep the
failed ones and any re-graded mid-flight, and stamp `lastPushAt` on any success. On mount the hook SHALL
seed from the persisted queue and drain. Open item held in ops #417.

#### Scenario: Offline for three drains

- **WHEN** three drains in a row all fail
- **THEN** `markPushFailed` runs once on the third, Background Sync is registered, and the queue stays persisted

#### Scenario: Cloud row is newer

- **WHEN** `pushSingleCard` returns `"rejected"`
- **THEN** the card leaves the queue and no failure is counted

#### Scenario: App closed with cards queued

- **WHEN** the tab was killed with a persisted queue and `lastPushFailed` false
- **THEN** the next mount seeds the queue and drains it

Source: `lib/sync/usePerGradeSync.ts:35`, `lib/sync/usePerGradeSync.ts:188`, `lib/sync/usePerGradeSync.ts:196`, `lib/sync/usePerGradeSync.ts:255`, `lib/sync/usePerGradeSync.ts:270`, `lib/sync/usePerGradeSync.ts:293`, `lib/sync/usePerGradeSync.ts:316`, `lib/sync/usePerGradeSync.ts:351`, `lib/sync/usePerGradeSync.ts:495`, `lib/sync/usePerGradeSync.ts:553`, `lib/sync/usePerGradeSync.ts:584`, `lib/sync/cloud.ts:94`, `lib/sync/cloud.ts:287`, `components/sync/usePerGradeSync.test.tsx`, `components/sync/loadPendingQueue.test.tsx`.

### Requirement: Queue persistence and its IndexedDB mirror (baseline)

`savePendingQueue` SHALL write `ReviewableCard[]` to localStorage and mirror it, fire-and-forget, to
IndexedDB as `CloudRow[]` for the service worker. `clearPendingQueue` SHALL remove both. On load, array
entries without `id`, `cardType`, `subjectKey` and an object `state` SHALL be dropped individually.

#### Scenario: Partly corrupt queue

- **WHEN** a stored queue has one entry with no `state`
- **THEN** that entry is dropped and the others load

Source: `lib/sync/persistence.ts:202`, `lib/sync/persistence.ts:217`, `lib/sync/persistence.ts:240`, `lib/sync/persistence.ts:249`, `lib/sync/persistence.ts:257`, `lib/sync/cloud.ts:196`, `components/sync/persistedGradeQueue.test.tsx`.

### Requirement: Undo hold (baseline)

A grade enqueued with `hold: true` SHALL stay out of the shared queue and its mirror, with a per-tab
localStorage copy, until the next held grade, unmount, 30 seconds hidden, pagehide, or 300 seconds from
grading. On commit the card joins the queue and its grade-log entry is pushed. The session fallback
SHALL skip held cards. A leftover copy SHALL count as committed only for the same user, and only if left
by this tab or older than `HELD_COPY_STALE_MS` (330 seconds).

#### Scenario: Undo inside the window

- **WHEN** the player undoes a held grade
- **THEN** the card and its grade-log entry never reach the cloud

#### Scenario: Reload during a hold

- **WHEN** the same tab reloads with a held copy for the same user
- **THEN** the grade is queued as committed and drained

#### Scenario: Another tab's live hold

- **WHEN** a mount finds another tab's copy younger than 330 seconds
- **THEN** it is left alone

#### Scenario: Sync goes away mid-hold

- **WHEN** a hold commits after sign-out or with a superuser flag on
- **THEN** the slot and copy are cleared and nothing is pushed

#### Scenario: In-step grade

- **WHEN** a held card is in-step
- **THEN** only its grade-log entry is held

Source: `lib/sync/heldGrade.ts:38`, `lib/sync/heldGrade.ts:47`, `lib/sync/heldGrade.ts:54`, `lib/sync/heldGrade.ts:148`, `lib/sync/heldGrade.ts:186`, `lib/sync/heldGrade.ts:223`, `lib/sync/usePerGradeSync.ts:386`, `lib/sync/usePerGradeSync.ts:419`, `lib/sync/usePerGradeSync.ts:451`, `lib/sync/usePerGradeSync.ts:559`, `lib/sync/pushWithFallback.ts:141`, `lib/gradelog/persistence.ts:246`, `components/sync/undoHoldAcceptance.test.tsx`, `components/sync/undoHoldTabsAndUsers.test.tsx`, `components/sync/usePerGradeSyncHold.test.tsx`.

### Requirement: Unload safety net (baseline)

On hide, when unsynced cards exist and no earlier hide push is running, the hook SHALL persist them and
POST to `/api/sync` with `fetch` keepalive. On pagehide, never skipped, it SHALL commit the hold and call
`sendBeacon` with the cards and the held grade-log entry; `queued` true counts as success, since the
response cannot be read.

#### Scenario: Beacon accepted, server fails

- **WHEN** the browser queues the beacon and the route later answers 502
- **THEN** the device has recorded success and cleared the persisted queue

#### Scenario: Offline on hide

- **WHEN** the keepalive `fetch` throws
- **THEN** `lastPushFailed` is set and Background Sync is registered

#### Scenario: Keepalive push succeeds

- **WHEN** the `fetch` answers 2xx
- **THEN** the persisted queue and the failure are cleared

#### Scenario: Keepalive push answers 409

- **WHEN** the `fetch` answers 409 with a structural code
- **THEN** the code is recorded, as well as `lastPushFailed` and `failedCardCount`, and Background Sync is registered

Source: `lib/sync/useSyncOnUnload.ts:59`, `lib/sync/useSyncOnUnload.ts:69`, `lib/sync/useSyncOnUnload.ts:96`, `lib/sync/useSyncOnUnload.ts:106`, `lib/sync/useSyncOnUnload.ts:114`, `lib/sync/useSyncOnUnload.ts:136`, `lib/sync/useSyncOnUnload.ts:143`, `lib/sync/useSyncOnUnload.ts:175`, `lib/sync/cloud.ts:415`, `components/sync/useSyncOnUnload.test.tsx`.

### Requirement: Sync route (baseline)

`POST /api/sync` SHALL check the body before auth: invalid JSON or non-array `cards` answers 400. No
session answers 401. The server SHALL set `user_id` from the session, default `locale` to `"en"`, omit
`updated_at`, and omit `seen_in_pasture` when absent. Cards SHALL go in batches of 200, each tried up to 3
times 100 ms apart, answering 200 when all land. Per-row reporting after the fallback is wrong today
(#2206).

#### Scenario: Not signed in

- **WHEN** a valid body arrives with no session
- **THEN** the route answers 401 and writes nothing

#### Scenario: One transient failure

- **WHEN** the first upsert fails with a generic error and the second succeeds
- **THEN** the route answers 200

#### Scenario: Schema mismatch

- **WHEN** an upsert returns 42P10
- **THEN** no retry runs and the route answers 409 `structural_error` with that code

#### Scenario: Regression trigger rejects a batch

- **WHEN** a batch upsert returns 23514
- **THEN** its rows are upserted one by one and 23514 rows are skipped

#### Scenario: A batch lands nothing

- **WHEN** a batch runs out of retries, or no row lands after the fallback
- **THEN** the route answers 502 `partial_failure`

#### Scenario: Non-object entry in cards

- **WHEN** an entry in `cards` is null
- **THEN** the route throws and answers an unhandled 500, because row shapes are not validated (#2232)

Source: `app/api/sync/route.ts:44`, `app/api/sync/route.ts:52`, `app/api/sync/route.ts:105`, `app/api/sync/route.ts:117`, `app/api/sync/route.ts:123`, `app/api/sync/route.ts:146`, `app/api/sync/route.ts:157`, `app/api/sync/route.ts:168`, `app/api/sync/route.ts:182`, `app/api/sync/route.ts:204`, `app/api/sync/route.ts:224`, `app/api/sync/route.ts:234`, `app/api/sync/route.test.tsx:111`, `app/api/sync/route.test.tsx:253`, `app/api/sync/route.test.tsx:278`.

### Requirement: Beacon grade-log leg (baseline)

The route SHALL treat `gradeLog` as untrusted and best-effort: a non-array is ignored, entries failing
`isGradeLogEntry` are dropped, at most 200 are kept, and they are upserted with duplicates ignored. It
SHALL start alongside the card leg, be awaited on every return, and never change the response.

#### Scenario: Grade log fails, cards succeed

- **WHEN** the `grade_log` upsert errors
- **THEN** the route still answers 200

#### Scenario: Cards hit a structural error

- **WHEN** the card leg returns 409
- **THEN** valid grade-log entries are still written

Source: `app/api/sync/route.ts:24`, `app/api/sync/route.ts:63`, `app/api/sync/route.ts:66`, `app/api/sync/route.ts:72`, `lib/sync/gradeLog.ts:70`, `app/api/sync/routeGradeLog.test.tsx:128`, `app/api/sync/routeGradeLog.test.tsx:185`, `app/api/sync/routeGradeLog.test.tsx:216`.

### Requirement: Reconnect catch-up pulls first (baseline)

On `online` or a replay message, with one run at a time, the hook SHALL reset the structural probe and
pull. If the pull errors it SHALL stop. If `lastPushFailed` is false it SHALL stop. Otherwise it SHALL
push through `pushWithFallback` and clear the failure only when every card succeeded. A replay message
SHALL be ACKed on its port before the run starts.

#### Scenario: Pull fails on reconnect

- **WHEN** `pullAndMerge` returns `"error"`
- **THEN** no push is attempted

#### Scenario: Partial failure

- **WHEN** some cards fail to push
- **THEN** `lastPushFailed` stays true

Source: `lib/sync/useOnlineReconnectSync.ts:66`, `lib/sync/useOnlineReconnectSync.ts:75`, `lib/sync/useOnlineReconnectSync.ts:80`, `lib/sync/useOnlineReconnectSync.ts:88`, `lib/sync/useOnlineReconnectSync.ts:102`, `lib/sync/useOnlineReconnectSync.ts:160`, `components/sync/useOnlineReconnectSync.test.tsx`.

### Requirement: Retry button pushes without pulling (baseline)

`retryNow` SHALL do nothing with no client or user, while a retry runs, when `lastPushFailed` is false,
or when a structural error is recorded. With `failedCardCount` 0 and no persisted queue it SHALL clear
the failure with no request. Otherwise it SHALL call `pushWithFallback` with no pull first. Success, or
nothing left to push, clears the failure; a failure keeps the flag and stamps `lastPushAttemptAt`.

#### Scenario: Structural error recorded

- **WHEN** `retryNow` runs with `structuralSyncError` set
- **THEN** no push is attempted

Source: `lib/sync/useRetryPush.ts:62`, `lib/sync/useRetryPush.ts:69`, `lib/sync/useRetryPush.ts:76`, `lib/sync/useRetryPush.ts:118`, `lib/sync/useRetryPush.ts:135`, `lib/sync/useRetryPush.ts:158`, `components/sync/useRetryPush.test.tsx`.

### Requirement: Shared push engine (baseline)

`pushWithFallback` SHALL push a non-empty persisted queue exactly, then slim it to the failed cards or
clear it; `"rejected"` cards are not retried. With no queue it SHALL use session cards with a
`lastReview`, skipping held ones, narrowed to cards reviewed today when `failedCardCount` is above 0
(all reviewed if none match). "Today" here is the UTC date. With `skipSessionWhenCountZero` and a zero
count it does nothing.

#### Scenario: Partial queue success

- **WHEN** two of three queued cards land
- **THEN** the persisted queue holds only the third

#### Scenario: Returning the next day

- **WHEN** `failedCardCount` is 2 with no queue and no card reviewed today
- **THEN** every reviewed card is pushed

Source: `lib/sync/pushWithFallback.ts:80`, `lib/sync/pushWithFallback.ts:96`, `lib/sync/pushWithFallback.ts:105`, `lib/sync/pushWithFallback.ts:114`, `lib/sync/pushWithFallback.ts:126`, `lib/sync/pushWithFallback.ts:135`, `lib/sync/pushWithFallback.ts:152`, `lib/review/session.ts:503`, `lib/sync/pushWithFallback.test.ts`.

### Requirement: Background Sync replay (baseline)

When a browser supports Background Sync, a failed push SHALL register `poke-memory:grade-sync`. On that
event the service worker SHALL ask controlled window clients to run the catch-up and return on the first
ACK. With no client or no ACK in time, it SHALL POST the IndexedDB queue to `/api/sync`. It clears the
mirror on 2xx, 401 or 403, and throws on a network error or any other status, so the browser retries.
Retrying a 400 or 409 is tracked in #2209. Elsewhere registration is a no-op.

#### Scenario: All tabs closed

- **WHEN** connectivity returns with no window client and a queue in IndexedDB
- **THEN** the worker POSTs the rows and clears the mirror on success

#### Scenario: Session expired

- **WHEN** the replay gets 401
- **THEN** the mirror is cleared and the event resolves

#### Scenario: Firefox or Safari

- **WHEN** `SyncManager` is absent
- **THEN** registration does nothing and the reconnect path remains

Source: `lib/sync/backgroundSync.ts:25`, `lib/sync/backgroundSync.ts:39`, `lib/sync/backgroundSync.ts:58`, `app/sw.ts:627`, `app/sw.ts:636`, `app/sw.ts:644`, `app/sw.ts:677`, `app/sw.ts:699`, `app/sw.ts:709`, `app/sw.ts:716`, `lib/sync/backgroundSync.test.ts:61`, `lib/sync/swReplay.test.ts`.

### Requirement: Sync status (baseline)

`SyncStatus` SHALL live in localStorage, with a field of the wrong type read as its default. Every save
SHALL dispatch a same-tab `StorageEvent`. `markPushSucceeded` SHALL NOT clear `failedCardCount` or
`structuralSyncError`, and `markPushFailed` SHALL NOT clear `lastPushAt`. Auxiliary pushes call
`markPushSucceeded`, so any leg's success clears `lastPushFailed` and stamps `lastPushAt`.

#### Scenario: Corrupt field

- **WHEN** stored `lastPullAt` is a number
- **THEN** it reads as null and the other fields survive

#### Scenario: Streak push succeeds during a card failure

- **WHEN** `lastPushFailed` is true and a streak push succeeds
- **THEN** `lastPushFailed` becomes false

Source: `lib/sync/persistence.ts:83`, `lib/sync/persistence.ts:87`, `lib/sync/persistence.ts:129`, `lib/sync/persistence.ts:142`, `lib/sync/persistence.ts:157`, `components/sync/AutoSyncOnChange.tsx:86`, `lib/sync/gradeLogPush.ts:24`, `lib/sync/persistence.test.ts`.

### Requirement: Structural errors stop retries (baseline)

On `card_reviews` pushes, SQLSTATE 42xxx, 23505 and 23503 SHALL count as structural; 23514 and `PGRST*`
SHALL NOT. A structural error SHALL be recorded at once with `lastPushFailed`, and only a successful
`card_reviews` push clears it. While one is recorded, drains SHALL stop, apart from one probe per app
load, reset by the `online` event. `pushSession` has no row-by-row fallback: a 23514 fails its batch.

#### Scenario: Deploy fixes a mismatch

- **WHEN** a structural error is recorded and the app's one probe push succeeds
- **THEN** the error clears

#### Scenario: Probe already used

- **WHEN** a second drain runs in the same app load with the error still recorded
- **THEN** it returns without pushing

Source: `lib/sync/cloud.ts:69`, `lib/sync/cloud.ts:238`, `lib/sync/cloud.ts:256`, `lib/sync/cloud.ts:325`, `lib/sync/cloud.ts:342`, `lib/sync/structuralError.ts:38`, `lib/sync/structuralError.ts:126`, `lib/sync/structuralError.ts:143`, `lib/sync/usePerGradeSync.ts:209`, `lib/sync/structuralError.test.ts`.

### Requirement: Database guards on card rows (baseline)

`card_reviews` SHALL be keyed by `(user_id, card_type, subject_key, locale)`, the column list every
upsert uses. A BEFORE UPDATE trigger SHALL raise 23514 when `last_review` or `first_seen` becomes null,
`last_review` moves back, `reps` or `lapses` fall, `scheduled_days` falls on the same `last_review`, or
`seen_in_pasture` goes from true to false. A second trigger SHALL set `updated_at` to server time on
every update. Row-level security SHALL limit each table to its own user.

#### Scenario: A stale device writes lower reps

- **WHEN** an update has `reps` below the stored value
- **THEN** it fails with 23514 and the row is unchanged

#### Scenario: Client sends no timestamp

- **WHEN** a push updates a row
- **THEN** `updated_at` is the server's time

Source: `lib/sync/cloud.ts:41`, `db/migrations/029_card_reviews_locale.sql:27`, `db/migrations/029_card_reviews_locale.sql:36`, `db/migrations/029_card_reviews_locale.sql:67`, `db/migrations/029_card_reviews_locale.sql:81`, `db/migrations/017_card_reviews_pasture_one_way.sql:74`, `db/migrations/043_card_reviews_updated_at_trigger.sql:36`, `db/migrations/001_initial_sync_schema.sql:23`, `lib/sync/integration/regression-trigger.test.ts`, `lib/sync/integration/onconflict-pk-parity.test.ts`.

### Requirement: Resetting progress (baseline)

`reset_all_progress` SHALL require a session, refuse a repeat within 5 seconds, delete the user's
`card_reviews`, `grade_log` and `streak_days` rows, and stamp `last_reset_at`, keeping settings.
`resetAllProgressEverywhere` SHALL do this first and clear local only on success. A pull seeing
`last_reset_at` later than `lastSeenResetAt`, or with that cursor null, SHALL clear local before merging.

This looks like a bug: the device that made the reset clears itself again on its next pull (#2231).

#### Scenario: Cloud reset fails

- **WHEN** the RPC errors
- **THEN** local stays intact and the result is `cloud-reset-failed`

#### Scenario: Reset on another device

- **WHEN** a pull sees a newer `last_reset_at`
- **THEN** local progress is cleared before the merge and the new value is stored as `lastSeenResetAt`

#### Scenario: Reset on this device, then a pull

- **WHEN** this device reset, then a later pull runs
- **THEN** local progress is cleared a second time, because the local clear also removed `lastSeenResetAt`

#### Scenario: Stale row after a reset

- **WHEN** a row is inserted dated before the UTC date of `last_reset_at`
- **THEN** the INSERT trigger raises 23514

Source: `db/migrations/026_reset_all_progress_cooldown.sql:28`, `db/migrations/026_reset_all_progress_cooldown.sql:45`, `db/migrations/026_reset_all_progress_cooldown.sql:54`, `db/migrations/022_user_settings_last_reset_at_tombstone_triggers.sql:68`, `db/migrations/022_user_settings_last_reset_at_tombstone_triggers.sql:133`, `lib/sync/reset.ts:50`, `lib/sync/pullAndMerge.ts:174`, `lib/sync/pullAndMerge.ts:624`, `lib/storage/reset.ts:18`, `lib/sync/pullAndMerge.test.ts:741`.

### Requirement: Deleting an account (baseline)

`deleteAccountEverywhere` SHALL call `delete_account` first; on success it SHALL clear local progress
and sweep every `poke-memory:*` key, settings included. The foreign keys cascade to the user's rows.

#### Scenario: Delete fails

- **WHEN** the RPC errors
- **THEN** local data stays and the result is `cloud-delete-failed`

Source: `lib/sync/deleteAccount.ts:41`, `lib/sync/deleteAccount.ts:77`, `db/migrations/027_delete_account_rpc.sql:40`, `db/migrations/027_delete_account_rpc.sql:57`, `lib/sync/deleteAccount.test.ts`.

### Requirement: Switching account on a device (baseline)

Before the sign-in pull, `guardAccountSwitch` SHALL compare `ownerUserId` with the incoming user. Null
or equal does nothing. On a different user it SHALL archive the outgoing state, clear its local data
(settings included, device-level keys and archives kept), restore the incoming user's archive, and stamp
fresh cursors unless the archive restored that owner. Open item held in ops #417.

#### Scenario: Guest signs in

- **WHEN** `ownerUserId` is null
- **THEN** the guard does nothing and the sign-in callback stamps the owner

#### Scenario: Returning user on a shared device

- **WHEN** user A signs in after user B, and A has an archive
- **THEN** B is archived, A's data and cursors are restored, and the pull continues from them

#### Scenario: Archive fails

- **WHEN** `archiveUserData` fails
- **THEN** a warning is logged and the switch continues (#2208)

Source: `lib/sync/guardAccountSwitch.ts:66`, `lib/sync/guardAccountSwitch.ts:109`, `lib/sync/guardAccountSwitch.ts:114`, `lib/sync/guardAccountSwitch.ts:120`, `lib/sync/guardAccountSwitch.ts:130`, `lib/sync/guardAccountSwitch.ts:139`, `lib/sync/guardAccountSwitch.ts:171`, `lib/storage/userArchive.ts:90`, `lib/storage/userArchive.ts:145`, `lib/sync/guardAccountSwitch.test.ts:135`, `lib/sync/guardAccountSwitch.test.ts:214`, `lib/sync/integration/account-switch.test.ts`.
