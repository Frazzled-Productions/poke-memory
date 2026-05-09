import { describe, it, expect } from 'vitest';
import { hydrateSession } from '@/lib/review/session';
import { initialReviewState } from '@/lib/srs/scheduler';
import type { ReviewCard } from '@/lib/review/session';
import type { SeedPokemon } from '@/lib/pokemon/seed';

const NOW = new Date('2026-05-09T12:00:00Z');

function makeSeedPokemon(id, overrides = {}) {
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

function makeCard(seedPokemon, stateOverrides = {}) {
  return {
    ...seedPokemon,
    state: { ...initialReviewState(NOW), ...stateOverrides },
  };
}

describe('hydrateSession', () => {
  it('appends new seed cards not present in saved session', () => {
    const saved = [makeCard(makeSeedPokemon(1))];
    const seed = [makeSeedPokemon(1), makeSeedPokemon(2)];
    const result = hydrateSession(saved, seed, NOW);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toContain(2);
  });

  it('preserves review state on existing cards', () => {
    const state = { ...initialReviewState(NOW), repetitions: 5, interval: 10 };
    const saved = [makeCard(makeSeedPokemon(1), { repetitions: 5, interval: 10 })];
    const seed = [makeSeedPokemon(1)];
    const result = hydrateSession(saved, seed, NOW);
    expect(result[0].state.repetitions).toBe(5);
    expect(result[0].state.interval).toBe(10);
  });

  it('refreshes seed fields (including flavorTexts) on existing persisted cards', () => {
    const stale = makeSeedPokemon(1, { flavorTexts: undefined });
    const saved = [makeCard(stale)];
    const freshSeed = [makeSeedPokemon(1, { flavorTexts: ['New flavor text.'] })];
    const result = hydrateSession(saved, freshSeed, NOW);
    expect(result[0].flavorTexts).toEqual(['New flavor text.']);
    expect(result[0].state.repetitions).toBe(saved[0].state.repetitions);
  });

  it('keeps cards whose id is not in the seed unchanged', () => {
    const saved = [makeCard(makeSeedPokemon(99))];
    const seed = [makeSeedPokemon(1)];
    const result = hydrateSession(saved, seed, NOW);
    expect(result.find((c) => c.id === 99)).toBeDefined();
  });

  it('returns an unchanged copy when no additions and no refreshes needed', () => {
    const saved = [makeCard(makeSeedPokemon(1))];
    const seed = [makeSeedPokemon(1)];
    const result = hydrateSession(saved, seed, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });
});
