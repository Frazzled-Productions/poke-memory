# feedback-and-operator-tools Specification

## Purpose
How players send feedback and how the maintainer hears about it and operates the app: the feedback
form and route, the Discord notification and digest, superuser mode and its Developer section, QA
seed scenarios, Sentry error reporting, and the two utility pages. This is the baseline: current
behaviour on `qa` at d2456f44, written from code and tests, not what it should be. A requirement that
records behaviour which looks wrong says so and names the issue. Line references are to that commit.
The cloud QA seed scripts in `scripts/qa-seed*` are out of scope.

## Requirements

### Requirement: Reaching the feedback form (baseline)

Settings SHALL show a "Send feedback" row above the accordions, to guests and signed-in players alike,
which opens the modal. While the Settings search is filtering, the row SHALL show only if it matches.
The modal SHALL stay mounted on the page and be driven by its `open` prop.

#### Scenario: Guest opens the form

- **WHEN** a guest presses the row's button
- **THEN** the dialog opens through `showModal()`, with no auth context needed

#### Scenario: Search does not match

- **WHEN** the Settings search is filtering and `feedback-row` is not among the visible sections
- **THEN** the row is not rendered

Source: `app/settings/page.tsx:890`, `app/settings/page.tsx:906`, `app/settings/page.tsx:2308`, `components/feedback/FeedbackModal.tsx:54`, `components/feedback/FeedbackModal.test.tsx:400`.

### Requirement: Feedback form fields and validation (baseline)

The modal SHALL offer a required category (bug, feature, other), an optional page chosen from a fixed
list (`/`, `/pokedex`, `/pasture`, `/stats`, `/journey`, `/settings`, `other`), a message of up to 2000
characters with a live counter, and a privacy notice. Submit SHALL be disabled without a category, with
a message that is empty after trimming, over the limit, or while a request is in flight. Text comes from
`settings.feedback` messages in every locale.

#### Scenario: No category

- **WHEN** the player types a message but has not chosen a category
- **THEN** Submit stays disabled

#### Scenario: Typing past the limit

- **WHEN** the player types or pastes past 2000 characters
- **THEN** the textarea's `maxLength` stops the text at 2000, so the state below needs a value set by code

#### Scenario: Message over the limit

- **WHEN** the value is set past 2000 characters by code, as the test does
- **THEN** Submit is disabled and the counter turns red

#### Scenario: Non-English locale

- **WHEN** the modal renders in `ja`, `zh-Hans` or `zh-Hant`
- **THEN** its labels and privacy notice are localised

Source: `components/feedback/FeedbackModal.tsx:8`, `components/feedback/FeedbackModal.tsx:21`, `components/feedback/FeedbackModal.tsx:199`, `components/feedback/FeedbackModal.tsx:233`, `components/feedback/FeedbackModal.tsx:238`, `components/feedback/FeedbackModal.tsx:251`, `components/feedback/FeedbackModal.tsx:277`, `components/feedback/FeedbackModal.test.tsx:136`, `components/feedback/FeedbackModal.test.tsx:174`, `components/feedback/FeedbackModal.test.tsx:425`.

### Requirement: Submitting feedback from the form (baseline)

Submit, or Cmd/Ctrl+Enter from the message field, SHALL POST `category`, `message`, `page` and
`appVersion` to `/api/feedback`. A blank page SHALL be sent as null; the current pathname is not sent.
A 2xx response SHALL replace the form with the success state. Any other response, or a network error, SHALL
show one inline error and keep the form and its text for a retry.

#### Scenario: Cmd/Ctrl+Enter over the limit

- **WHEN** the value is over 2000 characters and the player presses Cmd/Ctrl+Enter
- **THEN** the first 2000 characters are sent, because this path skips the over-limit check

#### Scenario: Privacy wording

- **WHEN** a player reads about what feedback records
- **THEN** the modal's notice only asks for no personal data, and the `/privacy` page still lists the page pathname (ops #427)

#### Scenario: Page left blank

- **WHEN** the player submits without choosing a page
- **THEN** the body has `page: null`

#### Scenario: Server error

- **WHEN** the route answers 500
- **THEN** the inline alert shows, the dialog stays open, and the fields stay enabled

#### Scenario: Offline

- **WHEN** `fetch` rejects
- **THEN** the same inline alert shows and the form stays open

Source: `components/feedback/FeedbackModal.tsx:88`, `components/feedback/FeedbackModal.tsx:89`, `components/feedback/FeedbackModal.tsx:93`, `components/feedback/FeedbackModal.tsx:100`, `components/feedback/FeedbackModal.tsx:105`, `components/feedback/FeedbackModal.tsx:118`, `components/feedback/FeedbackModal.tsx:269`, `next.config.ts:34`, `app/privacy/page.tsx:287`, `components/feedback/FeedbackModal.test.tsx:189`, `components/feedback/FeedbackModal.test.tsx:277`, `components/feedback/FeedbackModal.test.tsx:305`, `components/feedback/FeedbackModal.test.tsx:331`, `components/feedback/FeedbackModal.test.tsx:356`.

### Requirement: Closing the feedback form (baseline)

Closing SHALL reset all form state. Cancel is disabled during a submit, but Escape still closes the dialog
and the request carries on. Its result lands on the closed modal, which looks wrong (#2304).

#### Scenario: Escape during a submit

- **WHEN** the player presses Escape with a request in flight, the request succeeds, and they reopen the modal
- **THEN** the success state shows instead of the form (#2304)

#### Scenario: Escape during a submit that fails

- **WHEN** the player presses Escape with a request in flight, the request fails, and they reopen the modal
- **THEN** the empty form shows with the old inline error (#2304)

#### Scenario: Close after typing

- **WHEN** the player cancels with text in the form and reopens it
- **THEN** the form is empty

Source: `components/feedback/FeedbackModal.tsx:65`, `components/feedback/FeedbackModal.tsx:80`, `components/feedback/FeedbackModal.tsx:106`, `components/feedback/FeedbackModal.tsx:108`, `components/feedback/FeedbackModal.tsx:269`.

### Requirement: Feedback route input handling (baseline)

`POST /api/feedback` SHALL check configuration first, answering 500 `misconfigured` without its D1
binding. It SHALL answer 400 `invalid_json` for an unparseable body, 400 `invalid_category` for anything
but bug, feature or other, and 400 `missing_message` for a non-string or blank message. A body of
literal JSON `null` parses, then throws an unhandled `TypeError` at the category check, which looks
wrong (held in ops #442).

#### Scenario: Blank message

- **WHEN** the message is only whitespace
- **THEN** the route answers 400 `missing_message`

#### Scenario: Unknown category

- **WHEN** the category is `praise`
- **THEN** the route answers 400 `invalid_category`

#### Scenario: Body is literal null

- **WHEN** the body is the JSON value `null`
- **THEN** the handler throws before the rate limit and no row is inserted (ops #442)

Source (planned): `app/api/feedback/route.ts`, `lib/api/parseJsonBody.ts:19`; tests
`app/api/feedback/route.test.tsx`.

### Requirement: Feedback field limits (baseline)

A longer message SHALL be cut to 2000 characters, not refused, and stored untrimmed. `page` and `appVersion`
SHALL be cut to 300 characters, and any non-string or empty value becomes null. Neither is checked against
a list (open item held in ops #407).

#### Scenario: Long message

- **WHEN** the message is 2500 characters
- **THEN** the first 2000 are inserted and the route answers 200

#### Scenario: Optional fields missing

- **WHEN** `page` and `appVersion` are absent
- **THEN** both are inserted as null

Source: `app/api/feedback/route.ts:70`, `app/api/feedback/route.ts:73`, `app/api/feedback/route.ts:77`, `app/api/feedback/route.test.tsx:195`, `app/api/feedback/route.test.tsx:329`.

### Requirement: Feedback identity comes from the session (baseline)

The route SHALL take `user_id` only from the Better Auth session read from the request, ignoring any
`user_id` in the body. A guest, or a failure reading the session, SHALL insert a null `user_id` and
carry on.

#### Scenario: Spoofed id

- **WHEN** a guest sends `user_id` in the body
- **THEN** the row is inserted with `user_id` null

#### Scenario: Session read throws

- **WHEN** reading the session throws
- **THEN** the row is still inserted, with `user_id` null

Source (planned): `app/api/feedback/route.ts`, `lib/auth/server.ts`; tests
`app/api/feedback/route.test.tsx`.

### Requirement: Feedback rate limit (baseline)

After validation and identity, the route SHALL check the D1 rate-limit buckets with action `feedback`
and a salted hash of Cloudflare's `cf-connecting-ip` header, or of `unknown` without it. The caps are 5
in 10 minutes and 20 in an hour per hash. Only an explicit refusal SHALL answer 429 `rate_limited`. A
limiter error SHALL log a warning and let the insert go ahead.

#### Scenario: Over the cap

- **WHEN** the bucket check refuses the attempt
- **THEN** the route answers 429 and inserts nothing

#### Scenario: Limiter unavailable

- **WHEN** the bucket check errors
- **THEN** the insert goes ahead and the route answers 200

Source (planned): `app/api/feedback/route.ts`, `lib/auth/rateLimitIp.ts`, `lib/db/system.ts`.

### Requirement: Feedback storage and retention (baseline)

The route SHALL insert through `lib/db/system.ts` and answer `{ ok: true }`, or 500 `{ ok: false }` on an
insert error or throw. The `feedback` table SHALL NOT be on the data gateway, so no browser reads or
writes it. `user_id` is nullable. The Worker's schedule SHALL call `POST /api/cron/feedback-retention`
at 03:00 UTC daily, which SHALL delete rows older than 12 months. Account deletion SHALL delete the
player's rows. Neither deletion sends anything.

#### Scenario: Account deleted

- **WHEN** a player deletes their account
- **THEN** their feedback rows go with it, and guest rows wait for the purge

#### Scenario: Insert fails

- **WHEN** the insert returns an error
- **THEN** the route logs it and answers 500 `{ ok: false }`

#### Scenario: Retention without the secret

- **WHEN** anyone calls the retention route without the bearer secret
- **THEN** it answers 401 and deletes nothing

Source (planned): `app/api/feedback/route.ts`, `app/api/cron/feedback-retention/route.ts`,
`lib/db/system.ts`, `lib/db/tables.ts`.

### Requirement: Bug notification message preview (baseline)

The feedback route SHALL read the row's message through `lib/db/system.ts` and add a "Message
preview" to the email, cut to 500 characters plus "…" when longer. If the read fails or finds no row,
the preview SHALL be left out and the email still sent. The preview stays (the #1848 ruling, upheld
by the owner on 2 November 2026, and again for email on 20 November 2026).

#### Scenario: Long message

- **WHEN** the message is 501 characters
- **THEN** the preview is 500 characters followed by "…"

#### Scenario: Message fetch fails

- **WHEN** the read errors
- **THEN** the email is sent without the preview

Source (planned): `lib/feedback/alerts.ts`, `lib/db/system/feedback.ts`; tests
`lib/feedback/alerts.test.ts`.

### Requirement: Weekly feedback digest (baseline)

The Worker's schedule SHALL call `POST /api/cron/feedback-digest` on Mondays at 09:00 UTC. The route
SHALL answer 503 without `CRON_SHARED_SECRET` and 401 on a wrong bearer. `window_days` SHALL default
to 7 when absent or the body is unparseable, and a number SHALL be rounded and clamped to 1-90. The
email SHALL go out only when outbound sends are on; without `RESEND_API_KEY` it is logged and skipped
and the route answers 200 with `sent` false.

#### Scenario: Window too large

- **WHEN** `window_days` is 365
- **THEN** the window is 90 days

#### Scenario: Unparseable body

- **WHEN** the body is not JSON
- **THEN** the window is 7 days

#### Scenario: Preview Worker

- **WHEN** Monday 09:00 UTC passes on the preview Worker
- **THEN** no digest runs, because the preview has no Cron Triggers

Source (planned): `app/api/cron/feedback-digest/route.ts`, `lib/cron/schedule.ts`; tests
`app/api/cron/feedback-digest/route.test.tsx`.

### Requirement: Digest content (baseline)

The route SHALL count rows by category in the window, splitting authenticated from guest without
selecting `user_id`, and SHALL never select `message`. It SHALL email the window, the total and one
line per category with rows, as "Bug: 3 (2 auth, 1 guest)", with the subject "Poké Memory: weekly
feedback digest". A query error SHALL answer 502 `query_failed`; a Resend refusal or network error
SHALL answer 502 `email_failed`. Success answers with the total, window and `sent`.

#### Scenario: Empty week

- **WHEN** there is no feedback in the window
- **THEN** a digest showing a total of 0 is still emailed

#### Scenario: Category with no rows

- **WHEN** a category has no rows
- **THEN** it has no line in the email

Source (planned): `app/api/cron/feedback-digest/route.ts`, `lib/feedback/alerts.ts`; tests
`app/api/cron/feedback-digest/route.test.tsx`, `lib/feedback/alerts.test.ts`.

### Requirement: Unlocking superuser mode (baseline)

Typing lower-case `super` with no gap over 2 seconds, outside an input, textarea or editable element, or tapping an
element marked `data-superuser-tap` 7 times within 2 seconds of the first tap, SHALL toggle the unlocked
state, stored locally. It SHALL only reveal the Developer section and open the `/audit-themes` gate. Storage events SHALL keep other tabs' unlocked state and
flags current. Locking SHALL clear every flag and, if any was on, run exit cleanup.

#### Scenario: Typing in a field

- **WHEN** the player types `super` in a text input
- **THEN** nothing is unlocked

#### Scenario: Locked by default

- **WHEN** Settings loads with nothing stored
- **THEN** the Developer section is hidden

#### Scenario: Storage unavailable

- **WHEN** `localStorage` is null
- **THEN** superuser reads as locked and nothing throws

Source: `lib/superuser/SuperuserContext.tsx:42`, `lib/superuser/SuperuserContext.tsx:46`, `lib/superuser/SuperuserContext.tsx:312`, `lib/superuser/SuperuserContext.tsx:324`, `lib/superuser/SuperuserContext.tsx:354`, `lib/superuser/SuperuserContext.tsx:390`, `lib/superuser/persistence.ts:61`, `lib/superuser/persistence.ts:66`, `lib/storage/keys.ts:70`, `lib/superuser/persistence.test.ts:40`, `lib/superuser/persistence.test.ts:292`, `e2e/superuser.spec.ts:83`, `e2e/superuser.spec.ts:92`.

### Requirement: Superuser flags (baseline)

There SHALL be five independent flags, default off and stored together: `pretendAllMastered`,
`forceNextStreakMilestone`, `forceTokenToast`, `forceCardsGraduated` and `qaSeedMode`. A stored value that
is not exactly `true`, a missing field, or malformed JSON SHALL read as off. `forceNextStreakMilestone` and
`forceTokenToast` SHALL clear themselves after one fire, through `setFlag`, so if that was the last flag on,
exit cleanup runs.

#### Scenario: Corrupt blob

- **WHEN** the stored flags are malformed JSON
- **THEN** every flag reads as off

#### Scenario: Self-clearing last flag

- **WHEN** `forceTokenToast` is the only flag on and its toast is dismissed
- **THEN** the flag clears and exit cleanup runs, which for a guest means the reset prompt

#### Scenario: Forced milestone dismissed

- **WHEN** `forceNextStreakMilestone` fires and the celebration is dismissed
- **THEN** the flag clears and `seenStreakMilestones` is unchanged

#### Scenario: pretendAllMastered on the Pokédex

- **WHEN** the flag is on
- **THEN** generation counters read full, and mastery reads full on Pasture, Stats, Journey and the theme and favourite gates, while activity history and the PWA badge stay real

#### Scenario: forceCardsGraduated

- **WHEN** the flag is on and a learning-phase card comes up
- **THEN** typed entry shows, not multiple choice

Source: `lib/superuser/persistence.ts:23`, `lib/superuser/persistence.ts:53`, `lib/superuser/persistence.ts:78`, `lib/superuser/persistence.ts:95`, `components/review/StreakBadge.tsx:149`, `components/review/StreakBadge.tsx:153`, `components/review/StreakBadge.tsx:174`, `components/review/ReviewSession.tsx:3359`, `components/pokedex/PokedexGrid.tsx:193`, `components/pokedex/PokemonDetailDisclosure.tsx:170`, `app/journey/page.tsx:587`, `app/pasture/page.tsx:312`, `app/stats/page.tsx:366`, `components/favourite/usePartner.ts:26`, `components/pwa/usePwaBadge.ts:34`, `lib/stats/activity-history.ts:36`, `lib/superuser/SuperuserContext.tsx:280`, `lib/superuser/persistence.test.ts:101`, `lib/superuser/persistence.test.ts:106`, `e2e/superuser.spec.ts:111`, `e2e/superuser.spec.ts:156`.

### Requirement: Developer section (baseline)

While unlocked, Settings SHALL show a Developer section with a link to `/audit-themes`, a toggle for each
flag, and a "Reset earned badges" button that empties `earnedBadges` in local settings with no confirmation. The
button shows with every flag off, and then the write guard is not active, so the empty list goes to the
sync path, which looks wrong (#2354). The QA seed panel SHALL show only with `qaSeedMode` on.

#### Scenario: Unlocked with qaSeedMode off

- **WHEN** the section renders with `qaSeedMode` off
- **THEN** the toggle shows and the QA seed panel does not

#### Scenario: Reset earned badges

- **WHEN** the button is pressed
- **THEN** `earnedBadges` is emptied and the label shows "cleared" for 1.5 seconds

#### Scenario: Reset earned badges with no flag on

- **WHEN** a signed-in operator presses the button with every flag off
- **THEN** `AutoSyncOnChange` sends `earnedBadges: []`, which the `user_settings` regression trigger refuses when the cloud holds badges (#2354)

Source: `app/settings/page.tsx:128`, `app/settings/page.tsx:134`, `app/settings/page.tsx:139`, `app/settings/page.tsx:2103`, `app/settings/page.tsx:2116`, `app/settings/page.tsx:2199`, `app/settings/page.tsx:2221`, `components/sync/AutoSyncOnChange.tsx:64`, `db/migrations/038_user_settings_reject_regression_trigger.sql:102`, `e2e/qa-seed.spec.ts:38`, `e2e/qa-seed.spec.ts:62`, `e2e/qa-seed.spec.ts:200`.

### Requirement: Superuser write guard (baseline)

`anyFlagOn` SHALL be true while any flag is on or cleanup is pending in the provider's state; on the first
render, before the mount effect reads storage, it is false. Each write path SHALL read it:
`AutoSyncOnChange`, `OnlineReconnectSync`, the review session, Settings actions, the retry on Settings and
Stats, the Known Pokémon quiz, the Pasture seen marker, push opt-in and the auth callback. Sign-in and
visibility pulls keep reading but skip their write-backs (see the `cloud-sync` capability).

#### Scenario: Flag on

- **WHEN** any flag is on and the player's settings, streak or grade log change
- **THEN** no push is sent, even when signed in

#### Scenario: Flag turned off

- **WHEN** `anyFlagOn` goes from true to false
- **THEN** pushes resume

#### Scenario: Auth callback

- **WHEN** a sign-in completes with the guard active
- **THEN** the automatic push and "keep local" push are skipped

#### Scenario: Controls while guarded

- **WHEN** the guard is active
- **THEN** Settings hides Force pull, disables Reset all progress and Delete account, and passes `superuserPaused` to its controls, and Journey and Stats skip retroactive badge awards

#### Scenario: Pull while guarded

- **WHEN** a sign-in or visibility pull runs with the guard active
- **THEN** cloud data is read, and the learning-locales and grade-log push-backs are skipped

Source: `lib/superuser/SuperuserContext.tsx:423`, `components/sync/AutoSyncOnChange.tsx:48`, `components/sync/OnlineReconnectSync.tsx:21`, `components/review/ReviewSession.tsx:1117`, `components/pwa/PushOptIn.tsx:126`, `app/auth/callback-complete/page.tsx:149`, `app/auth/callback-complete/page.tsx:307`, `app/settings/page.tsx:468`, `app/settings/page.tsx:1009`, `app/settings/page.tsx:1987`, `app/settings/page.tsx:2245`, `app/settings/page.tsx:2263`, `app/stats/page.tsx:217`, `app/stats/page.tsx:315`, `app/journey/page.tsx:471`, `app/pasture/page.tsx:286`, `lib/sync/pullAndMerge.ts:458`, `lib/sync/pullAndMerge.ts:576`, `lib/superuser/SuperuserContext.tsx:76`, `components/auth/superuserGuard.test.tsx:127`, `components/auth/superuserGuard.test.tsx:174`, `components/auth/superuserGuard.test.tsx:202`, `components/auth/superuserGuard.test.tsx:473`, `components/auth/superuserGuard.test.tsx:514`.

### Requirement: Cleanup-pending marker (baseline)

On the change from any flag on to none, whether by toggle or lock, the provider SHALL set the
cleanup-pending marker in localStorage and its own `cleanupPending` state before saving the flags, then
run exit cleanup. Only a trusted cleanup SHALL remove the marker. After cleanup, `cleanupPending` SHALL
follow the marker, so a failed cleanup keeps writes paused for that page's lifetime. The retry is to turn a
flag on and off again.

#### Scenario: Cleanup in progress

- **WHEN** the last flag is turned off and the cloud pull has not finished
- **THEN** `anyFlagOn` stays true

#### Scenario: Cleanup failed

- **WHEN** `pullSession` returns null
- **THEN** the marker stays, and `anyFlagOn` stays true until the page reloads

Source: `lib/superuser/SuperuserContext.tsx:79`, `lib/superuser/SuperuserContext.tsx:206`, `lib/superuser/SuperuserContext.tsx:285`, `lib/superuser/SuperuserContext.tsx:296`, `lib/superuser/SuperuserContext.tsx:338`, `lib/storage/keys.ts:84`, `components/superuser/SuperuserContext.test.tsx:260`.

### Requirement: The marker is not read after a reload (baseline)

`isAnyFlagOn()` SHALL honour the marker, but no production code calls it, and the provider does not read the
marker on mount or in its storage listener. This looks wrong: after a reload, or in another tab, `anyFlagOn`
is false with the marker still set, so writes resume on data the marker was protecting (#2303).

#### Scenario: Reload with the marker set

- **WHEN** the provider mounts with the marker set and no flags on
- **THEN** `isAnyFlagOn()` is true and `anyFlagOn` is false (#2303)

#### Scenario: Marker and storage helper

- **WHEN** `isAnyFlagOn()` is called with the marker set and all flags off
- **THEN** it returns true

Source: `lib/superuser/SuperuserContext.tsx:76`, `lib/superuser/SuperuserContext.tsx:304`, `lib/superuser/SuperuserContext.tsx:312`, `lib/superuser/SuperuserContext.tsx:423`, `lib/superuser/persistence.ts:119`, `lib/superuser/persistence.test.ts:204`, `lib/superuser/persistence.test.ts:242`.

### Requirement: Exit cleanup for a signed-in player (baseline)

When the last flag goes off with a user and client, the provider SHALL pull cards, settings, regional
prefs, streak and grade log. Cards are required: if `pullSession` returns null or throws, local state SHALL
stay as it is with a warning. A failed pull of the other four SHALL leave that table's local value. With
cards, it SHALL apply the cloud over local, replacing streak and grade log outright rather than merging. It
does not touch the mastered-count cache, which looks wrong (#2305).

#### Scenario: Grade log pull fails

- **WHEN** only the grade log pull fails
- **THEN** a warning is logged, the rest applies, and local grade log stays

#### Scenario: Card pull fails

- **WHEN** `pullSession` returns null
- **THEN** nothing is written, no storage event fires, and the active-seed key stays

Source: `lib/superuser/SuperuserContext.tsx:102`, `lib/superuser/SuperuserContext.tsx:120`, `lib/superuser/SuperuserContext.tsx:124`, `lib/superuser/SuperuserContext.tsx:179`, `lib/superuser/SuperuserContext.tsx:217`, `lib/profile/useProfileStatus.ts:116`, `components/superuser/SuperuserContext.test.tsx:152`, `components/superuser/SuperuserContext.test.tsx:260`.

### Requirement: Signed-in exit cleanup details (baseline)

The cleanup SHALL keep device favourite keys that an older cloud settings row lacks, and apply regional
prefs only if the settings pull worked. After a good card pull it SHALL advance the pull cursors, dispatch a
storage event, and clear the active-seed key and the marker.

#### Scenario: Cloud row older than the favourite keys

- **WHEN** the cloud settings row has no favourite keys
- **THEN** the device's favourite keys stay

#### Scenario: Next background pull

- **WHEN** cleanup succeeds
- **THEN** `lastPullAt` is set from the pulled rows, so the next pull has an anchor

Source: `lib/superuser/SuperuserContext.tsx:147`, `lib/superuser/SuperuserContext.tsx:158`, `lib/superuser/SuperuserContext.tsx:189`, `lib/superuser/SuperuserContext.tsx:202`, `lib/superuser/SuperuserContext.tsx:206`, `components/superuser/SuperuserContext.test.tsx:221`.

### Requirement: Exit cleanup for a guest (baseline)

With no user or client, the provider SHALL show `window.confirm` offering to reset local progress. On OK
it SHALL run `clearSeedScenario`, delete the session whether or not that succeeded, dispatch a storage
event, and clear the active-seed key and the marker. On Cancel it SHALL change nothing and leave the marker
set.

#### Scenario: Guest cancels

- **WHEN** the guest presses Cancel
- **THEN** local state and the marker stay

#### Scenario: Partial failure

- **WHEN** `clearSeedScenario` throws and the guest pressed OK
- **THEN** a warning is logged and the session is still deleted

Source: `lib/superuser/SuperuserContext.tsx:225`, `lib/superuser/SuperuserContext.tsx:233`, `lib/superuser/SuperuserContext.tsx:242`, `lib/superuser/SuperuserContext.tsx:248`, `lib/superuser/SuperuserContext.tsx:253`.

### Requirement: Favourite theme re-check after cleanup (baseline)

After a trusted cleanup only, the provider SHALL re-check the favourite theme with real mastery in any
enrolled locale, `forceAllMastered` off, and clear it if not earned. After a failed cleanup or a guest's
Cancel it SHALL skip this, leaving the check that `FavouriteThemeProvider` runs on the next load.

#### Scenario: Theme picked under pretendAllMastered

- **WHEN** a trusted cleanup finishes and the theme's species is not mastered
- **THEN** the favourite theme is cleared

#### Scenario: Cleanup failed

- **WHEN** cleanup is not trusted
- **THEN** the favourite theme is left alone

Source: `lib/superuser/SuperuserContext.tsx:102`, `lib/superuser/SuperuserContext.tsx:257`, `lib/superuser/SuperuserContext.tsx:266`.

### Requirement: QA seed scenarios (baseline)

There SHALL be six scenarios: `fsrs-locale-mastery`, `optimiser-stress`, `pasture-progression`,
`mastery-gaps`, `favourite-unmastered` and `favourite-mastered`.
Builders SHALL derive FSRS states by replaying real grades from a fixed epoch, then anchor dates to today,
and SHALL take card identity from the loaded seed data, throwing if it has not loaded. The `subject_key`
format is non-canonical (open issue #2011).

#### Scenario: Same scenario twice

- **WHEN** `build()` runs twice
- **THEN** both payloads are equal as JSON

#### Scenario: Seed not loaded

- **WHEN** a builder runs before `loadSeed()`
- **THEN** it throws

#### Scenario: Non-English mastery

- **WHEN** `pasture-progression` is applied and the name language is switched to Japanese
- **THEN** 0 are mastered, because mastery is per locale

Source: `lib/qa-seed/scenarios.ts:19`, `lib/qa-seed/scenarios.ts:156`, `lib/qa-seed/scenarios.ts:186`, `lib/qa-seed/scenarios.ts:234`, `lib/qa-seed/scenarios.ts:872`, `lib/qa-seed/scenarios.test.ts:26`, `lib/qa-seed/scenarios.test.ts:210`, `lib/qa-seed/scenarios.test.ts:320`, `lib/qa-seed/scenarios.test.ts:344`, `lib/qa-seed/scenarios.test.ts:405`, `lib/qa-seed/scenarios.test.ts:587`, `lib/qa-seed/scenarios.test.ts:618`, `lib/qa-seed/scenarios.test.ts:751`.

### Requirement: Applying a QA seed (baseline)

The panel SHALL ask for confirmation, load the seed, build the payload and show "Seed applied" or the error.
Apply SHALL write only the keys the payload has: the session to IndexedDB with change events, a streak of
days ending today by UTC date, settings in one save with labs flags merged, the mastered-count cache, and the active slug. A value a scenario omits, such as an earlier streak, stays. The panel asks for a reload, and its
visible text is hard-coded English.

#### Scenario: Confirmation dismissed

- **WHEN** the operator cancels the dialog
- **THEN** nothing is written

#### Scenario: Labs flags

- **WHEN** a payload has `labsFlags`
- **THEN** they merge over the existing flags, although no current scenario sets any

#### Scenario: Remount

- **WHEN** the operator leaves Settings and returns
- **THEN** the active-seed indicator is restored from localStorage

#### Scenario: Pasture after reload

- **WHEN** `pasture-progression` is applied and the page reloaded
- **THEN** the Pasture shows the seeded species

Source: `components/settings/QaSeedSection.tsx:39`, `components/settings/QaSeedSection.tsx:50`, `components/settings/QaSeedSection.tsx:65`, `components/settings/QaSeedSection.tsx:109`, `components/settings/QaSeedSection.tsx:169`, `lib/qa-seed/apply.ts:36`, `lib/qa-seed/apply.ts:53`, `lib/qa-seed/apply.ts:87`, `lib/qa-seed/apply.ts:94`, `lib/qa-seed/apply.ts:110`, `lib/qa-seed/apply.ts:126`, `lib/qa-seed/apply.ts:136`, `components/settings/QaSeedSection.test.tsx:96`, `components/settings/QaSeedSection.test.tsx:148`, `components/settings/QaSeedSection.test.tsx:228`, `components/qa-seed/apply.test.tsx:187`, `components/qa-seed/apply.test.tsx:286`, `e2e/qa-seed.spec.ts:83`.

### Requirement: QA seed data stays local (baseline)

A seed SHALL write only to the device, and the panel is reachable only with `qaSeedMode` on, so the write
guard is active while seeding. The guard's limit after a reload with a pending marker is recorded in
"Cleanup-pending marker" (#2303).

#### Scenario: Superuser flag on

- **WHEN** a scenario is applied while signed in
- **THEN** no cloud write is made

Source: `lib/qa-seed/scenarios.ts:9`, `lib/qa-seed/apply.ts:9`, `app/settings/page.tsx:2221`, `components/sync/AutoSyncOnChange.tsx:48`.

### Requirement: Clearing a QA seed (baseline)

After confirmation, Clear seed SHALL delete the session and grade log from IndexedDB, empty the streak, reset
protection tokens to the default, set the mastered-count cache to 0 for every supported locale, remove the
active-seed key, and dispatch change events. The name locale is kept on purpose. Learning locales, the active
locale, the favourite, hearts and colours-offer marker are also kept, which looks wrong: the dialog promises a
fresh visitor (#2305).

#### Scenario: Clear after a favourite scenario

- **WHEN** a guest applies `favourite-unmastered`, then clears
- **THEN** cards, streak and tokens are gone, and the favourite and hearts stay (#2305)

#### Scenario: Signed-in clear

- **WHEN** a signed-in operator clears
- **THEN** cloud data is untouched

Source: `lib/qa-seed/apply.ts:150`, `lib/qa-seed/apply.ts:155`, `lib/qa-seed/apply.ts:165`, `lib/qa-seed/apply.ts:168`, `lib/qa-seed/apply.ts:175`, `components/settings/QaSeedSection.tsx:78`, `components/settings/QaSeedSection.tsx:88`, `components/qa-seed/apply.test.tsx:468`, `components/qa-seed/apply.test.tsx:482`, `components/qa-seed/apply.test.tsx:495`, `components/settings/QaSeedSection.test.tsx:207`, `e2e/qa-seed.spec.ts:172`.

### Requirement: Sentry start-up in every runtime (baseline)

`register()` SHALL load the server initialiser by `NEXT_RUNTIME`, and the browser SHALL initialise in
`instrumentation-client.ts`. All SHALL read `NEXT_PUBLIC_SENTRY_DSN`, and with no DSN Sentry is a safe
no-op. Traces SHALL default to a 0.1 sample rate, overridable by env, and Session Replay SHALL stay at
0. The environment SHALL be `cloudflare-production` or `cloudflare-preview` from `DEPLOY_ENV`, falling
back to `NODE_ENV`; on the server `SENTRY_ENVIRONMENT` wins.

#### Scenario: No DSN

- **WHEN** `NEXT_PUBLIC_SENTRY_DSN` is unset
- **THEN** `Sentry.init` opens no connection and throws nothing

#### Scenario: Preview deployment

- **WHEN** `DEPLOY_ENV` is `cloudflare-preview`
- **THEN** the environment is `cloudflare-preview`

#### Scenario: Worker runtime

- **WHEN** the server initialiser runs on the Worker under `nodejs_compat`
- **THEN** errors reach Sentry with the same privacy scrubbing

Source (planned): `instrumentation.ts`, `instrumentation-client.ts`, `instrumentation-node.ts`,
`lib/observability/sentryPrivacy.ts`; tests `lib/observability/sentryPrivacy.test.ts`.

### Requirement: Sentry data is scrubbed (baseline)

Every `Sentry.init` SHALL pass the shared `SENTRY_DATA_COLLECTION`, with every personal-data category off,
and `beforeSend: scrubSentryEvent`. The scrub SHALL remove user, request cookies, data, query string and
headers; strip query and fragment from the request URL, `nextjs.request_path`, and navigation breadcrumb
`data.from` and `data.to`; and drop `data` from fetch and xhr breadcrumbs. Breadcrumb `message` text is not
scrubbed (open item held in ops #426).

#### Scenario: Error with a query string

- **WHEN** an event has a request URL with a query and fragment
- **THEN** both are removed before sending

#### Scenario: Fetch breadcrumb

- **WHEN** an event holds a fetch breadcrumb
- **THEN** its `data` is removed and other categories keep theirs

#### Scenario: Transactions and spans

- **WHEN** a transaction or span is sent
- **THEN** the scrub does not run, because `beforeSendTransaction` is deliberately not set, and `SENTRY_DATA_COLLECTION` alone governs it

#### Scenario: Sparse event

- **WHEN** an event has no user, request or breadcrumbs
- **THEN** the scrub does not throw

Source: `lib/observability/sentryPrivacy.ts:23`, `lib/observability/sentryPrivacy.ts:43`, `lib/observability/sentryPrivacy.ts:64`, `lib/observability/sentryPrivacy.ts:85`, `lib/observability/sentryPrivacy.ts:89`, `instrumentation-client.ts:23`, `instrumentation-client.ts:47`, `instrumentation-node.ts:26`, `instrumentation-edge.ts:22`, `lib/observability/sentryPrivacy.test.ts:37`, `lib/observability/sentryPrivacy.test.ts:51`, `lib/observability/sentryPrivacy.test.ts:68`, `lib/observability/sentryPrivacy.test.ts:85`, `lib/observability/sentryPrivacy.test.ts:101`, `lib/observability/sentryPrivacy.test.ts:121`.

### Requirement: Server errors reach Sentry, control flow does not (baseline)

`onRequestError` SHALL send unhandled route, Server Component and Server Action errors to Sentry, except those
whose string `digest` starts with `NEXT_HTTP_ERROR_FALLBACK` or `NEXT_REDIRECT`. Anything else, including
non-Error values and null, SHALL be captured.

#### Scenario: notFound()

- **WHEN** a handler calls `notFound()`
- **THEN** nothing is sent

#### Scenario: Thrown string

- **WHEN** a handler throws a string
- **THEN** it is captured

Source: `instrumentation.ts:30`, `lib/observability/shouldCapture.ts:26`, `lib/observability/shouldCapture.test.ts:42`, `lib/observability/shouldCapture.test.ts:46`, `lib/observability/shouldCapture.test.ts:83`, `lib/observability/shouldCapture.test.ts:87`.

### Requirement: Sentry build options (baseline)

The Next config SHALL be wrapped in `withSentryConfig` as the outermost layer, tunnelling browser events through
`/monitoring`, deleting source maps after upload, and passing no `webpack` options, because the build uses
Turbopack. Without `SENTRY_AUTH_TOKEN` the upload is skipped and the build still succeeds.

#### Scenario: webpack option added

- **WHEN** a `webpack` key appears in the Sentry options
- **THEN** `nextConfigSentry.test.ts` fails

#### Scenario: No auth token

- **WHEN** `SENTRY_AUTH_TOKEN` is unset
- **THEN** the build warns, skips the upload and succeeds

Source: `next.config.ts:156`, `next.config.ts:159`, `next.config.ts:165`, `lib/observability/nextConfigSentry.test.ts:56`, `lib/observability/nextConfigSentry.test.ts:63`, `lib/observability/nextConfigSentry.test.ts:72`.

### Requirement: Theme audit page (baseline)

`/audit-themes` SHALL read the unlocked state from localStorage after mount, render nothing until then, and
give a 404 if locked. Unlocked, it SHALL show the brand colours and each curated mascot in accents, tinted and
full, light and dark, with the four grade buttons, using colours computed in JS to mirror `app/globals.css`.
`robots.ts` SHALL disallow it. The gate is on the client only, and the page holds no player data.

#### Scenario: Locked visitor

- **WHEN** a visitor opens the URL with superuser locked
- **THEN** the not-found page shows

#### Scenario: Unlocked, first render

- **WHEN** an unlocked operator loads the page
- **THEN** it does not 404 while the provider hydrates, because it reads storage directly

Source: `app/audit-themes/page.tsx:15`, `app/audit-themes/page.tsx:133`, `app/audit-themes/page.tsx:134`, `app/audit-themes/page.tsx:137`, `app/audit-themes/page.tsx:138`, `app/audit-themes/page.tsx:140`, `app/audit-themes/page.tsx:175`, `app/robots.ts:8`.

### Requirement: Test error page (baseline)

`/test-error` SHALL throw on render so the root error boundary shows, as a stable target for the
Playwright smoke tests. It is not linked from navigation and renders per request. When `DEPLOY_ENV` is
`cloudflare-production` it SHALL give a 404 instead.

#### Scenario: E2E run

- **WHEN** Playwright opens `/test-error` outside production, the preview Worker included
- **THEN** the error boundary shows with its Try again and Go to Practice controls

#### Scenario: Production

- **WHEN** a visitor opens `/test-error` in production
- **THEN** the not-found page shows

Source (planned): `app/test-error/page.tsx`; tests `e2e/error-boundary.spec.ts`.

### Requirement: The privacy notice states the deletion

Notice section 3 SHALL say a bug report sends a notification email to the company mailbox through
Resend, with a preview of up to 500 characters and no user identifier, deleted 12 months after it
arrives. Section 6 SHALL list Resend in place of Discord, section 7 its transfer safeguards, and
section 8 SHALL say the email cannot be matched to an account, so deleting the account does not
remove it, but it never outlasts 12 months. The DPIA and the Children's Code assessment SHALL say
the same.

#### Scenario: Reading the notice

- **WHEN** anyone opens the privacy notice, in any locale
- **THEN** sections 3, 6 and 8 say the bug-report email is deleted 12 months after it arrives
- **AND** the notice does not mention Discord

Source (planned): `app/privacy/page.tsx`, `docs/dpia.md`, `docs/childrens-code-assessment.md`; tests
`app/privacy/page.test.tsx` "says a bug report is emailed to our company mailbox through Resend" and
"says how long the bug-report email is kept, in sections 3, 6 and 8".

### Requirement: Bug reports email the company mailbox from the feedback route

After storing a `bug` row, the feedback route SHALL send the bug-report email in the same Worker with
`ctx.waitUntil`, through Resend to the company mailbox (`lib/alertEmail.ts`), from the row's `id`,
`page`, `app_version`, `created_at` and `authenticated`, never `user_id`. A failed or skipped email
SHALL be logged and SHALL NOT change the route's answer. It SHALL go out only when outbound sends are
on, as `hosting-and-data` describes.

#### Scenario: Feature request

- **WHEN** a `feature` or `other` row is inserted
- **THEN** no email is sent

#### Scenario: Resend down

- **WHEN** Resend refuses the email, or the request fails, after a bug row is stored
- **THEN** the route still answers `{ ok: true }` and the row stays

#### Scenario: No Resend key

- **WHEN** `RESEND_API_KEY` is not set
- **THEN** the feedback row is kept, `feedback-alert: alert not sent: no RESEND_API_KEY` is logged and
  no HTTP call is made

#### Scenario: Preview version

- **WHEN** a bug report is sent on the preview Worker
- **THEN** the row is stored, the would-be email is logged and nothing reaches Resend

Source (planned): design D3 and D8, `app/api/feedback/route.ts`, `lib/feedback/alerts.ts`,
`lib/alertEmail.ts`; tests `app/api/feedback/route.test.tsx`, `lib/feedback/alerts.test.ts`.

### Requirement: Bug-report email content

The bug-report email SHALL have the subject "Poké Memory: new bug report" and a plain-text body with
the page, app version, authenticated (Yes or "No (guest)"), timestamp and the feedback row id, never
`user_id` or an email address. A null page or version SHALL show "(not provided)". It SHALL go to
hello@frazzledproductions.com from `RESEND_FROM`, the same sender and recipient as the operator
alerts.

#### Scenario: Guest report

- **WHEN** the report has `authenticated` false
- **THEN** the email shows "No (guest)" and holds no user id

#### Scenario: Missing page

- **WHEN** the report has no page
- **THEN** the email shows "Page: (not provided)"

Source (planned): design D8, `lib/feedback/alerts.ts`, `lib/alertEmail.ts`; tests `lib/feedback/alerts.test.ts`.
