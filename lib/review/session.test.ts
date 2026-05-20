import { describe, it, expect } from 'vitest';
import {
  hydrateSession,
  buildSession,
  buildSessionQueues,
  buildQueueCounters,
  countDueTomorrow,
  limitBucket,
  cardTypeIsEnabled,
  groupNewCandidatesBySpecies,
  stableShuffleForDay,
  type DailyLimits,
  type EvolutionReviewCard,
  type NameReviewCard,
  type ReverseReviewCard,
  type CryReviewCard,
  type ReviewableCard,
} from '@/lib/review/session';
import type { EvolutionCard, SeedPokemon } from '@/lib/pokemon/seed';
import {
  REVERSE_ID_OFFSET,
  CRY_ID_OFFSET,
  REVERSE_EDGE_ID_BASE,
  reverseEdgeIdFor,
  isReverseEdgeId,
} from '@/lib/pokemon/seed';
import { initialReviewState } from '@/lib/srs/scheduler';
import { migrateReviewCard } from '@/lib/review/persistence';

const NOW = new Date('2026-05-09T12:00:00Z');

function makeSeedPokemon(id: number, overrides: Partial<SeedPokemon> = {}): SeedPokemon {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: 'pokemon-' + id,
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
    cryUrl: null,
    ...overrides,
  };
}

function makeCard(seedPokemon: SeedPokemon, stateOverrides: Partial<ReturnType<typeof initialReviewState>> = {}): NameReviewCard {
  return {
    ...seedPokemon,
    cardType: 'name',
    subjectKey: String(seedPokemon.id),
    state: { ...initialReviewState(NOW), ...stateOverrides },
  };
}

function makeEvoEdge(opts: {
  id?: number;
  preEvoId?: number;
  preEvoName?: string;
  postEvoId?: number;
  postEvoName?: string;
  postEvoSpriteUrl?: string;
  preEvoSpriteUrl?: string;
  triggerPhrase?: string | null;
} = {}): EvolutionCard {
  return {
    cardType: 'evolution',
    id: opts.id ?? 1_500_001,
    preEvoId: opts.preEvoId ?? 1,
    preEvoName: opts.preEvoName ?? 'bulbasaur',
    preEvoSpriteUrl: opts.preEvoSpriteUrl ?? '',
    postEvoId: opts.postEvoId ?? 2,
    postEvoName: opts.postEvoName ?? 'ivysaur',
    postEvoSpriteUrl: opts.postEvoSpriteUrl ?? '',
    triggerPhrase: opts.triggerPhrase ?? null,
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
    const saved = [makeCard(makeSeedPokemon(1), { reps:5, scheduledDays:10 })];
    const seed = [makeSeedPokemon(1)];
    const result = hydrateSession(saved, seed, [], NOW);
    expect(result[0].state.reps).toBe(5);
    expect(result[0].state.scheduledDays).toBe(10);
  });

  it('refreshes seed fields (including flavorTexts) on existing persisted cards', () => {
    const stale = makeSeedPokemon(1, { flavorTexts: undefined });
    const saved = [makeCard(stale)];
    const freshSeed = [makeSeedPokemon(1, { flavorTexts: ['New flavor text.'] })];
    const result = hydrateSession(saved, freshSeed, [], NOW);
    const card = result[0];
    if (card.cardType !== 'name') throw new Error('Expected name card');
    expect(card.flavorTexts).toEqual(['New flavor text.']);
    expect(card.state.reps).toBe(saved[0].state.reps);
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
    const evoSeed = [makeEvoEdge({ id: 1_500_001 })];
    const result = hydrateSession(saved, seed, evoSeed, NOW);
    expect(result).toHaveLength(2);
    expect(result.find((c) => c.id === 1_500_001)).toBeDefined();
  });
});

describe('buildSession', () => {
  const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];
  const evoSeed: EvolutionCard[] = [makeEvoEdge({ id: 1_500_001 })];

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
    expect(evoCards[0].id).toBe(1_500_001);
  });

  it('produces total count of name + evo cards', () => {
    const result = buildSession(seed, evoSeed, NOW);
    expect(result).toHaveLength(3);
  });
});

describe('hydrateSession (evolution refresh)', () => {
  it('refreshes stale sprite/trigger fields on existing evolution edge cards while preserving FSRS state', () => {
    const stale: EvolutionReviewCard = {
      ...makeEvoEdge({
        id: 1_500_001,
        preEvoSpriteUrl: 'old-pre',
        postEvoSpriteUrl: 'old-post',
        triggerPhrase: null,
      }),
      subjectKey: '1>>>2',
      state: { ...initialReviewState(NOW), reps: 7, scheduledDays: 30 },
    };
    const freshEvo = makeEvoEdge({
      id: 1_500_001,
      preEvoSpriteUrl: 'new-pre',
      postEvoSpriteUrl: 'new-post',
      triggerPhrase: 'at level 16',
    });
    const result = hydrateSession([stale], [], [freshEvo], NOW);
    expect(result).toHaveLength(1);
    const card = result[0];
    if (card.cardType !== 'evolution') throw new Error('Expected evolution card');
    expect(card.preEvoSpriteUrl).toBe('new-pre');
    expect(card.postEvoSpriteUrl).toBe('new-post');
    expect(card.triggerPhrase).toBe('at level 16');
    expect(card.state.reps).toBe(7);
    expect(card.state.scheduledDays).toBe(30);
  });
});

describe('migrateReviewState (stepStartedAt backfill for learning-step cards)', () => {
  it('sets stepStartedAt to a number when learningStep is non-null and stepStartedAt is absent', () => {
    const state: Record<string, unknown> = {
      reps:0,
      scheduledDays:0,
      dueDate: '2026-05-11',
      lastReview: null,
      firstSeen: '2026-05-11',
      learningStep: 0,
      // stepStartedAt intentionally absent — simulates old persisted schema
    };
    const before = Date.now();
    migrateReviewCard({ id: 1, name: 'bulbasaur', spriteUrl: '', state });
    const after = Date.now();
    expect(typeof state.stepStartedAt).toBe('number');
    expect(state.stepStartedAt as number).toBeGreaterThanOrEqual(before);
    expect(state.stepStartedAt as number).toBeLessThanOrEqual(after);
  });

  it('keeps stepStartedAt as null when learningStep is null and stepStartedAt is absent', () => {
    const state: Record<string, unknown> = {
      reps:3,
      scheduledDays:7,
      dueDate: '2026-05-18',
      lastReview: '2026-05-11',
      firstSeen: '2026-05-01',
      learningStep: null,
      // stepStartedAt intentionally absent — graduated card, should stay null
    };
    migrateReviewCard({ id: 1, name: 'bulbasaur', spriteUrl: '', state });
    expect(state.stepStartedAt).toBeNull();
  });
});

describe('migrateReviewCard', () => {
  it('backfills cardType "name" on legacy cards missing the field', () => {
    const legacy: Record<string, unknown> = {
      id: 1,
      name: 'bulbasaur',
      spriteUrl: '',
      state: {
        reps:0,
        scheduledDays:0,
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

  it('leaves an explicit cardType of "evolution" untouched (new edge-card shape)', () => {
    const card: Record<string, unknown> = {
      cardType: 'evolution',
      id: 1_500_001,
      preEvoId: 1,
      preEvoName: 'bulbasaur',
      preEvoSpriteUrl: '',
      postEvoId: 2,
      postEvoName: 'ivysaur',
      postEvoSpriteUrl: '',
      triggerPhrase: 'at level 16',
      state: {
        reps:0,
        scheduledDays:0,
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
        reps:1,
        scheduledDays:1,
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

  it('preserves saved reverse cards when reverseEnabled is false (non-destructive disable, #835)', () => {
    const revCard: ReverseReviewCard = {
      ...makeSeedPokemon(1),
      id: REVERSE_ID_OFFSET + 1,
      pokemonId: 1,
      cardType: 'reverse',
      subjectKey: '1',
      state: initialReviewState(NOW),
    };
    const saved = [makeCard(makeSeedPokemon(1)), revCard];
    const result = hydrateSession(saved, seed, [], NOW, { reverseEnabled: false });
    // Saved reverse cards are kept in storage so progress is not lost on re-enable.
    expect(result.filter((c) => c.cardType === 'reverse')).toHaveLength(1);
  });

  it('preserves reverse cards when toggle is turned off (build-then-disable path, #835)', () => {
    const built = buildSession(seed, [], NOW, { reverseEnabled: true });
    const result = hydrateSession(built, seed, [], NOW, { reverseEnabled: false });
    // Cards are kept; filtering is done via eligibleCardIds in the queue builder.
    expect(result.filter((c) => c.cardType === 'reverse')).toHaveLength(seed.length);
    expect(result.filter((c) => c.cardType === 'name')).toHaveLength(seed.length);
  });

  it('preserves review state on existing reverse cards when re-enabled', () => {
    const revCard: ReverseReviewCard = {
      ...makeSeedPokemon(1),
      id: REVERSE_ID_OFFSET + 1,
      pokemonId: 1,
      cardType: 'reverse',
      subjectKey: '1',
      state: { ...initialReviewState(NOW), reps:4, scheduledDays:30 },
    };
    const result = hydrateSession([revCard], seed, [], NOW, { reverseEnabled: true });
    const found = result.find((c) => c.id === REVERSE_ID_OFFSET + 1);
    expect(found?.state.reps).toBe(4);
    expect(found?.state.scheduledDays).toBe(30);
  });
});

describe('reverse-evolution cards (#343)', () => {
  const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];
  const evoSeed: EvolutionCard[] = [
    makeEvoEdge({ id: 1_500_001 }),
    makeEvoEdge({ id: 1_500_002, preEvoId: 2 }),
  ];

  it('reverseEdgeIdFor maps forward edge id to its reverse counterpart', () => {
    expect(reverseEdgeIdFor(1_500_001)).toBe(REVERSE_EDGE_ID_BASE + 1);
    expect(reverseEdgeIdFor(1_500_002)).toBe(REVERSE_EDGE_ID_BASE + 2);
  });

  it('isReverseEdgeId identifies the reverse sub-range', () => {
    expect(isReverseEdgeId(REVERSE_EDGE_ID_BASE + 1)).toBe(true);
    expect(isReverseEdgeId(1_500_001)).toBe(false);
    expect(isReverseEdgeId(REVERSE_ID_OFFSET + 1)).toBe(false);
  });

  it('buildSession excludes reverse-evolution cards by default', () => {
    const result = buildSession(seed, evoSeed, NOW);
    expect(result.filter((c) => c.cardType === 'reverse-evolution')).toHaveLength(0);
  });

  it('buildSession adds one reverse-evolution card per forward edge when enabled', () => {
    const result = buildSession(seed, evoSeed, NOW, { reverseEvolutionEnabled: true });
    const reverses = result.filter((c) => c.cardType === 'reverse-evolution');
    expect(reverses).toHaveLength(evoSeed.length);
    expect(reverses.map((c) => c.id).sort()).toEqual(
      evoSeed.map((e) => reverseEdgeIdFor(e.id)).sort(),
    );
  });

  it('reverse-evolution cards carry the same edge data as the forward direction', () => {
    const result = buildSession(seed, evoSeed, NOW, { reverseEvolutionEnabled: true });
    const fwd = result.find(
      (c): c is EvolutionReviewCard => c.cardType === 'evolution' && c.id === 1_500_001,
    );
    const rev = result.find(
      (c) => c.cardType === 'reverse-evolution' && c.id === reverseEdgeIdFor(1_500_001),
    );
    expect(rev?.cardType).toBe('reverse-evolution');
    if (rev?.cardType === 'reverse-evolution') {
      expect(rev.preEvoName).toBe(fwd?.preEvoName);
      expect(rev.postEvoName).toBe(fwd?.postEvoName);
      expect(rev.triggerPhrase).toBe(fwd?.triggerPhrase);
    }
  });

  it('hydrateSession appends reverse-evolution cards when newly enabled', () => {
    const saved = [makeCard(makeSeedPokemon(1))];
    const result = hydrateSession(saved, seed, evoSeed, NOW, { reverseEvolutionEnabled: true });
    expect(result.filter((c) => c.cardType === 'reverse-evolution')).toHaveLength(evoSeed.length);
  });

  it('hydrateSession preserves saved reverse-evolution cards when toggled off (non-destructive disable, #835)', () => {
    const built = buildSession(seed, evoSeed, NOW, { reverseEvolutionEnabled: true });
    const result = hydrateSession(built, seed, evoSeed, NOW, { reverseEvolutionEnabled: false });
    // Cards are kept so progress survives a re-enable; the queue builder filters them.
    expect(result.filter((c) => c.cardType === 'reverse-evolution')).toHaveLength(evoSeed.length);
  });

  it('hydrateSession preserves review state on reverse-evolution cards across reloads', () => {
    const built = buildSession(seed, evoSeed, NOW, { reverseEvolutionEnabled: true });
    const reverseId = reverseEdgeIdFor(1_500_001);
    const mutated: ReviewableCard[] = built.map((c) =>
      c.id === reverseId
        ? { ...c, state: { ...c.state, reps: 5, scheduledDays: 21 } }
        : c,
    );
    const result = hydrateSession(mutated, seed, evoSeed, NOW, { reverseEvolutionEnabled: true });
    const found = result.find((c) => c.id === reverseId);
    expect(found?.state.reps).toBe(5);
    expect(found?.state.scheduledDays).toBe(21);
  });

  it('reverse-evolution cards bucket under "evolution" for daily counters', () => {
    const built = buildSession(seed, evoSeed, NOW, {
      evolutionEnabled: true,
      reverseEvolutionEnabled: true,
    });
    // Mark one forward and one reverse card as new-introduced today.
    const today = '2026-05-09';
    const stamped = built.map((c) =>
      c.id === 1_500_001 || c.id === reverseEdgeIdFor(1_500_001)
        ? { ...c, state: { ...c.state, firstSeen: today } }
        : c,
    );
    const baseLimits: DailyLimits = {
      name: { maxNewPerDay: 100, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 100, maxReviewsPerDay: 100 },
      reverse: { maxNewPerDay: 100, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 100, maxReviewsPerDay: 100 },
    };
    const queues = buildSessionQueues(stamped, baseLimits, today);
    expect(queues.perType.evolution.newIntroducedToday).toBe(2);
    expect(queues.perType.reverse.newIntroducedToday).toBe(0);
  });
});

describe('buildSession (name/evolution enabled flags)', () => {
  const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];
  const evoSeed: EvolutionCard[] = [makeEvoEdge({ id: 1_500_001 })];

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
  const evoSeed: EvolutionCard[] = [makeEvoEdge({ id: 1_500_001 })];

  it('hydrateSession preserves saved name cards when nameEnabled: false (non-destructive disable, #835)', () => {
    const saved: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1)),
      makeCard(makeSeedPokemon(2)),
    ];
    const result = hydrateSession(saved, seed, evoSeed, NOW, { nameEnabled: false });
    // Saved name cards are kept so progress is available when re-enabled.
    expect(result.filter((c) => c.cardType === 'name')).toHaveLength(2);
  });

  it('hydrateSession preserves saved evolution cards when evolutionEnabled: false (non-destructive disable, #835)', () => {
    const savedEvo: EvolutionReviewCard = {
      ...makeEvoEdge({ id: 1_500_001 }),
      subjectKey: '1>>>2',
      state: initialReviewState(NOW),
    };
    const saved: ReviewableCard[] = [makeCard(makeSeedPokemon(1)), savedEvo];
    const result = hydrateSession(saved, seed, evoSeed, NOW, { evolutionEnabled: false });
    // Saved evolution cards are kept so progress is available when re-enabled.
    expect(result.filter((c) => c.cardType === 'evolution')).toHaveLength(1);
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

describe('hydrateSession (reverse card from slimmed stored shape)', () => {
  it('re-injects flavorTexts and evolutionChain from seed when loading a slimmed reverse card', () => {
    const fullSeed = makeSeedPokemon(1, {
      flavorTexts: ['A strange seed.', 'It bears the seed.'],
      evolutionChain: [
        { speciesId: 1, name: 'bulbasaur', evolvesFromId: null },
        { speciesId: 2, name: 'ivysaur', evolvesFromId: 1 },
      ],
    });

    // Simulate loading a slimmed card from localStorage — no flavorTexts or evolutionChain
    const slimCard: ReverseReviewCard = {
      id: REVERSE_ID_OFFSET + 1,
      speciesId: 1,
      isDefaultForm: true,
      formCategory: "default",
      formSlug: null,
      displayName: "Bulbasaur",
      pokemonId: 1,
      cardType: 'reverse',
      subjectKey: '1',
      name: 'bulbasaur',
      spriteUrl: '',
      types: ['grass'],
      stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
      flavorText: 'A strange seed.',
      flavorTexts: undefined,
      evolutionChain: [],
      height: 7,
      weight: 69,
      baseExperience: 64,
      genus: 'Seed',
      generation: 'generation-i',
      captureRate: 45,
      baseHappiness: 50,
      growthRate: 'medium-slow',
      habitat: null,
      genderRate: 1,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
      state: { ...initialReviewState(NOW), reps:3, scheduledDays:7 },
    };

    const result = hydrateSession([slimCard], [fullSeed], [], NOW, { reverseEnabled: true, nameEnabled: false, evolutionEnabled: false });

    expect(result).toHaveLength(1);
    const card = result[0];
    if (card.cardType !== 'reverse') throw new Error('Expected reverse card');
    expect(card.flavorTexts).toEqual(['A strange seed.', 'It bears the seed.']);
    expect(card.evolutionChain).toHaveLength(2);
    // SM-2 state preserved
    expect(card.state.reps).toBe(3);
    expect(card.state.scheduledDays).toBe(7);
  });
});

describe('buildSessionQueues (per-type budgets)', () => {
  const TODAY = '2026-05-09';
  const baseLimits: DailyLimits = {
    name: { maxNewPerDay: 2, maxReviewsPerDay: 5 },
    evolution: { maxNewPerDay: 1, maxReviewsPerDay: 3 },
    reverse: { maxNewPerDay: 2, maxReviewsPerDay: 5 },
    cry: { maxNewPerDay: 2, maxReviewsPerDay: 5 },
  };

  function nameCard(id: number, partialState: Partial<ReturnType<typeof initialReviewState>> = {}): NameReviewCard {
    return {
      ...makeSeedPokemon(id),
      cardType: 'name',
      subjectKey: String(id),
      state: { ...initialReviewState(NOW), ...partialState },
    };
  }
  function evoCard(id: number, partialState: Partial<ReturnType<typeof initialReviewState>> = {}): EvolutionReviewCard {
    const preEvoId = id - 1_500_000;
    const postEvoId = id - 1_500_000 + 100_000;
    return {
      ...makeEvoEdge({
        id,
        preEvoId,
        preEvoName: 'pre-' + id,
        postEvoId,
        postEvoName: 'post-' + id,
      }),
      subjectKey: `${preEvoId}>>>${postEvoId}`,
      state: { ...initialReviewState(NOW), ...partialState },
    };
  }
  function reverseCard(pokemonId: number, partialState: Partial<ReturnType<typeof initialReviewState>> = {}): ReverseReviewCard {
    return {
      ...makeSeedPokemon(pokemonId),
      id: REVERSE_ID_OFFSET + pokemonId,
      pokemonId,
      cardType: 'reverse',
      subjectKey: String(pokemonId),
      state: { ...initialReviewState(NOW), ...partialState },
    };
  }

  it('caps new name and new evolution cards independently', () => {
    const cards: ReviewableCard[] = [
      // 5 fresh name cards, 3 fresh evolution cards — all eligible as new
      nameCard(1), nameCard(2), nameCard(3), nameCard(4), nameCard(5),
      evoCard(1_500_001), evoCard(1_500_002), evoCard(1_500_003),
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
      nameCard(1, { firstSeen: TODAY, lastReview: TODAY, reps:1 }),
      nameCard(2, { firstSeen: TODAY, lastReview: TODAY, reps:1 }),
      // Fresh candidates of each type
      nameCard(3),
      nameCard(4),
      evoCard(1_500_001),
      evoCard(1_500_002),
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
      nameCard(1, { firstSeen: '2026-05-01', lastReview: TODAY, reps:2 }),
      nameCard(2, { firstSeen: '2026-05-01', lastReview: TODAY, reps:2 }),
      nameCard(3, { firstSeen: '2026-05-01', lastReview: TODAY, reps:2 }),
      // 1 evo review done today
      evoCard(1_500_001, { firstSeen: '2026-05-01', lastReview: TODAY, reps:2 }),
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
      ...Array.from({ length: 100 }, (_, i) => evoCard(1_500_001 + i)),
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
      reverseCard(1, { firstSeen: '2026-05-01', lastReview: TODAY, reps:2 }),
      reverseCard(2, { firstSeen: '2026-05-01', lastReview: TODAY, reps:2 }),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    expect(queues.perType.reverse.reviewsDoneToday).toBe(2);
    expect(queues.perType.name.reviewsDoneToday).toBe(0);
    expect(queues.reviewsDoneToday).toBe(2);
  });

  // ─── eligibleCardIds (learning filter, #333) ─────────────────────────────
  it('omitting eligibleCardIds is identical to passing every id (regression guard)', () => {
    const cards: ReviewableCard[] = [
      nameCard(1),
      nameCard(2),
      nameCard(3, { firstSeen: '2026-05-01', lastReview: '2026-05-03', dueDate: TODAY, reps: 2, scheduledDays: 6 }),
      evoCard(1_000_001),
    ];
    const without = buildSessionQueues(cards, baseLimits, TODAY);
    const allIds = new Set(cards.map((c) => c.id));
    const withAll = buildSessionQueues(cards, baseLimits, TODAY, allIds);
    expect(withAll).toEqual(without);
  });

  it('excludes ineligible ids from review and new queues', () => {
    const cards: ReviewableCard[] = [
      nameCard(1),
      nameCard(2),
      nameCard(3, { firstSeen: '2026-05-01', lastReview: '2026-05-03', dueDate: TODAY, reps: 2, scheduledDays: 6 }),
      nameCard(4, { firstSeen: '2026-05-01', lastReview: '2026-05-03', dueDate: TODAY, reps: 2, scheduledDays: 6 }),
    ];
    // Only 1 and 3 are eligible.
    const eligible = new Set([1, 3]);
    const queues = buildSessionQueues(cards, baseLimits, TODAY, eligible);
    expect(queues.newQueue).toEqual([1]);
    expect(queues.reviewQueue).toEqual([3]);
  });

  it('keeps reviewsDoneToday unchanged when an eligible-excluded card was reviewed today (counter independence)', () => {
    // Card 1 was reviewed today (counts toward reviewsDoneToday), then the
    // user applied a filter that excludes it. The counter must still see it.
    const cards: ReviewableCard[] = [
      nameCard(1, { firstSeen: '2026-05-01', lastReview: TODAY, reps: 2 }),
      nameCard(2), // fresh, eligible
    ];
    const eligible = new Set([2]); // 1 is filtered out
    const queues = buildSessionQueues(cards, baseLimits, TODAY, eligible);
    expect(queues.perType.name.reviewsDoneToday).toBe(1);
    expect(queues.reviewsDoneToday).toBe(1);
    // 1 must not appear in any queue since it's ineligible.
    expect(queues.reviewQueue).not.toContain(1);
    expect(queues.newQueue).not.toContain(1);
  });

  it('learning-step cards survive the eligibility filter (queue must finish them)', () => {
    // Mid-step card 1 is excluded by the filter; it must still be reported
    // via learningCardIds so the in-memory queue can complete the step.
    const cards: ReviewableCard[] = [
      nameCard(1, { learningStep: 0, stepStartedAt: NOW.getTime() }),
      nameCard(2), // eligible, fresh
    ];
    const eligible = new Set([2]);
    const queues = buildSessionQueues(cards, baseLimits, TODAY, eligible);
    expect(queues.learningCardIds).toEqual([1]);
  });

  // ─── outOfScopeLearningIds (#654) ────────────────────────────────────────
  it('outOfScopeLearningIds is empty when no eligibleCardIds is provided', () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { learningStep: 0, stepStartedAt: NOW.getTime() }),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    expect(queues.outOfScopeLearningIds).toEqual([]);
  });

  it('outOfScopeLearningIds contains mid-learning cards excluded from eligibleCardIds', () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { learningStep: 0, stepStartedAt: NOW.getTime() }), // mid-step, out of scope
      nameCard(2, { learningStep: 1, stepStartedAt: NOW.getTime() }), // mid-step, in scope
      nameCard(3), // fresh, in scope
    ];
    const eligible = new Set([2, 3]);
    const queues = buildSessionQueues(cards, baseLimits, TODAY, eligible);
    expect(queues.outOfScopeLearningIds).toEqual([1]);
    // Both mid-step cards still appear in learningCardIds regardless of scope
    expect(queues.learningCardIds).toContain(1);
    expect(queues.learningCardIds).toContain(2);
  });

  it('outOfScopeLearningIds is empty when all learning cards are in scope', () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { learningStep: 0, stepStartedAt: NOW.getTime() }),
      nameCard(2, { learningStep: 1, stepStartedAt: NOW.getTime() }),
    ];
    const eligible = new Set([1, 2]);
    const queues = buildSessionQueues(cards, baseLimits, TODAY, eligible);
    expect(queues.outOfScopeLearningIds).toEqual([]);
  });

  it('outOfScopeLearningIds is empty when there are no learning cards', () => {
    const cards: ReviewableCard[] = [
      nameCard(1), // fresh new card, not mid-step
      nameCard(2),
    ];
    const eligible = new Set([1]);
    const queues = buildSessionQueues(cards, baseLimits, TODAY, eligible);
    expect(queues.outOfScopeLearningIds).toEqual([]);
    expect(queues.learningCardIds).toEqual([]);
  });

  it('outOfScopeLearningIds contains all learning cards when eligibleCardIds excludes them all', () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { learningStep: 0, stepStartedAt: NOW.getTime() }),
      nameCard(2, { learningStep: 0, stepStartedAt: NOW.getTime() }),
    ];
    const eligible = new Set<number>(); // empty scope — no eligible cards
    const queues = buildSessionQueues(cards, baseLimits, TODAY, eligible);
    expect(queues.outOfScopeLearningIds.sort()).toEqual([1, 2]);
  });

  it('empty eligibleCardIds yields empty review and new queues but preserves counters', () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }), // counter-eligible
      nameCard(2), // fresh
    ];
    const eligible = new Set<number>();
    const queues = buildSessionQueues(cards, baseLimits, TODAY, eligible);
    expect(queues.reviewQueue).toEqual([]);
    expect(queues.newQueue).toEqual([]);
    expect(queues.perType.name.newIntroducedToday).toBe(1);
  });
});

describe('buildSessionQueues (round-robin new-card balancing, #842)', () => {
  const TODAY = '2026-05-09';
  const highLimits: DailyLimits = {
    name:      { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    reverse:   { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    cry:       { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  };

  function nameCard(id: number): NameReviewCard {
    return {
      ...makeSeedPokemon(id),
      cardType: 'name',
      subjectKey: String(id),
      state: initialReviewState(NOW),
    };
  }
  function reverseCard(pokemonId: number): ReverseReviewCard {
    return {
      ...makeSeedPokemon(pokemonId),
      id: REVERSE_ID_OFFSET + pokemonId,
      pokemonId,
      cardType: 'reverse',
      subjectKey: String(pokemonId),
      state: initialReviewState(NOW),
    };
  }
  function cryCard(pokemonId: number): CryReviewCard {
    return {
      ...makeSeedPokemon(pokemonId, { cryUrl: `https://example.com/${pokemonId}.ogg` }),
      id: CRY_ID_OFFSET + pokemonId,
      pokemonId,
      cardType: 'cry',
      subjectKey: String(pokemonId),
      state: initialReviewState(NOW),
    };
  }

  it('balances new cards across name and reverse directions (difference <= 1)', () => {
    // 5 name candidates, 5 reverse candidates, both caps = 10
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2), nameCard(3), nameCard(4), nameCard(5),
      reverseCard(1), reverseCard(2), reverseCard(3), reverseCard(4), reverseCard(5),
    ];
    const queues = buildSessionQueues(cards, highLimits, TODAY);
    const byType = queues.newQueue.reduce<Record<string, number>>((acc, id) => {
      const card = cards.find((c) => c.id === id)!;
      acc[card.cardType] = (acc[card.cardType] ?? 0) + 1;
      return acc;
    }, {});
    const nameCt  = byType['name']    ?? 0;
    const revCt   = byType['reverse'] ?? 0;
    // All 5 of each should be present — both below their cap
    expect(nameCt).toBe(5);
    expect(revCt).toBe(5);
  });

  it('no direction exceeds its per-type cap even with round-robin active', () => {
    const tightLimits: DailyLimits = {
      name:      { maxNewPerDay: 3, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 2, maxReviewsPerDay: 100 },
      reverse:   { maxNewPerDay: 3, maxReviewsPerDay: 100 },
      cry:       { maxNewPerDay: 3, maxReviewsPerDay: 100 },
    };
    // Provide more candidates than each cap
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2), nameCard(3), nameCard(4), nameCard(5),
      reverseCard(1), reverseCard(2), reverseCard(3), reverseCard(4),
      cryCard(1), cryCard(2), cryCard(3), cryCard(4),
    ];
    const queues = buildSessionQueues(cards, tightLimits, TODAY);
    const byType = queues.newQueue.reduce<Record<string, number>>((acc, id) => {
      const card = cards.find((c) => c.id === id)!;
      acc[card.cardType] = (acc[card.cardType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType['name']    ?? 0).toBeLessThanOrEqual(3);
    expect(byType['reverse'] ?? 0).toBeLessThanOrEqual(3);
    expect(byType['cry']     ?? 0).toBeLessThanOrEqual(3);
  });

  it('difference between any two enabled directions is at most 1 when same cap and many candidates', () => {
    const equalLimits: DailyLimits = {
      name:      { maxNewPerDay: 4, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 4, maxReviewsPerDay: 100 },
      reverse:   { maxNewPerDay: 4, maxReviewsPerDay: 100 },
      cry:       { maxNewPerDay: 4, maxReviewsPerDay: 100 },
    };
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2), nameCard(3), nameCard(4), nameCard(5),
      reverseCard(1), reverseCard(2), reverseCard(3), reverseCard(4), reverseCard(5),
      cryCard(1), cryCard(2), cryCard(3), cryCard(4), cryCard(5),
    ];
    const queues = buildSessionQueues(cards, equalLimits, TODAY);
    const byType = queues.newQueue.reduce<Record<string, number>>((acc, id) => {
      const card = cards.find((c) => c.id === id)!;
      acc[card.cardType] = (acc[card.cardType] ?? 0) + 1;
      return acc;
    }, {});
    const nameCt = byType['name']    ?? 0;
    const revCt  = byType['reverse'] ?? 0;
    const cryCt  = byType['cry']     ?? 0;
    // Each cap is 4 and there are 5 candidates — all 4 slots should be filled
    expect(nameCt).toBe(4);
    expect(revCt).toBe(4);
    expect(cryCt).toBe(4);
    // Difference between any two directions is at most 1
    expect(Math.abs(nameCt - revCt)).toBeLessThanOrEqual(1);
    expect(Math.abs(nameCt - cryCt)).toBeLessThanOrEqual(1);
    expect(Math.abs(revCt  - cryCt)).toBeLessThanOrEqual(1);
  });

  it('handles one direction exhausted before another — remaining direction still fills its cap', () => {
    const limits: DailyLimits = {
      name:      { maxNewPerDay: 5, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
      reverse:   { maxNewPerDay: 5, maxReviewsPerDay: 100 },
      cry:       { maxNewPerDay: 5, maxReviewsPerDay: 100 },
    };
    // 2 name candidates, 5 reverse candidates — name bucket drains first
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2),
      reverseCard(1), reverseCard(2), reverseCard(3), reverseCard(4), reverseCard(5),
    ];
    const queues = buildSessionQueues(cards, limits, TODAY);
    const byType = queues.newQueue.reduce<Record<string, number>>((acc, id) => {
      const card = cards.find((c) => c.id === id)!;
      acc[card.cardType] = (acc[card.cardType] ?? 0) + 1;
      return acc;
    }, {});
    // name has only 2 candidates — all introduced
    expect(byType['name']    ?? 0).toBe(2);
    // reverse has 5 candidates and a cap of 5 — all introduced
    expect(byType['reverse'] ?? 0).toBe(5);
  });

  it('per-type daily cap applied before species-grouped admission honours existing newIntroducedToday', () => {
    // Simulate a day where 3 name cards were already graduated on a prior day
    // (lastReview !== null) so their reverse partners are solo new candidates
    // with no matching name entry in the new pool.
    //
    // Species 1–3: name already graduated (firstSeen=TODAY triggers counter,
    //              lastReview=YESTERDAY excludes from new-candidate pool),
    //              reverse still new → admitted as solo.
    // Species 4–6: name is new (no reverse partner) → admitted as solo.
    //
    // name: newIntroducedToday=3 → 2 remaining slots; 3 candidates → 2 new.
    // reverse: 5 slots; 3 solo candidates → 3 new.
    const YESTERDAY = '2026-05-08';
    const limits: DailyLimits = {
      name:      { maxNewPerDay: 5, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 100 },
      reverse:   { maxNewPerDay: 5, maxReviewsPerDay: 100 },
      cry:       { maxNewPerDay: 5, maxReviewsPerDay: 100 },
    };
    const cards: ReviewableCard[] = [
      // Already graduated: firstSeen=TODAY drives newIntroducedToday; lastReview≠null
      // keeps them out of the new-candidate pool.
      { ...nameCard(1), state: { ...initialReviewState(NOW), firstSeen: TODAY, lastReview: YESTERDAY, reps: 1, dueDate: '2026-05-16' } },
      { ...nameCard(2), state: { ...initialReviewState(NOW), firstSeen: TODAY, lastReview: YESTERDAY, reps: 1, dueDate: '2026-05-16' } },
      { ...nameCard(3), state: { ...initialReviewState(NOW), firstSeen: TODAY, lastReview: YESTERDAY, reps: 1, dueDate: '2026-05-16' } },
      // Remaining new name candidates (no reverse partners):
      nameCard(4), nameCard(5), nameCard(6),
      // Reverse candidates whose name partner is already graduated (solo entries):
      reverseCard(1), reverseCard(2), reverseCard(3),
    ];
    const queues = buildSessionQueues(cards, limits, TODAY);
    const byType = queues.newQueue.reduce<Record<string, number>>((acc, id) => {
      const card = cards.find((c) => c.id === id)!;
      acc[card.cardType] = (acc[card.cardType] ?? 0) + 1;
      return acc;
    }, {});
    // name: firstSeen=TODAY on 1–3 → newIntroducedToday=3 → 2 slots; 3 candidates → 2 new
    expect(byType['name']    ?? 0).toBe(2);
    // reverse: solo entries (no name partner in new pool) → all 3 admitted
    expect(byType['reverse'] ?? 0).toBe(3);
  });

  it('newQueue is still deterministically ordered (same result on repeated calls with same today)', () => {
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2), nameCard(3),
      reverseCard(1), reverseCard(2), reverseCard(3),
    ];
    const first  = buildSessionQueues(cards, highLimits, TODAY).newQueue;
    const second = buildSessionQueues(cards, highLimits, TODAY).newQueue;
    expect(first).toEqual(second);
  });
});

describe('buildSessionQueues (species-grouped new-card introduction, #928)', () => {
  const TODAY = '2026-05-09';
  const highLimits: DailyLimits = {
    name:      { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    reverse:   { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    cry:       { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  };

  function nameCard(id: number): NameReviewCard {
    return {
      ...makeSeedPokemon(id),
      cardType: 'name',
      subjectKey: String(id),
      state: initialReviewState(NOW),
    };
  }
  function reverseCard(pokemonId: number): ReverseReviewCard {
    return {
      ...makeSeedPokemon(pokemonId),
      id: REVERSE_ID_OFFSET + pokemonId,
      pokemonId,
      cardType: 'reverse',
      subjectKey: String(pokemonId),
      state: initialReviewState(NOW),
    };
  }
  function cryCard(pokemonId: number): CryReviewCard {
    return {
      ...makeSeedPokemon(pokemonId, { cryUrl: `https://example.com/${pokemonId}.ogg` }),
      id: CRY_ID_OFFSET + pokemonId,
      pokemonId,
      cardType: 'cry',
      subjectKey: String(pokemonId),
      state: initialReviewState(NOW),
    };
  }

  // (a) All directions admitted together on day 1 when all are new
  it('admits all enabled directions for a species on the same day when all are new', () => {
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2),
      reverseCard(1), reverseCard(2),
    ];
    const queues = buildSessionQueues(cards, highLimits, TODAY);
    const newIds = new Set(queues.newQueue);
    expect(newIds.size).toBe(4);
    expect(newIds.has(1)).toBe(true);
    expect(newIds.has(REVERSE_ID_OFFSET + 1)).toBe(true);
    expect(newIds.has(2)).toBe(true);
    expect(newIds.has(REVERSE_ID_OFFSET + 2)).toBe(true);
  });

  it('admits name, reverse, and cry directions together for the same species on day 1', () => {
    const cards: ReviewableCard[] = [
      nameCard(1), reverseCard(1), cryCard(1),
      nameCard(2), reverseCard(2), cryCard(2),
    ];
    const queues = buildSessionQueues(cards, highLimits, TODAY);
    const newIds = new Set(queues.newQueue);
    expect(newIds.size).toBe(6);
    expect(newIds.has(1)).toBe(true);
    expect(newIds.has(REVERSE_ID_OFFSET + 1)).toBe(true);
    expect(newIds.has(CRY_ID_OFFSET + 1)).toBe(true);
  });

  // (b) Partial-introduction — one direction already seen → admitted alone
  it('admits a direction alone when its partner was introduced on a prior day', () => {
    const PREV_DAY = '2026-05-08';
    const cards: ReviewableCard[] = [
      // Name for species 1 already graduated — reverse is solo
      { ...nameCard(1), state: { ...initialReviewState(NOW), lastReview: PREV_DAY, firstSeen: PREV_DAY, reps: 1, dueDate: '2026-05-15' } },
      reverseCard(1),
      nameCard(2), reverseCard(2),
    ];
    const queues = buildSessionQueues(cards, highLimits, TODAY);
    const newIds = new Set(queues.newQueue);
    // Reverse for species 1 admitted alone — name partner already graduated
    expect(newIds.has(REVERSE_ID_OFFSET + 1)).toBe(true);
    // Species 2: name + reverse admitted together
    expect(newIds.has(2)).toBe(true);
    expect(newIds.has(REVERSE_ID_OFFSET + 2)).toBe(true);
    // Graduated name card not in newQueue
    expect(newIds.has(1)).toBe(false);
  });

  // (c) Budget boundary: when both directions of a species fall within budget,
  //     they are admitted together.  When one direction is over-budget (not in
  //     the pre-sliced candidate list), that species' other direction is
  //     admitted as a solo entry.
  it('admits the within-budget species as a pair; over-budget species becomes a solo reverse', () => {
    // name cap = 1: only 1 name card enters the candidate slice.
    // 2 species each have name + reverse.
    // Expected: the 1 within-budget name card is admitted paired with its reverse.
    //           The second species' reverse is admitted as a solo (name wasn't in the budget slice).
    const tightLimits: DailyLimits = {
      name:      { maxNewPerDay: 1, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      reverse:   { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry:       { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    };
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2),
      reverseCard(1), reverseCard(2),
    ];
    const queues = buildSessionQueues(cards, tightLimits, TODAY);
    const byType = queues.newQueue.reduce<Record<string, number>>((acc, id) => {
      const card = cards.find((c) => c.id === id)!;
      acc[card.cardType] = (acc[card.cardType] ?? 0) + 1;
      return acc;
    }, {});
    // 1 name slot: 1 name admitted.
    expect(byType['name']    ?? 0).toBe(1);
    // Both reverses admitted: one paired with its name, one as a solo entry.
    expect(byType['reverse'] ?? 0).toBe(2);
    // The admitted name and its paired reverse must be for the same species.
    const nameId    = queues.newQueue.find((id) => cards.find((c) => c.id === id)?.cardType === 'name')!;
    const pairedRev = cards.find((c) => c.cardType === 'reverse' && (c as ReverseReviewCard).pokemonId === nameId);
    expect(pairedRev).toBeDefined();
    expect(queues.newQueue).toContain(pairedRev!.id);
  });

  it('solo-direction species (reverse only) admitted freely when name budget exhausted', () => {
    const PREV_DAY = '2026-05-08';
    const zeroBudgetNameLimits: DailyLimits = {
      name:      { maxNewPerDay: 0, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      reverse:   { maxNewPerDay: 5, maxReviewsPerDay: 100 },
      cry:       { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    };
    const cards: ReviewableCard[] = [
      { ...nameCard(10), state: { ...initialReviewState(NOW), lastReview: PREV_DAY, firstSeen: PREV_DAY, reps: 1, dueDate: '2026-05-15' } },
      { ...nameCard(11), state: { ...initialReviewState(NOW), lastReview: PREV_DAY, firstSeen: PREV_DAY, reps: 1, dueDate: '2026-05-15' } },
      { ...nameCard(12), state: { ...initialReviewState(NOW), lastReview: PREV_DAY, firstSeen: PREV_DAY, reps: 1, dueDate: '2026-05-15' } },
      reverseCard(10), reverseCard(11), reverseCard(12),
    ];
    const queues = buildSessionQueues(cards, zeroBudgetNameLimits, TODAY);
    const byType = queues.newQueue.reduce<Record<string, number>>((acc, id) => {
      const card = cards.find((c) => c.id === id)!;
      acc[card.cardType] = (acc[card.cardType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType['reverse'] ?? 0).toBe(3);
    expect(byType['name']    ?? 0).toBe(0);
  });

  it('evolution cards are scheduled independently and unaffected by species grouping', () => {
    function evoCardFn(id: number): EvolutionReviewCard {
      const preEvoId = id - 1_500_000;
      const postEvoId = id - 1_500_000 + 100_000;
      return {
        ...makeEvoEdge({ id, preEvoId, postEvoId }),
        subjectKey: `${preEvoId}>>>${postEvoId}`,
        state: initialReviewState(NOW),
      };
    }
    const tightLimits: DailyLimits = {
      name:      { maxNewPerDay: 1, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 3, maxReviewsPerDay: 100 },
      reverse:   { maxNewPerDay: 1, maxReviewsPerDay: 100 },
      cry:       { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    };
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2),
      reverseCard(1), reverseCard(2),
      evoCardFn(1_500_001), evoCardFn(1_500_002), evoCardFn(1_500_003), evoCardFn(1_500_004),
    ];
    const queues = buildSessionQueues(cards, tightLimits, TODAY);
    const byType = queues.newQueue.reduce<Record<string, number>>((acc, id) => {
      const card = cards.find((c) => c.id === id)!;
      acc[card.cardType] = (acc[card.cardType] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType['evolution'] ?? 0).toBe(3);
    expect(byType['name']    ?? 0).toBe(1);
    expect(byType['reverse'] ?? 0).toBe(1);
  });

  it('newQueue remains deterministic across repeated calls (species-grouped)', () => {
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2), nameCard(3),
      reverseCard(1), reverseCard(2), reverseCard(3),
      cryCard(1), cryCard(2), cryCard(3),
    ];
    const first  = buildSessionQueues(cards, highLimits, TODAY).newQueue;
    const second = buildSessionQueues(cards, highLimits, TODAY).newQueue;
    expect(first).toEqual(second);
  });
});

describe('groupNewCandidatesBySpecies', () => {
  it('maps name cards to their speciesId', () => {
    const cards: ReviewableCard[] = [
      { ...makeSeedPokemon(1), cardType: 'name', subjectKey: '1', state: initialReviewState(NOW) },
    ];
    const groups = groupNewCandidatesBySpecies({ name: [1], reverse: [], cry: [] }, cards);
    expect(groups.get(1)).toEqual({ name: 1 });
  });

  it('maps reverse cards to their pokemonId (speciesId)', () => {
    const cards: ReviewableCard[] = [
      {
        ...makeSeedPokemon(1),
        id: REVERSE_ID_OFFSET + 1,
        pokemonId: 1,
        cardType: 'reverse',
        subjectKey: '1',
        state: initialReviewState(NOW),
      },
    ];
    const groups = groupNewCandidatesBySpecies({ name: [], reverse: [REVERSE_ID_OFFSET + 1], cry: [] }, cards);
    expect(groups.get(1)).toEqual({ reverse: REVERSE_ID_OFFSET + 1 });
  });

  it('merges name and reverse candidates for the same species into one group', () => {
    const cards: ReviewableCard[] = [
      { ...makeSeedPokemon(1), cardType: 'name', subjectKey: '1', state: initialReviewState(NOW) },
      {
        ...makeSeedPokemon(1),
        id: REVERSE_ID_OFFSET + 1,
        pokemonId: 1,
        cardType: 'reverse',
        subjectKey: '1',
        state: initialReviewState(NOW),
      },
    ];
    const groups = groupNewCandidatesBySpecies({ name: [1], reverse: [REVERSE_ID_OFFSET + 1], cry: [] }, cards);
    expect(groups.size).toBe(1);
    expect(groups.get(1)).toEqual({ name: 1, reverse: REVERSE_ID_OFFSET + 1 });
  });

  it('creates separate entries for different species', () => {
    const cards: ReviewableCard[] = [
      { ...makeSeedPokemon(1), cardType: 'name', subjectKey: '1', state: initialReviewState(NOW) },
      { ...makeSeedPokemon(2), cardType: 'name', subjectKey: '2', state: initialReviewState(NOW) },
    ];
    const groups = groupNewCandidatesBySpecies({ name: [1, 2], reverse: [], cry: [] }, cards);
    expect(groups.size).toBe(2);
    expect(groups.get(1)).toEqual({ name: 1 });
    expect(groups.get(2)).toEqual({ name: 2 });
  });

  it('includes cry cards in the species group', () => {
    const cards: ReviewableCard[] = [
      { ...makeSeedPokemon(1), cardType: 'name', subjectKey: '1', state: initialReviewState(NOW) },
      {
        ...makeSeedPokemon(1, { cryUrl: 'cry.ogg' }),
        id: CRY_ID_OFFSET + 1,
        pokemonId: 1,
        cardType: 'cry',
        subjectKey: '1',
        state: initialReviewState(NOW),
      },
    ];
    const groups = groupNewCandidatesBySpecies({ name: [1], reverse: [], cry: [CRY_ID_OFFSET + 1] }, cards);
    expect(groups.get(1)).toEqual({ name: 1, cry: CRY_ID_OFFSET + 1 });
  });

  it('returns empty map when all candidate lists are empty', () => {
    const groups = groupNewCandidatesBySpecies({ name: [], reverse: [], cry: [] }, []);
    expect(groups.size).toBe(0);
  });
});

describe('buildQueueCounters', () => {
  const TODAY = '2026-05-09';

  it('returns correct triple for 2 new + 1 learning + 1 review', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1)), // new: lastReview null, learningStep null
      makeCard(makeSeedPokemon(2)), // new: lastReview null, learningStep null
      makeCard(makeSeedPokemon(3), { learningStep: 0 }), // learning
      makeCard(makeSeedPokemon(4), {
        lastReview: '2026-05-01',
        dueDate: '2026-05-09',
        learningStep: null,
        reps:2,
        scheduledDays:8,
      }), // review: due today, not reviewed today
    ];
    const result = buildQueueCounters(cards, TODAY);
    expect(result.newCount).toBe(2);
    expect(result.learningCount).toBe(1);
    expect(result.reviewCount).toBe(1);
  });

  it('learning cards are excluded from newCount and reviewCount', () => {
    const cards: ReviewableCard[] = [
      // learningStep set, lastReview null → learning, NOT new
      makeCard(makeSeedPokemon(1), { learningStep: 0, lastReview: null }),
      // learningStep set, lastReview in the past, dueDate in the past → learning, NOT review
      makeCard(makeSeedPokemon(2), {
        learningStep: 0,
        lastReview: '2026-05-01',
        dueDate: '2026-05-09',
        reps:1,
        scheduledDays:8,
      }),
    ];
    const result = buildQueueCounters(cards, TODAY);
    expect(result.learningCount).toBe(2);
    expect(result.newCount).toBe(0);
    expect(result.reviewCount).toBe(0);
  });

  it('cards reviewed today are excluded from reviewCount', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1), {
        lastReview: TODAY,
        dueDate: TODAY,
        learningStep: null,
        reps:2,
        scheduledDays:1,
        firstSeen: '2026-05-01',
      }),
    ];
    const result = buildQueueCounters(cards, TODAY);
    expect(result.reviewCount).toBe(0);
    expect(result.newCount).toBe(0);
    expect(result.learningCount).toBe(0);
  });

  it('future-due graduated card is not in any queue', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1), {
        lastReview: '2026-05-01',
        dueDate: '2026-05-20',
        learningStep: null,
        reps:3,
        scheduledDays:19,
        firstSeen: '2026-04-01',
      }),
    ];
    const result = buildQueueCounters(cards, TODAY);
    expect(result.newCount).toBe(0);
    expect(result.learningCount).toBe(0);
    expect(result.reviewCount).toBe(0);
  });
});

describe('stableShuffleForDay (per-user salt)', () => {
  const TODAY = '2026-05-09';
  const IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('same salt + same inputs produces the same order (stability)', () => {
    const a = stableShuffleForDay(IDS, TODAY, 'user-abc');
    const b = stableShuffleForDay(IDS, TODAY, 'user-abc');
    expect(a).toEqual(b);
  });

  it('different string salts produce a different order for a sufficiently large id list', () => {
    const a = stableShuffleForDay(IDS, TODAY, 'user-abc');
    const b = stableShuffleForDay(IDS, TODAY, 'user-xyz');
    expect(a).not.toEqual(b);
  });

  it('different numeric salts produce a different order for a sufficiently large id list', () => {
    const a = stableShuffleForDay(IDS, TODAY, 1);
    const b = stableShuffleForDay(IDS, TODAY, 2);
    expect(a).not.toEqual(b);
  });

  it('empty string salt is stable (backward-compatible default)', () => {
    const a = stableShuffleForDay(IDS, TODAY);
    const b = stableShuffleForDay(IDS, TODAY, '');
    expect(a).toEqual(b);
  });

  it('same ids and same salt on different days produce different orders', () => {
    const a = stableShuffleForDay(IDS, '2026-05-09', 'user-abc');
    const b = stableShuffleForDay(IDS, '2026-05-10', 'user-abc');
    expect(a).not.toEqual(b);
  });

  it('output contains the same ids as the input', () => {
    const result = stableShuffleForDay(IDS, TODAY, 'user-abc');
    expect(result.slice().sort((a, b) => a - b)).toEqual(IDS.slice().sort((a, b) => a - b));
  });

  it('numeric salt 0 produces a different order from empty-string salt (no type-coercion collision)', () => {
    // Guards a future refactor against accidentally collapsing the numeric/string
    // code paths — String(0) === "0", which must not equal String("") === "".
    const withZero  = stableShuffleForDay(IDS, TODAY, 0);
    const withEmpty = stableShuffleForDay(IDS, TODAY, '');
    expect(withZero).not.toEqual(withEmpty);
  });
});

describe('buildSessionQueues (per-user salt)', () => {
  const TODAY = '2026-05-09';
  const highLimits: DailyLimits = {
    name:      { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    reverse:   { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    cry:       { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  };

  function nameCard(id: number): NameReviewCard {
    return {
      ...makeSeedPokemon(id),
      cardType: 'name',
      subjectKey: String(id),
      state: initialReviewState(NOW),
    };
  }

  const cards: ReviewableCard[] = Array.from({ length: 15 }, (_, i) => nameCard(i + 1));

  it('same salt produces the same queue order (stability)', () => {
    const a = buildSessionQueues(cards, highLimits, TODAY, undefined, 'salt-a').newQueue;
    const b = buildSessionQueues(cards, highLimits, TODAY, undefined, 'salt-a').newQueue;
    expect(a).toEqual(b);
  });

  it('different salts produce different queue orders for a large enough card set', () => {
    const a = buildSessionQueues(cards, highLimits, TODAY, undefined, 'salt-a').newQueue;
    const b = buildSessionQueues(cards, highLimits, TODAY, undefined, 'salt-b').newQueue;
    expect(a).not.toEqual(b);
  });
});

describe('countDueTomorrow', () => {
  const TODAY = '2026-05-09';
  const TOMORROW = '2026-05-10';
  const DAY_AFTER = '2026-05-11';

  it('returns 0 for an empty card list', () => {
    expect(countDueTomorrow([], TOMORROW)).toBe(0);
  });

  it('counts a graduated card due exactly tomorrow', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1), {
        lastReview: TODAY,
        dueDate: TOMORROW,
        learningStep: null,
        reps: 3,
        scheduledDays: 1,
        firstSeen: '2026-04-01',
      }),
    ];
    expect(countDueTomorrow(cards, TOMORROW)).toBe(1);
  });

  it('ignores cards due today', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1), {
        lastReview: '2026-05-01',
        dueDate: TODAY,
        learningStep: null,
        reps: 2,
        scheduledDays: 8,
        firstSeen: '2026-04-01',
      }),
    ];
    expect(countDueTomorrow(cards, TOMORROW)).toBe(0);
  });

  it('ignores cards due day-after-tomorrow', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1), {
        lastReview: TODAY,
        dueDate: DAY_AFTER,
        learningStep: null,
        reps: 3,
        scheduledDays: 2,
        firstSeen: '2026-04-01',
      }),
    ];
    expect(countDueTomorrow(cards, TOMORROW)).toBe(0);
  });

  it('ignores learning-step cards even if dueDate equals tomorrow', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1), {
        lastReview: TODAY,
        dueDate: TOMORROW,
        learningStep: 0,
        reps: 1,
        scheduledDays: 1,
        firstSeen: '2026-04-01',
      }),
    ];
    expect(countDueTomorrow(cards, TOMORROW)).toBe(0);
  });

  it('ignores new cards (lastReview === null)', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1)), // brand-new: lastReview null
    ];
    expect(countDueTomorrow(cards, TOMORROW)).toBe(0);
  });

  it('counts multiple graduated cards due on the same tomorrow', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1), {
        lastReview: TODAY,
        dueDate: TOMORROW,
        learningStep: null,
        reps: 3,
        scheduledDays: 1,
        firstSeen: '2026-04-01',
      }),
      makeCard(makeSeedPokemon(2), {
        lastReview: TODAY,
        dueDate: TOMORROW,
        learningStep: null,
        reps: 2,
        scheduledDays: 3,
        firstSeen: '2026-04-01',
      }),
    ];
    expect(countDueTomorrow(cards, TOMORROW)).toBe(2);
  });

  it('respects the eligibleCardIds filter', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1), {
        lastReview: TODAY,
        dueDate: TOMORROW,
        learningStep: null,
        reps: 3,
        scheduledDays: 1,
        firstSeen: '2026-04-01',
      }),
      makeCard(makeSeedPokemon(2), {
        lastReview: TODAY,
        dueDate: TOMORROW,
        learningStep: null,
        reps: 3,
        scheduledDays: 1,
        firstSeen: '2026-04-01',
      }),
    ];
    // Only card id=1 is in scope.
    expect(countDueTomorrow(cards, TOMORROW, new Set([1]))).toBe(1);
    // Neither in scope.
    expect(countDueTomorrow(cards, TOMORROW, new Set([99]))).toBe(0);
  });

  it('counts a mastered card due tomorrow (graduated, no learning step)', () => {
    const cards: ReviewableCard[] = [
      makeCard(makeSeedPokemon(1), {
        lastReview: TODAY,
        dueDate: TOMORROW,
        learningStep: null,
        reps: 5,
        scheduledDays: 21,
        firstSeen: '2026-04-01',
      }),
    ];
    expect(countDueTomorrow(cards, TOMORROW)).toBe(1);
  });
});

// ─── Alternate-form cards (#447) ─────────────────────────────────────────────
//
// Seed contains both the base species and one alternate form. buildSession and
// hydrateSession should emit cards for both entries without special-casing form
// IDs. The alternate form uses ID 10100 (Alolan Raichu in the real seed).

describe('alternate-form cards (#447)', () => {
  // Base: Raichu (id=26, speciesId=26, default form)
  // Alt:  Alolan Raichu (id=10100, speciesId=26, regional form)
  const raichu = makeSeedPokemon(26, {
    speciesId: 26,
    isDefaultForm: true,
    formCategory: 'default',
    formSlug: null,
    name: 'raichu',
    displayName: 'Raichu',
    cryUrl: 'https://example.com/cries/26.ogg',
  });
  const alolanRaichu = makeSeedPokemon(10100, {
    speciesId: 26,
    isDefaultForm: false,
    formCategory: 'regional',
    formSlug: 'alola',
    name: 'raichu-alola',
    displayName: 'Alolan Raichu',
    cryUrl: 'https://example.com/cries/10100.ogg',
  });
  const formSeed = [raichu, alolanRaichu];

  describe('buildSession with form seed', () => {
    it('emits name cards for both base and alternate form', () => {
      const result = buildSession(formSeed, [], NOW);
      const nameCards = result.filter((c) => c.cardType === 'name');
      expect(nameCards).toHaveLength(2);
      expect(nameCards.map((c) => c.id)).toContain(26);
      expect(nameCards.map((c) => c.id)).toContain(10100);
    });

    it('alt-form name card has subjectKey = "10100"', () => {
      const result = buildSession(formSeed, [], NOW);
      const altCard = result.find((c) => c.cardType === 'name' && c.id === 10100);
      expect(altCard?.subjectKey).toBe('10100');
    });

    it('alt-form name card carries displayName, not the slug', () => {
      const result = buildSession(formSeed, [], NOW);
      const altCard = result.find((c) => c.cardType === 'name' && c.id === 10100);
      if (!altCard || altCard.cardType !== 'name') throw new Error('Expected name card');
      expect(altCard.displayName).toBe('Alolan Raichu');
      expect(altCard.name).toBe('raichu-alola');
    });

    it('emits reverse cards for both base and alternate form when reverseEnabled', () => {
      const result = buildSession(formSeed, [], NOW, { reverseEnabled: true });
      const reverseCards = result.filter((c) => c.cardType === 'reverse');
      expect(reverseCards).toHaveLength(2);
      const pokemonIds = reverseCards.map((c) => (c as ReverseReviewCard).pokemonId);
      expect(pokemonIds).toContain(26);
      expect(pokemonIds).toContain(10100);
    });

    it('alt-form reverse card has subjectKey = "10100" and pokemonId = 10100', () => {
      const result = buildSession(formSeed, [], NOW, { reverseEnabled: true });
      const altRev = result.find(
        (c): c is ReverseReviewCard =>
          c.cardType === 'reverse' && (c as ReverseReviewCard).pokemonId === 10100,
      );
      expect(altRev?.subjectKey).toBe('10100');
      expect(altRev?.pokemonId).toBe(10100);
    });

    it('emits cry cards for both base and alternate form when cryEnabled (both have cryUrl)', () => {
      const result = buildSession(formSeed, [], NOW, { cryEnabled: true });
      const cryCards = result.filter((c) => c.cardType === 'cry');
      expect(cryCards).toHaveLength(2);
      const pokemonIds = cryCards.map((c) => (c as CryReviewCard).pokemonId);
      expect(pokemonIds).toContain(26);
      expect(pokemonIds).toContain(10100);
    });

    it('no cry card emitted for an alt form with cryUrl=null', () => {
      const altNoCry = { ...alolanRaichu, cryUrl: null };
      const result = buildSession([raichu, altNoCry], [], NOW, { cryEnabled: true });
      const cryCards = result.filter((c) => c.cardType === 'cry');
      expect(cryCards).toHaveLength(1);
      expect((cryCards[0] as CryReviewCard).pokemonId).toBe(26);
    });

    it('total cards = 4 name+reverse, 0 cry when cryEnabled:false', () => {
      const result = buildSession(formSeed, [], NOW, {
        nameEnabled: true,
        reverseEnabled: true,
        cryEnabled: false,
        evolutionEnabled: false,
      });
      expect(result).toHaveLength(4);
      expect(result.filter((c) => c.cardType === 'name')).toHaveLength(2);
      expect(result.filter((c) => c.cardType === 'reverse')).toHaveLength(2);
    });

    it('total cards = 6 name+reverse+cry when all three enabled', () => {
      const result = buildSession(formSeed, [], NOW, {
        nameEnabled: true,
        reverseEnabled: true,
        cryEnabled: true,
        evolutionEnabled: false,
      });
      expect(result).toHaveLength(6);
    });
  });

  describe('daily-limit bucketing for form cards', () => {
    it('limitBucket for name card cardType returns "name"', () => {
      expect(limitBucket('name')).toBe('name');
    });

    it('limitBucket for reverse card cardType returns "reverse"', () => {
      expect(limitBucket('reverse')).toBe('reverse');
    });

    it('limitBucket for cry card cardType returns "cry"', () => {
      expect(limitBucket('cry')).toBe('cry');
    });

    it('alt-form name card and base-form name card share the same "name" budget', () => {
      const TODAY = '2026-05-09';
      const baseLimits: DailyLimits = {
        name: { maxNewPerDay: 1, maxReviewsPerDay: 10 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      };
      // Both Raichu and Alolan Raichu are new cards competing for name slots.
      const cards = buildSession(formSeed, [], NOW);
      const queues = buildSessionQueues(cards, baseLimits, TODAY);
      // Only 1 new name card allowed — cap is 1.
      expect(queues.newQueue.filter((id) => id <= 10277)).toHaveLength(1);
    });

    it('form name card firstSeen today counts toward perType.name.newIntroducedToday', () => {
      const TODAY = '2026-05-09';
      const baseLimits: DailyLimits = {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      };
      const cards: ReviewableCard[] = buildSession(formSeed, [], NOW).map((c) =>
        c.id === 10100
          ? { ...c, state: { ...c.state, firstSeen: TODAY } }
          : c,
      );
      const queues = buildSessionQueues(cards, baseLimits, TODAY);
      expect(queues.perType.name.newIntroducedToday).toBe(1);
    });
  });

  describe('hydration round-trip for form cards', () => {
    it('hydrateSession matches a persisted subjectKey="10100" name card to the form seed entry', () => {
      const savedAltName: NameReviewCard = {
        ...alolanRaichu,
        cardType: 'name',
        subjectKey: '10100',
        state: { ...initialReviewState(NOW), reps: 3, scheduledDays: 10 },
      };
      const result = hydrateSession([savedAltName], formSeed, [], NOW);
      expect(result).toHaveLength(formSeed.length); // 2 total (saved + base raichu appended)
      const found = result.find((c) => c.id === 10100);
      expect(found).toBeDefined();
      expect(found?.state.reps).toBe(3);
      expect(found?.state.scheduledDays).toBe(10);
      if (found?.cardType !== 'name') throw new Error('Expected name card');
      // Seed data refreshed
      expect(found.displayName).toBe('Alolan Raichu');
      expect(found.subjectKey).toBe('10100');
    });

    it('hydrateSession preserves FSRS state on a form reverse card', () => {
      const savedAltReverse: ReverseReviewCard = {
        ...alolanRaichu,
        id: REVERSE_ID_OFFSET + 10100,
        pokemonId: 10100,
        cardType: 'reverse',
        subjectKey: '10100',
        state: { ...initialReviewState(NOW), reps: 5, scheduledDays: 21 },
      };
      const result = hydrateSession([savedAltReverse], formSeed, [], NOW, {
        reverseEnabled: true,
        nameEnabled: false,
        evolutionEnabled: false,
      });
      const found = result.find((c) => c.id === REVERSE_ID_OFFSET + 10100);
      expect(found).toBeDefined();
      expect(found?.state.reps).toBe(5);
      expect(found?.state.scheduledDays).toBe(21);
      if (found?.cardType !== 'reverse') throw new Error('Expected reverse card');
      expect(found.displayName).toBe('Alolan Raichu');
      expect(found.subjectKey).toBe('10100');
    });

    it('hydrateSession adds missing form entries (both name cards) when saved session has none', () => {
      const result = hydrateSession([], formSeed, [], NOW);
      expect(result).toHaveLength(2);
      const ids = result.map((c) => c.id);
      expect(ids).toContain(26);
      expect(ids).toContain(10100);
    });
  });
});

// ============================================================
// buildSessionQueues — "unlimited reviews" edge (#AGENTS.md)
// ============================================================
// From AGENTS.md:
//   "Cards first seen today have firstSeen === today set permanently on the
//    first grade, so subsequent grades of the same card never count toward
//    reviewsDoneToday. The 100/day review soft wall therefore cannot fire on
//    a session built from cleared localStorage."
//
// reviewsDoneToday increments only when:
//   lastReview === today AND firstSeen !== today
//
// A card introduced today (firstSeen === today) must never count as a review
// even if lastReview === today (because it was also introduced today).

describe("buildSessionQueues — firstSeen=today never increments reviewsDoneToday", () => {
  const TODAY = '2026-05-09';
  const baseLimits: DailyLimits = {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  };

  function nameCard(id: number, partialState: Partial<ReturnType<typeof initialReviewState>> = {}): NameReviewCard {
    return {
      ...makeSeedPokemon(id),
      cardType: 'name',
      subjectKey: String(id),
      state: { ...initialReviewState(NOW), ...partialState },
    };
  }

  it("card with firstSeen=today and lastReview=today does NOT count toward reviewsDoneToday", () => {
    // Simulates a card introduced today, graded multiple times in the same
    // session. The in-step grades do not set lastReview, but once it graduates
    // on the same day it was first seen, both firstSeen and lastReview land on
    // today. The reviewsDoneToday counter must stay zero for this card.
    const cards: ReviewableCard[] = [
      nameCard(1, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    expect(queues.perType.name.reviewsDoneToday).toBe(0);
    expect(queues.reviewsDoneToday).toBe(0);
  });

  it("card with firstSeen=today and lastReview=today counts toward newIntroducedToday", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    expect(queues.perType.name.newIntroducedToday).toBe(1);
  });

  it("multiple repeat grades within the same day on a same-day-introduced card keep reviewsDoneToday at zero", () => {
    // Three cards all introduced today, all with lastReview today. None should
    // contribute to reviewsDoneToday.
    const cards: ReviewableCard[] = [
      nameCard(1, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }),
      nameCard(2, { firstSeen: TODAY, lastReview: TODAY, reps: 2 }),
      nameCard(3, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    expect(queues.reviewsDoneToday).toBe(0);
    expect(queues.perType.name.newIntroducedToday).toBe(3);
  });

  it("only cards with firstSeen !== today AND lastReview = today count as reviews", () => {
    const cards: ReviewableCard[] = [
      // Introduced on a prior day, reviewed today → counts as review
      nameCard(1, { firstSeen: '2026-05-01', lastReview: TODAY, reps: 3, scheduledDays: 8 }),
      // Introduced today, reviewed today → does NOT count as review
      nameCard(2, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }),
    ];
    const queues = buildSessionQueues(cards, baseLimits, TODAY);
    expect(queues.reviewsDoneToday).toBe(1);
    expect(queues.perType.name.newIntroducedToday).toBe(1);
  });
});

// ============================================================
// buildSessionQueues — exact-cap boundary (N budget, N+1th excluded)
// ============================================================
describe("buildSessionQueues — exact-cap boundary", () => {
  const TODAY = '2026-05-09';

  function nameCard(id: number, partialState: Partial<ReturnType<typeof initialReviewState>> = {}): NameReviewCard {
    return {
      ...makeSeedPokemon(id),
      cardType: 'name',
      subjectKey: String(id),
      state: { ...initialReviewState(NOW), ...partialState },
    };
  }
  function evoCard(id: number, partialState: Partial<ReturnType<typeof initialReviewState>> = {}): EvolutionReviewCard {
    const preEvoId = id - 1_500_000;
    const postEvoId = id - 1_500_000 + 100_000;
    return {
      ...makeEvoEdge({
        id,
        preEvoId,
        preEvoName: 'pre-' + id,
        postEvoId,
        postEvoName: 'post-' + id,
      }),
      subjectKey: `${preEvoId}>>>${postEvoId}`,
      state: { ...initialReviewState(NOW), ...partialState },
    };
  }

  it("exactly N new cards fill the budget and the (N+1)th is excluded", () => {
    // Budget of 3 for new name cards. Provide exactly 3 + 1 = 4 fresh cards.
    const limits: DailyLimits = {
      name: { maxNewPerDay: 3, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
      reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    };
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2), nameCard(3), nameCard(4), // 4 fresh, cap = 3
    ];
    const queues = buildSessionQueues(cards, limits, TODAY);
    expect(queues.newQueue.filter((id) => id <= 4)).toHaveLength(3); // exactly the cap
    // The 4th must not be in the queue.
    const newIds = new Set(queues.newQueue);
    const allFourPresent = [1, 2, 3, 4].every((id) => newIds.has(id));
    expect(allFourPresent).toBe(false); // one must be excluded
  });

  it("exactly N reviews fill the budget and the (N+1)th is excluded", () => {
    // Budget of 2 reviews. Provide 3 due-today cards.
    const limits: DailyLimits = {
      name: { maxNewPerDay: 10, maxReviewsPerDay: 2 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
      reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    };
    const dueState = { firstSeen: '2026-05-01', lastReview: '2026-05-03', dueDate: TODAY, reps: 2, scheduledDays: 6 };
    const cards: ReviewableCard[] = [
      nameCard(1, dueState), nameCard(2, dueState), nameCard(3, dueState),
    ];
    const queues = buildSessionQueues(cards, limits, TODAY);
    expect(queues.reviewQueue).toHaveLength(2); // exactly the cap
    // All three cannot all be present — one must be excluded.
    const reviewIds = new Set(queues.reviewQueue);
    expect(reviewIds.size).toBe(2);
  });

  it("budget already at cap (newIntroducedToday === maxNewPerDay) prevents any new cards entering the queue", () => {
    // 3 cards already introduced today → at cap. 2 more fresh candidates should
    // receive zero new slots.
    const limits: DailyLimits = {
      name: { maxNewPerDay: 3, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
      reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    };
    const cards: ReviewableCard[] = [
      // Already introduced today (consume the budget)
      nameCard(1, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }),
      nameCard(2, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }),
      nameCard(3, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }),
      // Fresh candidates — should be excluded since budget is exhausted
      nameCard(4),
      nameCard(5),
    ];
    const queues = buildSessionQueues(cards, limits, TODAY);
    expect(queues.perType.name.newIntroducedToday).toBe(3);
    expect(queues.newQueue.filter((id) => id >= 4)).toHaveLength(0);
  });

  it("budget exactly at cap minus one allows exactly one more new card", () => {
    // 2 introduced, cap = 3 → 1 slot remaining. 2 candidates compete; only 1 enters.
    const limits: DailyLimits = {
      name: { maxNewPerDay: 3, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
      reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    };
    const cards: ReviewableCard[] = [
      nameCard(1, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }), // introduced today
      nameCard(2, { firstSeen: TODAY, lastReview: TODAY, reps: 1 }), // introduced today
      nameCard(3), // fresh candidate 1
      nameCard(4), // fresh candidate 2
    ];
    const queues = buildSessionQueues(cards, limits, TODAY);
    expect(queues.perType.name.newIntroducedToday).toBe(2);
    const freshInQueue = queues.newQueue.filter((id) => id === 3 || id === 4);
    expect(freshInQueue).toHaveLength(1); // exactly one slot remaining
  });

  it("evolution budget is independent: filling the name cap leaves evo slots intact", () => {
    // Name cap = 2, evolution cap = 1. Filling name must not spill into evo.
    const limits: DailyLimits = {
      name: { maxNewPerDay: 2, maxReviewsPerDay: 100 },
      evolution: { maxNewPerDay: 1, maxReviewsPerDay: 50 },
      reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    };
    const cards: ReviewableCard[] = [
      nameCard(1), nameCard(2), nameCard(3), // 3 fresh name (cap=2)
      evoCard(1_500_001), evoCard(1_500_002), // 2 fresh evo (cap=1)
    ];
    const queues = buildSessionQueues(cards, limits, TODAY);
    const allNewCards = queues.newQueue.map((id) => cards.find((c) => c.id === id)!);
    expect(allNewCards.filter((c) => c.cardType === 'name')).toHaveLength(2);
    expect(allNewCards.filter((c) => c.cardType === 'evolution')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// #835 — non-destructive re-enable and cardTypeIsEnabled
// ---------------------------------------------------------------------------

describe('cardTypeIsEnabled (#835)', () => {
  const seed1 = makeSeedPokemon(1);

  function nameCard(id: number): NameReviewCard {
    return { ...makeSeedPokemon(id), cardType: 'name', subjectKey: String(id), state: initialReviewState(NOW) };
  }
  function reverseCard(id: number): ReverseReviewCard {
    return { ...makeSeedPokemon(id), id: REVERSE_ID_OFFSET + id, pokemonId: id, cardType: 'reverse', subjectKey: String(id), state: initialReviewState(NOW) };
  }
  function cryCard(id: number): CryReviewCard {
    return { ...makeSeedPokemon(id), id: 3_000_000 + id, pokemonId: id, cardType: 'cry', subjectKey: String(id), state: initialReviewState(NOW) };
  }
  function evoCard(id: number): EvolutionReviewCard {
    return { ...makeEvoEdge({ id }), subjectKey: `1>>>2`, state: initialReviewState(NOW) };
  }

  it('returns true for name cards when nameEnabled is true (default)', () => {
    expect(cardTypeIsEnabled(nameCard(1), {})).toBe(true);
  });

  it('returns false for name cards when nameEnabled is false', () => {
    expect(cardTypeIsEnabled(nameCard(1), { nameEnabled: false })).toBe(false);
  });

  it('returns false for reverse cards by default (default is disabled)', () => {
    expect(cardTypeIsEnabled(reverseCard(1), {})).toBe(false);
  });

  it('returns true for reverse cards when reverseEnabled is true', () => {
    expect(cardTypeIsEnabled(reverseCard(1), { reverseEnabled: true })).toBe(true);
  });

  it('returns false for cry cards by default', () => {
    expect(cardTypeIsEnabled(cryCard(1), {})).toBe(false);
  });

  it('returns true for cry cards when cryEnabled is true', () => {
    expect(cardTypeIsEnabled(cryCard(1), { cryEnabled: true })).toBe(true);
  });

  it('returns true for evolution cards by default', () => {
    expect(cardTypeIsEnabled(evoCard(1_500_001), {})).toBe(true);
  });

  it('returns false for evolution cards when evolutionEnabled is false', () => {
    expect(cardTypeIsEnabled(evoCard(1_500_001), { evolutionEnabled: false })).toBe(false);
  });
});

describe('non-destructive re-enable: hydrateSession + cardTypeIsEnabled (#835)', () => {
  const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];
  const TODAY = '2026-05-09';
  const baseLimits: DailyLimits = {
    name: { maxNewPerDay: 100, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 100, maxReviewsPerDay: 100 },
    reverse: { maxNewPerDay: 100, maxReviewsPerDay: 100 },
    cry: { maxNewPerDay: 100, maxReviewsPerDay: 100 },
  };

  it('saved reverse cards survive a disable-then-re-enable cycle with FSRS state intact', () => {
    // Start: reverse enabled, one card has progress.
    const revCard: ReverseReviewCard = {
      ...makeSeedPokemon(1),
      id: REVERSE_ID_OFFSET + 1,
      pokemonId: 1,
      cardType: 'reverse',
      subjectKey: '1',
      state: { ...initialReviewState(NOW), reps: 8, scheduledDays: 30 },
    };
    // Disable — cards are preserved, not stripped.
    const afterDisable = hydrateSession([revCard], seed, [], NOW, { reverseEnabled: false });
    expect(afterDisable.filter((c) => c.cardType === 'reverse')).toHaveLength(1);
    // Re-enable — cards already there, state intact.
    const afterReEnable = hydrateSession(afterDisable, seed, [], NOW, { reverseEnabled: true });
    const found = afterReEnable.find((c) => c.id === REVERSE_ID_OFFSET + 1);
    expect(found?.state.reps).toBe(8);
    expect(found?.state.scheduledDays).toBe(30);
  });

  it('buildSessionQueues excludes disabled-type cards via eligibleCardIds', () => {
    // Build a session with name + reverse cards.
    const built = buildSession(seed, [], NOW, { reverseEnabled: true });
    // hydrate with reverse disabled — cards preserved in session.
    const hydrated = hydrateSession(built, seed, [], NOW, { reverseEnabled: false });
    expect(hydrated.filter((c) => c.cardType === 'reverse')).toHaveLength(2); // preserved

    // Build eligibleCardIds that excludes disabled types.
    const cardTypeOpts = { reverseEnabled: false, nameEnabled: true, evolutionEnabled: true };
    const eligibleIds = new Set(
      hydrated
        .filter((c) => cardTypeIsEnabled(c, cardTypeOpts))
        .map((c) => c.id),
    );

    const queues = buildSessionQueues(hydrated, baseLimits, TODAY, eligibleIds);
    // Reverse cards must not appear in any queue.
    const allQueued = [...queues.newQueue, ...queues.reviewQueue];
    const allCards = new Map(hydrated.map((c) => [c.id, c]));
    const queuedTypes = allQueued.map((id) => allCards.get(id)?.cardType);
    expect(queuedTypes.some((t) => t === 'reverse')).toBe(false);
    // Name cards (enabled) are still queued.
    expect(queuedTypes.some((t) => t === 'name')).toBe(true);
  });

  it('re-enable fresh start: resetting card states to initialReviewState clears all progress', () => {
    const revCard: ReverseReviewCard = {
      ...makeSeedPokemon(1),
      id: REVERSE_ID_OFFSET + 1,
      pokemonId: 1,
      cardType: 'reverse',
      subjectKey: '1',
      state: { ...initialReviewState(NOW), reps: 5, scheduledDays: 21, lastReview: '2026-05-01' },
    };
    const freshNow = new Date('2026-05-09T12:00:00Z');
    // Simulate "start fresh": reset reverse cards to initial state.
    const reset = [revCard].map((c) =>
      c.cardType === 'reverse' ? { ...c, state: initialReviewState(freshNow) } : c,
    );
    // The card must now have null lastReview (unreviewed).
    expect(reset[0].state.lastReview).toBeNull();
    expect(reset[0].state.reps).toBe(0);
    expect(reset[0].state.scheduledDays).toBe(0);
  });

  it('disabled name cards do not get new additions during disable period', () => {
    // No saved cards.
    const result = hydrateSession([], seed, [], NOW, { nameEnabled: false });
    expect(result.filter((c) => c.cardType === 'name')).toHaveLength(0);
  });

  it('disabled reverse cards do not get new additions during disable period', () => {
    const result = hydrateSession([], seed, [], NOW, { reverseEnabled: false });
    expect(result.filter((c) => c.cardType === 'reverse')).toHaveLength(0);
  });
});
