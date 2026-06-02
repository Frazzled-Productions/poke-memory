import type { Grade } from "@/lib/srs/scheduler";
import type { AppLocale } from "@/i18n/locales";

const GRADE_EMOJI: Record<Grade, string> = {
  5: "🟦",
  4: "🟩",
  2: "🟨",
  1: "⬛",
};

/**
 * Locale endonyms for the non-English Pokémon-name locales. English is
 * unlabelled in the share text (it is the default and needs no qualifier).
 * Only the three locales that currently have enrolled-language support are
 * included; extend this map when new locales are added.
 */
const LOCALE_ENDONYM: Partial<Record<AppLocale, string>> = {
  ja: "日本語",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

export type DailySummaryParts = {
  /** Local date string (e.g. "2026-05-12"). */
  date: string;
  /** Current streak length (after today's reviews). */
  streak: number;
  /** Total grades recorded in this session. */
  reviewed: number;
  /** Cards introduced for the first time this session. */
  newCards: number;
  /** Cards that crossed the mastery threshold this session. */
  mastered: number;
  /** Ordered grade sequence — one emoji per square in the share grid. */
  gradeSequence: readonly Grade[];
  /**
   * Pokémon-name locale for this practice session (#1562). When non-English,
   * `formatDailySummary` appends the language endonym in parentheses so the
   * recipient knows which language was practised. English is unlabelled.
   * Omit (or set to "en") for the default English behaviour.
   */
  locale?: AppLocale;
};

/**
 * Format a Wordle-style daily summary. Plain text only, no Pokémon
 * names or sprites — spoiler-safe by design. Grid wraps every 20
 * squares so it stays readable in chat.
 *
 * For non-English sessions the mastered line is suffixed with the
 * language endonym in parentheses, e.g. "5 mastered (日本語)".
 */
export function formatDailySummary(parts: DailySummaryParts): string {
  const lines: string[] = [];
  lines.push(`poke-memory · ${parts.date}`);
  if (parts.streak > 0) {
    lines.push(`${parts.streak}-day streak 🔥`);
  }
  // Append the language endonym for non-English sessions. English needs no
  // qualifier — it is the implicit default.
  const endonym = parts.locale ? LOCALE_ENDONYM[parts.locale] : undefined;
  const masteredSuffix = endonym ? ` (${endonym})` : "";
  lines.push(
    `${parts.reviewed} reviewed · ${parts.newCards} new · ${parts.mastered} mastered${masteredSuffix}`,
  );
  const squares = parts.gradeSequence.map((g) => GRADE_EMOJI[g]);
  // Wrap grid every 20 squares (~Wordle width) so the text reads well
  // inside chat bubbles. Slice on the array, not the string — emoji are
  // surrogate pairs in JS strings, so `.slice(i, i+20)` on the joined
  // form would split codepoints in half.
  for (let i = 0; i < squares.length; i += 20) {
    lines.push(squares.slice(i, i + 20).join(""));
  }
  return lines.join("\n");
}
