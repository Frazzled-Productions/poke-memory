/**
 * QA seed scenario builders for manual preview QA (#1326).
 *
 * Design rules:
 *   - Pure functions — no DOM, no IDB, no localStorage access.
 *   - Return serialisable payloads only (plain objects / arrays / primitives).
 *   - Reusable from a build-time Node script (e.g. the screenshot script #1296).
 *   - Reuse existing ReviewState shapes — no parallel state invented here.
 *   - All FSRS dates use "YYYY-MM-DD" UTC strings, string-comparable.
 *
 * The thin IDB/localStorage write wrapper lives in lib/qa-seed/apply.ts —
 * keep DOM APIs there so these builders stay importable in Node environments.
 */

import type { ReviewState } from "@/lib/srs/scheduler";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import type { AppLocale } from "@/i18n/locales";

// ---------------------------------------------------------------------------
// Internal primitives
// ---------------------------------------------------------------------------

/** Mastery thresholds (mirrors AGENTS.md "Mastery": reps >= 3 AND scheduledDays >= 21). */
const MASTERED_REPS = 4;
const MASTERED_SCHEDULED_DAYS = 28;

/**
 * Build a mastered ReviewState with a plausible FSRS history.
 * The due date is set to a future date so the card does not appear in today's queue.
 */
export function masteredState(opts: {
  firstSeen: string;
  lastReview: string;
  dueDate?: string;
  seenInPasture?: boolean;
}): ReviewState {
  return {
    stability: 30,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: MASTERED_SCHEDULED_DAYS,
    reps: MASTERED_REPS,
    lapses: 0,
    fsrsState: "review",
    dueDate: opts.dueDate ?? "2026-07-01",
    lastReview: opts.lastReview,
    firstSeen: opts.firstSeen,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: opts.seenInPasture ?? false,
  };
}

/**
 * Build an in-learning ReviewState — a card that has been seen but not yet mastered.
 */
export function learningState(opts: {
  firstSeen: string;
  reps?: number;
  scheduledDays?: number;
}): ReviewState {
  return {
    stability: 3,
    difficulty: 5.5,
    elapsedDays: 0,
    scheduledDays: opts.scheduledDays ?? 7,
    reps: opts.reps ?? 1,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-05-30",
    lastReview: opts.firstSeen,
    firstSeen: opts.firstSeen,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

/**
 * Build a brand-new (never seen) ReviewState.
 */
export function newState(): ReviewState {
  return {
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: "2026-05-29",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  };
}

/**
 * Build an optimiser-grade-style ReviewState with many reviews spread over
 * a realistic history. Produces a card that has enough grades to be included
 * in the FSRS optimiser (the optimiser requires 200+ grades across enough cards).
 */
export function heavilyReviewedState(opts: {
  firstSeen: string;
  lastReview: string;
  reps: number;
  scheduledDays: number;
  lapses?: number;
}): ReviewState {
  return {
    stability: opts.scheduledDays * 1.2,
    difficulty: 4,
    elapsedDays: 0,
    scheduledDays: opts.scheduledDays,
    reps: opts.reps,
    lapses: opts.lapses ?? 0,
    fsrsState: "review",
    dueDate: "2026-06-15",
    lastReview: opts.lastReview,
    firstSeen: opts.firstSeen,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: opts.scheduledDays >= MASTERED_SCHEDULED_DAYS,
  };
}

// ---------------------------------------------------------------------------
// Session shape helpers
// ---------------------------------------------------------------------------

export type MinimalNameCard = {
  id: number;
  cardType: "name";
  name: string;
  spriteUrl: string;
  habitat: string | null;
  types?: string[];
  speciesId?: number;
  locale?: AppLocale;
  state: ReviewState;
};

export type MinimalReverseCard = {
  id: number;
  cardType: "reverse";
  pokemonId: number;
  speciesId: number;
  name: string;
  spriteUrl: string;
  locale?: AppLocale;
  state: ReviewState;
};

export type MinimalCard = MinimalNameCard | MinimalReverseCard;

/**
 * Build a minimal mastered name card suitable for seeding into IDB.
 * The paired reverse card must also be seeded — see `masteredReversePair`.
 */
export function masteredNameCard(opts: {
  id: number;
  name: string;
  habitat?: string | null;
  types?: string[];
  firstSeen?: string;
  lastReview?: string;
  seenInPasture?: boolean;
  locale?: AppLocale;
}): MinimalNameCard {
  const firstSeen = opts.firstSeen ?? "2026-03-01";
  const lastReview = opts.lastReview ?? "2026-05-13";
  return {
    id: opts.id,
    cardType: "name",
    name: opts.name,
    spriteUrl: `/sprites/pokemon/${opts.id}.png`,
    habitat: opts.habitat ?? null,
    types: opts.types,
    speciesId: opts.id,
    locale: opts.locale ?? "en",
    state: masteredState({ firstSeen, lastReview, seenInPasture: opts.seenInPasture }),
  };
}

/**
 * Build a mastered reverse card paired with a name card.
 * filterMastered (since #1234) requires BOTH the name card AND the paired
 * reverse card to pass the mastery gate before a species is counted as mastered.
 */
export function masteredReverseCard(opts: {
  pokemonId: number;
  name?: string;
  locale?: AppLocale;
}): MinimalReverseCard {
  return {
    id: REVERSE_ID_OFFSET + opts.pokemonId,
    cardType: "reverse",
    pokemonId: opts.pokemonId,
    speciesId: opts.pokemonId,
    name: opts.name ?? `Pokémon ${opts.pokemonId}`,
    spriteUrl: `/sprites/pokemon/${opts.pokemonId}.png`,
    locale: opts.locale ?? "en",
    state: masteredState({ firstSeen: "2026-03-01", lastReview: "2026-05-13" }),
  };
}

/**
 * Convenience: build both the mastered name card AND its paired reverse card.
 * Always seed these together so filterMastered counts the species as mastered.
 */
export function masteredPair(opts: {
  id: number;
  name: string;
  habitat?: string | null;
  types?: string[];
  firstSeen?: string;
  lastReview?: string;
  seenInPasture?: boolean;
  locale?: AppLocale;
}): [MinimalNameCard, MinimalReverseCard] {
  return [
    masteredNameCard(opts),
    masteredReverseCard({ pokemonId: opts.id, name: opts.name, locale: opts.locale }),
  ];
}

/** Standard per-type daily limits for seeded sessions. */
export const DEFAULT_SEED_LIMITS = {
  name:      { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  evolution: { maxNewPerDay: 5,  maxReviewsPerDay: 50  },
  reverse:   { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  cry:       { maxNewPerDay: 0,  maxReviewsPerDay: 0   },
} as const;

export type SeedPayload = {
  session: { cards: MinimalCard[]; limits: typeof DEFAULT_SEED_LIMITS };
};

// ---------------------------------------------------------------------------
// Named scenarios
// ---------------------------------------------------------------------------

export type ScenarioKey =
  | "fsrs-locale-mastery"
  | "optimiser-stress"
  | "pasture-progression";

export type ScenarioMeta = {
  key: ScenarioKey;
  label: string;
  description: string;
};

export const SCENARIO_META: ScenarioMeta[] = [
  {
    key: "fsrs-locale-mastery",
    label: "FSRS locale mastery",
    description:
      "~30 mastered name cards in English + a few in-learning. Switching Pokémon name language to Japanese shows 0 mastered (locale-keyed FSRS state).",
  },
  {
    key: "optimiser-stress",
    label: "Optimiser stress",
    description:
      "~220 grades across ~20 cards with realistic spread, plus 2 single-review cards. Lets you trigger the FSRS optimiser and verify it returns weights.",
  },
  {
    key: "pasture-progression",
    label: "Pasture progression",
    description:
      "A believable mix of locked / in-progress / mastered species across several habitats. Populates the Pasture surface for manual QA.",
  },
];

// ---------------------------------------------------------------------------
// Scenario: fsrs-locale-mastery
// ---------------------------------------------------------------------------

/**
 * ~30 mastered name + reverse card pairs (all locale: 'en') + a few in-learning.
 *
 * QA use-case: switch pokemonNameLocale to 'ja' in Settings → Labs → Pokémon
 * name language. The Pasture should show 0 mastered because the 'ja'-locale
 * cards are all brand-new (no FSRS state exists for locale='ja' yet).
 */
export function buildFsrsLocaleMasteryScenario(): SeedPayload {
  // 30 well-known Gen I species — use small IDs so sprites are reliably
  // available in any seed environment.
  const masteredSpecies: Array<{ id: number; name: string; habitat: string }> = [
    { id: 1,   name: "Bulbasaur",  habitat: "grassland" },
    { id: 2,   name: "Ivysaur",    habitat: "grassland" },
    { id: 3,   name: "Venusaur",   habitat: "grassland" },
    { id: 4,   name: "Charmander", habitat: "mountain"  },
    { id: 5,   name: "Charmeleon", habitat: "mountain"  },
    { id: 6,   name: "Charizard",  habitat: "mountain"  },
    { id: 7,   name: "Squirtle",   habitat: "waters-edge" },
    { id: 8,   name: "Wartortle",  habitat: "waters-edge" },
    { id: 9,   name: "Blastoise",  habitat: "waters-edge" },
    { id: 10,  name: "Caterpie",   habitat: "forest"    },
    { id: 11,  name: "Metapod",    habitat: "forest"    },
    { id: 12,  name: "Butterfree", habitat: "forest"    },
    { id: 13,  name: "Weedle",     habitat: "forest"    },
    { id: 14,  name: "Kakuna",     habitat: "forest"    },
    { id: 15,  name: "Beedrill",   habitat: "forest"    },
    { id: 16,  name: "Pidgey",     habitat: "forest"    },
    { id: 17,  name: "Pidgeotto",  habitat: "forest"    },
    { id: 18,  name: "Pidgeot",    habitat: "forest"    },
    { id: 19,  name: "Rattata",    habitat: "grassland" },
    { id: 20,  name: "Raticate",   habitat: "grassland" },
    { id: 25,  name: "Pikachu",    habitat: "forest"    },
    { id: 26,  name: "Raichu",     habitat: "forest"    },
    { id: 39,  name: "Jigglypuff", habitat: "grassland" },
    { id: 52,  name: "Meowth",     habitat: "urban"     },
    { id: 54,  name: "Psyduck",    habitat: "waters-edge" },
    { id: 63,  name: "Abra",       habitat: "urban"     },
    { id: 74,  name: "Geodude",    habitat: "mountain"  },
    { id: 79,  name: "Slowpoke",   habitat: "waters-edge" },
    { id: 92,  name: "Gastly",     habitat: "urban"     },
    { id: 133, name: "Eevee",      habitat: "urban"     },
  ];

  // A few in-learning cards (not yet mastered)
  const learningSpecies: Array<{ id: number; name: string; habitat: string }> = [
    { id: 21, name: "Spearow", habitat: "forest"    },
    { id: 23, name: "Ekans",   habitat: "grassland" },
    { id: 27, name: "Sandshrew", habitat: "cave"   },
  ];

  const cards: MinimalCard[] = [];

  for (const s of masteredSpecies) {
    const [name, reverse] = masteredPair({
      id: s.id,
      name: s.name,
      habitat: s.habitat,
      locale: "en",
    });
    cards.push(name, reverse);
  }

  for (const s of learningSpecies) {
    cards.push({
      id: s.id,
      cardType: "name",
      name: s.name,
      spriteUrl: `/sprites/pokemon/${s.id}.png`,
      habitat: s.habitat,
      speciesId: s.id,
      locale: "en",
      state: learningState({ firstSeen: "2026-05-20", reps: 2, scheduledDays: 5 }),
    });
    cards.push({
      id: REVERSE_ID_OFFSET + s.id,
      cardType: "reverse",
      pokemonId: s.id,
      speciesId: s.id,
      name: s.name,
      spriteUrl: `/sprites/pokemon/${s.id}.png`,
      locale: "en",
      state: learningState({ firstSeen: "2026-05-20", reps: 1, scheduledDays: 3 }),
    });
  }

  return { session: { cards, limits: { ...DEFAULT_SEED_LIMITS } } };
}

// ---------------------------------------------------------------------------
// Scenario: optimiser-stress
// ---------------------------------------------------------------------------

/**
 * ~220 grades across ~20 cards with a realistic spread, plus 2 single-review
 * cards. Lets the maintainer trigger the FSRS optimiser on the Settings page
 * and verify it returns weights (not a 500 error).
 *
 * The optimiser requires 200+ grades; each card here has reps proportional to
 * how mature it is. Two single-review cards are included so the deltaT=0
 * regression (#1304) can be exercised.
 */
export function buildOptimiserStressScenario(): SeedPayload {
  // 20 cards with high reps simulate a mature deck (10–15 reviews each).
  const heavyCards: Array<{ id: number; name: string; reps: number; scheduledDays: number }> = [
    { id: 1,   name: "Bulbasaur",  reps: 15, scheduledDays: 90  },
    { id: 4,   name: "Charmander", reps: 14, scheduledDays: 80  },
    { id: 7,   name: "Squirtle",   reps: 13, scheduledDays: 75  },
    { id: 25,  name: "Pikachu",    reps: 12, scheduledDays: 65  },
    { id: 39,  name: "Jigglypuff", reps: 12, scheduledDays: 60  },
    { id: 52,  name: "Meowth",     reps: 11, scheduledDays: 55  },
    { id: 54,  name: "Psyduck",    reps: 11, scheduledDays: 50  },
    { id: 63,  name: "Abra",       reps: 10, scheduledDays: 45  },
    { id: 74,  name: "Geodude",    reps: 10, scheduledDays: 40  },
    { id: 79,  name: "Slowpoke",   reps: 10, scheduledDays: 40  },
    { id: 92,  name: "Gastly",     reps: 10, scheduledDays: 35  },
    { id: 133, name: "Eevee",      reps: 10, scheduledDays: 35  },
    { id: 10,  name: "Caterpie",   reps: 12, scheduledDays: 70  },
    { id: 16,  name: "Pidgey",     reps: 11, scheduledDays: 60  },
    { id: 19,  name: "Rattata",    reps: 11, scheduledDays: 55  },
    { id: 23,  name: "Ekans",      reps: 10, scheduledDays: 50  },
    { id: 27,  name: "Sandshrew",  reps: 10, scheduledDays: 45  },
    { id: 35,  name: "Clefairy",   reps: 10, scheduledDays: 40  },
    { id: 41,  name: "Zubat",      reps: 10, scheduledDays: 35  },
    { id: 43,  name: "Oddish",     reps: 10, scheduledDays: 30  },
  ];

  // 2 single-review cards (reps=1) to exercise deltaT=0 optimiser path (#1304)
  const singleReviewCards: Array<{ id: number; name: string }> = [
    { id: 50, name: "Diglett" },
    { id: 60, name: "Poliwag" },
  ];

  const cards: MinimalCard[] = [];

  for (const c of heavyCards) {
    cards.push({
      id: c.id,
      cardType: "name",
      name: c.name,
      spriteUrl: `/sprites/pokemon/${c.id}.png`,
      habitat: null,
      speciesId: c.id,
      locale: "en",
      state: heavilyReviewedState({
        firstSeen: "2025-12-01",
        lastReview: "2026-05-01",
        reps: c.reps,
        scheduledDays: c.scheduledDays,
      }),
    });
    cards.push({
      id: REVERSE_ID_OFFSET + c.id,
      cardType: "reverse",
      pokemonId: c.id,
      speciesId: c.id,
      name: c.name,
      spriteUrl: `/sprites/pokemon/${c.id}.png`,
      locale: "en",
      state: heavilyReviewedState({
        firstSeen: "2025-12-15",
        lastReview: "2026-05-10",
        reps: Math.max(1, c.reps - 2),
        scheduledDays: Math.max(1, c.scheduledDays - 10),
      }),
    });
  }

  for (const c of singleReviewCards) {
    cards.push({
      id: c.id,
      cardType: "name",
      name: c.name,
      spriteUrl: `/sprites/pokemon/${c.id}.png`,
      habitat: null,
      speciesId: c.id,
      locale: "en",
      state: learningState({ firstSeen: "2026-05-28", reps: 1, scheduledDays: 1 }),
    });
  }

  return { session: { cards, limits: { ...DEFAULT_SEED_LIMITS } } };
}

// ---------------------------------------------------------------------------
// Scenario: pasture-progression
// ---------------------------------------------------------------------------

/**
 * A believable mix of mastered, in-learning, and new cards across several
 * habitats. Populates the Pasture with a plausible-looking collection for
 * manual UI QA without needing any real grade history.
 *
 * Habitats represented: forest, grassland, mountain, waters-edge, urban.
 */
export function buildPastureProgressionScenario(): SeedPayload {
  // Mastered species (both legs required per #1234)
  const mastered: Array<{ id: number; name: string; habitat: string; seenInPasture?: boolean }> = [
    // Forest
    { id: 10,  name: "Caterpie",   habitat: "forest",       seenInPasture: true  },
    { id: 11,  name: "Metapod",    habitat: "forest",       seenInPasture: true  },
    { id: 12,  name: "Butterfree", habitat: "forest",       seenInPasture: false },
    { id: 16,  name: "Pidgey",     habitat: "forest",       seenInPasture: false },
    { id: 25,  name: "Pikachu",    habitat: "forest",       seenInPasture: true  },
    // Grassland
    { id: 1,   name: "Bulbasaur",  habitat: "grassland",    seenInPasture: false },
    { id: 19,  name: "Rattata",    habitat: "grassland",    seenInPasture: true  },
    { id: 39,  name: "Jigglypuff", habitat: "grassland",    seenInPasture: false },
    // Mountain
    { id: 4,   name: "Charmander", habitat: "mountain",     seenInPasture: false },
    { id: 74,  name: "Geodude",    habitat: "mountain",     seenInPasture: true  },
    // Waters-edge
    { id: 7,   name: "Squirtle",   habitat: "waters-edge",  seenInPasture: false },
    { id: 54,  name: "Psyduck",    habitat: "waters-edge",  seenInPasture: true  },
    { id: 79,  name: "Slowpoke",   habitat: "waters-edge",  seenInPasture: false },
    // Urban
    { id: 52,  name: "Meowth",     habitat: "urban",        seenInPasture: false },
    { id: 63,  name: "Abra",       habitat: "urban",        seenInPasture: true  },
    { id: 133, name: "Eevee",      habitat: "urban",        seenInPasture: false },
  ];

  // In-learning species (name card only, no reverse pair — not yet mastered)
  const learning: Array<{ id: number; name: string; habitat: string }> = [
    { id: 13, name: "Weedle",    habitat: "forest"    },
    { id: 23, name: "Ekans",     habitat: "grassland" },
    { id: 5,  name: "Charmeleon", habitat: "mountain" },
    { id: 72, name: "Tentacool", habitat: "sea"       },
  ];

  const cards: MinimalCard[] = [];

  for (const s of mastered) {
    const [name, reverse] = masteredPair({
      id: s.id,
      name: s.name,
      habitat: s.habitat,
      seenInPasture: s.seenInPasture,
      locale: "en",
    });
    cards.push(name, reverse);
  }

  for (const s of learning) {
    cards.push({
      id: s.id,
      cardType: "name",
      name: s.name,
      spriteUrl: `/sprites/pokemon/${s.id}.png`,
      habitat: s.habitat,
      speciesId: s.id,
      locale: "en",
      state: learningState({ firstSeen: "2026-05-15", reps: 2, scheduledDays: 6 }),
    });
    // Reverse card with fewer reps — not mastered
    cards.push({
      id: REVERSE_ID_OFFSET + s.id,
      cardType: "reverse",
      pokemonId: s.id,
      speciesId: s.id,
      name: s.name,
      spriteUrl: `/sprites/pokemon/${s.id}.png`,
      locale: "en",
      state: learningState({ firstSeen: "2026-05-18", reps: 1, scheduledDays: 3 }),
    });
  }

  return { session: { cards, limits: { ...DEFAULT_SEED_LIMITS } } };
}

// ---------------------------------------------------------------------------
// Scenario dispatch
// ---------------------------------------------------------------------------

export function buildScenario(key: ScenarioKey): SeedPayload {
  switch (key) {
    case "fsrs-locale-mastery":
      return buildFsrsLocaleMasteryScenario();
    case "optimiser-stress":
      return buildOptimiserStressScenario();
    case "pasture-progression":
      return buildPastureProgressionScenario();
    default: {
      const _exhaustive: never = key;
      throw new Error(`Unknown QA seed scenario: ${String(_exhaustive)}`);
    }
  }
}
