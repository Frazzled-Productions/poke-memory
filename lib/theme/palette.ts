import { CURATED_POKEMON, type ThemeColors } from "./curated-pokemon";
import { TYPE_PALETTES } from "./type-palettes";
import generated from "./generated-palettes.json";

/**
 * One entry per species in `generated-palettes.json` (written by
 * `npm run seed:palettes`): the four colours extracted from its sprite
 * (`[primary, secondary, accent, fgOnPrimary]`) when they pass the contrast
 * checks, otherwise the name of its primary type.
 */
export type GeneratedPaletteEntry = readonly [string, string, string, string] | string;

// JSON arrays type as string[]; the coverage test pins every array to four colours.
const GENERATED = generated as unknown as Readonly<Record<string, GeneratedPaletteEntry>>;

/**
 * The theme palette for a species (#2187), in this order: its
 * `CURATED_POKEMON` entry, else its generated sprite palette, else its primary
 * type's palette. Null for an id that is not a species in the palettes file.
 */
export function paletteFor(id: number): ThemeColors | null {
  const curated = CURATED_POKEMON.find((p) => p.id === id);
  if (curated) return curated.colors;
  const entry = GENERATED[String(id)];
  if (entry === undefined) return null;
  if (typeof entry === "string") return TYPE_PALETTES[entry] ?? null;
  const [primary, secondary, accent, fgOnPrimary] = entry;
  return { primary, secondary, accent, fgOnPrimary };
}
