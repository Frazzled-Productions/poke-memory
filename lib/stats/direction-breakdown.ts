import type { Grade } from "@/lib/srs/scheduler";
import type { GradeLog, GradeLogEntry } from "@/lib/gradelog/persistence";

/**
 * Card directions tracked in the grade log. Mirrors `GradeLogEntry.cardType`.
 */
export type CardDirection = GradeLogEntry["cardType"];

/** Display-ordered list of card directions for the breakdown chart. */
export const CARD_DIRECTIONS: readonly CardDirection[] = [
  "name",
  "reverse",
  "cry",
  "evolution",
  "reverse-evolution",
] as const;

/** Human-readable label for each card direction (British English copy). */
export const DIRECTION_LABELS: Record<CardDirection, string> = {
  name: "Name",
  reverse: "Reverse",
  cry: "Cry",
  evolution: "Evolution",
  "reverse-evolution": "Reverse evolution",
};

const PASS_GRADES: ReadonlySet<Grade> = new Set([4, 5]);

/**
 * One row of the per-direction breakdown.
 * `accuracy` is `null` when the direction has zero recorded reviews so the
 * UI can render a gap rather than a misleading 0%.
 * `disabled` is `true` when the direction is currently turned off in Settings
 * (only set when `enabledDirections` is passed to `computeDirectionBreakdown`).
 */
export type DirectionBreakdownRow = {
  direction: CardDirection;
  total: number;
  passes: number;
  accuracy: number | null; // passes / total, or null when total === 0
  disabled: boolean;
};

/**
 * Derive review counts and accuracy split by card direction from the
 * grade log. Pure — no I/O.
 *
 * This derives from review *history* (`grade_log`), not mastery state, so it
 * is intentionally NOT affected by the `pretendAllMastered` superuser flag.
 *
 * When `enabledDirections` is supplied (a set of directions the user has
 * switched on in Settings), each row is annotated with `disabled: true` when
 * that direction is currently switched off. Directions with zero reviews are
 * still included so callers can decide whether to show or hide them.
 *
 * If `enabledDirections` is omitted, `disabled` defaults to `false` for every
 * row — backwards-compatible with callers that do not read Settings.
 */
export function computeDirectionBreakdown(
  log: GradeLog,
  enabledDirections?: ReadonlySet<CardDirection>,
): DirectionBreakdownRow[] {
  const tallies = new Map<CardDirection, { total: number; passes: number }>();
  for (const direction of CARD_DIRECTIONS) {
    tallies.set(direction, { total: 0, passes: 0 });
  }

  for (const entry of log) {
    const t = tallies.get(entry.cardType);
    // Defensive: an unknown cardType from a future schema is simply skipped.
    if (t === undefined) continue;
    t.total++;
    if (PASS_GRADES.has(entry.grade)) t.passes++;
  }

  return CARD_DIRECTIONS.map((direction) => {
    const t = tallies.get(direction)!;
    return {
      direction,
      total: t.total,
      passes: t.passes,
      accuracy: t.total === 0 ? null : t.passes / t.total,
      disabled: enabledDirections !== undefined && !enabledDirections.has(direction),
    };
  });
}

/**
 * Build the set of enabled card directions from the card-type flags in
 * UserSettings. Extracted here so the Stats page and unit tests can share the
 * same mapping without importing the full settings module.
 */
export function enabledDirectionsFromSettings(settings: {
  nameCardsEnabled: boolean;
  evolutionCardsEnabled: boolean;
  reverseEvolutionCardsEnabled: boolean;
  reverseCardsEnabled: boolean;
  cryCardsEnabled: boolean;
}): ReadonlySet<CardDirection> {
  const enabled = new Set<CardDirection>();
  if (settings.nameCardsEnabled) enabled.add("name");
  if (settings.evolutionCardsEnabled) enabled.add("evolution");
  if (settings.reverseEvolutionCardsEnabled) enabled.add("reverse-evolution");
  if (settings.reverseCardsEnabled) enabled.add("reverse");
  if (settings.cryCardsEnabled) enabled.add("cry");
  return enabled;
}

/** Total reviews across every direction. Handy for empty-state checks. */
export function totalDirectionReviews(rows: readonly DirectionBreakdownRow[]): number {
  return rows.reduce((sum, row) => sum + row.total, 0);
}
