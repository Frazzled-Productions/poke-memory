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
});
