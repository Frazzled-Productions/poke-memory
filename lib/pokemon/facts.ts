import type { SeedPokemon } from "@/lib/pokemon/seed";

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
  if (rate <= 15) return `Extremely rare (catch rate ${rate})`;
  if (rate <= 45) return `Rare (catch rate ${rate})`;
  if (rate <= 100) return `Uncommon (catch rate ${rate})`;
  if (rate <= 180) return `Somewhat common (catch rate ${rate})`;
  if (rate <= 220) return `Common (catch rate ${rate})`;
  return `Very common (catch rate ${rate})`;
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
    facts.push({ label: "Height", value: `${(pokemon.height / 10).toFixed(1)} m` });
  }

  if (pokemon.weight !== null) {
    facts.push({ label: "Weight", value: `${(pokemon.weight / 10).toFixed(1)} kg` });
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
    facts.push({ label: "Base happiness", value: String(pokemon.baseHappiness) });
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
    facts.push({ label: "Base exp.", value: String(pokemon.baseExperience) });
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

  for (const text of pokemon.flavorTexts) {
    facts.push({ label: "Pokédex entry", value: text });
  }

  return facts;
}

export function selectFact(facts: PokemonFact[]): PokemonFact | null {
  if (facts.length === 0) return null;
  return facts[Math.floor(Math.random() * facts.length)];
}
