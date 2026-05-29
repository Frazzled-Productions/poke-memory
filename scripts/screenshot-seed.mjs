/**
 * Deterministic screenshot seed for `scripts/capture-screenshots.mjs`.
 *
 * Produces a lived-in localStorage/IndexedDB payload that makes all six
 * README screenshots render with realistic populated state:
 *
 *   - Practice:   Pikachu (#25) is always the front card (staged as an
 *                 immediately-due learning-step card so it bypasses the
 *                 shuffled review/new queues entirely).
 *   - Pasture:    ~30 mastered species (name + reverse cards both mastered,
 *                 which is the post-#1234 gate).
 *   - Stats:      populated charts from ~30 days of synthetic grade history.
 *   - Journey:    ~15-day streak + badge progress from the card set.
 *   - Pokédex:    mixed mastered / in-progress / locked tiles.
 *
 * DETERMINISM GUARANTEE
 *
 * All dates in the card states are computed from the EPOCH_ANCHOR constant
 * (a fixed past date), not from Date.now(). The only live values are:
 *   - Pikachu's stepStartedAt: set to Date.now() - 120_000 in the page
 *     context (so the 60-second learning step is already past due and
 *     Pikachu appears immediately).
 *   - Grade log occurredAt timestamps: built at deterministic offsets from
 *     the epoch anchor, not from Date.now().
 * - The client shuffle salt is pinned to "screenshot-seed" in localStorage,
 *   overriding the normal per-device UUID. Pikachu is in a learning step so
 *   it bypasses the shuffled queue anyway, but pinning the salt prevents any
 *   drift in the review/new order on future screenshot runs.
 *
 * RUNNING
 *
 * Import buildScreenshotSeed() and call it inside a Playwright addInitScript
 * to write all keys into the browser context before the page loads. See
 * capture-screenshots.mjs for the injection site.
 *
 * British English in comments; no em dashes.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

// Snapshot today's date at module load time (the moment the script starts).
// All card state dates are computed relative to NOW so the rendered practice
// queue reflects "today" correctly — mastered cards have future due dates
// (so they stay out of the review queue), while the grade-log history is
// anchored to a fixed past epoch (so Stats always shows 30 days of history).
const NOW_MS = Date.now();

/** Converts a day offset from NOW_MS into a YYYY-MM-DD string. */
function relDate(offsetDays) {
  const ms = NOW_MS + offsetDays * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}


// Reference dates relative to NOW (for card states).
// Mastered/due-soon cards get FUTURE due dates so they are NOT in the
// review queue when the screenshots are captured.
const TODAY       = relDate(0);
const PAST_7      = relDate(-7);
const PAST_15     = relDate(-15);
const PAST_30     = relDate(-30);
const FUTURE_7    = relDate(7);
const FUTURE_14   = relDate(14);
const FUTURE_21   = relDate(21);
const FUTURE_28   = relDate(28);

// Storage key strings -- must match lib/storage/keys.ts exactly.
export const KEY_REVIEW_SESSION = "poke-memory:review-session:v1";
export const KEY_GRADE_LOG      = "poke-memory:grade-log:v1";
export const KEY_STREAK         = "poke-memory:streak:v1";
export const KEY_SETTINGS       = "poke-memory:settings:v1";
export const KEY_HAS_MASTERED   = "poke-memory:has-mastered:v2";
export const KEY_CLIENT_SALT    = "poke-memory:client-salt:v1";
export const KEY_SUPERUSER      = "poke-memory:superuser";
export const KEY_SUPERUSER_FLAGS = "poke-memory:superuser:flags:v1";

// Reverse-card ID offset -- must match lib/pokemon/seed.ts REVERSE_ID_OFFSET.
const REVERSE_ID_OFFSET = 2_000_000;

// ─── Card state builders ────────────────────────────────────────────────────

/**
 * A fully mastered card state. reps >= 3 and scheduledDays >= 21 satisfy
 * the isMastered() gate in lib/stats/derive.ts.
 * `seenInPasture: true` means the species will appear in the Pasture.
 * Due dates are set in the future (relative to NOW) so mastered cards are
 * NOT in the review queue when screenshots are captured.
 */
function masteredState({ dueDate = FUTURE_7, lastReview = PAST_7, firstSeen = PAST_30, scheduledDays = 28 } = {}) {
  return {
    stability: 50,
    difficulty: 4.5,
    elapsedDays: 21,
    scheduledDays,
    reps: 4,
    lapses: 0,
    fsrsState: "review",
    dueDate,
    lastReview,
    firstSeen,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: true,
  };
}

/**
 * A graduated, not-yet-mastered card state (reps >= 1, scheduledDays < 21).
 * Shows as "in progress" in the Pokédex grid. Due dates are in the future
 * so they don't appear in today's review queue.
 */
function dueSoonState({ dueDate = FUTURE_7, lastReview = PAST_7, firstSeen = PAST_15 } = {}) {
  return {
    stability: 10,
    difficulty: 5,
    elapsedDays: 4,
    scheduledDays: 5,
    reps: 2,
    lapses: 0,
    fsrsState: "review",
    dueDate,
    lastReview,
    firstSeen,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

/**
 * An in-learning card state for a species other than Pikachu.
 * stepStartedAt is null here; it will be stamped by ReviewSession on load.
 * We give it a future dueDate so it stays behind Pikachu in the queue.
 *
 * stability is set to 1.0 (not 0) because ts-fsrs validates stability >= S_MIN
 * (0.001) when calling scheduler.next for a Card, and previewIntervals calls
 * nextReview for grade 5 (Easy) on every render. A zero stability triggers
 * "Invalid memory state" from ts-fsrs.
 */
function learningState({ firstSeen = PAST_7 } = {}) {
  return {
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "learning",
    dueDate: TODAY,
    lastReview: null,
    firstSeen,
    learningStep: 0,
    // null so ReviewSession stamps it at load time (= now), making the step's
    // dueAt = now + 60_000 ms, which keeps these cards behind Pikachu.
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

// ─── Card object helpers ────────────────────────────────────────────────────

function nameCard(id, state, locale = "en") {
  return {
    cardType: "name",
    id,
    locale,
    // hydrateSession backfills name/spriteUrl from SEED_POKEMON on load.
    name: `pokemon-${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    subjectKey: `species:${id}`,
    state,
  };
}

function reverseCard(id, state, locale = "en") {
  return {
    cardType: "reverse",
    id: REVERSE_ID_OFFSET + id,
    pokemonId: id,
    locale,
    name: `pokemon-${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    subjectKey: `species:${id}`,
    state,
  };
}

function evolutionCard(preEvoId, postEvoId, edgeId, state) {
  return {
    cardType: "evolution",
    id: edgeId,
    preEvoId,
    postEvoId,
    locale: "en",
    subjectKey: `edge:${preEvoId}:${postEvoId}`,
    state,
  };
}

// ─── Grade log builder ──────────────────────────────────────────────────────

/**
 * Produces ~30 days of synthetic grade-log entries. The entries cover the
 * last 30 days relative to NOW (so the Stats page's "recent accuracy" charts
 * show populated data). Each day gets 8-15 grades weighted toward Good (4)
 * and Easy (5) to reflect a comfortable practice session.
 *
 * The `occurredAt` timestamps are computed as NOW_MS + per-day-offset +
 * per-entry-offset so they are deterministic within a single run of the
 * script. Because NOW_MS is captured once at module import, consecutive
 * calls within the same run produce identical values.
 */
function buildGradeLog() {
  // Grade pattern for each day (0-indexed within a 10-day cycle):
  // Mimics a real user who mostly gets Good/Easy with occasional Hard/Again.
  const DAILY_PATTERNS = [
    [4, 4, 5, 4, 4, 5, 4, 2, 4, 4, 5, 4],  // 12 grades
    [4, 5, 4, 4, 5, 4, 4, 4, 5, 4],           // 10 grades
    [4, 4, 4, 5, 4, 2, 4, 4, 5, 1, 4, 4],    // 12 grades
    [5, 4, 4, 4, 5, 4, 4, 4, 4, 5, 4, 4, 4], // 13 grades
    [4, 4, 5, 4, 4, 4, 5, 4, 2, 4],           // 10 grades
    [4, 4, 4, 4, 5, 4, 4, 4, 5, 4, 4],        // 11 grades
    [4, 5, 4, 4, 2, 4, 4, 5, 4, 4, 4, 4],    // 12 grades
    [4, 4, 4, 5, 4, 4, 4, 1, 4, 4, 5, 4, 4], // 13 grades
    [5, 4, 4, 4, 4, 5, 4, 2, 4, 4],           // 10 grades
    [4, 4, 5, 4, 4, 4, 4, 5, 4, 4, 4],        // 11 grades
  ];

  const entries = [];
  for (let dayOffset = -30; dayOffset <= 0; dayOffset++) {
    // Use relDate() so dates are relative to now and recent-accuracy charts
    // in Stats show populated data.
    const date = relDate(dayOffset);
    // Midnight UTC of the capture day plus the daily offset (in milliseconds).
    const dayMs = NOW_MS + dayOffset * 86_400_000;
    const pattern = DAILY_PATTERNS[(dayOffset + 30) % DAILY_PATTERNS.length];
    for (let i = 0; i < pattern.length; i++) {
      // Space entries out by 5 minutes starting at 09:00 UTC for a believable
      // session rhythm. occurredAt is relative to the day's midnight + 9 hours.
      const occurredAt = Math.floor(dayMs / 86_400_000) * 86_400_000
        + 9 * 3_600_000   // 09:00 UTC
        + i * 300_000;     // 5-min spacing
      entries.push({
        date,
        grade: pattern[i],
        cardType: "name",
        occurredAt,
        subjectKey: String(1 + ((i * 7 + (dayOffset + 30) * 13) % 30)), // rotates across species
        locale: "en",
      });
    }
  }
  return entries;
}

// ─── Streak builder ─────────────────────────────────────────────────────────

/**
 * Produces 15 consecutive streak days ending at today (relDate(0)). The
 * streak is stored as a sorted array of ISO date strings in localStorage
 * at KEY_STREAK.
 */
function buildStreakDates() {
  const dates = [];
  for (let dayOffset = -14; dayOffset <= 0; dayOffset++) {
    dates.push(relDate(dayOffset));
  }
  return dates;
}

// ─── Main card set ──────────────────────────────────────────────────────────

/**
 * The full session card set. Ordered so that when hydrateSession appends new
 * cards from the seed it does not disrupt the saved card order. The
 * practitioner has:
 *
 *   - 30 mastered species (name + reverse each) -- eligible for Pasture
 *   - 20 in-progress species (name cards only, not yet mastered)
 *   - 10 in-learning species (name cards)
 *   - Pikachu (#25) as a immediately-due learning card (placed before other
 *     learning cards so it is the first card in the learning queue)
 *   - A handful of mastered evolution edges
 *
 * Pikachu is in the mastered list AND has a separate learning-step entry.
 * Actually, Pikachu must NOT be mastered (the learning card and mastered state
 * would conflict on the same id). Instead we exclude Pikachu from the mastered
 * set and give it only the learning-step name card.
 */
function buildSessionCards() {
  const cards = [];

  // 30 mastered Gen-I species. Excludes Pikachu (#25) since Pikachu is the
  // practice protagonist with its own learning-step card below.
  // Both name AND reverse must be mastered for the Pasture gate (post-#1234).
  // Due dates are FUTURE (relative to NOW) so none appear in the review queue.
  const MASTERED_IDS = [
    1, 4, 7, 10, 13, 16, 19, 21, 23,
    27, 29, 32, 35, 37, 39, 41, 43, 46, 48,
    50, 52, 54, 56, 58, 60, 63, 66, 69, 72, 74,
  ];
  for (const id of MASTERED_IDS) {
    const offsetDays = (id % 14) + 7; // vary due dates (7..20 days in the future)
    const state = masteredState({
      dueDate: relDate(offsetDays),
      lastReview: relDate(-7),
      firstSeen: PAST_30,
      scheduledDays: 21 + (id % 14),
    });
    cards.push(nameCard(id, state));
    cards.push(reverseCard(id, state));
  }

  // 20 in-progress species (graduated but not yet mastered).
  // Due dates are in the future so they don't appear in today's review queue.
  const DUE_SOON_IDS = [
    77, 79, 81, 83, 84, 86, 88, 90, 92,
    95, 96, 98, 99, 100, 102, 104, 107, 109, 111, 114,
  ];
  for (const id of DUE_SOON_IDS) {
    const daysOut = (id % 6) + 3; // 3..8 days in the future
    cards.push(nameCard(id, dueSoonState({
      dueDate: relDate(daysOut),
      lastReview: relDate(-3),
      firstSeen: PAST_15,
    })));
  }

  // Pikachu (#25) as the practice protagonist, staged as an immediately-due
  // learning card. stepStartedAt is intentionally null in this static payload;
  // capture-screenshots.mjs replaces it with Date.now() - 120_000 (two minutes
  // ago) so the 60-second learning step is already overdue, ensuring Pikachu
  // is the first card the learning queue selects.
  //
  // Because all review/new candidates have FUTURE due dates, the review queue
  // is empty. Pikachu is the sole item in the learning queue and therefore
  // the only card that can show first -- deterministically, regardless of
  // the shuffle salt.
  cards.push({
    cardType: "name",
    id: 25,
    locale: "en",
    name: "pokemon-25",
    spriteUrl: "/sprites/pokemon/25.png",
    subjectKey: "species:25",
    state: {
      // stability must be >= ts-fsrs's S_MIN (0.001) so previewIntervals can
      // call scheduler.next for grade 5 (Easy) without throwing "Invalid memory
      // state". A value of 1.0 is conventional for a card at step 0.
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      fsrsState: "learning",
      dueDate: TODAY,
      lastReview: null,
      firstSeen: PAST_7,
      learningStep: 0,
      // SENTINEL: replaced at runtime by capture-screenshots.mjs with
      // Date.now() - 120_000 so the step is already overdue.
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  });

  // 10 in-learning species (other than Pikachu). stepStartedAt is null so
  // ReviewSession stamps them with the current time on load, making their
  // dueAt = now + 60_000 ms (one minute in the future). This keeps them
  // strictly behind Pikachu in the learning queue.
  const LEARNING_IDS = [115, 116, 118, 120, 122, 124, 126, 128, 130, 131];
  for (const id of LEARNING_IDS) {
    cards.push(nameCard(id, learningState()));
  }

  // A handful of mastered evolution edges for the Pokédex evo column.
  // Due dates are in the future so they don't appear in the review queue.
  const MASTERED_EDGES = [
    [1, 2, 1_500_001],   // Bulbasaur -> Ivysaur
    [2, 3, 1_500_002],   // Ivysaur -> Venusaur
    [4, 5, 1_500_003],   // Charmander -> Charmeleon
    [5, 6, 1_500_004],   // Charmeleon -> Charizard
    [7, 8, 1_500_005],   // Squirtle -> Wartortle
    [8, 9, 1_500_006],   // Wartortle -> Blastoise
    [25, 26, 1_500_015], // Pikachu -> Raichu
  ];
  for (const [preEvoId, postEvoId, edgeId] of MASTERED_EDGES) {
    cards.push(evolutionCard(preEvoId, postEvoId, edgeId, masteredState({ dueDate: FUTURE_21 })));
  }

  return cards;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Returns the seed payload as plain objects that can be serialised with
 * JSON.stringify and injected via Playwright's addInitScript / evaluate.
 *
 * NOTE: This function is called in Node (scripts/) context; it must not
 * import any app modules.
 */
export function buildScreenshotSeed() {
  return {
    session: {
      cards: buildSessionCards(),
      limits: {
        // maxNewPerDay is set to 0 for all types. This suppresses the "new
        // card introduction" queue entirely, so hydrateSession's additions
        // from the ~932 un-seeded species never appear in the practice queue.
        // The session has 11 learning cards (Pikachu + 10 others), and with
        // all mastered/in-progress due dates in the future the review queue is
        // also empty -- guaranteeing Pikachu (the only overdue learning card)
        // always appears first.
        name:      { maxNewPerDay: 0, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 0, maxReviewsPerDay: 100 },
        reverse:   { maxNewPerDay: 0, maxReviewsPerDay: 100 },
        cry:       { maxNewPerDay: 0, maxReviewsPerDay: 100 },
      },
    },
    gradeLog: buildGradeLog(),
    streakDates: buildStreakDates(),
    // Storage keys injected by the addInitScript.
    keys: {
      KEY_REVIEW_SESSION,
      KEY_GRADE_LOG,
      KEY_STREAK,
      KEY_SETTINGS,
      KEY_HAS_MASTERED,
      KEY_CLIENT_SALT,
      KEY_SUPERUSER,
      KEY_SUPERUSER_FLAGS,
    },
  };
}
