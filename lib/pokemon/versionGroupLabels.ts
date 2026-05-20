/**
 * Marketing labels for PokéAPI version-group slugs. The slug is the canonical
 * id stored in `SeedPokemon.versionGroups` and on `PracticeScope.games`; the
 * label is what the UI renders.
 *
 * Coverage: every version-group currently exposed by PokéAPI (32 entries at
 * the time of seeding). `lib/pokemon/versionGroupLabels.test.ts` enforces
 * that every version-group slug appearing in any `SeedPokemon.versionGroups`
 * has an entry here, so re-seeding cannot silently introduce an unlabeled
 * entry.
 *
 * Grouping is by generation (`VERSION_GROUP_GENERATION`). The scope picker
 * uses this to render an accordion of games per generation. Spin-offs and
 * Japan-only releases that don't fit a mainline generation are bucketed into
 * `0` so they sort first / can be hidden.
 *
 * Display order is controlled by `VERSION_GROUP_ORDER` rather than alphabetic
 * sort: within a generation we list games in release order so the picker
 * reads as a familiar timeline.
 */

export const VERSION_GROUP_LABELS: Record<string, string> = {
  // Gen I
  "red-blue": "Pokémon Red/Blue",
  yellow: "Pokémon Yellow",
  "red-green-japan": "Pokémon Red/Green (Japan)",
  "blue-japan": "Pokémon Blue (Japan)",
  // Gen II
  "gold-silver": "Pokémon Gold/Silver",
  crystal: "Pokémon Crystal",
  // Gen III
  "ruby-sapphire": "Pokémon Ruby/Sapphire",
  emerald: "Pokémon Emerald",
  "firered-leafgreen": "Pokémon FireRed/LeafGreen",
  colosseum: "Pokémon Colosseum",
  xd: "Pokémon XD: Gale of Darkness",
  // Gen IV
  "diamond-pearl": "Pokémon Diamond/Pearl",
  platinum: "Pokémon Platinum",
  "heartgold-soulsilver": "Pokémon HeartGold/SoulSilver",
  // Gen V
  "black-white": "Pokémon Black/White",
  "black-2-white-2": "Pokémon Black 2/White 2",
  // Gen VI
  "x-y": "Pokémon X/Y",
  "omega-ruby-alpha-sapphire": "Pokémon Omega Ruby/Alpha Sapphire",
  // Gen VII
  "sun-moon": "Pokémon Sun/Moon",
  "ultra-sun-ultra-moon": "Pokémon Ultra Sun/Ultra Moon",
  "lets-go-pikachu-lets-go-eevee": "Pokémon Let's Go Pikachu/Eevee",
  // Gen VIII
  "sword-shield": "Pokémon Sword/Shield",
  "the-isle-of-armor": "Sword/Shield: The Isle of Armor",
  "the-crown-tundra": "Sword/Shield: The Crown Tundra",
  "brilliant-diamond-shining-pearl": "Pokémon Brilliant Diamond/Shining Pearl",
  "legends-arceus": "Pokémon Legends: Arceus",
  // Gen IX
  "scarlet-violet": "Pokémon Scarlet/Violet",
  "the-teal-mask": "Scarlet/Violet: The Teal Mask",
  "the-indigo-disk": "Scarlet/Violet: The Indigo Disk",
  "legends-za": "Pokémon Legends: Z-A",
  // Other / spin-off
  "mega-dimension": "Mega Dimension",
  champions: "Pokémon Champions",
};

/**
 * Generation grouping. `0` is a catch-all for entries that don't slot into a
 * mainline generation (Japan-only releases, spin-offs). The picker sorts
 * generations ascending; entries in group `0` render under an "Other" header.
 */
export const VERSION_GROUP_GENERATION: Record<string, number> = {
  "red-blue": 1,
  yellow: 1,
  "red-green-japan": 1,
  "blue-japan": 1,
  "gold-silver": 2,
  crystal: 2,
  "ruby-sapphire": 3,
  emerald: 3,
  "firered-leafgreen": 3,
  colosseum: 3,
  xd: 3,
  "diamond-pearl": 4,
  platinum: 4,
  "heartgold-soulsilver": 4,
  "black-white": 5,
  "black-2-white-2": 5,
  "x-y": 6,
  "omega-ruby-alpha-sapphire": 6,
  "sun-moon": 7,
  "ultra-sun-ultra-moon": 7,
  "lets-go-pikachu-lets-go-eevee": 7,
  "sword-shield": 8,
  "the-isle-of-armor": 8,
  "the-crown-tundra": 8,
  "brilliant-diamond-shining-pearl": 8,
  "legends-arceus": 8,
  "scarlet-violet": 9,
  "the-teal-mask": 9,
  "the-indigo-disk": 9,
  "legends-za": 9,
  "mega-dimension": 0,
  champions: 0,
};

/**
 * Display order within each generation (release order). Lower index = earlier.
 * Used by the picker to render games as a timeline within their generation
 * group. Any slug not listed here falls to the end (alphabetic) of its
 * generation bucket.
 */
export const VERSION_GROUP_ORDER: string[] = [
  // Gen I
  "red-green-japan",
  "blue-japan",
  "red-blue",
  "yellow",
  // Gen II
  "gold-silver",
  "crystal",
  // Gen III
  "ruby-sapphire",
  "emerald",
  "firered-leafgreen",
  "colosseum",
  "xd",
  // Gen IV
  "diamond-pearl",
  "platinum",
  "heartgold-soulsilver",
  // Gen V
  "black-white",
  "black-2-white-2",
  // Gen VI
  "x-y",
  "omega-ruby-alpha-sapphire",
  // Gen VII
  "sun-moon",
  "ultra-sun-ultra-moon",
  "lets-go-pikachu-lets-go-eevee",
  // Gen VIII
  "sword-shield",
  "the-isle-of-armor",
  "the-crown-tundra",
  "brilliant-diamond-shining-pearl",
  "legends-arceus",
  // Gen IX
  "scarlet-violet",
  "the-teal-mask",
  "the-indigo-disk",
  "legends-za",
  // Other / spin-off
  "mega-dimension",
  "champions",
];

/** Lookup helper. Returns the marketing label, or the slug itself as fallback. */
export function versionGroupLabel(slug: string): string {
  return VERSION_GROUP_LABELS[slug] ?? slug;
}

/** Lookup helper. Returns the generation bucket (0 = other / spin-off). */
export function versionGroupGeneration(slug: string): number {
  return VERSION_GROUP_GENERATION[slug] ?? 0;
}

/**
 * Sort comparator used by the scope picker. Groups by generation ascending,
 * then by `VERSION_GROUP_ORDER` index ascending. Unknown entries sort to the
 * end of their generation alphabetically.
 */
export function compareVersionGroupSlugs(a: string, b: string): number {
  const genA = versionGroupGeneration(a);
  const genB = versionGroupGeneration(b);
  if (genA !== genB) return genA - genB;
  const orderA = VERSION_GROUP_ORDER.indexOf(a);
  const orderB = VERSION_GROUP_ORDER.indexOf(b);
  if (orderA !== -1 && orderB !== -1) return orderA - orderB;
  if (orderA !== -1) return -1;
  if (orderB !== -1) return 1;
  return a.localeCompare(b);
}
