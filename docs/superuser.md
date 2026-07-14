# Superuser mode

Canonical reference for the QA cheat summarised in AGENTS.md (Superuser mode). Read this before
adding any user-facing feature that shows mastery, completion, or collection state.

A QA cheat unlocked by typing `super` (desktop) or 7-tapping the nav title (mobile). It only
reveals a **Developer** section on Settings that houses per-axis-of-cheating flags:

| Flag | Purpose |
|---|---|
| `pretendAllMastered` | Renders every species as mastered across Pokédex, Pasture, Stats, theme picker. |
| `forceNextStreakMilestone` | Fires the smallest un-seen streak celebration on next Practice visit. Self-clears after one fire. |
| `forceCardsGraduated` | Treats all cards as graduated; skips the learning phase. QA typed-entry without grinding. |
| `qaSeedMode` | Reveals a scenario picker (#1326). Pick a scenario, "Apply seed" injects deterministic test data into IndexedDB. Local-only; sync write-guard applies. |

QA-seed scenarios (when `qaSeedMode` on): `fsrs-locale-mastery`, `optimiser-stress`,
`pasture-progression`, `mastery-gaps` - details in `lib/qa-seed/scenarios.ts`. Clear via "Clear
seed" + reload, or by locking superuser mode.

## Every new user-facing feature must honour the relevant flag

If a feature shows mastery state, completion counts, per-Pokémon collection state, or anything
gated on mastery, read `useSuperuser().flags.pretendAllMastered` and treat as fully mastered when
on. Canonical pattern `forceAllMastered || isMastered(...)`; pure functions take an optional
`forceAllMastered` param (`computeStats`, `computeRecords`, `filterMastered`). Do **not** add a
per-page toggle that re-derives mastery. If a feature genuinely should not be affected, call it out
in the PR description and the planner's acceptance criteria.

## QA-seed data must be a faithful proxy for real data

A fixture that can occupy states real data can't reach (or misses states it does) validates
nothing and ships QA-only crashes (#1394 had two). Rules: match every real invariant (unique
numeric `id` per session, FSRS states within reachable bounds, name+reverse pairing per #1234,
locale consistency); prefer *deriving* states by replaying real grades through
`lib/srs/scheduler.ts::nextReview` + the real `hydrateSession` path over hand-fabricating FSRS
literals (rebuild tracked in #1421); enforce with forcing functions -
`lib/qa-seed/scenarios.test.ts` asserts unique card ids; add `hydrateSession`→`buildSessionQueues`
no-throw + FSRS-bounds/pairing assertions as the seed grows.

## Sync write-guard

While any flag is on, all cloud writes are suppressed (`usePerGradeSync.enqueueGrade`,
`useSyncOnUnload`, `AutoSyncOnChange` short-circuit via `null` client/userId; the FSRS optimizer
button and the `SyncStatusLine` Retry link render disabled with a "Sync paused (superuser)" label).
Any future write-triggering button takes the same `superuserPaused` prop. Background pulls
(`SyncOnVisible`, `SignInPull`) stay enabled - reads can't corrupt the cloud. Do not work around
this guard.

## Exit cleanup

When the last flag is toggled off (or the chord re-locks while flags were on), `SuperuserContext`
runs `exitCleanup`: signed-in → force-pull cloud, overlay local via `mergeCloudIntoLocal`, dispatch
a synthetic `StorageEvent`; guest → `window.confirm` offers a destructive local reset. Don't skip
the prompt or the pull.
