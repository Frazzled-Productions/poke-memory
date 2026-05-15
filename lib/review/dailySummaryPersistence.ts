import type { Grade } from "@/lib/srs/scheduler";
import { todayInTimezone } from "@/lib/utils/format-date";

const STORAGE_KEY = "poke-memory:daily-summary:v1";

export type DailySummaryRecord = {
  date: string;
  gradeSequence: Grade[];
  reviewed: number;
  newCards: number;
  mastered: number;
};

export function loadDailySummary(timezone: string): DailySummaryRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).date !== "string" ||
      !Array.isArray((parsed as Record<string, unknown>).gradeSequence) ||
      typeof (parsed as Record<string, unknown>).reviewed !== "number" ||
      typeof (parsed as Record<string, unknown>).newCards !== "number" ||
      typeof (parsed as Record<string, unknown>).mastered !== "number"
    ) {
      return null;
    }
    const record = parsed as DailySummaryRecord;
    if (record.date !== todayInTimezone(timezone)) return null;
    return record;
  } catch {
    return null;
  }
}

export function saveDailySummary(record: DailySummaryRecord): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (e) {
    // QuotaExceededError — non-fatal, share button just won't survive a reload.
    console.warn("poke-memory: failed to persist daily summary", e);
  }
}

export function mergeDailySummary(
  existing: DailySummaryRecord | null,
  session: {
    gradeSequence: Grade[];
    newCards: number;
    mastered: number;
    date: string;
  },
): DailySummaryRecord {
  if (existing === null) {
    return {
      date: session.date,
      gradeSequence: session.gradeSequence,
      reviewed: session.gradeSequence.length,
      newCards: session.newCards,
      mastered: session.mastered,
    };
  }
  const merged = [...existing.gradeSequence, ...session.gradeSequence];
  return {
    date: existing.date,
    gradeSequence: merged,
    reviewed: merged.length,
    newCards: existing.newCards + session.newCards,
    mastered: existing.mastered + session.mastered,
  };
}
