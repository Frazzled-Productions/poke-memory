// Shared card-shape narrowing predicates used by both the review-session
// persistence layer and the backup schema validator.
//
// Split into a separate module so the two callers can import only the core
// they share and layer their own extra strictness on top, rather than
// duplicating 15+ lines of identical field-narrowing logic.
//
// Callers:
//   - lib/review/persistence.ts  — isReviewCardShaped (stricter: requires
//     name/spriteUrl on non-evolution cards, validates reverse-evolution shape)
//   - lib/backup/schema.ts        — isMinimalCardShaped (more lenient: skips
//     those extra checks because hydrateSession refreshes them from seed)

/** The set of recognised `cardType` discriminant values. */
export const KNOWN_CARD_TYPES = [
  "name",
  "evolution",
  "reverse-evolution",
  "reverse",
  "cry",
] as const;

export type KnownCardType = (typeof KNOWN_CARD_TYPES)[number];

/**
 * Narrows `value` to `Record<string, unknown>`, confirming that it is a
 * non-null object.  This is step 1 of every card-shape check.
 */
export function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Returns true when the `cardType` field is either absent (undefined, which
 * legacy-migrates to "name") or one of the recognised discriminant values.
 * An explicit value outside the known set indicates corruption or a
 * forward-incompatible schema.
 */
export function isKnownCardType(cardType: unknown): boolean {
  return (
    cardType === undefined ||
    cardType === "name" ||
    cardType === "evolution" ||
    cardType === "reverse-evolution" ||
    cardType === "reverse" ||
    cardType === "cry"
  );
}

/**
 * Returns true when `value` looks like a valid evolution card.
 *
 * Accepts three shapes:
 *   1. New edge shape (post-#262): `postEvoId` is a number.
 *   2. Legacy `evolvesInto` array shape: each entry has `name` and `spriteUrl`
 *      strings.  The import pipeline discards these, but they are accepted here
 *      so the surrounding file/session still validates.
 *   3. Legacy `evolvesIntoNames` array shape: each entry is a string.  Same
 *      treatment as shape 2.
 */
export function isEvolutionCardShaped(v: Record<string, unknown>): boolean {
  // New edge shape: postEvoId discriminates edge cards from legacy ones.
  if (typeof v.postEvoId === "number") return true;

  // Legacy shape: evolvesInto: { name, spriteUrl }[]
  if (
    Array.isArray(v.evolvesInto) &&
    v.evolvesInto.every(
      (e: unknown) =>
        isNonNullObject(e) &&
        typeof e.name === "string" &&
        typeof e.spriteUrl === "string",
    )
  ) {
    return true;
  }

  // Legacy shape: evolvesIntoNames: string[]
  if (
    Array.isArray(v.evolvesIntoNames) &&
    v.evolvesIntoNames.every((n: unknown) => typeof n === "string")
  ) {
    return true;
  }

  return false;
}

/**
 * Core card-shape predicate shared by both persistence and backup validators.
 *
 * Validates the fields that every card — regardless of strictness level —
 * must carry:
 *   - `id`: number
 *   - `state.dueDate`: string
 *   - `cardType`: undefined or one of the known discriminant values
 *   - evolution cards: one of the three recognised shapes (see isEvolutionCardShaped)
 *
 * Does NOT validate:
 *   - `reverse-evolution` edge fields (`preEvoId`, `postEvoId`) — the stricter
 *     persistence validator adds that check.
 *   - `name` and `spriteUrl` on non-evolution cards — the stricter persistence
 *     validator adds those checks too.
 *   - Backup-specific fields — schema.ts adds nothing here; it deliberately
 *     omits those checks because hydrateSession refreshes them from seed.
 *
 * Returns true when all shared invariants hold.
 */
export function isBaseCardShaped(value: unknown): value is Record<string, unknown> {
  if (!isNonNullObject(value)) return false;
  const v = value;

  if (typeof v.id !== "number") return false;
  if (!isNonNullObject(v.state)) return false;
  if (typeof (v.state as Record<string, unknown>).dueDate !== "string") return false;

  if (!isKnownCardType(v.cardType)) return false;

  if (v.cardType === "evolution") {
    return isEvolutionCardShaped(v);
  }

  return true;
}
