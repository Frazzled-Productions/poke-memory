import { describe, it, expect } from 'vitest';
import {
  hydrateSession,
  buildSession,
  buildSessionQueues,
  type DailyLimits,
  type EvolutionReviewCard,
  type NameReviewCard,
  type ReverseReviewCard,
  type ReviewableCard,
} from '@/lib/review/session';
import type { EvolutionCard, SeedPokemon } from '@/lib/pokemon/seed';
import { REVERSE_ID_OFFSET } from '@/lib/pokemon/seed';
import { initialReviewState } from '@/lib/srs/scheduler';
import { migrateReviewCard } from '@/lib/review/persistence';

const NOW = new Date('2026-05-09T12:00:00Z');

function makeSeedPokemon(id: number, overrides: Partial<SeedPokemon> = {}): SeedPokemon {
  return {
    id,
    name: 'pokemon-' + id,
    spriteUrl: '',
    types: ['normal'],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: 'A pokemon.',
    flavorTexts: ['A pokemon.'],
    evolutionChain: [],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: 'Generic',
    generation: 'generation-i',
    captureRate: 45,
    baseHappiness: 50,
    growthRate: 'medium',
    habitat: null,
    genderRate: 0,
    isLegendary: false,
    isMythical: false,
    ...overrides,
  };
}

function makeCard(seedPokemon: SeedPokemon, stateOverrides: Partial<ReturnType<typeof initialReviewState>> = {}): NameReviewCard {
  return {
    ...seedPokemon,
    cardType: 'name',
    state: { ...initialReviewState(NOW), ...stateOverrides },
  };
}

describe('hydrateSession', () => {
  it('appends new seed cards not present in saved session', () => {
    const saved = [makeCard(makeSeedPokemon(1))];
    const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];
    // Pass empty evo seed so only name cards are counted
    const result = hydrateSession(saved, seed, [], NOW);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toContain(2);
  });

  it('preserves review state on existing cards', () => {
    const saved = [makeCard(makeSeedPokemon(1), { repetitions: 5, interval: 10 })];
    const seed = [makeSeedPokemon(1)];
    const result = hydrateSession(saved, seed, [], NOW);
    expect(result[0].state.repetitions).toBe(5);
    expect(result[0].state.interval).toBe(10);
  });

  it('refreshes seed fields (including flavorTexts) on existing persisted cards', () => {
    const stale = makeSeedPokemon(1, { flavorTexts: undefined });
    const saved = [makeCard(stale)];
    const freshSeed = [makeSeedPokemon(1, { flavorTexts: ['New flavor text.'] })];
    const result = hydrateSession(saved, freshSeed, [], NOW);
    const card = result[0];
    if (card.cardType !== 'name') throw new Error('Expected name card');
    expect(card.flavorTexts).toEqual(['New flavor text.']);
    expect(card.state.repetitions).toBe(saved[0].state.repetitions);
  });

  it('keeps cards whose id is not in the seed unchanged', () => {
    const saved = [makeCard(makeSeedPokemon(99))];
    const seed = [makeSeedPokemon(1)];
    const result = hydrateSession(saved, seed, [], NOW);
    expect(result.find((c) => c.id === 99)).toBeDefined();
  });

  it('returns an unchanged copy when no additions and no refreshes needed', () => {
    const saved = [makeCard(makeSeedPokemon(1))];
    const seed = [makeSeedPokemon(1)];
    const result = hydrateSession(saved, seed, [], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('appends evolution cards not present in saved session', () => {
    const saved = [makeCard(makeSeedPokemon(1))];
    const seed = [makeSeedPokemon(1)];
    const evoSeed = [
      {
        cardType: 'evolution' as const,
        id: 1_000_001,
        pokemonId: 1,
        name: 'bulbasaur',
        spriteUrl: '',
        evolvesInto: [{ name: 'ivysaur', spriteUrl: '' }],
      },
    ];
    const result = hydrateSession(saved, seed, evoSeed, NOW);
    expect(result).toHaveLength(2);
    expect(result.find((c) => c.id === 1_000_001)).toBeDefined();
  });
});

describe('buildSession', () => {
  const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];
  const evoSeed: EvolutionCard[] = [
    {
      cardType: 'evolution',
      id: 1_000_001,
      pokemonId: 1,
      name: 'bulbasaur',
      spriteUrl: '',
      evolvesInto: [{ name: 'ivysaur', spriteUrl: '' }],
    },
  ];

  it('assigns cardType "name" to name cards', () => {
    const result = buildSession(seed, evoSeed, NOW);
    const nameCards = result.filter((c) => c.cardType === 'name');
    expect(nameCards).toHaveLength(2);
    expect(nameCards.map((c) => c.id)).toEqual([1, 2]);
  });

  it('assigns cardType "evolution" to evolution cards', () => {
    const result = buildSession(seed, evoSeed, NOW);
    const evoCards = result.filter((c) => c.cardType === 'evolution');
    expect(evoCards).toHaveLength(1);
    expect(evoCards[0].id).toBe(1_000_001);
  });

  it('produces total count of name + evo cards', () => {
    const result = buildSession(seed, evoSeed, NOW);
    expect(result).toHaveLength(3);
  });
});

describe('hydrateSession (evolution refresh)', () => {
  it('refreshes stale evolvesInto on existing evolution cards', () => {
    const stale: EvolutionReviewCard = {
      cardType: 'evolution',
      id: 1_000_001,
      pokemonId: 1,
      name: 'bulbasaur',
      spriteUrl: 'old-url',
      evolvesInto: [{ name: 'ivysaur', spriteUrl: '' }],
      state: { ...initialReviewState(NOW), repetitions: 7, interval: 30 },
    };
    const freshEvo: EvolutionCard = {
      cardType: 'evolution',
      id: 1_000_001,
      pokemonId: 1,
      name: 'bulbasaur',
      spriteUrl: 'new-url',
      evolvesInto: [{ name: 'ivysaur', spriteUrl: '' }, { name: 'venusaur', spriteUrl: '' }],
    };
    const result = hydrateSession([stale], [], [freshEvo], NOW);
    expect(result).toHaveLength(1);
    const card = result[0];
    if (card.cardType !== 'evolution') throw new Error('Expected evolution card');
    expect(card.evolvesInto.map((e) => e.name)).toEqual(['ivysaur', 'venusaur']);
    expect(card.spriteUrl).toBe('new-url');
    expect(card.state.repetitions).toBe(7);
    expect(card.state.interval).toBe(30);
  });
});

describe('migrateReviewCard', () => {
  it('backfills cardType "name" on legacy cards missing the field', () => {
    const legacy: Record<string, unknown> = {
      id: 1,
      name: 'bulbasaur',
      spriteUrl: '',
      state: {
        repetitions: 0,
        interval: 0,
        easeFactor: 2.5,
        dueDate: '2026-05-09',
        lastReview: null,
        firstSeen: null,
        learningStep: null,
        stepStartedAt: null,
      },
    };
    migrateReviewCard(legacy);
    expect(legacy.cardType).toBe('name');
  });

  it('leaves an explicit cardType of "evolution" untouched', () => {
    const card: Record<string, unknown> = {
      cardType: 'evolution',
      id: 1_000_001,
      name: 'bulbasaur',
      spriteUrl: '',
      evolvesInto: [{ name: 'ivysaur', spriteUrl: '' }],
      state: {
        repetitions: 0,
        interval: 0,
        easeFactor: 2.5,
        dueDate: '2026-05-09',
        lastReview: null,
        firstSeen: null,
        learningStep: null,
        stepStartedAt: null,
      },
    };
    migrateReviewCard(card);
    expect(card.cardType).toBe('evolution');
  });

  it('backfills firstSeen from lastReview on legacy state shapes', () => {
    const legacy: Record<string, unknown> = {
      id: 1,
      name: 'bulbasaur',
      spriteUrl: '',
      state: {
        repetitions: 1,
        interval: 1,
        easeFactor: 2.5,
        dueDate: '2026-05-10',
        lastReview: '2026-05-08',
        // firstSeen, learningStep, stepStartedAt all absent
      },
    };
    migrateReviewCard(legacy);
    const state = legacy.state as Record<string, unknown>;
    expect(state.firstSeen).toBe('2026-05-08');
    expect(state.learningStep).toBeNull();
    expect(state.stepStartedAt).toBeNull();
  });
});

describe('buildSession (reverse cards)', () => {
  const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];

  it('excludes reverse cards when reverseEnabled is false (default)', () => {
    const result = buildSession(seed, [], NOW);
    expect(result.filter((c) => c.cardType === 'reverse')).toHaveLength(0);
  });

  it('includes reverse cards when reverseEnabled is true', () => {
    const result = buildSession(seed, [], NOW, { reverseEnabled: true });
    const reverseCards = result.filter((c) => c.cardType === 'reverse');
    expect(reverseCards).toHaveLength(2);
    expect(reverseCards.map((c) => c.id)).toEqual(
      expect.arrayContaining([REVERSE_ID_OFFSET + 1, REVERSE_ID_OFFSET + 2]),
    );
  });

  it('reverse card id = REVERSE_ID_OFFSET + pokemon.id', () => {
    const result = buildSession(seed, [], NOW, { reverseEnabled: true });
    const rev = result.find((c) => c.cardType === 'reverse' && (c as ReverseReviewCard).pokemonId === 1);
    expect(rev?.id).toBe(REVERSE_ID_OFFSET + 1);
  });
});

describe('hydrateSession (reverse cards)', () => {
  const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];

  it('appends reverse cards when enabled and not in saved session', () => {
    const saved = [makeCard(makeSeedPokemon(1))];
    const result = hydrateSession(saved, seed, [], NOW, { reverseEnabled: true });
    const reverseCards = result.filter((c) => c.cardType === 'reverse');
    expect(reverseCards).toHaveLength(2);
  });

  it('strips saved reverse cards when reverseEnabled is false', () => {
    const revCard: ReverseReviewCard = {
      ...makeSeedPokemon(1),
      id: REVERSE_ID_OFFSET + 1,
      pokemonId: 1,
      cardType: 'reverse',
      state: initialReviewState(NOW),
    };
    const saved = [makeCard(makeSeedPokemon(1)), revCard];
    const result = hydrateSession(saved, seed, [], NOW, { reverseEnabled: false });
    expect(result.filter((c) => c.cardType === 'reverse')).toHaveLength(0);
  });

  it('strips reverse cards when toggle is turned off (build-then-disable path)', () => {
    const built = buildSession(seed, [], NOW, { reverseEnabled: true });
    const result = hydrateSession(built, seed, [], NOW, { reverseEnabled: false });
    expect(result.filter((c) => c.cardType === 'reverse')).toHaveLength(0);
    expect(result.filter((c) => c.cardType === 'name')).toHaveLength(seed.length);
  });

  it('preserves review state on existing reverse cards when re-enabled', () => {
    const revCard: ReverseReviewCard = {
      ...makeSeedPokemon(1),
      id: REVERSE_ID_OFFSET + 1,
      pokemonId: 1,
      cardType: 'reverse',
      state: { ...initialReviewState(NOW), repetitions: 4, interval: 30 },
    };
    const result = hydrateSession([revCard], seed, [], NOW, { reverseEnabled: true });
    const found = result.find((c) => c.id === REVERSE_ID_OFFSET + 1);
    expect(found?.state.repetitions).toBe(4);
    expect(found?.state.interval).toBe(30);
  });
});

describe('buildSession (name/evolution enabled flags)', () => {
  const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];
  const evoSeed: EvolutionCard[] = [
    {
      cardType: 'evolution',
      id: 1_000_001,
      pokemonId: 1,
      name: 'bulbasaur',
      spriteUrl: '',
      evolvesInto: [{ name: 'ivysaur', spriteUrl: '' }],
    },
  ];

  it('buildSession with nameEnabled: false → zero name cards', () => {
    const result = buildSession(seed, evoSeed, NOW, { nameEnabled: false });
    expect(result.filter((c) => c.cardType === 'name')).toHaveLength(0);
    // evo cards still present
    expect(result.filter((c) => c.cardType === 'evolution')).toHaveLength(1);
  });

  it('buildSession with evolutionEnabled: false → zero evolution cards', () => {
    const result = buildSession(seed, evoSeed, NOW, { evolutionEnabled: false });
    expect(result.filter((c) => c.cardType === 'evolution')).toHaveLength(0);
    // name cards still present
    expect(result.filter((c) => c.cardType === 'name')).toHaveLength(2);
  });

  it('buildSession with both disabled → zero cards of both types (reverse unaffected if enabled)', () => {
    const result = buildSession(seed, evoSeed, NOW, {
      nameEnabled: false,
      evolutionEnabled: false,
      reverseEnabled: true,
    });
    expect(result.filter((c) => c.cardType === 'name')).toHaveLength(0);
    expect(result.filter((c) => c.cardType === 'evolution')).toHaveLength(0);
    expect(result.filter((c) => c.cardType === 'reverse')).toHaveLength(2);
  });
});

describe('hydrateSession (name/evolution enabled flags)', () => {
  const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];
  const evoSeed: EvolutionCard[] = [
    {
      cardType: 'evolution',
      id: 1_000_001,
      pokemonId: 1,
      name: 'bulbasaur',
      spriteUrl: '',
      evolvesInto: [{ name: 'ivysaur', spriteUrl: '' }],
    },
  ];

  it('hydrateSession strips saved name cards when nameEnabled: false', () => {
    const saved: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1)),
      makeCard(makeSeedPokemon(2)),
    ];
    const result = hydrateSession(saved, seed, evoSeed, NOW, { nameEnabled: false });
    expect(result.filter((c) => c.cardType === 'name')).toHaveLength(0);
  });

  it('hydrateSession strips saved evolution cards when evolutionEnabled: false', () => {
    const savedEvo: EvolutionReviewCard = {
      cardType: 'evolution',
      id: 1_000_001,
      pokemonId: 1,
      name: 'bulbasaur',
      spriteUrl: '',
      evolvesInto: [{ name: 'ivysaur', spriteUrl: '' }],
      state: initialReviewState(NOW),
    };
    const saved: ReviewableCard[] = [makeCard(makeSeedPokemon(1)), savedEvo];
    const result = hydrateSession(saved, seed, evoSeed, NOW, { evolutionEnabled: false });
    expect(result.filter((c) => c.cardType === 'evolution')).toHaveLength(0);
  });

  it('hydrateSession does not add new name cards when nameEnabled: false', () => {
    // saved is empty — no saved name cards, but seed has 2 pokemon
    const result = hydrateSession([], seed, [], NOW, { nameEnabled: false });
    expect(result.filter((c) => c.cardType === 'name')).toHaveLength(0);
  });

  it('hydrateSession does not add new evolution cards when evolutionEnabled: false', () => {
    // saved is empty — no saved evo cards, but evoSeed has 1 entry
    const result = hydrateSession([], seed, evoSeed, NOW, { evolutionEnabled: false });
    expect(result.filter((c) => c.cardType === 'evolution')).toHaveLength(0);
  });
});

describe('buildSessionQueues (per-type budgets)', () => {
  const TODAY = '2026-05-09';
  const baseLimits: DailyLimits = {
    name: { maxNewPerDay: 2, maxReviewsPerDay: 5 },
    evolution: { maxNewPerDay: 1, maxReviewsPerDay: 3 },
    reverse: { maxNewPerDay: 2, maxReviewsPerDay: 5 },
  };

  function nameCard(id: number, partialState: Partial<ReturnType<typeof initialReviewState>> = {}): NameReviewCard {
    return {
      ...makeSeedPokemon(id),
      cardType: 'name',
      state: { ...initialReviewState(NOW), ...partialState },
    };
  }
  function evoCard(id: number, partialState: Partial<ReturnType<typeof initialReviewState>> = {}): EvolutionReviewCard {
    return {
      cardType: 'evolution',
      id,
      pokemonId: id - 1_000_000,
      name: 'name-' + id,
      spriteUrl: '',
      evolvesInto: [{ name: 'evo-of-' + id, spriteUrl: '' }],
      state: { ...initialReviewState(NOW), ...partialState },
    };
  }
  function reverseCard(pokemonId: number, partialState: Partial<ReturnType<typeof initialReviewState>> = {}): ReverseReviewCard {
    return {
      ...makeSeedPokemon(pokemonId),
      id: REVERSE_ID_OFFSET + pokemonId,
      pokemonId,
      cardType: 'reverse',
      state: { ...initialReviewState(NOW), ...partialState },
    };
  }

  it('caps new name and new evolution cards independently', () => {
    const cards: ReviewableCard[] = [
      // 5 fresh name cards, 3 fresh evolution cards — all eligible as new
      nameCard(1), nameCard(2), nameCard(3), nameCard(4), nameCard(5),
      evoCard(1_000_001), evoCard(1_000_002), evoCard(1_000_003),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    const newCards = queues.newQueue.map((id) => cards.find((c) => c.id === id)!);
    const newName = newCards.filter((c) => c.cardType === 'name');
    const newEvo = newCards.filter((c) => c.cardType === 'evolution');
    expect(newName).toHaveLength(2); // name cap = 2
    expect(newEvo).toHaveLength(1);  // evo cap = 1
  });

  it('counts already-introduced new cards per cardType', () => {
    const cards: ReviewableCard[] = [
      // Today: name has 2 introduced (at cap), evo has 0 (under cap)
      nameCard(1, { firstSeen: TODAY, lastReview: TODAY, repetitions: 1 }),
      nameCard(2, { firstSeen: TODAY, lastReview: TODAY, repetitions: 1 }),
      // Fresh candidates of each type
      nameCard(3),
      nameCard(4),
      evoCard(1_000_001),
      evoCard(1_000_002),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    expect(queues.perType.name.newIntroducedToday).toBe(2);
    expect(queues.perType.evolution.newIntroducedToday).toBe(0);
    // name is at cap → no additional new name cards
    const newCards = queues.newQueue.map((id) => cards.find((c) => c.id === id)!);
    expect(newCards.filter((c) => c.cardType === 'name')).toHaveLength(0);
    // evo still has 1 slot
    expect(newCards.filter((c) => c.cardType === 'evolution')).toHaveLength(1);
  });

  it('counts reviews per cardType independently', () => {
    const cards: ReviewableCard[] = [
      // 3 name reviews done today
      nameCard(1, { firstSeen: '2026-05-01', lastReview: TODAY, repetitions: 2 }),
      nameCard(2, { firstSeen: '2026-05-01', lastReview: TODAY, repetitions: 2 }),
      nameCard(3, { firstSeen: '2026-05-01', lastReview: TODAY, repetitions: 2 }),
      // 1 evo review done today
      evoCard(1_000_001, { firstSeen: '2026-05-01', lastReview: TODAY, repetitions: 2 }),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    expect(queues.perType.name.reviewsDoneToday).toBe(3);
    expect(queues.perType.evolution.reviewsDoneToday).toBe(1);
    // Blended counters sum across types for the TodayPill display
    expect(queues.reviewsDoneToday).toBe(4);
  });

  it('does not let evolution cards consume the name new-card budget', () => {
    const cards: ReviewableCard[] = [
      // 100 fresh evo cards, 1 fresh name card
      ...Array.from({ length: 100 }, (_, i) => evoCard(1_000_001 + i)),
      nameCard(1),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    const newCards = queues.newQueue.map((id) => cards.find((c) => c.id === id)!);
    expect(newCards.filter((c) => c.cardType === 'name')).toHaveLength(1);
    expect(newCards.filter((c) => c.cardType === 'evolution')).toHaveLength(1); // capped at 1
  });

  it('caps reverse cards independently from name and evolution', () => {
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2), nameCard(3),     // 3 fresh name (cap=2)
      reverseCard(1), reverseCard(2), reverseCard(3), // 3 fresh reverse (cap=2)
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    const newCards = queues.newQueue.map((id) => cards.find((c) => c.id === id)!);
    expect(newCards.filter((c) => c.cardType === 'name')).toHaveLength(2);
    expect(newCards.filter((c) => c.cardType === 'reverse')).toHaveLength(2);
  });

  it('tracks reverse card review counters independently', () => {
    const cards: ReviewableCard[] = [
      reverseCard(1, { firstSeen: '2026-05-01', lastReview: TODAY, repetitions: 2 }),
      reverseCard(2, { firstSeen: '2026-05-01', lastReview: TODAY, repetitions: 2 }),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    expect(queues.perType.reverse.reviewsDoneToday).toBe(2);
    expect(queues.perType.name.reviewsDoneToday).toBe(0);
    expect(queues.reviewsDoneToday).toBe(2);
  });
});
