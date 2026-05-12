import { describe, it, expect } from 'vitest';
import { filterPokemon, parseFilters } from './filter';
import type { PokemonCellData, PokedexFilters } from './filter';

function basePokemon(overrides: Partial<PokemonCellData> = {}): PokemonCellData {
  return {
    id: 1,
    name: 'bulbasaur',
    spriteUrl: '',
    types: ['grass', 'poison'],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: '',
    flavorTexts: [],
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
    cardClass: 'locked',
    ...overrides,
  };
}

const noFilters: PokedexFilters = { query: '', types: [], gen: null };

// A small fixture set covering two gens and multiple types.
// Gen 1 IDs: 1–151; Gen 2 IDs: 152–251.
const FIXTURES: PokemonCellData[] = [
  basePokemon({ id: 1,   name: 'bulbasaur',  types: ['grass', 'poison'] }),
  basePokemon({ id: 4,   name: 'charmander', types: ['fire'] }),
  basePokemon({ id: 7,   name: 'squirtle',   types: ['water'] }),
  basePokemon({ id: 152, name: 'chikorita',  types: ['grass'] }),
  basePokemon({ id: 155, name: 'cyndaquil',  types: ['fire'] }),
];

describe('filterPokemon', () => {
  it('empty filters returns all pokemon', () => {
    const result = filterPokemon(FIXTURES, noFilters);
    expect(result).toHaveLength(FIXTURES.length);
    expect(result).toEqual(FIXTURES);
  });

  it('query filter matches substring case-insensitively', () => {
    const result = filterPokemon(FIXTURES, { ...noFilters, query: 'CHAR' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('charmander');
  });

  it('query filter excludes non-matching names', () => {
    const result = filterPokemon(FIXTURES, { ...noFilters, query: 'xyz' });
    expect(result).toHaveLength(0);
  });

  it('type filter uses OR logic — pokemon with any selected type passes', () => {
    const result = filterPokemon(FIXTURES, { ...noFilters, types: ['fire', 'water'] });
    const names = result.map((p) => p.name).sort();
    expect(names).toEqual(['charmander', 'cyndaquil', 'squirtle'].sort());
  });

  it('type filter excludes pokemon with none of the selected types', () => {
    const result = filterPokemon(FIXTURES, { ...noFilters, types: ['electric'] });
    expect(result).toHaveLength(0);
  });

  it('type filter matches multi-type pokemon when one type matches', () => {
    // bulbasaur has ['grass', 'poison']; filtering on poison should include it
    const result = filterPokemon(FIXTURES, { ...noFilters, types: ['poison'] });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bulbasaur');
  });

  it('gen filter returns only pokemon in the specified generation', () => {
    // Gen 1: IDs 1–151
    const result = filterPokemon(FIXTURES, { ...noFilters, gen: 1 });
    const ids = result.map((p) => p.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 4, 7]);
  });

  it('gen filter for gen 2 returns only gen-2 pokemon', () => {
    const result = filterPokemon(FIXTURES, { ...noFilters, gen: 2 });
    const ids = result.map((p) => p.id).sort((a, b) => a - b);
    expect(ids).toEqual([152, 155]);
  });

  it('combined query + gen: both axes must match (AND)', () => {
    // "char" matches charmander (gen 1) and nothing in gen 2
    const result = filterPokemon(FIXTURES, { query: 'char', types: [], gen: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('charmander');
  });

  it('combined query + gen: returns empty when gen matches but query does not', () => {
    const result = filterPokemon(FIXTURES, { query: 'xyz', types: [], gen: 1 });
    expect(result).toHaveLength(0);
  });

  it('zero-result case returns empty array', () => {
    const result = filterPokemon(FIXTURES, { query: 'zzz', types: ['electric'], gen: 9 });
    expect(result).toEqual([]);
  });
});

describe('parseFilters', () => {
  function params(entries: Record<string, string>) {
    return new URLSearchParams(entries);
  }

  it('returns defaults when no params are present', () => {
    const result = parseFilters(params({}));
    expect(result).toEqual({ query: '', types: [], gen: null });
  });

  it('reads q into query', () => {
    const result = parseFilters(params({ q: 'pikachu' }));
    expect(result.query).toBe('pikachu');
  });

  it('splits type param by comma into types array', () => {
    const result = parseFilters(params({ type: 'fire,water' }));
    expect(result.types).toEqual(['fire', 'water']);
  });

  it('filters empty strings from type param', () => {
    const result = parseFilters(params({ type: 'fire,,water' }));
    expect(result.types).toEqual(['fire', 'water']);
  });

  it('parses gen as integer', () => {
    const result = parseFilters(params({ gen: '3' }));
    expect(result.gen).toBe(3);
  });

  it('maps non-numeric gen to null', () => {
    const result = parseFilters(params({ gen: 'abc' }));
    expect(result.gen).toBeNull();
  });

  it('maps missing gen to null', () => {
    const result = parseFilters(params({}));
    expect(result.gen).toBeNull();
  });
});
