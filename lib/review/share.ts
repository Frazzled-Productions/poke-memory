import type { Grade } from "@/lib/srs/scheduler";

const GRADE_EMOJI: Record<Grade, string> = {
  5: "🟦",
  4: "🟩",
  2: "🟨",
  1: "⬛",
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
};

/**
 * Format a Wordle-style daily summary. Plain text only, no Pokémon
 * names or sprites — spoiler-safe by design. Grid wraps every 20
 * squares so it stays readable in chat.
 */
export function formatDailySummary(parts: DailySummaryParts): string {
  const lines: string[] = [];
  lines.push(`poke-memory · ${parts.date}`);
  if (parts.streak > 0) {
    lines.push(`${parts.streak}-day streak 🔥`);
  }
  lines.push(
    `${parts.reviewed} reviewed · ${parts.newCards} new · ${parts.mastered} mastered`,
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
