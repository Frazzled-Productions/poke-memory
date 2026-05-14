/**
 * Card identity codec for the (card_type, subject_key) primary key.
 *
 * The DB schema (migration 010) replaces the packed integer pokemon_id with a
 * string discriminator pair:
 *   card_type   text  — one of the five CardType slugs below
 *   subject_key text  — type-specific opaque key
 *
 * For species cards (name / reverse / cry), subject_key is the Pokédex number
 * as a string: "1", "25", "1025".
 *
 * For edge cards (evolution-edge / reverse-evolution-edge), subject_key
 * encodes both endpoint species IDs separated by ">>>":
 *   "1>>>2"   (Bulbasaur → Ivysaur)
 *   "133>>>134" (Eevee → Vaporeon)
 *
 * The ">>>" separator is chosen because it does not appear in PokéAPI numeric
 * IDs (which are plain positive integers) and is not ambiguous when the key is
 * logged or stored as text.
 */

// DB card_type discriminator values.
export type CardType =
  | "name"
  | "reverse"
  | "cry"
  | "evolution-edge"
  | "reverse-evolution-edge";

export const CARD_TYPES: readonly CardType[] = [
  "name",
  "reverse",
  "cry",
  "evolution-edge",
  "reverse-evolution-edge",
] as const;

export function isValidCardType(value: string): value is CardType {
  return (CARD_TYPES as readonly string[]).includes(value);
}

// The ">>>" separator used in edge subject keys.
const EDGE_SEP = ">>>";

export const Subject = {
  /**
   * subject_key for a species card (name / reverse / cry).
   * Accepts a positive integer species ID and returns its decimal string.
   */
  forSpecies(pokemonId: number): string {
    if (!Number.isInteger(pokemonId) || pokemonId <= 0) {
      throw new Error(`Subject.forSpecies: expected positive integer, got ${pokemonId}`);
    }
    return String(pokemonId);
  },

  /**
   * subject_key for an evolution edge card.
   * Both IDs must be positive integers. Order matters: fromId is the
   * pre-evolution, toId is the post-evolution.
   */
  forEdge(fromId: number, toId: number): string {
    if (!Number.isInteger(fromId) || fromId <= 0) {
      throw new Error(`Subject.forEdge: fromId must be a positive integer, got ${fromId}`);
    }
    if (!Number.isInteger(toId) || toId <= 0) {
      throw new Error(`Subject.forEdge: toId must be a positive integer, got ${toId}`);
    }
    return `${fromId}${EDGE_SEP}${toId}`;
  },

  /**
   * Parses a subject_key produced by forSpecies and returns the species ID.
   * Throws if the key is not a valid positive integer.
   */
  parseSpecies(key: string): number {
    const n = Number(key);
    if (!Number.isInteger(n) || n <= 0 || String(n) !== key) {
      throw new Error(`Subject.parseSpecies: invalid species key "${key}"`);
    }
    return n;
  },

  /**
   * Parses a subject_key produced by forEdge and returns the {fromId, toId}
   * pair. Throws if the key does not match the expected format.
   */
  parseEdge(key: string): { fromId: number; toId: number } {
    const sepIdx = key.indexOf(EDGE_SEP);
    if (sepIdx === -1) {
      throw new Error(`Subject.parseEdge: missing separator "${EDGE_SEP}" in key "${key}"`);
    }
    const fromStr = key.slice(0, sepIdx);
    const toStr = key.slice(sepIdx + EDGE_SEP.length);
    const fromId = Number(fromStr);
    const toId = Number(toStr);
    if (!Number.isInteger(fromId) || fromId <= 0 || String(fromId) !== fromStr) {
      throw new Error(`Subject.parseEdge: invalid fromId in key "${key}"`);
    }
    if (!Number.isInteger(toId) || toId <= 0 || String(toId) !== toStr) {
      throw new Error(`Subject.parseEdge: invalid toId in key "${key}"`);
    }
    return { fromId, toId };
  },
};

/**
 * Maps the app-internal cardType slug to the DB card_type value.
 * The app uses "evolution" / "reverse-evolution" internally; the DB uses
 * "evolution-edge" / "reverse-evolution-edge" to avoid colliding with the
 * legacy per-pre-evo range.
 */
export function appTypeToDbType(
  cardType: "name" | "reverse" | "cry" | "evolution" | "reverse-evolution",
): CardType {
  if (cardType === "evolution") return "evolution-edge";
  if (cardType === "reverse-evolution") return "reverse-evolution-edge";
  return cardType;
}

/**
 * Maps a DB card_type value back to the app-internal cardType slug.
 * Returns null for unknown / unmapped types (e.g. a future type this client
 * doesn't understand yet).
 */
export function dbTypeToAppType(
  dbType: string,
): "name" | "reverse" | "cry" | "evolution" | "reverse-evolution" | null {
  switch (dbType) {
    case "name": return "name";
    case "reverse": return "reverse";
    case "cry": return "cry";
    case "evolution-edge": return "evolution";
    case "reverse-evolution-edge": return "reverse-evolution";
    default: return null;
  }
}
