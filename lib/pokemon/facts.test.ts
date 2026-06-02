import { describe, it, expect } from 'vitest';
import { getPokemonFacts } from '@/lib/pokemon/facts';
import type { SeedPokemon, FlavorTextEntry } from '@/lib/pokemon/seed';

function basePokemon(overrides: Partial<SeedPokemon> = {}): SeedPokemon {
  return {
    id: 1,
    speciesId: 1,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: 'Bulbasaur',
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
    cryUrl: null,
    ...overrides,
  };
}

describe('getPokemonFacts', () => {
  // ---------------------------------------------------------------------------
  // Legacy string[] shape (pre-#1559 payloads) — falls back to "Pokédex entry"
  // ---------------------------------------------------------------------------

  it('returns facts for a fully-populated pokemon (legacy string[] flavourTexts)', () => {
    const facts = getPokemonFacts(basePokemon());
    expect(facts.length).toBeGreaterThan(0);
    // Legacy plain-string entries → versions=[] → label falls back to "Pokédex entry"
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

  // ---------------------------------------------------------------------------
  // New FlavorTextEntry[] shape (post-#1559) — label is formatted game names
  // ---------------------------------------------------------------------------

  it('uses game-name label when flavorTexts is FlavorTextEntry[] with known versions', () => {
    const entries: FlavorTextEntry[] = [
      { text: 'A strange seed.', versions: ['red', 'blue'] },
    ];
    const facts = getPokemonFacts(basePokemon({ flavorTexts: entries }));
    const entry = facts.find((f) => f.value === 'A strange seed.');
    expect(entry?.label).toBe('Red · Blue');
  });

  it('falls back to "Pokédex entry" when versions array is empty', () => {
    const entries: FlavorTextEntry[] = [
      { text: 'Some text.', versions: [] },
    ];
    const facts = getPokemonFacts(basePokemon({ flavorTexts: entries }));
    const entry = facts.find((f) => f.value === 'Some text.');
    expect(entry?.label).toBe('Pokédex entry');
  });

  it('dedup-accumulate: each text appears once, label lists all its games', () => {
    // Simulates what extractFlavorTexts now produces:
    // two different texts each shared by two games
    const entries: FlavorTextEntry[] = [
      { text: 'Text one.', versions: ['red', 'blue'] },
      { text: 'Text two.', versions: ['yellow', 'gold'] },
    ];
    const facts = getPokemonFacts(basePokemon({ flavorTexts: entries }));
    const textOneFact = facts.find((f) => f.value === 'Text one.');
    const textTwoFact = facts.find((f) => f.value === 'Text two.');
    expect(textOneFact?.label).toBe('Red · Blue');
    expect(textTwoFact?.label).toBe('Yellow · Gold');
  });

  it('overflow: shows first 3 games + "+N" when 4+ games share a text', () => {
    const entries: FlavorTextEntry[] = [
      { text: 'A text.', versions: ['red', 'blue', 'yellow', 'gold'] },
    ];
    const facts = getPokemonFacts(basePokemon({ flavorTexts: entries }));
    const entry = facts.find((f) => f.value === 'A text.');
    expect(entry?.label).toBe('Red · Blue · Yellow +1');
  });

  it('FireRed label formatted correctly (compound slug)', () => {
    const entries: FlavorTextEntry[] = [
      { text: 'FireRed text.', versions: ['firered'] },
    ];
    const facts = getPokemonFacts(basePokemon({ flavorTexts: entries }));
    const entry = facts.find((f) => f.value === 'FireRed text.');
    expect(entry?.label).toBe('FireRed');
  });

  it('game labels stay English under non-English locale (locale-invariant proper nouns)', () => {
    // formatVersions always returns English game names regardless of locale
    const entries: FlavorTextEntry[] = [
      { text: 'Some text.', versions: ['scarlet', 'violet'] },
    ];
    // Tested with English fallback — the label comes from VERSION_NAMES which
    // is locale-invariant. The locale-coverage test for the component is in
    // PokemonDetailDisclosure.test.tsx.
    const facts = getPokemonFacts(basePokemon({ flavorTexts: entries }));
    const entry = facts.find((f) => f.value === 'Some text.');
    expect(entry?.label).toBe('Scarlet · Violet');
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
