## MODIFIED Requirements

### Requirement: Streak dates sync as a one-way-growing set (baseline)

`pushStreak` SHALL upsert every local date into `streak_days`, ignoring duplicates, `pullStreak` SHALL page through all rows by date, and `mergeStreak` SHALL union and sort, so a background pull never removes a date. Force pull, choosing cloud at sign-in and leaving superuser mode SHALL replace the local list instead. Only `AutoSyncOnChange` and the keep-local sign-in choice SHALL push. Failures SHALL NOT interrupt anything. Spend dates SHALL travel in settings, not `streak_days`.

#### Scenario: A new streak day on a signed-in device

- **WHEN** `poke-memory:streak-updated` fires
- **THEN** `AutoSyncOnChange` pushes the full local list, and a failure waits for the next new streak day

#### Scenario: A second device

- **WHEN** a pull finds dates this device lacks
- **THEN** the union is saved, the event fires and the session key is bumped so an open Stats page reloads (`lib/sync/pullAndMerge.ts:508-531`)

#### Scenario: Guest

- **WHEN** no user is signed in
- **THEN** dates stay on the device, because `AutoSyncOnChange` has no client to push with

#### Scenario: Signing in with local progress

- **WHEN** the player chooses at sign-in between local and cloud progress
- **THEN** keeping local pushes every local date, and keeping cloud replaces the local list (`app/auth/callback-complete/page.tsx:279`, `:334`)

#### Scenario: Force pull

- **WHEN** the cloud list lacks a date this device holds
- **THEN** Force pull drops that date without firing `poke-memory:streak-updated` (`components/settings/ForcePullSection.tsx:93`), and so does leaving superuser mode, by design (`lib/superuser/SuperuserContext.tsx:176-181`)

#### Scenario: Another account on a shared device

- **WHEN** a different user signs in
- **THEN** the outgoing user's dates go into their per-user archive and return if they sign in again (`lib/storage/userArchive.ts:1-8`, `:55`)

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on
- **THEN** the page passes a null client and user to `useRetryPush`, cloud writes stay suppressed and pulls continue (`AGENTS.md:72`)

#### Scenario: Push and pull failures

- **WHEN** the data gateway returns an error, or the device is offline
- **THEN** push gives `false` and pull gives `null` (`lib/sync/streak.test.ts:64`, `:90`), and a pull orders by date before ranging (`:83`)

#### Scenario: Nothing to push

- **WHEN** the date list is empty
- **THEN** `pushStreak` returns `true` with no request (`lib/sync/streak.test.ts:57`)

#### Scenario: A date too far ahead

- **WHEN** a pushed date is later than `current_date + 1`
- **THEN** the D1 trigger rejects it (`db/migrations/021_streak_days_no_future_date.sql:25-27`)

Source: `lib/sync/streak.ts:15`, `lib/sync/streak.ts:18-36`, `lib/sync/streak.ts:38-60`, `lib/sync/streak.ts:65-68`, `components/sync/AutoSyncOnChange.tsx:81-90`, `db/migrations/021_streak_days_no_future_date.sql:25-27`, `app/stats/page.tsx:217-219`.

### Requirement: Protection state lives in settings and is parsed defensively (baseline)

`StreakProtection` SHALL live in the settings blob, so it follows settings sync. `validateStreakProtection` SHALL never throw: bad fields SHALL take defaults, the balance SHALL clamp to `MAX_BALANCE`, `spendDates` SHALL keep only valid dates, sorted and unique, and bad events SHALL drop. Each append SHALL cap events at `MAX_PROTECTION_EVENTS` (10), but `spendDates` SHALL have no cap. Cloud pushes SHALL be deep-merged by the Worker's settings merge, which SHALL protect spend dates and balance.

#### Scenario: Corrupt state

- **WHEN** the stored value is not an object or holds bad fields
- **THEN** defaults are used per field (`lib/streak/tokens.test.ts:20`, `:31`, `:37`, `:48`)

#### Scenario: Event cap

- **WHEN** an eleventh event is added
- **THEN** the oldest is dropped (`lib/streak/tokens.test.ts:630`)

#### Scenario: A stale device pushes protection

- **WHEN** a settings push would remove a spend date from the cloud row, or lower the balance without adding one
- **THEN** the settings merge refuses it with `23514`, the push reports failure and it is retried on the next settings save (`components/sync/AutoSyncOnChange.tsx:63-75`)

Source: `lib/streak/tokens.ts:37`, `lib/streak/tokens.ts:59-96`, `lib/streak/tokens.ts:113-187`, `lib/streak/tokens.ts:398-401`, `lib/settings/persistence.ts:426`, `lib/settings/persistence.ts:905`, planned `lib/db/rpc/mergeUserSettings.ts` (rules from `db/migrations/038_user_settings_reject_regression_trigger.sql:78-100`).
