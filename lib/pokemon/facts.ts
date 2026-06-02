import type { SeedPokemon, FlavorTextEntry } from "@/lib/pokemon/seed";
import { formatVersions } from "@/lib/pokemon/versionNames";

// Lazy-loaded flavor text map: populated on first call to `loadFlavorTexts()`.
// `generated-flavor.json` is only fetched after the initial render so it never
// blocks the critical JS evaluation path.
let _flavorCache: Map<number, FlavorTextEntry[]> | null = null;
let _flavorLoadPromise: Promise<Map<number, FlavorTextEntry[]>> | null = null;

/**
 * Shape stored in `generated-flavor.json` (post-#1559).
 * Each entry carries the normalised text and the PokéAPI version slugs that
 * used it. Older payloads used plain `string` — `normaliseFlavorEntry` handles
 * both forms.
 */
type FlavorJsonEntry = {
  id: number;
  flavorTexts: Array<FlavorTextEntry | string>;
};

/**
 * Normalise a single entry from `generated-flavor.json`.
 * Accepts both the legacy `string` shape and the new `{ text, versions }` shape
 * so the app can load pre-#1559 payloads without crashing.
 */
function normaliseFlavorEntry(raw: FlavorTextEntry | string): FlavorTextEntry {
  if (typeof raw === "string") return { text: raw, versions: [] };
  return raw;
}

/** Fetch and cache the flavor text lookup. Safe to call multiple times. */
export async function loadFlavorTexts(): Promise<Map<number, FlavorTextEntry[]>> {
  if (_flavorCache !== null) return _flavorCache;
  if (_flavorLoadPromise !== null) return _flavorLoadPromise;
  _flavorLoadPromise = (async () => {
    try {
      const res = await fetch("/pokemon-data/generated-flavor.json");
      if (!res.ok) throw new Error(`Flavor fetch failed: ${res.status}`);
      const entries = (await res.json()) as FlavorJsonEntry[];
      const map = new Map<number, FlavorTextEntry[]>(
        entries.map((e) => [e.id, e.flavorTexts.map(normaliseFlavorEntry)]),
      );
      _flavorCache = map;
      return map;
    } catch {
      // Non-fatal — facts panel renders without Pokédex entries.
      _flavorCache = new Map();
      return _flavorCache;
    }
  })();
  return _flavorLoadPromise;
}

/** Return flavor text entries for a given Pokémon id, or an empty array if not yet loaded. */
export function getFlavorTexts(pokemonId: number): FlavorTextEntry[] {
  return _flavorCache?.get(pokemonId) ?? [];
}

export type PokemonFact = {
  label: string;
  value: string;
};

const GENERATION_LABELS: Record<string, string> = {
  "generation-i": "Generation I",
  "generation-ii": "Generation II",
  "generation-iii": "Generation III",
  "generation-iv": "Generation IV",
  "generation-v": "Generation V",
  "generation-vi": "Generation VI",
  "generation-vii": "Generation VII",
  "generation-viii": "Generation VIII",
  "generation-ix": "Generation IX",
};

const STAT_DISPLAY_NAMES: Record<string, string> = {
  hp: "HP",
  attack: "Attack",
  defense: "Defense",
  specialAttack: "Sp. Atk",
  specialDefense: "Sp. Def",
  speed: "Speed",
};

function titleCase(slug: string): string {
  return slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function catchDifficulty(rate: number): string {
  if (rate <= 15) return "Extremely rare";
  if (rate <= 45) return "Rare";
  if (rate <= 100) return "Uncommon";
  if (rate <= 180) return "Somewhat common";
  if (rate <= 220) return "Common";
  return "Very common";
}

function heightComparison(dm: number): string {
  const m = dm / 10;
  const label =
    m < 0.3 ? "about the size of a hamster" :
    m < 0.6 ? "about the size of a large house cat" :
    m < 1.0 ? "roughly knee-height on an adult" :
    m < 1.5 ? "roughly the height of a 10-year-old child" :
    m < 2.0 ? "roughly the height of an average adult" :
    m < 3.1 ? "taller than a standard doorframe" :
    m < 4.0 ? "taller than a basketball hoop" :
    m < 8.0 ? "about the height of a double-decker bus" :
    m < 15.0 ? "taller than a four-storey building" :
    "taller than a six-storey building";
  return `${m.toFixed(1)} m — ${label}`;
}

function weightComparison(hg: number): string {
  const kg = hg / 10;
  const label =
    kg < 1 ? "lighter than a bag of sugar" :
    kg < 5 ? "about as heavy as a laptop" :
    kg < 7.5 ? "about as heavy as a small bowling ball" :
    kg < 15 ? "about as heavy as a large bag of dog food" :
    kg < 40 ? "about as heavy as a medium dog" :
    kg < 100 ? "about as heavy as an average adult" :
    kg < 200 ? "about as heavy as two adult humans" :
    kg < 350 ? "about as heavy as a large grizzly bear" :
    kg < 500 ? "about as heavy as a large horse" :
    "heavier than a small car";
  return `${kg.toFixed(1)} kg — ${label}`;
}

function happinessTier(n: number): string {
  if (n < 35) return "Slow to trust";
  if (n <= 69) return "Warms up gradually";
  if (n <= 99) return "Bonds with trainers easily";
  if (n <= 139) return "Particularly friendly";
  return "Very happy by nature";
}

function experienceTier(n: number): string {
  if (n < 70) return "Very low XP yield";
  if (n < 110) return "Low XP yield";
  if (n < 160) return "Average XP yield";
  if (n < 220) return "High XP yield";
  return "Very high XP yield";
}

function genderText(rate: number): string {
  if (rate === -1) return "Genderless";
  if (rate === 0) return "Male only";
  if (rate === 8) return "Female only";
  const femalePct = (rate / 8) * 100;
  const malePct = 100 - femalePct;
  const fmt = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(1);
  return `${fmt(malePct)}% ♂, ${fmt(femalePct)}% ♀`;
}

export function getPokemonFacts(pokemon: SeedPokemon): PokemonFact[] {
  const facts: PokemonFact[] = [];

  if (pokemon.height !== null) {
    facts.push({ label: "Height", value: heightComparison(pokemon.height) });
  }

  if (pokemon.weight !== null) {
    facts.push({ label: "Weight", value: weightComparison(pokemon.weight) });
  }

  if (pokemon.types.length > 0) {
    facts.push({ label: "Type", value: pokemon.types.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(" / ") });
  }

  if (pokemon.genus) {
    facts.push({ label: "Category", value: pokemon.genus });
  }

  if (pokemon.generation) {
    facts.push({ label: "Generation", value: GENERATION_LABELS[pokemon.generation] ?? titleCase(pokemon.generation) });
  }

  if (pokemon.captureRate !== null) {
    facts.push({ label: "Catch difficulty", value: catchDifficulty(pokemon.captureRate) });
  }

  if (pokemon.baseHappiness !== null) {
    facts.push({ label: "Base happiness", value: happinessTier(pokemon.baseHappiness) });
  }

  if (pokemon.growthRate) {
    facts.push({ label: "Growth rate", value: titleCase(pokemon.growthRate) });
  }

  if (pokemon.habitat) {
    facts.push({ label: "Habitat", value: titleCase(pokemon.habitat) });
  }

  if (pokemon.genderRate !== null) {
    facts.push({ label: "Gender", value: genderText(pokemon.genderRate) });
  }

  if (pokemon.baseExperience !== null) {
    facts.push({ label: "Base exp.", value: experienceTier(pokemon.baseExperience) });
  }

  const statEntries = Object.entries(pokemon.stats) as [string, number][];
  if (statEntries.length > 0) {
    const [topKey, topVal] = statEntries.reduce((a, b) => b[1] > a[1] ? b : a);
    facts.push({ label: "Strongest stat", value: `${STAT_DISPLAY_NAMES[topKey] ?? topKey} (${topVal})` });
  }

  if (pokemon.isLegendary) {
    facts.push({ label: "Status", value: "Legendary" });
  } else if (pokemon.isMythical) {
    facts.push({ label: "Status", value: "Mythical" });
  }

  // flavorTexts is lazy-loaded and absent on the runtime SEED_POKEMON objects.
  // Callers that want Pokédex entries should await loadFlavorTexts() first and
  // pass the entries explicitly, or rely on the component using getFlavorTexts().
  // Each entry is a { text, versions } object (post-#1559) or a plain string
  // (legacy; normalised to { text, versions: [] } via normaliseFlavorEntry).
  const rawEntries: Array<FlavorTextEntry | string> =
    pokemon.flavorTexts ?? getFlavorTexts(pokemon.id);
  for (const raw of rawEntries) {
    const entry = normaliseFlavorEntry(raw);
    const label = formatVersions(entry.versions) || "Pokédex entry";
    facts.push({ label, value: entry.text });
  }

  return facts;
}

export function selectFact(facts: PokemonFact[]): PokemonFact | null {
  if (facts.length === 0) return null;
  return facts[Math.floor(Math.random() * facts.length)];
}
