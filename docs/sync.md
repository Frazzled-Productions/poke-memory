# Sync

Cross-device sync for authenticated users. Guest mode is browser-local only — none of this applies.

This file is the canonical reference for `lib/sync/`, `app/api/sync/route.ts`, the regression trigger on `card_reviews`, and the per-card conflict rule on background pulls. AGENTS.md keeps a short pointer here. Read this before touching anything in `lib/sync/`, `app/api/sync/route.ts`, `db/migrations/`, or any code that pushes to Supabase.

## Invariants and destructive-write protection (READ FIRST)

The rules below exist because of incidents that have already happened (#293 wiped 2497 of 2513 cloud rows to zero state) and are enforced both in code and at the database layer.

### Order constraints

- **Manual sync (`useManualSync`) pulls before pushing.** Order: load local → `pullSession` → `mergeCloudIntoLocal` → `saveSession` → `pushSession` of the merged result. Pushing first lets stale or emptied local state overwrite real cloud progress through the `(user_id, card_type, subject_key)` upsert key. `components/sync/useManualSync.test.tsx` asserts call order — if you re-order the steps, that test fails by design.
- **Brand-new device (`loadSession()` returned `null`) must not push back the merged result.** The merged state is entirely cloud-sourced; pushing it back is wasted bandwidth and widens the window for a future regression.
- **If `pullSession` fails, do not push.** Pushing without knowing cloud state is the exact failure mode of #293. The same rule applies to anywhere else you sync: cards, streak, settings, future tables. Pull first, decide, then push.

### Database trigger (`card_reviews_reject_regression_trigger`, migration 002, extended in 015)

A `BEFORE UPDATE` trigger on `card_reviews` raises `23514 check_violation` when:

- `OLD.last_review IS NOT NULL AND NEW.last_review IS NULL` — un-reviewing a card.
- `OLD.first_seen IS NOT NULL AND NEW.first_seen IS NULL` — un-seeing a card.
- `OLD.last_review IS NOT NULL AND NEW.last_review < OLD.last_review` — review date moving backward.
- `NEW.reps < OLD.reps` — reps counter decreasing (added in migration 015; FSRS only ever increments this).
- `NEW.lapses < OLD.lapses` — lapses counter decreasing (added in migration 015; same invariant).

Other FSRS columns (`stability`, `difficulty`, `scheduled_days`, etc.) are intentionally **not** checked because legitimate rescheduling operations (e.g. grading "Again") can lower them.

**Do not work around the trigger.** A legitimate "reset progress" / "delete account" flow needs a `SECURITY DEFINER` RPC that explicitly bypasses it, plus user confirmation. No such flow exists today; do not invent one without an explicit feature requirement.

### Auxiliary sync legs are best-effort

Cards are the primary contract. Streak (`streak_days`) and settings (`user_settings`) sync runs inside `useManualSync` after the cards step. Their failures `console.warn` and continue — they must not flip the overall sync into the error state. Surfacing "Sync failed" because the streak push hiccuped is worse than silently degrading.

### Per-table conflict policy

- `card_reviews` — per-card rule in `mergeCloudIntoLocalSilent` (see [Background pull on visibility](#background-pull-on-visibility) for the exact rule).
- `streak_days` — union-merge (`mergeStreak`). Streak data is monotonic; nothing is ever removed by sync. `grade_log` and `streak_days` are **append-only at the DB layer** (migration 018 dropped the UPDATE and DELETE RLS policies on both tables). The only path that removes rows from either table is the `reset_all_progress` SECURITY DEFINER RPC, which also deletes from `card_reviews` atomically and requires an authenticated session. `user_settings` is intentionally **not** touched by this RPC — user preferences survive a progress reset by design.
- `user_settings` — last-write-wins on the whole `settings` JSONB column. The pull-overlay path runs **only** when `hasStoredSettings()` is `false` (i.e. the user has never written settings on this device). Once local has a stored copy, local is authoritative on that device; we still push local up so other devices can pick it up.

### Schema notes

- `user_settings.settings` (jsonb) is the source of truth for per-user settings. The schema is `(user_id, settings, updated_at)` after migration 005 dropped the original flat columns from migration 001.
- `card_reviews` is on FSRS columns (`stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `fsrs_state`) after migration 004. The lifecycle-timestamp guards from migration 002 were unaffected by the swap; migration 015 added guards for `reps` and `lapses` decreasing.
- `card_reviews` PRIMARY KEY is `(user_id, card_type, subject_key)` after migration 012. The legacy `pokemon_id` integer column was dropped in the same migration.
- `card_reviews.hidden_since` (migration 007, nullable date) is set when a card becomes ineligible under the user's learning filter (#333) and cleared when it becomes eligible again. The session-load reconciliation shifts `due_date` forward by the hidden duration so paused cards don't accumulate overdue debt. The regression trigger does not guard `hidden_since` or `due_date` — both are allowed to move in either direction by design. (The trigger guards lifecycle timestamps from migration 002, and `reps`/`lapses` from migration 015.)
- `card_reviews.seen_in_pasture` (migration 008, boolean default `false`) tracks whether a card has been scouted in the Higher-or-Lower minigame on the all-caught-up screen.
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
