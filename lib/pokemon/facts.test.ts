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

  // Height boundary values
  it('height < 0.3 m (dm=2) → hamster comparison', () => {
    const facts = getPokemonFacts(basePokemon({ height: 2 }));
    const h = facts.find((f) => f.label === 'Height');
    expect(h?.value).toContain('hamster');
  });

  it('height 0.9 m (dm=9) → knee-height comparison (boundary: m < 1.0)', () => {
    const facts = getPokemonFacts(basePokemon({ height: 9 }));
    const h = facts.find((f) => f.label === 'Height');
    expect(h?.value).toContain('knee-height');
  });

  it('height >= 15 m (dm=200) → six-storey comparison', () => {
    const facts = getPokemonFacts(basePokemon({ height: 200 }));
    const h = facts.find((f) => f.label === 'Height');
    expect(h?.value).toContain('six-storey');
  });

  // Weight boundary values
  it('weight at 5 kg (hg=50) → bowling ball comparison (bucket lower bound)', () => {
    const facts = getPokemonFacts(basePokemon({ weight: 50 }));
    const w = facts.find((f) => f.label === 'Weight');
    expect(w?.value).toContain('bowling ball');
  });

  it('weight at 7 kg (hg=70) → bowling ball comparison (mid-bucket)', () => {
    const facts = getPokemonFacts(basePokemon({ weight: 70 }));
    const w = facts.find((f) => f.label === 'Weight');
    expect(w?.value).toContain('bowling ball');
  });

  it('weight at 100 kg exactly (hg=1000) → two adult humans comparison', () => {
    const facts = getPokemonFacts(basePokemon({ weight: 1000 }));
    const w = facts.find((f) => f.label === 'Weight');
    expect(w?.value).toContain('two adult humans');
  });

  it('weight at 200 kg exactly (hg=2000) → grizzly bear comparison', () => {
    const facts = getPokemonFacts(basePokemon({ weight: 2000 }));
    const w = facts.find((f) => f.label === 'Weight');
    expect(w?.value).toContain('grizzly bear');
  });

  it('weight at 350 kg (hg=3500) → large horse comparison', () => {
    const facts = getPokemonFacts(basePokemon({ weight: 3500 }));
    const w = facts.find((f) => f.label === 'Weight');
    expect(w?.value).toContain('large horse');
  });

  it('weight at 4.9 kg (hg=49) → laptop comparison', () => {
    const facts = getPokemonFacts(basePokemon({ weight: 49 }));
    const w = facts.find((f) => f.label === 'Weight');
    expect(w?.value).toContain('laptop');
  });

  it('weight at 14.9 kg (hg=149) → dog food comparison', () => {
    const facts = getPokemonFacts(basePokemon({ weight: 149 }));
    const w = facts.find((f) => f.label === 'Weight');
    expect(w?.value).toContain('dog food');
  });

  // Happiness boundary values
  it('happiness=0 → "Slow to trust"', () => {
    const facts = getPokemonFacts(basePokemon({ baseHappiness: 0 }));
    const h = facts.find((f) => f.label === 'Base happiness');
    expect(h?.value).toBe('Slow to trust');
  });

  it('happiness=35 → "Warms up gradually" (first value above Slow to trust boundary)', () => {
    const facts = getPokemonFacts(basePokemon({ baseHappiness: 35 }));
    const h = facts.find((f) => f.label === 'Base happiness');
    expect(h?.value).toBe('Warms up gradually');
  });

  // Experience boundary values
  it('experience=69 → "Very low XP yield"', () => {
    const facts = getPokemonFacts(basePokemon({ baseExperience: 69 }));
    const e = facts.find((f) => f.label === 'Base exp.');
    expect(e?.value).toBe('Very low XP yield');
  });

  it('experience=70 → "Low XP yield" (first value above very-low boundary)', () => {
    const facts = getPokemonFacts(basePokemon({ baseExperience: 70 }));
    const e = facts.find((f) => f.label === 'Base exp.');
    expect(e?.value).toBe('Low XP yield');
  });

  it('experience=220 → "Very high XP yield"', () => {
    const facts = getPokemonFacts(basePokemon({ baseExperience: 220 }));
    const e = facts.find((f) => f.label === 'Base exp.');
    expect(e?.value).toBe('Very high XP yield');
  });
});
