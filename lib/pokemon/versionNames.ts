/**
 * lib/pokemon/versionNames.ts
 *
 * Maps PokéAPI version slugs to English display names and release-order
 * ordinals. Game names are intentional English proper nouns across all
 * appLocales (see issue #1559 decision 1).
 *
 * `formatVersions(slugs)` is the single source of truth for the game-label
 * string shown in the Pokédex facts panel. It sorts by release order and
 * applies the up-to-3-then-+N rule (decision 2).
 */

export type VersionMeta = {
  /** Marketed English title (e.g. "FireRed", "Brilliant Diamond"). */
  display: string;
  /** Release ordinal for sorting — lower = earlier. */
  order: number;
};

/**
 * Static map of PokéAPI version slugs to display metadata.
 * Covers all mainline versions up to Gen IX that PokéAPI emits.
 * Unknown slugs fall back to a titleCase transform in `formatVersions`.
 */
export const VERSION_NAMES: Record<string, VersionMeta> = {
  // Gen I
  red:                 { display: "Red",              order: 1 },
  blue:                { display: "Blue",             order: 2 },
  yellow:              { display: "Yellow",           order: 3 },
  // Gen II
  gold:                { display: "Gold",             order: 4 },
  silver:              { display: "Silver",           order: 5 },
  crystal:             { display: "Crystal",          order: 6 },
  // Gen III
  ruby:                { display: "Ruby",             order: 7 },
  sapphire:            { display: "Sapphire",         order: 8 },
  firered:             { display: "FireRed",          order: 9 },
  leafgreen:           { display: "LeafGreen",        order: 10 },
  emerald:             { display: "Emerald",          order: 11 },
  // Gen IV
  diamond:             { display: "Diamond",          order: 12 },
  pearl:               { display: "Pearl",            order: 13 },
  platinum:            { display: "Platinum",         order: 14 },
  heartgold:           { display: "HeartGold",        order: 15 },
  soulsilver:          { display: "SoulSilver",       order: 16 },
  // Gen V
  black:               { display: "Black",            order: 17 },
  white:               { display: "White",            order: 18 },
  "black-2":           { display: "Black 2",          order: 19 },
  "white-2":           { display: "White 2",          order: 20 },
  // Gen VI
  x:                   { display: "X",                order: 21 },
  y:                   { display: "Y",                order: 22 },
  "omega-ruby":        { display: "Omega Ruby",       order: 23 },
  "alpha-sapphire":    { display: "Alpha Sapphire",   order: 24 },
  // Gen VII
  sun:                 { display: "Sun",              order: 25 },
  moon:                { display: "Moon",             order: 26 },
  "ultra-sun":         { display: "Ultra Sun",        order: 27 },
  "ultra-moon":        { display: "Ultra Moon",       order: 28 },
  "lets-go-pikachu":   { display: "Let's Go Pikachu", order: 29 },
  "lets-go-eevee":     { display: "Let's Go Eevee",   order: 30 },
  // Gen VIII
  sword:               { display: "Sword",            order: 31 },
  shield:              { display: "Shield",           order: 32 },
  "the-isle-of-armor": { display: "Isle of Armor",    order: 33 },
  "the-crown-tundra":  { display: "Crown Tundra",     order: 34 },
  "brilliant-diamond": { display: "Brilliant Diamond", order: 35 },
  "shining-pearl":     { display: "Shining Pearl",    order: 36 },
  "legends-arceus":    { display: "Legends: Arceus",  order: 37 },
  // Gen IX
  scarlet:             { display: "Scarlet",          order: 38 },
  violet:              { display: "Violet",           order: 39 },
  // Side games that PokéAPI occasionally includes in flavour-text entries
  colosseum:           { display: "Colosseum",        order: 40 },
  xd:                  { display: "XD",               order: 41 },
};

/** Max games shown before collapsing to "+N". */
const MAX_DISPLAY_VERSIONS = 3;

/**
 * Convert a kebab-case slug to Title Case as a fallback display name.
 * E.g. "unknown-game" → "Unknown Game".
 */
function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Format a list of PokéAPI version slugs into a human-readable game-label
 * string for the Pokédex facts panel.
 *
 * - Slugs are resolved to their display name (with `titleCase` fallback for
 *   unknown slugs, so future games never render blank).
 * - Results are sorted by release order (earlier games first).
 * - Up to 3 names are shown, joined with " · ".
 * - When more than 3 games share the same text, the first 3 are listed and
 *   the remainder collapsed to "+N" (e.g. "Red · Blue · Yellow +2").
 * - An empty input returns an empty string.
 *
 * Game names stay English proper nouns across all appLocales (decision 1,
 * issue #1559). They are added to the i18n-leak allowlist in
 * `scripts/i18n-leak-allowlist.ts` as intentional proper nouns.
 */
export function formatVersions(slugs: string[]): string {
  if (slugs.length === 0) return "";

  // Sort by release order, unknown slugs sort last.
  const sorted = [...slugs].sort((a, b) => {
    const orderA = VERSION_NAMES[a]?.order ?? Infinity;
    const orderB = VERSION_NAMES[b]?.order ?? Infinity;
    return orderA - orderB;
  });

  const displayed = sorted.slice(0, MAX_DISPLAY_VERSIONS);
  const overflow = sorted.length - MAX_DISPLAY_VERSIONS;

  const names = displayed.map(
    (slug) => VERSION_NAMES[slug]?.display ?? titleCase(slug),
  );

  if (overflow > 0) {
    return names.join(" · ") + ` +${overflow}`;
  }
  return names.join(" · ");
}
