import { generationOf } from "@/lib/stats/derive";
import type { SeedPokemon, PokemonNameLocale, TransliterationLocale } from "@/lib/pokemon/seed";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import type { CardClass } from "@/lib/stats/derive";
import type { MasteryProgress } from "@/lib/pokedex/sort";
import { getLocaleName, getTransliteration } from "@/lib/pokemon/localeNames";

export type PokemonCellData = SeedPokemon & {
  cardClass: CardClass;
  /**
   * Optional FSRS snapshot for "closest to mastery" sort ranking. Populated by
   * the Pokédex page layer when card state is available; absent for locked
   * species (never reviewed). See `lib/pokedex/sort.ts`.
   */
  masteryProgress?: MasteryProgress;
};

export type MasteryStatus = "all" | "new" | "learning" | "mastered";

export type PokedexFilters = {
  query: string;              // substring match on name or form displayName; empty = no filter
  types: string[];            // AND/intersection: pokemon must have all selected types; empty = no type filter
  gen: number | null;         // null = all gens; 1–9 = specific gen
  hasAlternateForms: boolean; // true = only species with at least one non-default form
  // "all" = no mastery filter; "new" / "learning" / "mastered" map 1:1 onto
  // CardClass ("locked" / "learning" / "mastered"). This intentionally matches
  // the grid's OWN visual mastery state (the name-card cardClass, stability
  // >= 21 days), not the two-leg badge mastery definition used elsewhere in
  // the app (Stats page, badges) - do not "fix" this to badge mastery.
  masteryStatus: MasteryStatus;
};

// Lazily-derived lookup maps - memoised only once the seed has loaded.
let _formDisplayNameCache: ReadonlyMap<number, string[]> | null = null;
let _speciesWithFormsCache: ReadonlySet<number> | null = null;

function getFormDisplayNames(): ReadonlyMap<number, string[]> {
  if (_formDisplayNameCache !== null) return _formDisplayNameCache;
  const seed = getSeedIfLoaded();
  if (!seed) return new Map();
  const map = new Map<number, string[]>();
  for (const p of seed.seedPokemon) {
    if (!p.isDefaultForm && p.speciesId !== undefined && p.displayName !== undefined) {
      const existing = map.get(p.speciesId) ?? [];
      existing.push(p.displayName);
      map.set(p.speciesId, existing);
    }
  }
  _formDisplayNameCache = map;
  return map;
}

function getSpeciesWithAlternateForms(): ReadonlySet<number> {
  if (_speciesWithFormsCache !== null) return _speciesWithFormsCache;
  const seed = getSeedIfLoaded();
  if (!seed) return new Set();
  // Build from the seed directly so the set is consistent with getFormDisplayNames.
  const map = getFormDisplayNames();
  _speciesWithFormsCache = new Set(map.keys());
  return _speciesWithFormsCache;
}

/**
 * Filter a list of Pokémon by the active filters.
 *
 * @param pokemon   Pre-enriched list to filter.
 * @param filters   Active filter state.
 * @param locale    The active `pokemonNameLocale`. When non-"en", the name search
 *                  also matches against the locale name and its transliteration
 *                  (rōmaji for ja, pinyin for zh-Hans/zh-Hant) so users can search
 *                  by the names they see on screen.
 */
export function filterPokemon(
  pokemon: PokemonCellData[],
  filters: PokedexFilters,
  locale: PokemonNameLocale = "en",
): PokemonCellData[] {
  return pokemon.filter((p) => {
    if (filters.query !== "") {
      const q = filters.query.toLowerCase().trim();
      // Always match the English seed name.
      const nameMatches = p.name.toLowerCase().includes(q);
      const formNames = getFormDisplayNames().get(p.speciesId ?? p.id) ?? [];
      const formMatches = formNames.some((fn) => fn.toLowerCase().includes(q));

      // When a non-English locale is active, also match the displayed locale
      // name and its transliteration (rōmaji/pinyin) so users can search by
      // the name visible in the grid.
      let localeNameMatches = false;
      if (!nameMatches && !formMatches && locale !== "en") {
        const sid = p.speciesId ?? p.id;
        const localeName = getLocaleName(sid, locale);
        if (localeName && localeName.toLowerCase().includes(q)) {
          localeNameMatches = true;
        }
        if (!localeNameMatches) {
          const translit = getTransliteration(sid, locale as TransliterationLocale);
          if (translit && translit.toLowerCase().includes(q)) {
            localeNameMatches = true;
          }
        }
      }

      if (!nameMatches && !formMatches && !localeNameMatches) {
        return false;
      }
    }

    if (filters.types.length > 0) {
      if (!filters.types.every((t) => p.types.includes(t))) {
        return false;
      }
    }

    if (filters.gen !== null) {
      // speciesId falls back to id for pre-expansion seed entries where the
      // field is not yet populated (speciesId === id for all default-form seeds).
      if (generationOf(p.speciesId ?? p.id) !== filters.gen) {
        return false;
      }
    }

    if (filters.hasAlternateForms) {
      if (!getSpeciesWithAlternateForms().has(p.speciesId ?? p.id)) {
        return false;
      }
    }

    if (filters.masteryStatus !== "all") {
      // "new" -> locked, "learning" -> learning, "mastered" -> mastered. Direct
      // 1:1 mapping onto the grid's own cardClass; see the MasteryStatus comment.
      const wantedCardClass: CardClass =
        filters.masteryStatus === "new" ? "locked" : filters.masteryStatus;
      if (p.cardClass !== wantedCardClass) {
        return false;
      }
    }

    return true;
  });
}

export function parseFilters(
  searchParams: URLSearchParams | { get(name: string): string | null },
): PokedexFilters {
  const query = searchParams.get("q") ?? "";

  const typeParam = searchParams.get("type") ?? "";
  const types = typeParam
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");

  const genParam = searchParams.get("gen");
  const genParsed = genParam !== null ? parseInt(genParam, 10) : NaN;
  const gen = isNaN(genParsed) ? null : genParsed;

  const hasAlternateForms = searchParams.get("forms") === "1";

  const masteryParam = searchParams.get("mastery") ?? "";
  const masteryStatus: MasteryStatus =
    masteryParam === "mastered" || masteryParam === "new" || masteryParam === "learning"
      ? masteryParam
      : "all";

  return { query, types, gen, hasAlternateForms, masteryStatus };
}
