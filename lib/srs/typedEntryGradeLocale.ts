/**
 * Locale-aware typed-entry grading (#1576).
 *
 * Extends the typed-entry engine (#1251) to non-English learning languages
 * (ja, zh-Hans, zh-Hant). The English path delegates byte-for-byte to the
 * existing `gradeTypedAnswer` - the regression guarantee asserted by the
 * fitness test in `typedEntryGradeLocale.test.ts`.
 *
 * For ja/zh the primary comparison is the user's input against the
 * native-script name for the active locale (from `getLocaleName`). In
 * lenient mode the pre-baked transliteration (rōmaji / pinyin, from
 * `getTransliteration`) is also accepted, tone-, spacing- and
 * case-insensitively. No runtime transliteration library is involved:
 * every accepted string is pre-baked in the locale-names sidecar
 * (`wanakana` / `pinyin-pro` stay devDependencies, seed-time only).
 *
 * Pure functions only - no DOM, no fetch, no React.
 */

import type { Grade } from "@/lib/review/session";
import {
  distanceToGrade,
  gradeTypedAnswer,
  levenshtein,
} from "@/lib/srs/typedEntryGrade";

/** Locales typed entry can grade against. Mirrors `AppLocale`. */
export type TypedEntryLocale = "en" | "ja" | "zh-Hans" | "zh-Hant";

/**
 * Grading strictness for non-English typed entry (#1576, maintainer
 * decision on #1561 option B).
 *
 * - `"lenient"` (default): native script OR the pre-baked romanisation
 *   (rōmaji / pinyin) is accepted; romanisation matching is tone-,
 *   spacing- and case-insensitive.
 * - `"strict"`: native script only - romanised input is not compared,
 *   so `pikachu` against `ピカチュウ` grades Again.
 *
 * The English path ignores this value entirely (it delegates to
 * `gradeTypedAnswer` unchanged).
 */
export type TypedEntryStrictness = "strict" | "lenient";

/** Resolved per-card answer data, sourced from the locale-names sidecar. */
export type TypedEntryLocaleAnswer = {
  /** The active learning locale for this card. */
  locale: TypedEntryLocale;
  /**
   * The canonical name in `locale`'s script (`getLocaleName`). For
   * `locale === "en"` this is the English display name.
   */
  nativeName: string;
  /**
   * The pre-baked romanisation (`getTransliteration`): Hepburn rōmaji for
   * ja, tone-marked pinyin for zh. Undefined for `en` or when the sidecar
   * has no entry - lenient mode then falls back to native-only matching.
   */
  transliteration?: string;
};

/**
 * Normalise a string for native-script CJK comparison.
 *
 * Rules (applied in order):
 * 1. Trim.
 * 2. Unicode NFKC - folds full-width punctuation and Latin (`！` → `!`,
 *    `Ｚ` → `Z`), half-width katakana (`ﾋﾟ` → `ピ`), and CJK compatibility
 *    ideographs (e.g. U+FA19 → U+795E), which is the agreed Hans/Hant
 *    compatibility-form folding for lenient zh (#1576 decision 3). Genuine
 *    simplified↔traditional variant pairs (e.g. 种/種) are distinct code
 *    points that NFKC does not fold; they land in the Levenshtein near-miss
 *    band instead of hard-failing.
 * 3. Lowercase (no-op for CJK; normalises any Latin NFKC produced).
 * 4. Strip punctuation, symbols, and whitespace - ASCII and CJK alike
 *    (`、。・「」`, gender symbols, spaces incl. U+3000). The katakana
 *    prolonged sound mark `ー` is a Letter, not punctuation, and is kept.
 * 5. For `ja`: fold katakana to hiragana (pure code-point shift) so a
 *    learner typing either kana form via IME matches katakana seed names.
 */
export function normaliseCjkInput(input: string, locale: TypedEntryLocale): string {
  let s = input
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, "");
  if (locale === "ja") {
    // Katakana (ァ..ヶ) → hiragana: shift down by 0x60. NFKC has already
    // folded half-width katakana to full-width, so the range covers all input.
    s = s.replace(/[ァ-ヶ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60),
    );
  }
  return s;
}

/**
 * Normalise a string for romanisation (rōmaji / pinyin) comparison.
 *
 * Tone-insensitive: NFD decomposition + combining-mark removal strips pinyin
 * tone diacritics (`miào wā zhǒng zǐ` → `miaowazhongzi`) - tone marks are
 * never required of the learner. Spacing- and case-insensitive via the same
 * strip/lowercase rules as the native normaliser.
 */
export function normaliseRomanisation(input: string): string {
  return input
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

/** Compare two already-normalised strings and map to a grade. */
function gradeNormalised(
  input: string,
  answer: string,
): { grade: Grade; distance: number } {
  const distance = levenshtein(input, answer);
  return { grade: distanceToGrade(distance), distance };
}

/**
 * Grade a typed answer against the active learning locale's name (#1576).
 *
 * - `locale === "en"`: delegates unchanged to `gradeTypedAnswer` - the
 *   English path is byte-for-byte identical to the pre-#1576 engine and
 *   `mode` is ignored.
 * - ja / zh: the input is compared against the native-script `nativeName`
 *   (both sides through `normaliseCjkInput`). In `"lenient"` mode the input
 *   is additionally compared against the pre-baked `transliteration` (both
 *   sides through `normaliseRomanisation`) and the better of the two grades
 *   wins. In `"strict"` mode romanisation is never consulted.
 *
 * The distance→grade band is unchanged from English typed entry:
 * 0 → Good (4), 1-2 → Hard (2), >2 → Again (1).
 *
 * Returns the grade plus the edit distance of the winning comparison
 * (useful for feedback copy).
 */
export function gradeTypedAnswerLocale(
  input: string,
  answer: TypedEntryLocaleAnswer,
  mode: TypedEntryStrictness = "lenient",
): { grade: Grade; distance: number } {
  if (answer.locale === "en") {
    return gradeTypedAnswer(input, answer.nativeName);
  }

  const normNative = normaliseCjkInput(answer.nativeName, answer.locale);
  const normInput = normaliseCjkInput(input, answer.locale);

  // Empty input (after normalisation) is a skip - grade Again, mirroring
  // the English engine's behaviour.
  if (normInput.length === 0 && normaliseRomanisation(input).length === 0) {
    return { grade: 1, distance: normNative.length };
  }

  const native = gradeNormalised(normInput, normNative);

  if (mode === "strict" || !answer.transliteration) {
    return native;
  }

  const romanised = gradeNormalised(
    normaliseRomanisation(input),
    normaliseRomanisation(answer.transliteration),
  );

  // Take the better of the two comparisons: higher grade wins; on a grade
  // tie, the smaller distance (for more accurate feedback copy).
  if (
    romanised.grade > native.grade ||
    (romanised.grade === native.grade && romanised.distance < native.distance)
  ) {
    return romanised;
  }
  return native;
}
