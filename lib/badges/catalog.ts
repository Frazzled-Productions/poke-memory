/**
 * Gym badges (#420). Awarded when a user has mastered every species in
 * the badge's `speciesIds` list. Secret until earned - there is no UI
 * surface that hints at any badge before it is unlocked.
 *
 * The catalog ships as code (not data fetched at runtime). IDs are
 * immutable once shipped - changing an existing id re-awards the badge
 * to existing earners on their next badge check. New badges are added
 * by appending entries; users earn them the moment they meet the
 * criterion after the new build deploys.
 *
 * Mastery here means name-card mastery: `stability >= MASTERY_STABILITY_DAYS`
 * on the species' name card. Other card directions
 * (evolution, reverse, cry) do not contribute. The species ID is the
 * raw PokéAPI species id (1..1025), which is also the name-card id.
 */

import { badgeArtworkSrc } from "./artwork";

export type BadgeCriterion = {
  kind: "all-mastered";
  speciesIds: readonly number[];
};

export type BadgeDefinition = {
  /** Stable kebab-case identifier. Immutable once a release ships it. */
  id: string;
  name: string;
  description: string;
  /**
   * Short teaser shown when the badge is locked. Evocative but non-spoiler -
   * hints at the theme without revealing the exact mastery criterion.
   */
  lockedHint: string;
  criterion: BadgeCriterion;
  /**
   * Public path to the badge's 8-bit pixel-art medallion PNG (#831). Always
   * derived from `id` via `badgeArtworkSrc` so the filename convention lives
   * in one place - see `lib/badges/artwork.ts` and `tools/art/README.md`.
   */
  artwork: string;
};

export const BADGE_CATALOG: readonly BadgeDefinition[] = [
  // Kanto gym leader rosters - anime-iconic pairs rather than full
  // game-canon 6-Pokémon teams. Two Pokémon is enough for a satisfying
  // reveal and keeps the early badges achievable.
  {
    id: "boulder-badge",
    name: "Boulder Badge",
    description: "You've mastered Brock's roster.",
    lockedHint: "A Kanto gym leader's rocky roster…",
    criterion: { kind: "all-mastered", speciesIds: [74, 95] },
    artwork: badgeArtworkSrc("boulder-badge"),
  },
  {
    id: "cascade-badge",
    name: "Cascade Badge",
    description: "You've mastered Misty's roster.",
    lockedHint: "A Cerulean gym leader favours the sea…",
    criterion: { kind: "all-mastered", speciesIds: [120, 121] },
    artwork: badgeArtworkSrc("cascade-badge"),
  },
  {
    id: "thunder-badge",
    name: "Thunder Badge",
    description: "You've mastered Lt. Surge's electric roster.",
    lockedHint: "A Vermilion commander sparks with voltage…",
    criterion: { kind: "all-mastered", speciesIds: [26, 100] },
    artwork: badgeArtworkSrc("thunder-badge"),
  },
  {
    id: "rainbow-badge",
    name: "Rainbow Badge",
    description: "You've mastered Erika's grass roster.",
    lockedHint: "A Celadon gym leader tends her garden…",
    criterion: { kind: "all-mastered", speciesIds: [70, 71] },
    artwork: badgeArtworkSrc("rainbow-badge"),
  },
  {
    id: "soul-badge",
    name: "Soul Badge",
    description: "You've mastered Koga's poison roster.",
    lockedHint: "A Fuchsia ninja deals in hidden toxins…",
    criterion: { kind: "all-mastered", speciesIds: [49, 110] },
    artwork: badgeArtworkSrc("soul-badge"),
  },
  {
    id: "marsh-badge",
    name: "Marsh Badge",
    description: "You've mastered Sabrina's psychic roster.",
    lockedHint: "A Saffron psychic bends minds and matter…",
    criterion: { kind: "all-mastered", speciesIds: [63, 65] },
    artwork: badgeArtworkSrc("marsh-badge"),
  },
  {
    id: "volcano-badge",
    name: "Volcano Badge",
    description: "You've mastered Blaine's fire roster.",
    lockedHint: "A Cinnabar island quiz master commands fire…",
    criterion: { kind: "all-mastered", speciesIds: [59, 78] },
    artwork: badgeArtworkSrc("volcano-badge"),
  },
  {
    id: "earth-badge",
    name: "Earth Badge",
    description: "You've mastered Giovanni's ground roster.",
    lockedHint: "A Viridian leader of shadowy reputation…",
    criterion: { kind: "all-mastered", speciesIds: [76, 112] },
    artwork: badgeArtworkSrc("earth-badge"),
  },

  // Themed groupings - fan-favourites that span generations.
  {
    id: "kanto-starters",
    name: "Kanto Starters",
    description: "Bulbasaur, Charmander, Squirtle and their final evolutions.",
    lockedHint: "Three Kanto partners and the paths they grow into…",
    criterion: { kind: "all-mastered", speciesIds: [1, 3, 4, 6, 7, 9] },
    artwork: badgeArtworkSrc("kanto-starters"),
  },
  {
    id: "johto-starters",
    name: "Johto Starters",
    description: "Chikorita, Cyndaquil, Totodile and their final evolutions.",
    lockedHint: "Three Johto companions and their final forms…",
    criterion: {
      kind: "all-mastered",
      speciesIds: [152, 154, 155, 157, 158, 160],
    },
    artwork: badgeArtworkSrc("johto-starters"),
  },
  {
    id: "hoenn-starters",
    name: "Hoenn Starters",
    description: "Treecko, Torchic, Mudkip and their final evolutions.",
    lockedHint: "Three Hoenn beginnings and where they lead…",
    criterion: {
      kind: "all-mastered",
      speciesIds: [252, 254, 255, 257, 258, 260],
    },
    artwork: badgeArtworkSrc("hoenn-starters"),
  },
  {
    id: "sinnoh-starters",
    name: "Sinnoh Starters",
    description: "Turtwig, Chimchar, Piplup and their final evolutions.",
    lockedHint: "Three Sinnoh starters and their evolved destinies…",
    criterion: {
      kind: "all-mastered",
      speciesIds: [387, 389, 390, 392, 393, 395],
    },
    artwork: badgeArtworkSrc("sinnoh-starters"),
  },
  {
    id: "galar-starters",
    name: "Galar Starters",
    description: "Grookey, Scorbunny, Sobble and their final evolutions.",
    lockedHint: "Three Galar rivals and the champions they become…",
    criterion: {
      kind: "all-mastered",
      speciesIds: [810, 812, 813, 815, 816, 818],
    },
    artwork: badgeArtworkSrc("galar-starters"),
  },
  {
    id: "legendary-birds",
    name: "Legendary Birds",
    description: "Articuno, Zapdos, and Moltres.",
    lockedHint: "Three legendary wings soar above Kanto…",
    criterion: { kind: "all-mastered", speciesIds: [144, 145, 146] },
    artwork: badgeArtworkSrc("legendary-birds"),
  },
  {
    id: "legendary-beasts",
    name: "Legendary Beasts",
    description: "Raikou, Entei, and Suicune.",
    lockedHint: "Three sacred beasts roam the Johto wilds…",
    criterion: { kind: "all-mastered", speciesIds: [243, 244, 245] },
    artwork: badgeArtworkSrc("legendary-beasts"),
  },
  {
    id: "lake-trio",
    name: "Lake Trio",
    description: "Uxie, Mesprit, and Azelf - the lake guardians of Sinnoh.",
    lockedHint: "Three spirits dwell in Sinnoh's still waters…",
    criterion: { kind: "all-mastered", speciesIds: [480, 481, 482] },
    artwork: badgeArtworkSrc("lake-trio"),
  },
  {
    id: "eeveelutions",
    name: "Eeveelutions",
    description: "Eevee and all eight of its evolutions.",
    lockedHint: "One adaptable Pokémon and the many paths it can take…",
    criterion: {
      kind: "all-mastered",
      speciesIds: [133, 134, 135, 136, 196, 197, 470, 471, 700],
    },
    artwork: badgeArtworkSrc("eeveelutions"),
  },
];
