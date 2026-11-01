# settings-onboarding-and-i18n Specification

## Purpose
Baseline: what the Settings page, first-run onboarding and nudges, the app and Pokémon-name languages,
the theme and Labs flags do today, written from code and tests at `qa` commit `d2456f44` (ops #383). It
records current behaviour, including behaviour that looks wrong, not intended behaviour; each such
requirement names its open issue, and a fix needs a delta against it. Out of scope, for their own
capabilities: the merge inside `pullAndMerge` (`cloud-sync`), sign-in and account deletion
(`accounts-and-auth`), backup files and the offline download (`local-data-and-backup`), the optimiser
(`srs-scheduling`), push delivery (`push-notifications`), and what the favourite and hearts mean in
practice (change `favourite-everywhere`).

## Requirements

### Requirement: Settings load from one blob and never throw (baseline, current behaviour)

`loadSettings` SHALL read the single localStorage key `poke-memory:settings:v1` and return defaults on
the server, when the key is absent, when the JSON is corrupt, and when the value is not an object. An
array passes that check, so it reads field by field: defaults, except `mobileNav` as `hamburger`.

#### Scenario: Corrupt blob

- **WHEN** the stored value is not valid JSON
- **THEN** `loadSettings` returns a copy of `DEFAULT_SETTINGS` and does not throw

#### Scenario: Server render

- **WHEN** `loadSettings` runs with no `window`
- **THEN** it returns `DEFAULT_SETTINGS`

Source: `lib/storage/keys.ts:32`, `lib/settings/persistence.ts:777-785`, `lib/settings/persistence.ts:1126-1132`.

### Requirement: Default values (baseline, current behaviour)

A user with no stored settings SHALL get `DEFAULT_SETTINGS`: mastery 3 repetitions; 10 new and 100
review name cards a day; 5 and 50 for evolution; 10 and 100 for reverse and cry; evolution cards on;
reverse-evolution, cry and alternate-form cards off; retention target 0.9; theme intensity `accents`;
mobile navigation `bottom`; learning locales `["en"]`; typed entry off, with `lenient` strictness.

#### Scenario: Fresh user

- **WHEN** a new visitor opens the app
- **THEN** only evolution cards are on among the opt-in card types, and retention target is 0.9

Source: `lib/settings/persistence.ts:582-651`.

### Requirement: Each field is coerced on read (baseline, current behaviour)

The parser SHALL keep a stored value only when its runtime type or literal matches, and otherwise use
the default. Retention target SHALL be clamped to 0.80..0.97, TTS rate to 0.5..2.0, TTS volume to 0..1
and the push hour SHALL be an integer 0..23 or null. Daily limits and `masteryRepetitions` SHALL only be
type-checked, with no range applied on read.

#### Scenario: Retention out of range

- **WHEN** the stored `retentionTarget` is 0.5
- **THEN** it reads as 0.8

#### Scenario: Daily limit out of range

- **WHEN** the stored `maxNewPerDay` is 9999
- **THEN** it reads as 9999

Source: `lib/settings/persistence.ts:654-662`, `lib/settings/persistence.ts:738-765`, `lib/settings/persistence.ts:817-830`, `lib/settings/persistence.ts:846-849`, `lib/settings/persistence.ts:876-883`, `lib/settings/persistence.ts:890-896`.

### Requirement: Keys the parser does not list are lost on read (baseline, current behaviour)

The parser SHALL return only the keys it names. `fsrsWeights` and `fsrsWeightsOptimizedAt` are declared
on `UserSettings` but not named, so they SHALL read as absent, and the next save of the loaded object
SHALL drop them (open issue #2248).

#### Scenario: Stored weights

- **WHEN** the blob holds `fsrsWeights`
- **THEN** `loadSettings().fsrsWeights` is undefined

Source: `lib/settings/persistence.ts:345-347`, `lib/settings/persistence.ts:816-949`.

### Requirement: Older records keep their navigation style (baseline, current behaviour)

A stored record with no valid `mobileNav` SHALL read as `hamburger`, while a user with no record gets
`bottom`.

#### Scenario: Record without the field

- **WHEN** a stored blob has no `mobileNav` key
- **THEN** the setting reads as `hamburger`

Source: `lib/settings/persistence.ts:607-609`, `lib/settings/persistence.ts:897-904`.

### Requirement: One-shot migrations on read (baseline, current behaviour)

`loadSettings` SHALL move the legacy practice-scope key into `practiceScope` only when the stored scope
is empty, and SHALL clear the legacy key either way. A blob with no `favouritePokemonId` key SHALL take
a valid theme's species as the favourite, hearted. `loadFavourite` SHALL move the legacy favourite-theme
key into settings when settings hold no valid theme, and SHALL remove the legacy key whether or not it
parsed.

#### Scenario: Non-empty scope wins

- **WHEN** both a legacy scope and a non-empty stored `practiceScope` exist
- **THEN** the stored scope stays and the legacy key is removed

#### Scenario: Cleared favourite stays cleared

- **WHEN** the blob holds `favouritePokemonId: null` and a valid theme
- **THEN** no favourite is carried over

Source: `lib/settings/persistence.ts:803-815`, `lib/settings/persistence.ts:1134-1147`, `lib/theme/persistence.ts:28-53`.

### Requirement: A name locale from before enrolment becomes enrolment (baseline, current behaviour)

A blob with no `learningLocales` and a non-English `pokemonNameLocale` SHALL read as enrolled in English
and that locale, with that locale active.

#### Scenario: Older Japanese record

- **WHEN** a blob has `pokemonNameLocale: "ja"` and no `learningLocales`
- **THEN** `learningLocales` reads as `["en", "ja"]` and the active locale as `ja`

Source: `lib/settings/persistence.ts:787-801`, `lib/settings/persistence.ts:1078-1085`.

### Requirement: Saving mirrors the active locale and announces the save (baseline, current behaviour)

`saveSettings` SHALL set `pokemonNameLocale` from `activePokemonNameLocale` when present, write the
blob, and dispatch `poke-memory:settings-saved` with the written object in `detail`. A write failure
SHALL be swallowed and the event SHALL still fire. It SHALL do nothing on the server.
`hasStoredSettings` SHALL report whether any blob exists.

#### Scenario: Storage full

- **WHEN** the localStorage write fails
- **THEN** no error reaches the caller and listeners still receive the event

Source: `lib/settings/persistence.ts:1158-1186`, `lib/storage/writeLocalStorage.ts:52-64`.

### Requirement: Settings cross devices as a diff, except device-local keys (baseline, current behaviour)

While signed in with no superuser flag on, each save SHALL push only the top-level keys that differ
from the last successful push; a first push SHALL leave out keys equal to their defaults.
`appVisitCount` and `activePokemonNameLocale` SHALL stay out of that diff and out of a background pull.
The paths that skip this are in the next requirement.

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on and settings are saved
- **THEN** nothing is pushed

#### Scenario: Guest

- **WHEN** a guest saves settings
- **THEN** only localStorage changes

Source: `lib/settings/lastPushedSnapshot.ts:41-58`, `lib/settings/lastPushedSnapshot.ts:114-143`, `components/sync/AutoSyncOnChange.tsx:48-49`, `components/sync/AutoSyncOnChange.tsx:54-65`.

### Requirement: Sign-in choices and the superuser exit skip the device-local rule (baseline, current behaviour)

Keep local at sign-in SHALL push the whole local object, device-local keys included, with no diff or
locale merge. Keep cloud and a brand-new device SHALL save the cloud blob as it is, and the superuser exit
SHALL spread it over defaults, keeping only the favourite keys. None of these SHALL keep the device's
own `appVisitCount` or active language, or run the learning-language union (open issue #2353).

#### Scenario: Keep local

- **WHEN** a user with local and cloud cards chooses Keep local
- **THEN** the push carries `appVisitCount` and `activePokemonNameLocale`

#### Scenario: Keep cloud

- **WHEN** the user chooses Keep cloud and the blob has no `appVisitCount`
- **THEN** `appVisitCount` reads as 0 on this device

Source: `app/auth/callback-complete/page.tsx:245`, `app/auth/callback-complete/page.tsx:322`, `lib/superuser/SuperuserContext.tsx:147-151`, `lib/settings/lastPushedSnapshot.ts:41-44`, `lib/sync/settings.ts:27`.

### Requirement: Regional preferences use their own columns (baseline, current behaviour)

Timezone, date format and push hour SHALL be written by `pushRegionalPrefs` to scalar columns with an
UPDATE, so a user with no row writes nothing. The Settings page SHALL call it after each change while
signed in with no superuser flag on, and SHALL ignore its failure. The same values SHALL also stay in the
settings blob and its diff. Each background pull SHALL then overlay the columns' non-null values on local
settings, all three of them.

#### Scenario: Offline change

- **WHEN** a signed-in user changes timezone and the update fails
- **THEN** the local value stays changed and no error shows

#### Scenario: Hour changed on another device

- **WHEN** a pull finds a non-null `push_notification_hour` that differs from local
- **THEN** the local value takes the column's

Source: `lib/sync/settings.ts:77-99`, `lib/sync/pullAndMerge.ts:478-497`, `app/settings/page.tsx:572-584`, `app/settings/page.tsx:1751-1757`.

### Requirement: Learning languages merge as sets with tombstones (baseline, current behaviour)

On pull, `removedLocales` SHALL be the union of both sides without `en`, and `learningLocales` the union
of both sides minus those, local order first, always with `en`. The active locale SHALL stay when still
enrolled.

#### Scenario: Removed on another device

- **WHEN** `ja` is enrolled here and tombstoned in the cloud
- **THEN** `ja` is dropped here, and an active `ja` falls back to the first enrolled locale

Source: `lib/sync/settings.ts:263-306`, `lib/sync/pullAndMerge.ts:395-402`, `lib/settings/persistence.ts:1043-1093`.

### Requirement: The database protects most onboarding flags (baseline, current behaviour)

The `user_settings` regression trigger SHALL reject a true-to-false change of 17 listed onboarding flags
and a decrease of `practiceSessionsCount` or `slowSpriteLoadCount`, unless the write carries a strictly
newer `onboardingResetAt`. `cardTypesDefaultOpenDismissed` and `masteryBlockersNudgeDismissed` are not listed, although the type's comment requires every boolean dismissal flag to be, so the trigger SHALL
NOT protect them (open issue #2318).

#### Scenario: Stale device clears a listed flag

- **WHEN** a stale write sets `statsHintDismissed` from true to false with no newer reset stamp
- **THEN** the database rejects it

#### Scenario: Top-level one-shot flag

- **WHEN** any write sets `typedEntryOnboardingShown` or `mcCardOnboardingShown` from true to false
- **THEN** the database rejects it, even with a newer reset stamp

#### Scenario: Stale device clears an unlisted flag

- **WHEN** a stale write sets `masteryBlockersNudgeDismissed` from true to false
- **THEN** the database accepts it

Source: `db/migrations/038_user_settings_reject_regression_trigger.sql:142-166`, `db/migrations/038_user_settings_reject_regression_trigger.sql:178-195`, `db/migrations/038_user_settings_reject_regression_trigger.sql:200-202`, `lib/settings/persistence.ts:51-56`, `lib/settings/persistence.ts:197`, `lib/settings/persistence.ts:209`.

### Requirement: The Settings page writes back its mount-time snapshot (baseline, current behaviour)

The page SHALL load settings once on mount into React state, SHALL NOT listen for later saves, and its
controls SHALL save that state with one key changed. Only the first collapse of Card types SHALL
refresh that state from storage. A value another writer saved after mount (a
favourite, a dismissed hint, the language pill, a pull) SHALL be overwritten by the page's next save
(open issue #2307).

#### Scenario: Favourite then intensity

- **WHEN** the user picks a favourite on Settings and then changes theme intensity
- **THEN** the saved blob holds the favourite from page load, not the new one

#### Scenario: Language pill then toggle

- **WHEN** the user switches the active language from the pill while on Settings and then flips a toggle
- **THEN** the previous active language is written back

Source: `app/settings/page.tsx:427`, `app/settings/page.tsx:531-570`, `app/settings/page.tsx:640-642`, `app/settings/page.tsx:771-781`, `app/settings/page.tsx:1662-1666`, `components/favourite/FavouriteSettings.tsx:73`, `components/i18n/LanguageSwitcher.tsx:180-183`.

### Requirement: Regional defaults are detected on first Settings load (baseline, current behaviour)

When timezone or date format is null, the page SHALL detect it, save it, and push it once auth is
available and no superuser flag is on.

#### Scenario: Guest signs in later

- **WHEN** a guest opens Settings, values are detected, and auth becomes available on the same mount
- **THEN** the detected values are pushed once

Source: `app/settings/page.tsx:535-551`, `app/settings/page.tsx:572-584`.

### Requirement: Some controls save at once, others wait for Save (baseline, current behaviour)

Toggles, radio groups, selects and the enrolment list SHALL save on change. Numeric limits, the recall
target and the TTS voice, rate and volume SHALL only update page state. The Save button SHALL appear in
Practice schedule and Card types and SHALL NOT appear in Audio, so a TTS change with no later save SHALL
be lost on leaving the page (open issue #2308).

#### Scenario: Toggle

- **WHEN** the user turns on Play cry on reveal
- **THEN** it is saved at once

#### Scenario: TTS controls hidden

- **WHEN** Speak name on reveal is off
- **THEN** the voice, rate and volume controls do not show

#### Scenario: TTS rate

- **WHEN** the user moves the rate slider and leaves Settings
- **THEN** the stored rate is unchanged

Source: `app/settings/page.tsx:586-598`, `app/settings/page.tsx:634-642`, `app/settings/page.tsx:723-753`, `app/settings/page.tsx:947-952`, `app/settings/page.tsx:1016-1033`, `app/settings/page.tsx:1318-1335`, `app/settings/page.tsx:1392-1398`, `app/settings/page.tsx:1451-1455`.

### Requirement: Daily limits are bounded only by Save (baseline, current behaviour)

New-card limits SHALL be 1..50 and review limits 1..500 for name, evolution and reverse cards; cry limits and `masteryRepetitions` SHALL have no control. On blur the page SHALL parse the draft, keep the
old value when it is not a number, and apply only the minimum. Save SHALL clamp both ends. Any immediate
save between blur and Save SHALL write the unclamped value (open issue #2309).

#### Scenario: Save clamps

- **WHEN** the user enters 9999 new cards and presses Save
- **THEN** 50 is stored

#### Scenario: Toggle before Save

- **WHEN** the user enters 9999 new cards, leaves the field, then flips a toggle
- **THEN** 9999 is stored

#### Scenario: Cry limit

- **WHEN** a stored `maxNewCryPerDay` is 9999 and the user presses Save
- **THEN** 9999 stays

Source: `app/settings/page.tsx:188-244`, `app/settings/page.tsx:590-598`, `app/settings/page.tsx:723-745`, `components/settings/NumericFieldDraft.test.tsx:72`, `components/settings/NumericFieldDraft.test.tsx:88`.

### Requirement: Turning on a card type asks about saved progress (baseline, current behaviour)

Turning on evolution, reverse-evolution or cry cards SHALL open a dialog that says the user has saved
progress, whether or not they do (open issue #2310). Reuse SHALL enable the type; Start fresh SHALL also
reset that type's cards in the local session; Cancel SHALL change nothing. Turning a type off, and any
change to alternate forms, SHALL NOT open it.

#### Scenario: First ever enable

- **WHEN** a new user turns on cry cards
- **THEN** the dialog says they have saved progress for cry cards

#### Scenario: Start fresh

- **WHEN** the user chooses Start fresh
- **THEN** the type is enabled and only the local session's cards of that type are reset

Source: `app/settings/page.tsx:603-613`, `app/settings/page.tsx:645-675`, `components/settings/ReenableCardTypeDialog.tsx:58-63`, `app/settings/page.test.tsx:578`, `app/settings/page.test.tsx:644`.

### Requirement: First enable of typed entry shows a banner (baseline, current behaviour)

The first time verified typed entry is turned on, the page SHALL set `typedEntryOnboardingShown` and show
a dismissible banner. Strictness options SHALL show only while typed entry is on.

#### Scenario: Second enable

- **WHEN** `typedEntryOnboardingShown` is already true
- **THEN** no banner shows

Source: `app/settings/page.tsx:618-632`, `app/settings/page.tsx:1097`, `app/settings/page.tsx:1141`, `app/settings/page.test.tsx:893`, `app/settings/page.test.tsx:932`.

### Requirement: Ten collapsible sections under an account block (baseline, current behaviour)

The page SHALL always show the account block, then, once settings have loaded, search, the nudge, the
feedback row and ten sections: Practice schedule, Card types, Audio, Language, Appearance, Offline,
Regional & reminders, Data & backup, About, Advanced. Each section SHALL start collapsed and remember its
state per device under `poke-memory:settings-section:<id>`; Reset progress clears that. While searching, the nudge
SHALL hide and the feedback row SHALL show only if its terms match.

#### Scenario: Return visit

- **WHEN** a user expands Audio and reloads
- **THEN** Audio is open

Source: `app/settings/page.tsx:254-265`, `app/settings/page.tsx:791-855`, `components/settings/CollapsibleSection.tsx:7-23`, `components/settings/CollapsibleSection.tsx:92-100`, `lib/storage/reset.ts:25-38`, `e2e/settings.spec.ts:40`.

### Requirement: Card types is open until first collapsed, and force-open scrolls (baseline, current behaviour)

While `cardTypesDefaultOpenDismissed` is not true, with no filter and no deep link elsewhere, Card types
SHALL be force-opened; the first collapse SHALL set the flag. Every force-open SHALL also scroll the
section into view, so each Settings load before that first collapse SHALL scroll to Card types with no
hash in the URL, and so SHALL clearing a search (open issue #2311). A force-open SHALL also store the
section as open.

#### Scenario: New user opens Settings

- **WHEN** a user who has never collapsed Card types opens `/settings`
- **THEN** Card types is open and the page scrolls to it

#### Scenario: Search cleared

- **WHEN** that user searches and then clears the query
- **THEN** the page scrolls to Card types again

Source: `app/settings/page.tsx:761-781`, `app/settings/page.tsx:1042-1047`, `components/settings/CollapsibleSection.tsx:75-86`.

### Requirement: Deep links resolve once, on mount (baseline, current behaviour)

On mount the page SHALL map a known hash, section or sub-section, to its section and force it open, and
SHALL keep that section visible during search; it stays open on later visits. Opening the known-Pokémon
quiz SHALL set the same target. There SHALL be no listener for later hash changes, so a
link followed while already on Settings SHALL NOT open a collapsed section (open issue #2312).

#### Scenario: Arriving by link

- **WHEN** the user opens `/settings#onboarding-heading`
- **THEN** Data & backup is open

#### Scenario: Remembered after a link

- **WHEN** the user arrives by a link to Audio and later opens `/settings` with no hash
- **THEN** Audio is open

#### Scenario: In-page link

- **WHEN** Audio is collapsed and the user follows the cry-card link to `#audio-heading`
- **THEN** Audio stays collapsed

#### Scenario: Deep link plus a query that matches nothing

- **WHEN** the page was opened by a deep link and the query matches no section
- **THEN** the target section stays and the no-match message does not show

Source: `app/settings/page.tsx:268-319`, `app/settings/page.tsx:527-529`, `app/settings/page.tsx:557-564`, `app/settings/page.tsx:1308-1313`, `components/i18n/LanguageSwitcher.tsx:290-292`, `e2e/settings.spec.ts:94`, `e2e/settings.spec.ts:426`.

### Requirement: Settings search matches a static English index (baseline, current behaviour)

The query SHALL be trimmed, lower-cased and matched as a substring against a fixed term list per section.
Matching sections SHALL show and expand without changing their remembered state. Terms SHALL be English
plus language endonyms, in every app language, so a query in the UI's own language SHALL NOT match
(open issue #2314). The count SHALL be announced through a live region.

#### Scenario: Query clears

- **WHEN** a search expands a collapsed section and the query is cleared
- **THEN** the section is collapsed again

#### Scenario: Japanese UI, Japanese word

- **WHEN** the UI is Japanese and the user searches for 音声
- **THEN** the no-match message shows

Source: `components/settings/settingsSearchIndex.ts:25-265`, `app/settings/page.tsx:510-526`, `app/settings/page.tsx:864-872`, `components/settings/SettingsSearch.tsx:77-89`, `components/settings/CollapsibleSection.tsx:88-90`.

### Requirement: The Language section separates app and name languages (baseline, current behaviour)

The app-language select SHALL offer the four supported locales by endonym. The enrolment list SHALL add
or remove a locale from `learningLocales`, keeping `removedLocales` in step; English SHALL be locked on.
Removing the active language SHALL first ask for inline confirmation, then switch active to English.

#### Scenario: Remove the active language

- **WHEN** the user unticks the active language
- **THEN** a confirmation shows and nothing is saved until confirmed

#### Scenario: Re-enrol

- **WHEN** the user ticks a tombstoned locale
- **THEN** it leaves `removedLocales`

Source: `app/settings/page.tsx:1485-1502`, `app/settings/page.tsx:1514-1585`, `app/settings/page.tsx:1586-1629`, `app/settings/page.test.tsx:1561`, `app/settings/page.test.tsx:1659`, `app/settings/page.test.tsx:1743`.

### Requirement: Appearance controls (baseline, current behaviour)

Intensity and mobile navigation SHALL save on change. In `hamburger` mode the bottom tab bar SHALL hide
and the drawer SHALL show, updating on the next settings save with no reload; the Footer SHALL hide in
`bottom` mode.

#### Scenario: Switch to hamburger

- **WHEN** the user turns off the bottom bar
- **THEN** the drawer replaces it at once

Source: `app/settings/page.tsx:1660-1667`, `app/settings/page.tsx:1681-1691`, `components/MobileNavSlot.tsx:31-41`, `components/BottomTabBar.tsx:167-180`, `components/Footer.tsx:35`.

### Requirement: Regional and reminder controls (baseline, current behaviour)

The timezone select SHALL list `Intl.supportedValuesOf("timeZone")`, or a fixed list without that API.
Date format SHALL offer dmy, mdy and iso, showing today in each. The reminder select SHALL offer a default
plus each hour 00:00 to 23:00. `PushOptIn` SHALL show only when signed in.

#### Scenario: Hour cleared

- **WHEN** the user picks the default option
- **THEN** `pushNotificationHour` is null

Source: `app/settings/page.tsx:74-111`, `app/settings/page.tsx:1744-1764`, `app/settings/page.tsx:1775-1816`, `app/settings/page.tsx:1830-1859`, `app/settings/page.tsx:1864-1866`, `e2e/settings.spec.ts:1014`.

### Requirement: Show onboarding again resets every flag (baseline, current behaviour)

The button SHALL replace `onboarding` with `DEFAULT_ONBOARDING`, counters included, and stamp
`onboardingResetAt`. `typedEntryOnboardingShown` and `mcCardOnboardingShown` SHALL stay set.

#### Scenario: Return to Practice

- **WHEN** the user presses it and opens Practice
- **THEN** the first-visit modal opens again

Source: `app/settings/page.tsx:1905-1915`, `lib/settings/persistence.ts:212-256`, `db/migrations/038_user_settings_reject_regression_trigger.sql:178-195`, `e2e/onboarding.spec.ts:74`, `e2e/onboarding.spec.ts:216`.

### Requirement: Restore from cloud saves the raw cloud blob (baseline, current behaviour)

The action SHALL ask for confirmation, show only when signed in with no superuser flag on, and replace
cards, streak and grade log from the cloud. It SHALL save the pulled settings as they are, without the
device-local protection a normal pull has, and SHALL restore timezone and date format but not the push
hour (open issue #2317).

#### Scenario: Blob without device-local keys

- **WHEN** the user restores and the cloud blob has no `appVisitCount`
- **THEN** `appVisitCount` reads as 0 on this device

#### Scenario: Reminder hour

- **WHEN** the cloud holds a push hour that differs from this device's
- **THEN** this device keeps its own

Source: `app/settings/page.tsx:1987-1992`, `components/settings/ForcePullSection.tsx:42-44`, `components/settings/ForcePullSection.tsx:62-81`, `lib/sync/pullAndMerge.ts:223`, `lib/sync/pullAndMerge.ts:238`.

### Requirement: Destructive actions and developer tools are gated (baseline, current behaviour)

Reset all progress SHALL require typing RESET and SHALL be disabled while a superuser flag is on. It SHALL
keep the favourite and hearts and clear the theme, learn-first list and offer marker. Delete account SHALL
show only when signed in and be disabled while a superuser flag is on. The Developer block SHALL show only
when superuser is unlocked; QA seed SHALL show only with its flag on and SHALL state that the page must be
reloaded.

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on
- **THEN** reset and delete are disabled and `handleReset` returns without acting

Source: `app/settings/page.tsx:678-702`, `app/settings/page.tsx:2103`, `app/settings/page.tsx:2221`, `app/settings/page.tsx:2245`, `app/settings/page.tsx:2252-2282`, `components/settings/ResetProgressDialog.tsx:41-43`, `components/settings/QaSeedSection.tsx:50-58`, `lib/favourite/favourite.ts:83-91`, `app/settings/page.test.tsx:2125`.

### Requirement: About shows versions and legal links (baseline, current behaviour)

About SHALL show `v` plus `NEXT_PUBLIC_APP_VERSION`, or `dev` without it, and the controlling service
worker's state; when both versions are known and differ, it SHALL show a mismatch warning. It SHALL link
to What's New, the company site, Privacy and Terms.

#### Scenario: Stale worker

- **WHEN** the service worker reports a different version from the app
- **THEN** a warning names both

Source: `app/settings/page.tsx:2004-2038`, `app/settings/page.tsx:2071-2084`, `app/settings/page.test.tsx:2054`.

### Requirement: Some Settings copy is English in every language (baseline, current behaviour)

The re-enable and reset dialogs, most of the known-Pokémon quiz, the recall-target hint title, the reset
and delete error messages and the optimiser's error messages SHALL render as fixed English in every app
language (open issue #2314). The English-leak gate SHALL run only `*.i18n-leak.test.tsx` files, none of
which covers these.

#### Scenario: Japanese UI

- **WHEN** the app language is Japanese and the user turns on cry cards
- **THEN** the dialog reads in English, with an English card-type name

Source: `components/settings/ReenableCardTypeDialog.tsx:58-85`, `components/settings/ResetProgressDialog.tsx:60-69`, `components/onboarding/KnownPokemonQuiz.tsx:367-381`, `components/onboarding/KnownPokemonQuiz.tsx:430-438`, `app/settings/page.tsx:247-251`, `app/settings/page.tsx:682`, `app/settings/page.tsx:697`, `app/settings/page.tsx:927`, `components/settings/FsrsOptimizerSection.tsx:88-123`, `package.json:30`.

### Requirement: First-visit modal on Practice (baseline, current behaviour)

`/` SHALL mount the modal, which SHALL open while `firstVisitOnboardingDismissed` is not true, including
after any settings save that clears it. Close, Get started, Escape and the Audio settings link SHALL set
the flag. The guest storage section SHALL show only once auth resolves to no user. While open, `#app-root`
SHALL be inert and aria-hidden, scroll locked and Tab trapped. On close it SHALL try to restore focus, but
that call runs before `#app-root` stops being inert (open issue #2316).

#### Scenario: Dismissed once

- **WHEN** the user closes the modal and reloads
- **THEN** it stays closed

#### Scenario: Signed-in visitor

- **WHEN** a signed-in user sees the modal
- **THEN** the guest storage section is absent

Source: `app/page.tsx:104`, `components/onboarding/FirstVisitOnboardingModal.tsx:60-70`, `components/onboarding/FirstVisitOnboardingModal.tsx:77-97`, `components/onboarding/FirstVisitOnboardingModal.tsx:99-164`, `components/onboarding/FirstVisitOnboardingModal.tsx:170`, `components/onboarding/FirstVisitOnboardingModal.tsx:259-262`, `e2e/onboarding.spec.ts:14`, `e2e/onboarding.spec.ts:254`.

### Requirement: One-shot hints (baseline, current behaviour)

`OnboardingHint` SHALL render nothing until its flag is read, then show until dismissed, re-reading on
every settings save. Dismissing SHALL set only its flag, read fresh from storage. Flags SHALL parse with
`=== true`, and counters SHALL be non-negative integers or 0. A sign-up nudge, the only hint for guests
alone, is listed in the next requirement.

#### Scenario: Reset elsewhere

- **WHEN** another surface resets onboarding while a hint is mounted
- **THEN** the hint reappears with no reload

#### Scenario: Flag absent from an older blob

- **WHEN** a blob predates a flag
- **THEN** the flag reads as false and the hint may show

Source: `components/onboarding/OnboardingHint.tsx:63-93`, `lib/settings/persistence.ts:952-1003`.

### Requirement: Nudge gates (baseline, current behaviour)

The four Practice nudges SHALL each need the first visit done. The scope nudge SHALL also need an empty
scope, scope never opened and at least 3 sessions. The offline nudge SHALL also need no offline download, superuser guard
off, and at least 3 slow loads or 5 sessions. The mastery-blockers nudge SHALL also need a blocked
species and that preset off. Higher-or-Lower SHALL also need two Pokémon seen. The guest sign-up nudge, on
Stats and Journey for guests only, SHALL need 10 mastered species or 3 sessions.

#### Scenario: Guest with three sessions

- **WHEN** a guest with 3 sessions and no mastered species opens Stats
- **THEN** the nudge shows its low-mastery copy

#### Scenario: First-visit modal still open

- **WHEN** a user with a blocked species has not dismissed the first-visit modal
- **THEN** the mastery-blockers nudge stays hidden

#### Scenario: Visit count

- **WHEN** two browser sessions have been counted
- **THEN** the install nudge stays hidden, and it needs 3 on a platform that can install

Source: `components/review/ReviewSession.tsx:127-137`, `components/review/ReviewSession.tsx:942-947`, `components/review/ReviewSession.tsx:1199-1202`, `components/review/ReviewSession.tsx:1236-1239`, `components/review/ReviewSession.tsx:1838-1843`, `components/onboarding/GuestSignUpNudge.tsx:9-12`, `components/onboarding/GuestSignUpNudge.tsx:52-55`, `components/onboarding/PwaInstallNudge.tsx:12-13`, `components/onboarding/PwaInstallNudge.tsx:26-34`, `components/onboarding/PwaInstallNudge.tsx:68-75`, `app/stats/page.tsx:468`, `app/journey/page.tsx:666`.

### Requirement: Mark Pokémon I already know (baseline, current behaviour)

The quiz SHALL list untouched name cards in `pokemonNameLocale`, grouped by generation, with alternate
forms only when enabled, and build a session when none exists. Apply SHALL grade each chosen card Easy
through the normal scheduler, never as mastered, append a grade-log entry stamped in the user's timezone,
and queue a cloud upsert. While a superuser flag is on, Apply SHALL be disabled.

#### Scenario: Nudge button

- **WHEN** the user presses the discovery nudge's button
- **THEN** Practice schedule and the closed-by-default quiz open and `markWhatIKnowNudgeDismissed` is saved

#### Scenario: Two enrolled languages

- **WHEN** a chosen species has cards in two locales
- **THEN** only the active locale's card is graded

#### Scenario: Card already started

- **WHEN** a selected card has `firstSeen` set
- **THEN** it is left unchanged

#### Scenario: Guest

- **WHEN** a guest applies
- **THEN** the session and grade log change locally and no cloud write happens

Source: `app/settings/page.tsx:489-505`, `app/settings/page.tsx:875-889`, `components/onboarding/KnownPokemonQuiz.tsx:165-201`, `components/onboarding/KnownPokemonQuiz.tsx:269-357`, `components/onboarding/KnownPokemonQuiz.tsx:461-469`, `lib/onboarding/applyKnownGrades.ts:38-40`, `lib/onboarding/applyKnownGrades.ts:58-76`, `lib/onboarding/applyKnownGrades.ts:93-110`.

### Requirement: App language comes from a cookie, not the URL (baseline, current behaviour)

The app SHALL support `en`, `ja`, `zh-Hans` and `zh-Hant` with no locale in the URL. The server SHALL read
`poke-memory:locale`, fall back to `en` for a missing or unsupported value, and load that catalogue.
`xx-pseudo` SHALL be reachable only from tests. The cookie is not part of settings, so it SHALL NOT follow
the user across devices. `<html lang>` SHALL be `en` in every language (open issue #2315).

#### Scenario: Unsupported cookie

- **WHEN** the cookie holds `fr` or `xx-pseudo`
- **THEN** the app renders in English

#### Scenario: Japanese app

- **WHEN** the cookie is `ja`
- **THEN** the UI is Japanese and `<html lang>` is `en`

Source: `i18n/locales.ts:8-15`, `i18n/request.ts:37-61`, `components/i18n/LocaleProvider.tsx:16-29`, `app/layout.tsx:97-104`, `components/test-utils/renderWithIntl.tsx:48-53`.

### Requirement: Switching app language writes a cookie then refreshes (baseline, current behaviour)

The Server Action SHALL ignore an unsupported locale and set the cookie for a year on `/`, `sameSite=lax`,
readable by scripts, `secure` only over HTTPS by `x-forwarded-proto`. The select SHALL update first, then
refresh the route after the action resolves. A failed action SHALL show nothing while the select keeps
the new value (open issue #2313).

#### Scenario: Online switch

- **WHEN** the user picks Japanese online
- **THEN** the cookie is `ja` and the page re-renders in Japanese with no reload

#### Scenario: Offline switch

- **WHEN** the action fails offline
- **THEN** the select shows Japanese and the UI and cookie stay as they were

Source: `lib/i18n/actions.ts:18-38`, `lib/i18n/actions.test.ts:1`, `app/settings/page.tsx:1488-1494`, `e2e/i18n.spec.ts:203`.

### Requirement: The name language is separate from the app language (baseline, current behaviour)

`PokemonLocaleProvider` SHALL be the single subscription to settings saves and storage events, giving the
active locale and enrolled set. `useLocalePokemonName` SHALL return the English name first, then the
localised name and transliteration once the sidecar loads, and keep English when a name is missing.

#### Scenario: English active

- **WHEN** the active locale is `en`
- **THEN** no sidecar is loaded and the English name stays

#### Scenario: Non-English app, English names

- **WHEN** the cookie is `ja` and the active name locale is `en`
- **THEN** the chrome is Japanese and Pokémon names are English

Source: `lib/i18n/PokemonLocaleContext.tsx:55-77`, `lib/i18n/PokemonLocaleContext.tsx:95-131`, `lib/i18n/useLocalePokemonName.ts:48-83`, `components/i18n/PokemonLocaleContext.test.tsx:1`.

### Requirement: The language pill switches only names (baseline, current behaviour)

The pill SHALL show even with only English enrolled, list enrolled locales with cached due badges and
write `activePokemonNameLocale`, updating names with no reload. While a card is revealed when the panel
opens, choosing another language SHALL be blocked with a prompt to grade first. Escape, an outside press or a
choice SHALL close it; Tab SHALL stay inside; keydowns SHALL stop propagating while open. A zero count SHALL
read as caught up with history, and as no cards yet without.

#### Scenario: Card revealed

- **WHEN** a card is revealed and the user picks another language
- **THEN** nothing changes and the panel stays open

Source: `components/i18n/LanguageSwitcher.tsx:96-146`, `components/i18n/LanguageSwitcher.tsx:162-185`, `components/i18n/LanguageSwitcher.tsx:221-253`, `components/profile/ProfileStatusBar.tsx:116`, `components/review/StreakBadge.tsx:218`.

### Requirement: Machine-translation banner (baseline, current behaviour)

Outside English the banner SHALL show until dismissed for that locale, in the root layout and inside the
first-visit modal. Dismissing SHALL write `poke-memory:mt-banner-dismissed:<locale>` and add the locale to
`dismissedMtBannerLocales`. `useAppLocale` SHALL read the cookie once and re-read only on a `storage` event,
so a same-tab language switch SHALL leave the banner on the old locale until a reload, and the two banners
SHALL not see each other's dismissal (open issue #2313).

#### Scenario: English

- **WHEN** the app language is English
- **THEN** no banner renders

#### Scenario: Switch to Japanese in Settings

- **WHEN** the user switches from English to Japanese with no reload
- **THEN** no banner shows until the page is reloaded

#### Scenario: Dismissed on another device

- **WHEN** a pull brings a cloud dismissal
- **THEN** it is written to the local key, and a mounted banner stays until its next mount

#### Scenario: Reset progress

- **WHEN** a user who dismissed the banner resets progress
- **THEN** the standalone key is cleared and the banner returns until a pull rewrites the key

#### Scenario: Cookie set before load

- **WHEN** the page loads with cookie `ja` and no dismissal
- **THEN** the banner shows

Source: `components/i18n/MachineTranslationBanner.tsx:40-79`, `components/onboarding/FirstVisitOnboardingModal.tsx:211`, `app/layout.tsx:198`, `lib/i18n/useAppLocale.ts:17-27`, `lib/i18n/useAppLocale.ts:38-56`, `lib/sync/pullAndMerge.ts:263-278`, `lib/storage/reset.ts:25-38`, `e2e/i18n.spec.ts:65`.

### Requirement: Catalogue integrity is checked in lint (baseline, current behaviour)

`lint:i18n` SHALL fail when `ja`, `zh-Hans` or `zh-Hant` has a missing or extra key against `en`, or any of
the four has a duplicate key. `lint:pseudo-locale` and its workflow SHALL fail when `xx-pseudo.json` is not
the bracketed regeneration of `en.json`. Today all five catalogues hold 1027 leaf keys.

#### Scenario: New English key only

- **WHEN** a key is added to `en.json` alone
- **THEN** `lint:i18n` and the pseudo-locale check fail

Source: `scripts/lint-i18n.mjs:1-26`, `scripts/generate-pseudo-locale.mjs:1-41`, `package.json:17-18`, `.github/workflows/pseudo-locale-drift.yml:12-18`, `.github/workflows/i18n-leak.yml:21-31`, `lib/i18n/lint-i18n.test.ts:1`.

### Requirement: Type names come from one helper (baseline, current behaviour)

The Pokédex, Pasture, scope pills and Stats type breakdown SHALL render type names through `getTypeName`,
using the `types` catalogue group of 18 names.

#### Scenario: Japanese

- **WHEN** the app language is Japanese
- **THEN** `fire` renders from the Japanese catalogue

Source: `lib/i18n/typeNames.ts:33-38`, `components/stats/TypeBreakdown.tsx:7`, `lib/i18n/typeNames.test.ts:1`.

### Requirement: Theme colours resolve from the species palette (baseline, current behaviour)

A pre-paint inline script SHALL apply stored colours and intensity before hydration. The provider SHALL
then apply the species' current palette (curated, else generated, else primary type) over the stored
colours, keeping stored colours if the palette module fails, and SHALL refresh on settings saves and storage
events, ignoring a slow resolve that a newer one has passed. A stored theme with an unknown species id or a
non-hex colour SHALL read as no theme.

#### Scenario: Palette fix ships

- **WHEN** a species' palette changes after a player stored its theme
- **THEN** the new colours apply on next load

#### Scenario: Mastery lapsed

- **WHEN** the species of a held theme is no longer mastered
- **THEN** the theme stays on load

#### Scenario: Invalid stored colour

- **WHEN** a stored theme has a non-hex colour
- **THEN** no theme applies

Source: `app/layout.tsx:114`, `components/theme/FavouriteThemeProvider.tsx:27-33`, `components/theme/FavouriteThemeProvider.tsx:54-115`, `lib/theme/apply.ts:3-17`, `lib/theme/stored-theme.ts:34-57`, `lib/theme/palette.ts:16-20`.

### Requirement: Intensity sets one attribute (baseline, current behaviour)

`accents` SHALL remove `data-intensity` from `<html>`; `tinted` and `full` SHALL set it. The watermark SHALL
show only at those two, with the favourite-theme sprite or a Poké Ball.

#### Scenario: Accents

- **WHEN** intensity is `accents`
- **THEN** there is no attribute and no watermark

Source: `lib/theme/intensity.ts:12-20`, `components/theme/ThemeWatermark.tsx:23-84`, `components/theme/intensity.test.tsx:1`.

### Requirement: The theme is a mastery reward, the favourite is not (baseline, current behaviour)

Any default-form species MAY be chosen as favourite. Choosing a theme SHALL be limited to mastered species,
with a locked state when none are mastered. The current theme SHALL show with Remove even when its mastery
has lapsed. Mastery counts in any enrolled language, with both name and reverse legs. When superuser
flags go off after a cards pull, a theme not earned by that test SHALL be removed.

#### Scenario: Superuser exit

- **WHEN** a theme was chosen under `pretendAllMastered` and the flag goes off with the species unmastered
- **THEN** the theme is removed

#### Scenario: Nothing mastered

- **WHEN** a user has mastered nothing
- **THEN** the locked state shows a link to Practice and no theme search

Source: `components/favourite/FavouriteSettings.tsx:53`, `components/favourite/FavouriteSettings.tsx:103-125`, `components/favourite/FavouriteSettings.tsx:131-156`, `lib/theme/persistence.ts:67-100`, `lib/superuser/SuperuserContext.tsx:258-271`, `app/settings/page.test.tsx:1260`.

### Requirement: Labs is empty infrastructure (baseline, current behaviour)

`LABS_FLAGS` SHALL be empty, so `labsFlags` parses to `{}` and any stored key is dropped. Settings SHALL have
no Labs section and no component SHALL call `useLabsFlag`. `isLabsFlagEnabled` SHALL return false for an
unknown key. Multi-language is always on.

#### Scenario: Old languages flag

- **WHEN** a stored blob has `labsFlags.languages: true`
- **THEN** it is dropped on read

Source: `lib/labs/flags.ts:33`, `lib/labs/flags.ts:65-92`, `lib/labs/useLabsFlag.ts:22-48`, `lib/i18n/PokemonLocaleContext.tsx:12-14`, `lib/labs/flags.test.ts:1`.
