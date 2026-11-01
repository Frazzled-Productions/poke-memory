## Why

"Optimise now" runs an expensive fit on the server, limited to one a week per account. Today that limit
and an in-progress marker live with the user's synced preferences in `user_settings`, and the route
checks them in two steps (its own comment notes that the atomic version would need a migration). A
limit that guards server work should be owned by the server and claimed in one step. The marker also
sits unused for five minutes after a request that never fitted, which blocks a retry after syncing.
Refs ops #404 (held privately in Frazzled-Productions/ops).

## What Changes

- **The server owns the weekly limit.** A new `optimizer_runs` table, with RLS on and no client
  policies, holds when each account last claimed a run.
- **One atomic claim.** A new `claim_optimizer_slot()` RPC claims for `auth.uid()` in a single
  statement, so of any number of concurrent requests one runs and the rest get 429 `cooldown`.
- **A per-IP bucket.** `check_rate_limit` gains an `optimize` action: 3 in 10 minutes, 10 in an hour.
- **The route checks before it claims.** Order: session, IP bucket, grade log read, review count,
  claim, fit, save. A request that could not fit yet spends nothing.
- **A claim is spent whatever the fit does.** A failed run counts as that week's run (open call 2).
- **`user_settings` stops deciding anything.** The route no longer reads it. The in-progress key is
  gone. `fsrsWeightsOptimizedAt` stays as the date the Settings screen shows (open call 1).

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, What's new:** no change, none of
  them call the route. Scheduling reads `fsrsWeights`, which is unchanged.
- **Settings:** one copy change, in English only like its neighbours: `save_failed` now says "Try again
  next week", because the slot is spent. A full IP bucket reuses the 429 path and shows "Try again in 1
  day" through `optimizerRetryAfter`, so no new string. Another device whose date is out of date shows
  a live button, then the same 429 message.
- **Guest mode (localStorage):** no change, the route is signed-in only and the section tells guests to
  sign in.
- **Cloud sync and Supabase migrations (both projects):** migration 050 adds the table and RPC, restates
  `check_rate_limit`, widens `rate_limit_buckets_action_check` and removes the in-progress key from
  `user_settings.settings`. Sync does not read the table. `fsrsWeightsOptimizedAt` keeps syncing as it
  does. The migration must be on both projects before the route ships; the old route works alongside it.
- **Superuser mode and QA-seed scenarios:** no code change, the button is already disabled by the write
  guard. Testing a second run on QA now means clearing the `optimizer_runs` row with SQL.
- **Locales:** no new catalogue keys. en, ja, zh-Hans, zh-Hant and the pseudo-locale are unchanged.
- **Push notifications and the service worker (offline):** no change, an offline press already fails at
  `fetch`.
- **Sign-in:** no change. The session check is the same and the bucket uses the existing hash.
- **Account deletion and progress reset:** the FK cascades on deletion. `reset_all_progress` leaves the
  row, so a reset does not free the slot.
- **Privacy notice and sub-processors:** no change here. The table holds a user id and a timestamp for
  an operational limit, under the optimiser purpose already listed. Disclosure of hashed IPs is a known
  open point in ops, and this adds one more use of them.
- **Data export:** no change, the export carries review history, not limits.
- **Accessibility, README screenshots:** no change.
- **Changelog fragments and the release:** one `changed` fragment. `migration-check.yml` fails the PR
  until QA has migration 050 (`docs/persistence.md`).
- **CI and GitHub Actions:** no workflow change. `integration-tests.yml` already runs on
  `db/migrations/**`.

## Removes

- `fetchUserSettings`, its row type and the settings read in the route.
- The `fsrsOptimizingAt` stamp, its five-minute check and the key on existing rows.
- The route comment describing the migration-free strategy.

## Out of scope

- A "last optimised" read from the server (open call 1).
- A retry after a failed run (open call 2).
- Other findings from the same audit (ops #378).
- Bounding the grade log read before the claim, beyond the IP bucket (open call 4).

## Owner decisions relied on

- 2026-10-21: every change goes through OpenSpec, bug fixes included, with spec on touch.
- 2026-10-22: never archive by hand.

## Clarifications

No grilling yet: this proposal was drafted by a scheduled run, so every call below is open for Fraser.
Each has a recommended answer, which the documents and the spike assume.

- 2026-11-02 Open call 1: the brief says to remove both settings fields, but `fsrsWeightsOptimizedAt` is
  also what Settings shows for "Last optimized" and the countdown, on every device. Recommended: keep it
  as display only, because the route ignores it and removing it needs a new status route for one date.
- 2026-11-02 Open call 2: should a failed fit spend the week? Recommended: yes. The degenerate-data
  message already says "try again in a few weeks", and any refund a session can trigger would undo the
  limit. The cost is a person losing a week after a crash or a failed save, so "save_failed" copy
  changes. The alternative is a refund through a service-role call in the route, which adds a key to it.
- 2026-11-02 Open call 3: are 3 in 10 minutes and 10 in an hour right for the bucket? Recommended: keep
  them. A person presses this at most weekly, and a shared address only meets the cap if several people
  press within minutes.
- 2026-11-02 Open call 4: requests read the grade log before the claim, so one already in cooldown still
  costs that read. Recommended: accept it, the IP bucket bounds it and the button is disabled in
  cooldown. The alternative is a second RPC that only reports the time left.
- 2026-11-02 Open call 5: how much of the reason goes in this public PR? Recommended: this wording, with
  the detail staying in ops #404.
- 2026-11-02 Open call 6: carry today's dates into the new table? Recommended: no. The stored value is
  not validated, so a cast could fail the migration, and the only effect is one early run for anyone
  inside a window when it ships.
