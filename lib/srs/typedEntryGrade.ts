/**
 * Typed-entry grading helpers (#1251).
 *
 * Implements the input-normalisation and Levenshtein-based grade-mapping used
 * by TypedEntryNameCard. Exported as pure functions so they can be unit-tested
 * without any DOM or React dependencies.
 */

import type { Grade } from "@/lib/review/session";

/**
 * Normalise a user's typed answer before comparing it to the canonical name.
 *
 * Rules (applied in order):
 * 1. Trim leading/trailing whitespace.
 * 2. Lowercase.
 * 3. Remove all separators: ASCII punctuation (hyphens, periods, apostrophes,
 *    etc.) AND spaces. This makes "Porygon-Z", "porygon z", and "porygonz" all
 *    collapse to the same normalised form, so a user who types the name with a
 *    space instead of a hyphen is not penalised. Only ASCII punctuation and
 *    spaces are stripped - accented characters in Pokémon names (e.g. "Flabébé")
 *    are preserved.
 */
export function normaliseInput(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      // Fold typographic apostrophes (U+2018 LEFT / U+2019 RIGHT SINGLE QUOTATION
      // MARK) to ASCII apostrophe so "Farfetch’d" matches a typed "farfetch'd"
      // or "farfetchd" after the strip below (F10).
      .replace(/[‘’]/g, "'")
      // Strip gender symbols used in Nidoran♀/♂ names (F10).
      .replace(/[♀♂]/g, "")
      // Strip ASCII punctuation characters (., -, ', !, ?, : etc.) AND spaces so
      // separator variants ("Porygon-Z" / "porygon z" / "porygonz") all match.
      // eslint-disable-next-line no-useless-escape
      .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\s]/g, "")
  );
}

/**
 * Compute the Levenshtein edit-distance between two strings.
 *
 * Standard dynamic-programming implementation using a single rolling row.
 * O(m*n) time, O(min(m,n)) space. Both inputs are assumed already normalised
 * (lowercase, no punctuation).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep `b` as the column dimension; swap so the row (a) is the shorter string
  // to minimise allocation.
  if (a.length > b.length) return levenshtein(b, a);

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const curr: number[] = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      curr[j + 1] = Math.min(
        curr[j] + 1,        // insertion
        prev[j + 1] + 1,    // deletion
        prev[j] + cost,     // substitution
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Map a Levenshtein distance to an SRS grade.
 *
 * - distance 0 → Good (4)   exact match
 * - distance 1–2 → Hard (2) close but wrong
 * - distance > 2 → Again (1) too far off
 */
export function distanceToGrade(distance: number): Grade {
  if (distance === 0) return 4;
  if (distance <= 2) return 2;
  return 1;
}

/**
 * Grade a typed answer against the canonical species name.
 *
 * Both `input` and `canonicalName` are normalised internally, so callers may
 * pass raw values straight from the input field / seed data.
 *
 * Returns:
 * - `grade`: the SRS grade (1 = Again, 2 = Hard, 4 = Good)
 * - `distance`: the normalised edit distance (useful for feedback copy)
 */
export function gradeTypedAnswer(
  input: string,
  canonicalName: string,
): { grade: Grade; distance: number } {
  const normInput = normaliseInput(input);
  const normCanonical = normaliseInput(canonicalName);
  // Empty input (after normalisation) is treated as a skip - grade Again.
  if (normInput.length === 0) return { grade: 1, distance: normCanonical.length };
  const distance = levenshtein(normInput, normCanonical);
  return { grade: distanceToGrade(distance), distance };
}
