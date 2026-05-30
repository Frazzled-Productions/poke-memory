import type { Grade } from "@/lib/srs/scheduler";
import { todayInTimezone } from "@/lib/utils/format-date";
import { KEY_DAILY_SUMMARY } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorage } from "@/lib/storage/writeLocalStorage";

export const STORAGE_KEY = KEY_DAILY_SUMMARY;

export type DailySummaryRecord = {
  date: string;
  gradeSequence: Grade[];
  reviewed: number;
  newCards: number;
  mastered: number;
};

export function loadDailySummary(timezone: string): DailySummaryRecord | null {
  return readLocalStorage(
    STORAGE_KEY,
    (raw) => {
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
        p.reviewed !== (p.gradeSequence as unknown[]).length ||
        typeof p.newCards !== "number" ||
        typeof p.mastered !== "number"
      ) {
        return null;
      }
      const record = parsed as DailySummaryRecord;
      // A date mismatch — whether the record is days old or was written seconds
      // before a midnight rollover — means it is no longer "today's" summary, so
      // discarding it here is the intended behaviour, not a lost-data bug.
      if (record.date !== todayInTimezone(timezone)) return null;
      return record;
    },
    null,
  );
}

export function saveDailySummary(record: DailySummaryRecord): void {
  // QuotaExceededError is swallowed — non-fatal, share button just won't survive a reload.
  writeLocalStorage(STORAGE_KEY, record);
}
