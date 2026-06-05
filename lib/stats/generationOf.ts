/**
 * Seed-free generation helpers.
 *
 * Extracted from `lib/stats/derive.ts` so server-side routes and predicates
 * (e.g. `lib/eligibility/scopePredicate.ts`) can import `generationOf`
 * without pulling the ~3.8 MB `generated.json` seed into their bundle.
 *
 * `lib/stats/derive.ts` re-exports every symbol defined here so all existing
 * callers importing from that module continue to work without change.
 *
 * Pure - no I/O, no side effects, no seed dependency.
 */

export type GenerationRange = {
  gen: number;   // 1..9
  name: string;  // "Generation I", "Generation II", ...
  first: number; // first PokéDex ID inclusive
  last: number;  // last PokéDex ID inclusive
};

/**
 * Hardcoded canonical generation boundaries for IDs 1–1025.
 *   Gen I:    1..151
 *   Gen II:   152..251
 *   Gen III:  252..386
 *   Gen IV:   387..493
 *   Gen V:    494..649
 *   Gen VI:   650..721
 *   Gen VII:  722..809
 *   Gen VIII: 810..905
 *   Gen IX:   906..1025
 */
export const GEN_RANGES: readonly GenerationRange[] = [
  { gen: 1, name: "Generation I",    first: 1,    last: 151  },
  { gen: 2, name: "Generation II",   first: 152,  last: 251  },
  { gen: 3, name: "Generation III",  first: 252,  last: 386  },
  { gen: 4, name: "Generation IV",   first: 387,  last: 493  },
  { gen: 5, name: "Generation V",    first: 494,  last: 649  },
  { gen: 6, name: "Generation VI",   first: 650,  last: 721  },
  { gen: 7, name: "Generation VII",  first: 722,  last: 809  },
  { gen: 8, name: "Generation VIII", first: 810,  last: 905  },
  { gen: 9, name: "Generation IX",   first: 906,  last: 1025 },
] as const;

/** Returns 1..9 for any valid species ID (1..1025), or 0 if out of range. */
export function generationOf(speciesId: number): number {
  for (const range of GEN_RANGES) {
    if (speciesId >= range.first && speciesId <= range.last) return range.gen;
  }
  return 0;
}
