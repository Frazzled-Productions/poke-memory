# Sync

Cross-device sync for authenticated users. Guest mode is browser-local only — none of this applies.

This file is the canonical reference for `lib/sync/`, `app/api/sync/route.ts`, the regression trigger on `card_reviews`, and the per-card conflict rule on background pulls. AGENTS.md keeps a short pointer here. Read this before touching anything in `lib/sync/`, `app/api/sync/route.ts`, `db/migrations/`, or any code that pushes to Supabase.

## Invariants and destructive-write protection (READ FIRST)

The rules below exist because of incidents that have already happened (#293 wiped 2497 of 2513 cloud rows to zero state) and are enforced both in code and at the database layer.

### Order constraints

- **Manual sync (`useManualSync`) pulls before pushing.** Order: load local → `pullSession` → `mergeCloudIntoLocal` → `saveSession` → `pushSession` of the merged result. Pushing first lets stale or emptied local state overwrite real cloud progress through the `(user_id, card_type, subject_key)` upsert key. `components/sync/useManualSync.test.tsx` asserts call order — if you re-order the steps, that test fails by design.
- **Brand-new device (`loadSession()` returned `null`) must not push back the merged result.** The merged state is entirely cloud-sourced; pushing it back is wasted bandwidth and widens the window for a future regression.
- **If `pullSession` fails, do not push.** Pushing without knowing cloud state is the exact failure mode of #293. The same rule applies to anywhere else you sync: cards, streak, settings, future tables. Pull first, decide, then push.

### Database trigger (`card_reviews_reject_regression_trigger`, migration 002, extended in 015, 016, and 017)

A `BEFORE UPDATE` trigger on `card_reviews` raises `23514 check_violation` when:

- `OLD.last_review IS NOT NULL AND NEW.last_review IS NULL` — un-reviewing a card.
- `OLD.first_seen IS NOT NULL AND NEW.first_seen IS NULL` — un-seeing a card.
- `OLD.last_review IS NOT NULL AND NEW.last_review IS NOT NULL AND NEW.last_review < OLD.last_review` — review date moving backward. (The `NEW.last_review IS NOT NULL` predicate was added to the bullet here to mirror the migration 002 SQL; it was always present in the trigger function but had been omitted from the docs bullet — earlier docs were inaccurate.)
- `NEW.reps < OLD.reps` — reps counter decreasing (added in migration 015; FSRS only ever increments this).
- `NEW.lapses < OLD.lapses` — lapses counter decreasing (added in migration 015; same invariant).
- `OLD.last_review IS NOT NULL AND NEW.last_review IS NOT NULL AND NEW.last_review = OLD.last_review AND NEW.scheduled_days < OLD.scheduled_days` — `scheduled_days` dropping without `last_review` advancing (added in migration 016; see below).
- `OLD.seen_in_pasture = true AND NEW.seen_in_pasture = false` — `seen_in_pasture` flipping from `true` to `false` (added in migration 017; the flag is a one-way "user has acknowledged this mastered Pokémon in the pasture" marker, so any client write that un-acknowledges is a sync bug).

`scheduled_days` is intentionally not guarded for absolute non-decrease because legitimate Again grades (FSRS reset) lower it — but Again always advances `last_review` to today. Migration 016 encodes this tighter invariant: a same-date drop in `scheduled_days` is always a stale-state clobber. **Known limitation:** any non-Again re-grade (Hard, Good, or Easy) of a card already reviewed earlier the same calendar day also produces `NEW.last_review = OLD.last_review` with a potentially lower `scheduled_days`, which the trigger would reject. The session design prevents this in practice (each card appears at most once per session), but the trigger has no visibility into session semantics — it is a last-resort DB guardrail, not a complete model of valid FSRS transitions.

**Do not work around the trigger.** A legitimate "reset progress" / "delete account" flow needs a `SECURITY DEFINER` RPC that explicitly bypasses it, plus user confirmation in the calling UI. `reset_all_progress` (migration 018) is that RPC — use it rather than creating a new bypass path.

### Auxiliary sync legs are best-effort

Cards are the primary contract. Streak (`streak_days`) and settings (`user_settings`) sync runs inside `useManualSync` after the cards step. Their failures `console.warn` and continue — they must not flip the overall sync into the error state. Surfacing "Sync failed" because the streak push hiccuped is worse than silently degrading.

### Per-table conflict policy

- `card_reviews` — per-card rule in `mergeCloudIntoLocalSilent` (see [Background pull on visibility](#background-pull-on-visibility) for the exact rule).
- `streak_days` — union-merge (`mergeStreak`). Streak data is monotonic; nothing is ever removed by sync. `grade_log` and `streak_days` are **append-only at the DB layer** (migration 018 dropped the UPDATE and DELETE RLS policies on both tables). The only path that removes rows from either table is the `reset_all_progress` SECURITY DEFINER RPC, which also deletes from `card_reviews` atomically and requires an authenticated session. `user_settings` is intentionally **not** touched by this RPC — user preferences survive a progress reset by design.
- `user_settings` — last-write-wins on the whole `settings` JSONB column. The pull-overlay path runs **only** when `hasStoredSettings()` is `false` (i.e. the user has never written settings on this device). Once local has a stored copy, local is authoritative on that device; we still push local up so other devices can pick it up.

### Schema notes

- `user_settings.settings` (jsonb) is the source of truth for per-user settings. The schema is `(user_id, settings, updated_at, timezone, date_format)` after migration 005 dropped the original flat columns from migration 001 and migration 019 added the two regional-prefs scalar columns.
- `user_settings.timezone` (text, nullable, migration 019) and `user_settings.date_format` (text, nullable, CHECK in `('iso','dmy','mdy')`, migration 019) live as scalar columns rather than JSONB fields specifically to avoid the last-write-wins race on the `settings` blob. They are written via `pushRegionalPrefs` (direct UPDATE on the two columns only — NOT via `pushSettings`) and read via `pullRegionalPrefs` as a best-effort auxiliary leg. NULL means "client hasn't set this yet — auto-detect and write back" so two devices in different locales don't trample each other's deliberate choices.
- `card_reviews` is on FSRS columns (`stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `fsrs_state`) after migration 004. The lifecycle-timestamp guards from migration 002 were unaffected by the swap; migration 015 added guards for `reps` and `lapses` decreasing; migration 016 added a same-date `scheduled_days` drop guard; migration 017 added the `seen_in_pasture` one-way guard.
- `card_reviews` PRIMARY KEY is `(user_id, card_type, subject_key)` after migration 012. The legacy `pokemon_id` integer column was dropped in the same migration.
- `card_reviews.hidden_since` (migration 007, nullable date) is set when a card becomes ineligible under the user's learning filter (#333) and cleared when it becomes eligible again. The session-load reconciliation shifts `due_date` forward by the hidden duration so paused cards don't accumulate overdue debt. The regression trigger does not guard `hidden_since` or `due_date` — both are allowed to move in either direction by design. (The trigger guards lifecycle timestamps from migration 002, `reps`/`lapses` from migration 015, same-date `scheduled_days` drops from migration 016, and the `seen_in_pasture` one-way invariant from migration 017.)
- `card_reviews.seen_in_pasture` (migration 008, boolean default `false`) tracks whether a card has been scouted in the Higher-or-Lower minigame on the all-caught-up screen. The transition from `true` to `false` is rejected by the migration 017 trigger guard — there is no legitimate client action that un-acknowledges.
- `grade_log` carries `(card_type, subject_key)` after migration 013. The legacy `card_id` integer column was dropped and the `grade_log_card_type_check` constraint was removed; `card_type` is now validated at the app boundary only. All card directions (name, evolution, reverse, reverse-evolution, cry) are synced.

### Catastrophic recovery

There is no Point-in-Time Recovery on the free tier. Issue #298 tracks the upgrade as a launch blocker. Until PITR is enabled, the trigger and the SQL audit you can run via `mcp__supabase__execute_sql` are the only defenses against an unforeseen sync bug. Treat any production sync change as one-way until PITR is in place.

## Sync paths (authenticated users)

Sync paths to Supabase, in order of how data normally flows:

1. **Per-grade debounced upsert (primary path)** — `usePerGradeSync(client, userId)` returns `{ enqueueGrade, flushPending }`. Call `enqueueGrade(card)` fire-and-forget immediately after each grade. A 200 ms debounce coalesces rapid re-grades; when it fires, one upsert per pending card is sent via `pushSingleCard`. Failed cards stay in the queue for the next grade cycle or the unload safety-net.

2. **Unload safety-net** — `useSyncOnUnload(client, userId, flushPending)` registers `visibilitychange` / `pagehide` listeners. On unload it calls `flushPending()` (from `usePerGradeSync`) to get the still-unsynced cards; if non-empty, it dispatches them via `navigator.sendBeacon('/api/sync', blob)`. When the per-grade path is working normally, `flushPending()` returns `[]` and the unload push is skipped entirely.

3. **Background pull on visibility** — see the next section.

4. **Manual sync (`useManualSync`)** — wired to the Stats-page "Sync" button. **Pulls before pushing** — see [Invariants](#invariants-and-destructive-write-protection-read-first) above for why. Order: load local → pull cards → merge → save → push merged cards → streak (pull → union-merge → save → push) → settings (push local; pull only when `hasStoredSettings()` is false). Cards drive success/error state; streak and settings failures `console.warn` and continue. `pushSession` (batched) is reused for the cards push.

- **Unload-time send mechanism:** `useSyncOnUnload` uses `navigator.sendBeacon('/api/sync', blob)` rather than calling the Supabase JS client directly. `sendBeacon` is the W3C-specified mechanism for guaranteed delivery during page hide and carries same-origin cookies automatically — ITP does not affect same-origin requests, so mobile Safari auth cookies are included. The receiver is `app/api/sync/route.ts` — a POST Route Handler that authenticates via session cookie and upserts server-side. `lastPushFailed` in sync status reflects whether the browser accepted the beacon (the synchronous return value of `sendBeacon`), not whether the server upserted.
- **`pushSession` is not deleted** — it remains the batched escape hatch and is what `useManualSync` calls for the cards push step.
- **Volume**: 100 reviews/day → at most 100 single-row upserts (often fewer after debounce coalescing). Well within Supabase free-tier limits.
- Guest-mode guard runs on every `enqueueGrade` call, not just at mount, so mid-session sign-out is safe.

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
