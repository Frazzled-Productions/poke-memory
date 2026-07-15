// lib/pokemon/dailySpotlight.ts
// Pure helpers for the "Pokémon of the day" spotlight on the all-done /
// zero-card end-of-session screen (#1949).
//
// Deterministic daily pick: the same species (and fact) for every session on
// a given local day, rotating to a different pick the next day. Both
// functions are pure - no PokéAPI calls, no randomness - so the pick can be
// derived purely from the caller's day string and the pre-seeded data.

import { fnv1a } from "@/lib/utils/fnv1a";
import type { SeedPokemon } from "@/lib/pokemon/seed-builder";
import type { PokemonFact } from "@/lib/pokemon/facts";

/**
 * Deterministically picks one default-form species for the given local day.
 *
 * Filters to default forms only (`isDefaultForm`) so alternate forms
 * (Alolan/Galarian/Mega/Gmax/etc.) never appear in the spotlight, then
 * indexes into the filtered list with `fnv1a(dateStr) % list.length`.
 *
 * Same `dateStr` always yields the same species; a different `dateStr`
 * (i.e. the next local day) rotates to a different one. Returns null when
 * there are no default-form species to pick from (e.g. seed not yet loaded).
 */
export function pickDailySpecies(
  dateStr: string,
  seedPokemon: readonly SeedPokemon[],
): SeedPokemon | null {
  const defaultForms = seedPokemon.filter((p) => p.isDefaultForm);
  if (defaultForms.length === 0) return null;
  const index = fnv1a(dateStr) % defaultForms.length;
  return defaultForms[index];
}

/**
 * Deterministically picks one fact for the given local day from a species'
 * fact list. Mixes a distinct suffix into the hash input so the fact index
 * doesn't trivially correlate with the species index derived from the same
 * `dateStr` in `pickDailySpecies`.
 *
 * Do NOT use `selectFact()` from `lib/pokemon/facts.ts` here - it draws via
 * `Math.random()` and would make the pick non-deterministic across renders.
 */
export function pickDailyFact(
  dateStr: string,
  facts: readonly PokemonFact[],
): PokemonFact | null {
  if (facts.length === 0) return null;
  const index = fnv1a(`${dateStr}:fact`) % facts.length;
  return facts[index];
}
