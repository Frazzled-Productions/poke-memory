# Spaced repetition

Canonical reference for the SRS scheduler — algorithm, per-card state, queue policy, daily limits, card directions, practice scope, undo, mastery. AGENTS.md keeps a short pointer here.

## Algorithm

FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs). Default parameters per FSRS, with a user-controlled `request_retention` knob (Settings → Recall target, 0.80–0.97, default 0.90). Per-user FSRS weight optimisation has shipped (#268) — the optimiser runs against the user's `grade_log` history and persists trained weights to `user_settings`.

## Anki-style learning steps layer

Kept on top of FSRS. FSRS schedules graduated cards only; new and lapsed cards go through wall-clock learning steps via `learningStepsFor(difficulty)` / `relearningStepsFor(difficulty)` (`lib/srs/constants.ts`). The bands are:

- **easy** (FSRS difficulty ≤ 4): `[1m]`
- **medium** (5–7): `[1m, 10m]` for learning and `[10m]` for relearning — the historic default, preserved as `LEARNING_STEPS_MS` / `RELEARNING_STEPS_MS`
- **hard** (≥ 8): `[1m, 5m, 15m]` for learning and `[5m, 15m]` for relearning

The in-step layer is what `learningStep` / `stepStartedAt` track.

## Scheduler call options

`nextReview(state, grade, now, options?)` accepts `{ retentionTarget }` and is the single chokepoint that reads it. `previewIntervals` accepts the same options shape. FSRS instances are cached per retention value so a session that holds one target doesn't reinstantiate per grade.

## Grading UX

4 buttons — `Again` (1) / `Hard` (2) / `Good` (4) / `Easy` (5). The 1/2/4/5 internal convention maps to FSRS's `Rating` enum (1/2/3/4) at the boundary in `lib/srs/scheduler.ts`.

## Per-card review state

```ts
type ReviewState = {
  // FSRS core (graduated-path math)
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  fsrsState: 'new' | 'learning' | 'review' | 'relearning';
  // Lifecycle timestamps (unchanged across the SM-2 → FSRS swap)
  dueDate: string;           // ISO 8601 "YYYY-MM-DD"
  lastReview: string | null;
  firstSeen: string | null;  // ISO date of first-ever grade. Set once; never overwritten.
  // Anki layer (in-memory wall-clock countdown)
  learningStep: number | null;
  stepStartedAt: number | null;
};
```

Dates as `"YYYY-MM-DD"` strings (string-comparable, no timezone math). The `nextReview` scheduler is a pure function and lives in `lib/srs/`.

## Queue policy

Two queues — review (`lastReview !== null && dueDate <= today && lastReview !== today`) served first, then new (`lastReview === null`). Within each queue, deterministic per-day shuffle via FNV-1a hash of `id + today` (stable for the day, rotates daily).

## Daily limits

10 new cards/day (hard wall — exceeding inflates tomorrow's review queue), 100 reviews/day (soft wall with "Keep reviewing" override). Counters: `newIntroducedToday = firstSeen === today`; `reviewsDoneToday = lastReview === today && firstSeen !== today`.

## Species-grouped new-card introduction (#928)

When a species has new-card candidates across multiple enabled directions (e.g. `name` and `reverse` both enabled, both still unintroduced), `buildSessionQueues` admits all of them on the same day or none. This prevents directions from drifting out of sync when a user enables multiple directions from the start.

**Algorithm** (in `buildSessionQueues`):

1. Each direction's candidates are pre-sliced to its remaining daily budget via `stableShuffleForDay(...).slice(0, remainingBudget)`. A direction with zero remaining budget contributes an empty slice.
2. `groupNewCandidatesBySpecies` groups the sliced candidates by speciesId into a `Map<speciesId, {name?, reverse?, cry?}>`. A direction only appears in a species entry if it was in the budget slice.
3. Species IDs are stable-shuffled for the day. Each species is admitted only if every direction present in its group still has remaining budget. Budgets are consumed atomically: all directions of a species are admitted together, or none are.
4. Evolution cards are edge-keyed (not species-keyed) and use their own independent budget pass, unchanged.

**No-regression guarantee**: cards with `lastReview !== null` (already introduced on a prior day) are never in `newCandidatesByType`, so they never appear in any species group. A species whose reverse was introduced before its name was enabled will have the reverse as a solo entry — admitted freely with no name partner to block it. No persisted card state is touched; the change is confined to new-card introduction ordering.

## Persisted session shape

`{ cards: ReviewCard[], limits: DailyLimits }` in `localStorage`. `loadSession` runs `migrateReviewState` on every card — including the SM-2 → FSRS conversion for any legacy persisted state — so the migration is idempotent and runs once per device automatically.

## Card directions

Three directions, each its own FSRS stream:

- `name` (forward): sprite prompt → name. IDs `1..MAX_NAME_ID`.
- `reverse`: name prompt → sprite tile picker. IDs `REVERSE_ID_OFFSET + speciesId` (≥ 2_000_001).
- `cry`: cry plays as prompt → sprite + name reveal. IDs `CRY_ID_OFFSET + speciesId` (≥ 3_000_001). Only generated for species with a non-null `cryUrl`.
- Evolution cards (`EVOLUTION_ID_OFFSET + speciesId`, ≥ 1_000_001) are a fourth stream layered on top of the species; they are not a direction of the same card.

## Practice scope

`lib/review/scope.ts` is a runtime filter over the cards array before `buildSessionQueues` sees it. Persisted as `practiceScope` on `UserSettings` and synced with the rest of settings (#333). The pre-#333 localStorage key `poke-memory:practice-scope:v1` is read once on first load and then cleared by `readLegacyScope` / `clearLegacyScope`. Out-of-scope cards' `dueDate` keeps advancing — the scope only affects which cards surface in a session.

## Undo

Single-step, session-only. `ReviewSession` captures a pre-grade snapshot of `cards`, session tally, sequence, learning queue, and the `occurredAt` of the just-appended grade-log entry. `handleUndo` (or ⌘/Ctrl+Z) restores them and pops the grade-log entry via `removeGradeEntry(occurredAt)`. Cloud sync rollback is best-effort: the per-grade debounce may already have fired, in which case the cloud retains the post-grade state.

## Mastery

`reps >= masteryRepetitions && scheduledDays >= 21`. The legacy `easeFactor` / `repetitions` field names survive on `StrugglingCard` (in `lib/stats/derive.ts`) — they are derived from FSRS state at the stats boundary so existing UI consumers stay stable.
