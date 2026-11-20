## ADDED Requirements

### Requirement: The optimiser runs on its own cross-origin-isolated page

The optimiser SHALL run in the browser on `/settings/optimiser`, served with
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on that path
only. The binding's wasm build SHALL run in a Web Worker on that page. The Settings optimiser section
SHALL link to the page. `/api/srs/optimize` and the native binding SHALL be gone. Progress SHALL be
announced in a live region, and every state SHALL be translated.

#### Scenario: Isolation only on that page

- **WHEN** a production build serves `/settings/optimiser` and `/settings`
- **THEN** `crossOriginIsolated` is true on the optimiser page and false on Settings, so images elsewhere keep loading

#### Scenario: Japanese locale

- **WHEN** the app language is `ja`
- **THEN** the running, done, not enough reviews, weekly limit, unsupported browser and error states read in Japanese

#### Scenario: Screen reader

- **WHEN** a fit is running
- **THEN** its progress is announced through the live region

#### Scenario: Offline

- **WHEN** the page is opened with no connection
- **THEN** the grade log read fails and the page shows the error state, with nothing saved

Source (planned): design D7, `app/settings/optimiser/page.tsx`, `next.config.ts` headers.

### Requirement: Browsers that cannot run the optimiser see a plain message

When the page is not cross-origin isolated, or the browser lacks wasm threads, the page SHALL show a
plain translated "not supported in this browser" message and SHALL NOT start a fit.

#### Scenario: No wasm threads

- **WHEN** the browser has no `SharedArrayBuffer`
- **THEN** the unsupported message shows and no Web Worker starts

#### Scenario: Other pages unaffected

- **WHEN** the same browser opens Practice or Settings
- **THEN** they work as before

Source (planned): design D7, `app/settings/optimiser/page.tsx`.

### Requirement: Who can run the optimiser on its page

The page SHALL ask a guest to sign in and run no fit. For a signed-in player it SHALL fit only when the
fittable review count from the cloud grade log is at least 200, and otherwise show the not enough
reviews state with that count; this count can be lower than the local count on Settings, and the state
then asks the player to sync first. The run button SHALL be disabled during any superuser flag, during a
run, and when the local fittable count is under 200.

#### Scenario: Guest opens the page

- **WHEN** a guest opens `/settings/optimiser`
- **THEN** a sign-in prompt shows and no grade log is read

#### Scenario: Signed in, reviews not yet synced

- **WHEN** the cloud log has fewer than 200 fittable reviews
- **THEN** the not enough reviews state shows the count and no fit runs

#### Scenario: Superuser flag on

- **WHEN** the page renders with any superuser flag on
- **THEN** the button is disabled and nothing is saved

#### Scenario: Too few local reviews

- **WHEN** the signed-in player's local fittable count is under 200
- **THEN** the button is disabled, the count shows and no grade log is read

Source (planned): design D7, `lib/srs/optimizer.ts` (`MIN_REVIEWS_FOR_OPTIMIZATION`),
`app/settings/optimiser/page.tsx`.

### Requirement: The settings merge enforces the optimiser's weekly limit

The Worker's settings merge SHALL refuse, with 23514, a patch whose `fsrsWeightsOptimizedAt` is later
than the stored value by less than `OPTIMIZER_COOLDOWN_MS` (7 days), so a second device or a stale page
cannot save a second run within a week.

#### Scenario: Two devices in one week

- **WHEN** a phone and a laptop start a fit at the same time and the phone saves first
- **THEN** the laptop's save fails with 23514 and its page shows the weekly limit state

#### Scenario: A week later

- **WHEN** a run is saved 7 days or more after the stored one
- **THEN** the merge accepts it

Source (planned): design D7, `lib/db/rpc/mergeUserSettings.ts`, `lib/srs/optimizer.ts`.

## RENAMED Requirements

- FROM: `### Requirement: The route reads the whole grade log, without locale (baseline)`
- TO: `### Requirement: The optimiser page reads the whole cloud grade log`

## MODIFIED Requirements

### Requirement: Optimiser input groups a player's reviews by card (baseline)

`gradeLogToOptimizerItems` SHALL skip entries without a subject key, group the rest by card type,
subject key and locale (a missing locale counts as "en"), sort each group by `occurredAt`, map grades
1, 2, 4, 5 to ratings 1, 2, 3, 4, and build one item per review prefix of each group: its first two
reviews, its first three, and so on to the whole history. (Assumed from #2392's finding that one item
per card gives `NotEnoughData`; to be confirmed by task 6.1.)

#### Scenario: Legacy entry

- **WHEN** an entry has no subject key
- **THEN** it is dropped

#### Scenario: Same card in two locales

- **WHEN** entries for one subject carry `en` and `ja`
- **THEN** they form separate groups

#### Scenario: Four reviews of one card

- **WHEN** a card has four reviews
- **THEN** it gives three items, of two, three and four reviews

#### Scenario: A large log

- **WHEN** a log of about 19,000 reviews is fitted
- **THEN** `computeParameters` returns parameters rather than `NotEnoughData`

Source (planned): `lib/srs/optimizer.ts`; tests `lib/srs/optimizer.test.ts`; #2392.

### Requirement: One optimiser run a week (baseline)

Before a fit the page SHALL read the last-run date (`fsrsWeightsOptimizedAt`) from the player's cloud
settings row, and while it is under 7 days old SHALL show the weekly limit state with the days left,
rounded up, and run nothing. If that read fails it SHALL show the error state and run nothing. The
settings merge refuses a second save within the week as well.

#### Scenario: Second run on day three

- **WHEN** the last run was 3 days ago
- **THEN** the weekly limit state shows 4 days left and no grade log is read

#### Scenario: Stored state unreadable

- **WHEN** the settings read fails
- **THEN** the error state shows and no fit runs

#### Scenario: Settings just after a successful run

- **WHEN** a run succeeds and the page stays open
- **THEN** the button is disabled and shows the days left

#### Scenario: Settings after a reload

- **WHEN** the player reloads the optimiser page two days after a successful run
- **THEN** the page reads the date from the cloud row and shows 5 days left

Source (planned): `app/settings/optimiser/page.tsx`, `lib/srs/optimizer.ts` (`OPTIMIZER_COOLDOWN_MS`).

### Requirement: The optimiser page reads the whole cloud grade log

The page SHALL read the player's grade log through the data client, oldest first, page by page, with
`locale`, so items are grouped as the Settings count groups them (#2252). A failed page SHALL show the
error state and run no fit.

#### Scenario: Over 1,000 rows

- **WHEN** a player has more rows than one page
- **THEN** all pages are read before the fit

#### Scenario: Two learning languages

- **WHEN** one card has cloud rows in `en` and `ja`
- **THEN** the fit sees them as two groups, matching the count on Settings

#### Scenario: A page fails

- **WHEN** the second page of the read fails
- **THEN** the error state shows and no fit runs

Source (planned): `app/settings/optimiser/page.tsx`, `lib/sync/paginatedFetch.ts`, `lib/db/client.ts`.

### Requirement: Fit results and failures (baseline)

The page SHALL run `computeParameters` in its Web Worker with short-term mode on. A throw from the fit
SHALL show the error state with a detail of at most 200 characters. Success SHALL save `fsrsWeights` and
`fsrsWeightsOptimizedAt` through the existing settings push (`merge_user_settings`) and show the done
state. A failed save SHALL show the error state and keep the stored weights.

#### Scenario: Binding rejects the data

- **WHEN** `computeParameters` throws
- **THEN** the error state shows, with the message as detail for an Error or a string, and "internal_error" for anything else or an empty message

#### Scenario: Save fails

- **WHEN** the settings push returns an error
- **THEN** the error state shows and the cloud weights are unchanged

#### Scenario: Superuser flag turned on during a run

- **WHEN** a superuser flag is switched on while a fit runs
- **THEN** the write guard suppresses the save

Source (planned): `app/settings/optimiser/page.tsx`, `app/settings/optimiser/worker.ts`,
`lib/srs/optimizer.ts`, `lib/sync/settings.ts`.

## REMOVED Requirements

### Requirement: Who can run the optimiser (baseline)

**Reason**: It described `POST /api/srs/optimize` and its 401 and 422 answers; the route is removed.

**Migration**: Replaced by "Who can run the optimiser on its page", with the same minimum of 200
fittable reviews and the same superuser and guest rules.

### Requirement: A running or failed fit blocks new runs for five minutes (baseline)

**Reason**: The in-progress stamp guarded a server function. The fit now runs on the player's device,
the button is disabled while it runs, and a failed run can be retried at once.

**Migration**: None needed; the weekly limit still applies to saved runs.
