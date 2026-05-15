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
    const p = parsed as Record<string, unknown>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof p.date !== "string" ||
      !Array.isArray(p.gradeSequence) ||
      !(p.gradeSequence as unknown[]).every(
        (v) => v === 1 || v === 2 || v === 4 || v === 5,
      ) ||
      typeof p.reviewed !== "number" ||
      typeof p.newCards !== "number" ||
      typeof p.mastered !== "number"
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
