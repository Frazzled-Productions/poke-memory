// lib/pokemon/localeNames.ts
// Lazy-loaded sidecar for multi-locale Pokemon names (#1259).
//
// `generated-locale-names.json` is served from `public/pokemon-data/` and
// never bundled into the critical JS path.  The data is gated in the UI by
// the `languages` Labs flag (#1260); this module provides the data layer.
//
// The payload shape is an array of PokemonLocaleNames entries, indexed on
// load into a Map<speciesId, PokemonLocaleNames> for O(1) lookup.

import type { PokemonNameLocale, PokemonLocaleNames } from "@/lib/pokemon/seed";

// ---------------------------------------------------------------------------
// Module-level cache (singleton per JS context)
// ---------------------------------------------------------------------------

let _cache: Map<number, PokemonLocaleNames> | null = null;
let _loadPromise: Promise<Map<number, PokemonLocaleNames>> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and cache the locale-names sidecar.  Safe to call concurrently - 
 * only one network request is ever in flight.
 */
export async function loadLocaleNames(): Promise<Map<number, PokemonLocaleNames>> {
  if (_cache !== null) return _cache;
  if (_loadPromise !== null) return _loadPromise;

  _loadPromise = (async () => {
    try {
      const res = await fetch("/pokemon-data/generated-locale-names.json");
      if (!res.ok) throw new Error(`Locale-names fetch failed: ${res.status}`);
      const entries = (await res.json()) as PokemonLocaleNames[];
      const map = new Map<number, PokemonLocaleNames>(
        entries.map((e) => [e.speciesId, e]),
      );
      _cache = map;
      return map;
    } catch {
      // Non-fatal - callers fall back to the English name already on SeedPokemon.
      _cache = new Map();
      return _cache;
    }
  })();

  return _loadPromise;
}

/**
 * Return the locale name for a species, or `undefined` if the sidecar has
 * not been loaded yet or does not contain an entry for this species.
 *
 * Callers should `await loadLocaleNames()` before calling this for a
 * guaranteed result.  In a synchronous context (e.g. render), this returns
 * `undefined` on the first render and the correct value after rehydration.
 */
export function getLocaleName(
  speciesId: number,
  locale: PokemonNameLocale,
): string | undefined {
  return _cache?.get(speciesId)?.nameByLocale[locale];
}

/**
 * Return the transliteration for a species and locale, or `undefined` if
 * not yet loaded or not available.
 *
 * `locale` must be `"ja"`, `"zh-Hans"`, or `"zh-Hant"` - English has no
 * transliteration.
 */
export function getTransliteration(
  speciesId: number,
  locale: "ja" | "zh-Hans" | "zh-Hant",
): string | undefined {
  return _cache?.get(speciesId)?.transliterationByLocale[locale];
}

/**
 * Synchronous snapshot of the currently-loaded locale names, keyed by
 * speciesId.  Returns an empty Map before `loadLocaleNames()` resolves.
 */
export function getLocaleNamesSnapshot(): ReadonlyMap<number, PokemonLocaleNames> {
  return _cache ?? new Map();
}

// ---------------------------------------------------------------------------
// Test helpers (reset module-level state between tests)
// ---------------------------------------------------------------------------

/** @internal - test use only.  Resets the in-memory cache. */
export function _resetLocaleNamesCache(): void {
  _cache = null;
  _loadPromise = null;
}
