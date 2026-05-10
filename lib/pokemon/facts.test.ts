import { describe, it, expect } from 'vitest';
import { getPokemonFacts } from '@/lib/pokemon/facts';
import type { SeedPokemon } from '@/lib/pokemon/seed';

function basePokemon(overrides = {}) {
  return {
    id: 1,
    name: 'bulbasaur',
    spriteUrl: '',
    types: ['grass', 'poison'],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: 'A strange seed was planted on its back at birth.',
    flavorTexts: ['A strange seed was planted on its back at birth.'],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: 'Seed Pokemon',
    generation: 'generation-i',
    captureRate: 45,
    baseHappiness: 50,
    growthRate: 'medium-slow',
    habitat: 'grassland',
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    ...overrides,
  };
}

describe('getPokemonFacts', () => {
  it('returns facts for a fully-populated pokemon', () => {
    const facts = getPokemonFacts(basePokemon());
    expect(facts.length).toBeGreaterThan(0);
    const entry = facts.find((f) => f.label === 'Pokédex entry');
    expect(entry?.value).toBe('A strange seed was planted on its back at birth.');
  });

  it('does not throw and omits Pokédex entries when flavorTexts is undefined (stale localStorage card)', () => {
    const stale = basePokemon({ flavorTexts: undefined });
    expect(() => getPokemonFacts(stale)).not.toThrow();
    const facts = getPokemonFacts(stale);
    expect(facts.every((f) => f.label !== 'Pokédex entry')).toBe(true);
  });

  it('does not throw when flavorTexts is an empty array', () => {
    const pokemon = basePokemon({ flavorTexts: [] });
    expect(() => getPokemonFacts(pokemon)).not.toThrow();
    const facts = getPokemonFacts(pokemon);
    expect(facts.every((f) => f.label !== 'Pokédex entry')).toBe(true);
  });

  it('height fact contains " m — " (comparison present)', () => {
    const facts = getPokemonFacts(basePokemon());
    const height = facts.find((f) => f.label === 'Height');
    expect(height?.value).toContain(' m — ');
  });

  it('weight fact contains " kg — " (comparison present)', () => {
    const facts = getPokemonFacts(basePokemon());
    const weight = facts.find((f) => f.label === 'Weight');
    expect(weight?.value).toContain(' kg — ');
  });

  it('base happiness fact is tier label, not raw number', () => {
    const facts = getPokemonFacts(basePokemon());
    const happiness = facts.find((f) => f.label === 'Base happiness');
    expect(happiness?.value).toBe('Warms up gradually');
  });

  it('base exp. fact is tier label, not raw number', () => {
    const facts = getPokemonFacts(basePokemon());
    const exp = facts.find((f) => f.label === 'Base exp.');
    expect(exp?.value).toBe('Very low XP yield');
  });

  it('catch difficulty does not contain "catch rate"', () => {
    const facts = getPokemonFacts(basePokemon());
    const difficulty = facts.find((f) => f.label === 'Catch difficulty');
    expect(difficulty?.value).not.toContain('catch rate');
  });

  it('catch difficulty for rate=3 is "Extremely rare" with no parenthetical', () => {
    const facts = getPokemonFacts(basePokemon({ captureRate: 3 }));
    const difficulty = facts.find((f) => f.label === 'Catch difficulty');
    expect(difficulty?.value).toBe('Extremely rare');
  });
});
