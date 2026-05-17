# Sync

Cross-device sync for authenticated users. Guest mode is browser-local only — none of this applies.

This file is the canonical reference for `lib/sync/`, `app/api/sync/route.ts`, the regression trigger on `card_reviews`, and the per-card conflict rule on background pulls. AGENTS.md keeps a short pointer here. Read this before touching anything in `lib/sync/`, `app/api/sync/route.ts`, `db/migrations/`, or any code that pushes to Supabase.

## Invariants and destructive-write protection (READ FIRST)

The rules below exist because of incidents that have already happened (#293 wiped 2497 of 2513 cloud rows to zero state) and are enforced both in code and at the database layer.

### Order constraints

- **Pull-before-push wherever an orchestrator merges cloud and local cards.** Today the only path that does this is `pullAndMerge` (`lib/sync/pullAndMerge.ts`), driven by `useVisibilityPull` and `useSignInPull`. Its order is `pullSession` → `mergeCloudIntoLocalSilent` → `saveSession`; it does **not** push back, by design. If you add a future orchestrator that does push, the order must be load local → `pullSession` → merge → save → push the merged result. Pushing first lets stale or emptied local state overwrite real cloud progress through the `(user_id, card_type, subject_key)` upsert key.
- **Brand-new device (`loadSession()` returned `null`).** `pullAndMerge` handles this by building a fresh base session, merging cloud rows into it, and saving — it never pushes the merged result. Any future write path must preserve that property: the merged state is entirely cloud-sourced, so pushing it back is wasted bandwidth and widens the window for a future regression.
- **If `pullSession` fails, do not push.** Pushing without knowing cloud state is the exact failure mode of #293. The same rule applies to anywhere else you sync: cards, streak, settings, future tables. Pull first, decide, then push.

### Database trigger (`card_reviews_reject_regression_trigger`, migration 002, extended in 015, 016, and 017)

A `BEFORE UPDATE` trigger on `card_reviews` raises `23514 check_violation` when:

- `OLD.last_review IS NOT NULL AND NEW.last_review IS NULL` — un-reviewing a card.
- `OLD.first_seen IS NOT NULL AND NEW.first_seen IS NULL` — un-seeing a card.
- `OLD.last_review IS NOT NULL AND NEW.last_review IS NOT NULL AND NEW.last_review < OLD.last_review` — review date moving backward. (The `NEW.last_review IS NOT NULL` predicate was added to the bullet here to mirror the migration 002 SQL; it was always present in the trigger function but had been omitted from the docs bullet — earlier docs were inaccurate.)
- `NEW.reps < OLD.reps` — reps counter decreasing (added in migration 015; FSRS only ever increments this).
- `NEW.lapses < OLD.lapses` — lapses counter decreasing (added in migration 015; same invariant).
- `OLD.last_review IS NOT NULL AND NEW.last_review IS NOT NULL AND NEW.last_review = OLD.last_review AND NEW.scheduled_days < OLD.scheduled_days` — `scheduled_days` dropping without `last_review` advancing (added in migration 016; see below).
- `OLD.seen_in_pasture = true AND NEW.seen_in_pasture = false` — `seen_in_pasture` flipping from `true` to `false` (added in migration 017; the flag is a one-way "user has tapped this card on the Pasture page, clearing the new-arrival sparkle" marker — set by `markSeenInPasture` from `app/pasture/page.tsx`. Any client write that clears it is a sync bug).

`scheduled_days` is intentionally not guarded for absolute non-decrease because legitimate Again grades (FSRS reset) lower it — but Again always advances `last_review` to today. Migration 016 encodes this tighter invariant: a same-date drop in `scheduled_days` is always a stale-state clobber. **Known limitation:** any non-Again re-grade (Hard, Good, or Easy) of a card already reviewed earlier the same calendar day also produces `NEW.last_review = OLD.last_review` with a potentially lower `scheduled_days`, which the trigger would reject. The session design prevents this in practice (each card appears at most once per session), but the trigger has no visibility into session semantics — it is a last-resort DB guardrail, not a complete model of valid FSRS transitions.

**Do not work around the trigger.** A legitimate "reset progress" / "delete account" flow needs a `SECURITY DEFINER` RPC that explicitly bypasses it, plus user confirmation in the calling UI. `reset_all_progress` (migration 018) is that RPC — use it rather than creating a new bypass path.

### Auxiliary sync legs are best-effort

Cards are the primary contract — they flow through `usePerGradeSync` (per-grade debounced upsert) and `useSyncOnUnload` (beacon on page hide). Everything else is best-effort: the regional-prefs leg inside `pullAndMerge`, the `pushSettings` / `pushStreak` / `pushGradeLog` calls inside `AutoSyncOnChange`, and the settings-page write-back of auto-detected regional prefs. Their failures `console.warn` and continue — they must not flip the user-visible sync status into the error state. Surfacing "Sync failed" because the streak push hiccuped is worse than silently degrading.

### Per-table conflict policy

- `card_reviews` — per-card rule in `mergeCloudIntoLocalSilent` (see [Background pull on visibility](#background-pull-on-visibility) for the exact rule).
- `streak_days` — union-merge (`mergeStreak`). Streak data is monotonic; nothing is ever removed by sync. `grade_log` and `streak_days` are **append-only at the DB layer** (migration 018 dropped the UPDATE and DELETE RLS policies on both tables). The only path that removes rows from either table is the `reset_all_progress` SECURITY DEFINER RPC, which also deletes from `card_reviews` atomically and requires an authenticated session. `user_settings` is intentionally **not** touched by this RPC — user preferences survive a progress reset by design.
- `user_settings` — last-write-wins on the whole `settings` JSONB column. The pull-overlay path runs **only** when `hasStoredSettings()` is `false` (i.e. the user has never written settings on this device). Once local has a stored copy, local is authoritative on that device; we still push local up so other devices can pick it up.

### Schema notes

- `user_settings.settings` (jsonb) is the source of truth for per-user settings. The schema is `(user_id, settings, updated_at, timezone, date_format)` after migration 005 dropped the original flat columns from migration 001 and migration 019 added the two regional-prefs scalar columns.
- `user_settings.timezone` (text, nullable, migration 019) and `user_settings.date_format` (text, nullable, CHECK in `('iso','dmy','mdy')`, migration 019) live as scalar columns rather than JSONB fields specifically to avoid the last-write-wins race on the `settings` blob. They are written via `pushRegionalPrefs` (direct UPDATE on the two columns only — NOT via `pushSettings`) and read via `pullRegionalPrefs` inside `pullAndMerge` as a best-effort auxiliary leg. NULL means "no value set in cloud" — the **settings page** is the only place that detects NULL local values, auto-detects from the browser via `detectTimezone` / `detectDateFormat`, saves them locally, and calls `pushRegionalPrefs` to write them back. `pullRegionalPrefs` itself does not write anything to the cloud; it overlays non-null cloud values onto local. Two devices in different locales therefore don't trample each other's deliberate choices.
- `card_reviews` is on FSRS columns (`stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `fsrs_state`) after migration 004. The lifecycle-timestamp guards from migration 002 were unaffected by the swap; migration 015 added guards for `reps` and `lapses` decreasing; migration 016 added a same-date `scheduled_days` drop guard; migration 017 added the `seen_in_pasture` one-way guard.
- `card_reviews` PRIMARY KEY is `(user_id, card_type, subject_key)` after migration 012. The legacy `pokemon_id` integer column was dropped in the same migration.
- `card_reviews.hidden_since` (migration 007, nullable date) is set when a card becomes ineligible under the user's learning filter (#333) and cleared when it becomes eligible again. The session-load reconciliation shifts `due_date` forward by the hidden duration so paused cards don't accumulate overdue debt. The regression trigger does not guard `hidden_since` or `due_date` — both are allowed to move in either direction by design. (The trigger guards lifecycle timestamps from migration 002, `reps`/`lapses` from migration 015, same-date `scheduled_days` drops from migration 016, and the `seen_in_pasture` one-way invariant from migration 017.)
- `card_reviews.seen_in_pasture` (migration 008, boolean default `false`) tracks whether the user has tapped this mastered card on the Pasture page, clearing its new-arrival sparkle (`markSeenInPasture` in `lib/pasture/arrivals.ts`, called from `app/pasture/page.tsx`). The transition from `true` to `false` is rejected by the migration 017 trigger guard — there is no legitimate client action that un-clears the sparkle.
- `grade_log` carries `(card_type, subject_key)` after migration 013. The legacy `card_id` integer column was dropped and the `grade_log_card_type_check` constraint was removed; `card_type` is now validated at the app boundary only. All card directions (name, evolution, reverse, reverse-evolution, cry) are synced.

### Catastrophic recovery

There is no Point-in-Time Recovery on the free tier. Issue #298 tracks the upgrade as a launch blocker. Until PITR is enabled, the trigger and the SQL audit you can run via `mcp__supabase__execute_sql` are the only defenses against an unforeseen sync bug. Treat any production sync change as one-way until PITR is in place.

## Client-cannot-regress checklist

Run through these questions whenever you add a new write path (a new sync leg, a new Server Action that upserts to Supabase) or a new column on a synced table. Each item names the canonical defence and the migration that established it — copy that pattern when adding new state.

1. **Monotonic columns (timestamps and counters).** Does the column only move forward (e.g. `last_review`, `first_seen`, `reps`, `lapses`)? If yes: is movement-backward blocked by `card_reviews_reject_regression_trigger` (migrations 002 / 015 / 016 / 017), or an equivalent `BEFORE UPDATE` trigger on the new table? The trigger raises `check_violation`; copy the structure from `db/migrations/017_card_reviews_pasture_one_way.sql`.

2. **Bounded columns (range or enum CHECK constraints).** Does the column have a known valid range or value set (e.g. numeric bounds like `difficulty ∈ [0, 10]` or `stability ≥ 0`, or a fixed enum like `date_format ∈ {'iso','dmy','mdy'}` or `fsrs_state ∈ {'new','learning','review','relearning'}`)? If yes: is the range or enum enforced by a DB-level `CHECK` constraint? `NOT NULL` alone is not enough — `difficulty` and `stability`, for instance, are `NOT NULL` but have no range `CHECK` yet. Reference implementations to copy: `card_reviews_fsrs_state_check` (migration 004), the `date_format` CHECK (migration 019).

3. **Append-only tables.** Is the table an audit or history ledger where rows should never be mutated or deleted by clients (e.g. `grade_log`, `streak_days`)? If yes: are `UPDATE` and `DELETE` RLS policies absent? Migration 018 dropped `grade_log_update`, `grade_log_delete`, `streak_days_update`, and `streak_days_delete` for exactly this reason. The only legitimate destructive path on these tables is the `reset_all_progress` SECURITY DEFINER RPC in migration 018. New append-only tables must follow the same pattern: add `SELECT` and `INSERT` policies only at creation time, and omit `UPDATE`/`DELETE` entirely — see `db/migrations/006_grade_log.sql` for the policy syntax and `db/migrations/018_reset_all_progress_rpc.sql` for why the UPDATE/DELETE policies that 006 initially created were subsequently dropped.

4. **Future-date columns.** Does the column store a date that must not be in the future (e.g. `streak_days.review_date`, which currently has no such guard)? If yes: add a `CHECK (col <= current_date)` constraint, with `+1` grace day if UTC+14 clients can legitimately stamp tomorrow-in-UTC. See migration 019 for the `ADD CONSTRAINT … CHECK` syntax.

5. **Whole-row overwrite vs. merge.** Does the write path overwrite a JSONB column or multi-field row that another sync leg may also be writing concurrently (e.g. `user_settings.settings`)? If yes: route the write through a merge RPC. The canonical example is `merge_user_settings(p_user_id, p_patch)` (migrations 011 / 014), which uses `INSERT … ON CONFLICT DO UPDATE SET settings = settings || p_patch` to atomically apply a JSONB patch. Any new multi-writer JSONB column needs the same pattern. Scalar columns written by exactly one sync leg (e.g. `user_settings.timezone`, `user_settings.date_format`) are exempt — they use a targeted `UPDATE` (`pushRegionalPrefs`) and are never overwritten by the settings blob path (`pushSettings`).

6. **SECURITY DEFINER scope.** If a new function uses `SECURITY DEFINER`, it must (a) capture `auth.uid()` into a local variable in the `DECLARE` block (e.g. `uid uuid := auth.uid()`) and filter `WHERE user_id = uid` — never rely on the caller to filter, (b) check `uid IS NULL` and raise an exception if not authenticated, (c) set `SET search_path = ''` to avoid search-path injection, and (d) be backed by RLS or a CHECK as the first line of defence — `SECURITY DEFINER` is a bypass, not a replacement. Today the only `SECURITY DEFINER` function is `reset_all_progress`; copy the structure from `db/migrations/018_reset_all_progress_rpc.sql` before writing a new one.

## Sync paths (authenticated users)

Sync paths to Supabase, in order of how data normally flows:

1. **Per-grade debounced upsert (primary path)** — `usePerGradeSync(client, userId)` returns `{ enqueueGrade, flushPending }`. Call `enqueueGrade(card)` fire-and-forget immediately after each grade. A 200 ms debounce coalesces rapid re-grades; when it fires, one upsert per pending card is sent via `pushSingleCard`. Failed cards stay in the queue for the next grade cycle or the unload safety-net.

2. **Unload safety-net** — `useSyncOnUnload(client, userId, flushPending)` registers `visibilitychange` / `pagehide` listeners. On unload it calls `flushPending()` (from `usePerGradeSync`) to get the still-unsynced cards; if non-empty, it dispatches them via `navigator.sendBeacon('/api/sync', blob)`. When the per-grade path is working normally, `flushPending()` returns `[]` and the unload push is skipped entirely.

3. **Background pull on visibility** (`useVisibilityPull` → `pullAndMerge`) — see the next section. Also triggered once on sign-in by `useSignInPull` (`SignInPull` in the root layout).

4. **Side-channel auto-syncs (`AutoSyncOnChange`)** — listens for the local `poke-memory:*` change events for settings, streak, and grade-log writes, and fires the matching `pushSettings` / `pushStreak` / `pushGradeLog`. Best-effort: each leg `console.warn`s on failure and continues. The settings-page regional-prefs write-back follows the same shape but lives on the page itself (it auto-detects when local values are NULL, then calls `pushRegionalPrefs` directly).

5. **Failed-beacon retry** (`useRetryPush`, surfaced as the Retry link in `SyncStatusLine` on the Stats page) — push-only recovery for when the unload beacon's synchronous return signalled failure. **Does not pull first** by design: #293 was caused by pushing _without_ pulling first (stale local clobbered cloud), and the corrective rule is "pull before push when you're merging" — but a beacon-retry has nothing to merge; it just re-sends the rows that already failed to leave the device. Pulling here would only introduce a race window where a freshly arrived cloud row could be re-clobbered by the same stale local state the beacon was trying to deliver. So this hook re-pushes the affected cards (today's reviewed cards when a count is known, all reviewed cards otherwise) without touching cloud first.

6. **Force pull from cloud** (Stats page, "Force pull from cloud" button → `pullSession` + `applyCloudAuthoritative`) — destructive recovery path that **replaces local progress with cloud**. Guarded by a `window.confirm` prompt. There is intentionally no inverse "force push from local" button: a stale local state pushing wholesale is exactly the #293 failure mode.

- **Unload-time send mechanism:** `useSyncOnUnload` uses `navigator.sendBeacon('/api/sync', blob)` rather than calling the Supabase JS client directly. `sendBeacon` is the W3C-specified mechanism for guaranteed delivery during page hide and carries same-origin cookies automatically — ITP does not affect same-origin requests, so mobile Safari auth cookies are included. The receiver is `app/api/sync/route.ts` — a POST Route Handler that authenticates via session cookie and upserts server-side. `lastPushFailed` in sync status reflects whether the browser accepted the beacon (the synchronous return value of `sendBeacon`), not whether the server upserted.
- **`pushSession` is the batched-push escape hatch** — `app/auth/callback-complete/page.tsx` invokes it in two places: the first-sign-in path (push local up to seed an empty cloud) and the "Keep local" branch of the conflict picker (push the user's chosen local state up to overwrite cloud). The per-grade and unload paths use `pushSingleCard` instead; nothing else in `app/` or `components/` currently calls `pushSession`.
- **Volume**: 100 reviews/day → at most 100 single-row upserts (often fewer after debounce coalescing). Well within Supabase free-tier limits.
- Guest-mode guard runs on every `enqueueGrade` call, not just at mount, so mid-session sign-out is safe.

## Offline behaviour and online-reconnect catch-up

When the device loses connectivity:

- **Per-grade upserts fail silently.** `usePerGradeSync` keeps failed cards in its in-memory `pendingQueueRef`. After three consecutive all-failure drains the `lastPushFailed` flag is set (via `markPushFailed`) and the Stats-page banner appears.
- **Unload beacon may fail.** `useSyncOnUnload` records `lastPushFailed: true` when `sendBeacon` returns `false` or the `fetch+keepalive` path returns a non-2xx. Failed card count is stored in `failedCardCount`.
- **The in-memory queue is not persisted across tab closes.** Cards in `pendingQueueRef` that have not yet reached the unload path are lost if the tab is force-killed. The `lastPushFailed` / `failedCardCount` fields in `sync-status:v1` survive because they are written to `localStorage`; the queue contents themselves do not. Queue persistence is tracked in a follow-up issue (#875).

When the device comes back online, **`OnlineReconnectSync`** (`components/sync/OnlineReconnectSync.tsx`) fires via the browser `online` event, driven by `useOnlineReconnectSync` (`lib/sync/useOnlineReconnectSync.ts`):

1. **Pull first** — `pullAndMerge` is called to bring local state up to date. If pull fails, the push leg is skipped: pushing without knowing cloud state is the exact failure mode of #293.
2. **Push failed cards** — if `lastPushFailed` is true, the hook re-pushes the card set that matches the `failedCardCount` heuristic (same selection logic as `useRetryPush`): today's reviewed cards when `failedCardCount > 0`, all reviewed cards when `failedCardCount` is null. On partial success, `markPushSucceeded` advances the "Last synced" timestamp.

The reconnect push respects the same superuser write-guard as every other cloud-write path: `OnlineReconnectSync` passes `null` for client and userId when any superuser flag is on, so QA sessions never leak fake state into Supabase.

The `online` event listener is registered once at mount (empty deps, ref-based) so it never needs to be re-registered on re-render — the same pattern as `useVisibilityPull`.

## Background pull on visibility

When a signed-in tab regains focus after being hidden ≥ 30 seconds, `useVisibilityPull` (mounted via `SyncOnVisible` in the root layout) silently calls `pullAndMerge`, which pulls all cloud rows and merges them into `localStorage`.

**Blocked routes**: `["/"]` — the practice session is excluded to avoid interrupting an active review. The block is route-level; the session-complete screen (still at `/`) is also excluded, which is the accepted tradeoff for keeping the implementation simple.

**`lastPullAt` and clock-skew mitigation**: `SyncStatus.lastPullAt` stores the ISO timestamp from the most-recently-updated cloud row in the pull response (server-side `updated_at`), not `Date.now()`. This prevents a device with a drifting local clock from producing false "cloud is newer" signals on subsequent pulls.

**Per-card conflict rule** (implemented in `mergeCloudIntoLocalSilent` in `lib/sync/cloud.ts`):

1. `lastPullAt` is `null` (first pull on this device) → cloud wins unconditionally.
2. `card.state.lastReview !== null && lastReview >= lastPullAt.slice(0, 10)` → this device graded since the last pull (same calendar day or later) → **keep local**.
3. `cloudRow.updated_at > lastPullAt` → cloud has newer state → **take cloud**.
4. Otherwise (cloud row unchanged since last pull) → **keep local**.

The `>=` date comparison is conservative: any review on the same calendar day as the pull counts as "graded since pull," preventing incorrect reverts when sub-day ordering cannot be determined from `YYYY-MM-DD` strings.

**Synthetic `StorageEvent` invariant**: `saveSession` (in `lib/review/persistence.ts`) dispatches a synthetic `StorageEvent` for `"poke-memory:review-session:v1"` after every successful localStorage write, so same-tab subscribers (`useSessionStorageKey` in NavLinks, Stats, and Pokédex) are notified. Cross-tab listeners receive the native event automatically. If you write the session key directly via `localStorage.setItem` (bypassing `saveSession`), dispatch the event yourself — better, route through `saveSession`.

**Reactive re-render**: `useSessionStorageKey` (`lib/review/useSessionStorageKey.ts`) returns an incrementing counter on each matching storage event. NavLinks, Stats, and Pokédex include this counter in their session-loading `useEffect` dependency arrays so they re-render after a background pull, a sparkle-clear, or a grade that crosses a mastery threshold — without a page reload.
