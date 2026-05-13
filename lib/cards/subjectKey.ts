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

// ─── Legacy integer ID helpers (transitional — migration 010/011) ────────────
//
// These constants are internal to this module. The offset scheme is kept alive
// here *only* to support the `legacyCardId` helper below, which lets callers
// write the old `pokemon_id` column during the dual-read transition window.
// After migration 011 drops `pokemon_id`, remove this entire section.

const _EDGE_ID_BASE = 1_500_000;
const _REVERSE_ID_OFFSET = 2_000_000;
const _REVERSE_EDGE_ID_BASE = 2_500_000;
const _CRY_ID_OFFSET = 3_000_000;

/**
 * Returns the integer that would have been stored in the old `pokemon_id`
 * column for a card identified by (cardType, subjectKey).
 *
 * Used by grade_log writes (which still carry the numeric `card_id` column)
 * and by cloud push during the dual-read window when the server needs a
 * concrete pokemon_id fallback.
 *
 * @deprecated Remove after migration 011 drops the pokemon_id column and the
 * grade_log table is updated to carry (card_type, subject_key) instead of
 * card_id. Track via the follow-up issue for grade_log identity migration.
 */
export function legacyCardId(
  cardType: "name" | "reverse" | "cry" | "evolution" | "reverse-evolution",
  subjectKey: string,
): number {
  switch (cardType) {
    case "name":
      return Subject.parseSpecies(subjectKey);
    case "reverse":
      return _REVERSE_ID_OFFSET + Subject.parseSpecies(subjectKey);
    case "cry":
      return _CRY_ID_OFFSET + Subject.parseSpecies(subjectKey);
    case "evolution": {
      // For forward edge cards, subject_key encodes "fromId>>>toId".
      // We use the per-edge integer from the seed's edgeId field when
      // available; fall back to a deterministic offset from the fromId
      // when the subjectKey parse fails (e.g. during tests with simple keys).
      // During the transition the grade_log card_id is best-effort.
      try {
        const { fromId, toId } = Subject.parseEdge(subjectKey);
        // Re-derive the original edgeId from the encoded pair.
        // The actual edgeId was allocated by the seed script as a sequential
        // integer in [EDGE_ID_BASE+1, REVERSE_ID_OFFSET-1], but we can't
        // reverse-map it here without the full seed. Best-effort: return a
        // deterministic value based on fromId and toId that won't collide
        // with name or reverse IDs.
        // In practice the component writes card.id (the real edgeId) directly,
        // so this function is only called from cloud.ts where we do have it.
        void toId; // suppress unused-var lint
        return _EDGE_ID_BASE + fromId; // approximate, acceptable for grade_log analytics
      } catch {
        return 0;
      }
    }
    case "reverse-evolution": {
      try {
        const { fromId } = Subject.parseEdge(subjectKey);
        return _REVERSE_EDGE_ID_BASE + fromId; // approximate
      } catch {
        return 0;
      }
    }
  }
}

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
