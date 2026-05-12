import type { Grade } from "@/lib/srs/scheduler";

export type GradeLogEntry = {
  date: string;
  grade: Grade;
  cardType: "name" | "evolution" | "reverse";
  /**
   * Epoch ms when the entry was recorded. Required since #308 — gives every
   * entry a stable unique key for cross-device sync deduplication. Legacy
   * entries written before #308 lack this field; `loadGradeLog` synthesizes
   * one deterministically from `date` and the entry's position within its
   * day so the cloud can still dedup against pre-existing local logs.
   */
  occurredAt: number;
};

export type GradeLog = GradeLogEntry[];

export type GradeTotals = Record<Grade, number>;

const STORAGE_KEY = "poke-memory:grade-log:v1";

/**
 * Fires on every successful `appendGradeEntry`. The detail is the stamped
 * `GradeLogEntry` that was just persisted. Consumed by
 * `components/sync/AutoSyncOnChange.tsx` (#319) to push the entry to
 * Supabase without waiting for the next manual Sync.
 */
export const GRADE_LOG_APPENDED_EVENT = "poke-memory:grade-log-appended";

const EMPTY_TOTALS: GradeTotals = { 1: 0, 2: 0, 4: 0, 5: 0 };

function isGrade(v: unknown): v is Grade {
  return v === 1 || v === 2 || v === 4 || v === 5;
}

// Validate a stored entry shape. Legacy entries are allowed to lack
// `occurredAt`; the caller (loadGradeLog) backfills it before returning.
function isStoredEntryShape(v: unknown): v is Omit<GradeLogEntry, "occurredAt"> & {
  occurredAt?: number;
} {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.date === "string" &&
    isGrade(e.grade) &&
    (e.cardType === "name" || e.cardType === "evolution" || e.cardType === "reverse") &&
    (e.occurredAt === undefined || typeof e.occurredAt === "number")
  );
}

/**
 * Synthesize a deterministic `occurredAt` for a legacy entry that lacks it.
 * Uses noon UTC on the entry's date as the base, plus a per-day ordinal so
 * multiple legacy entries on the same day don't collide.
 */
function synthesizeOccurredAt(date: string, indexWithinDay: number): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12, 0, 0) + indexWithinDay;
}

export function loadGradeLog(): GradeLog {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStoredEntryShape)) return [];

    // Backfill `occurredAt` for legacy entries that lack it. Counts how many
    // legacy entries we've seen on each date so the synthesized timestamps
    // are unique within a day.
    const seenPerDay: Record<string, number> = {};
    return (parsed as Array<Omit<GradeLogEntry, "occurredAt"> & { occurredAt?: number }>).map(
      (entry) => {
        if (typeof entry.occurredAt === "number") {
          return entry as GradeLogEntry;
        }
        const index = seenPerDay[entry.date] ?? 0;
        seenPerDay[entry.date] = index + 1;
        return {
          date: entry.date,
          grade: entry.grade,
          cardType: entry.cardType,
          occurredAt: synthesizeOccurredAt(entry.date, index),
        };
      },
    );
  } catch {
    return [];
  }
}

export function appendGradeEntry(entry: Omit<GradeLogEntry, "occurredAt">): void {
  if (typeof window === "undefined") return;
  try {
    const stamped: GradeLogEntry = { ...entry, occurredAt: Date.now() };
    const pruned = pruneGradeLog(loadGradeLog(), 365, entry.date);
    pruned.push(stamped);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    window.dispatchEvent(
      new CustomEvent(GRADE_LOG_APPENDED_EVENT, { detail: stamped }),
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      console.warn("poke-memory: grade log write failed — localStorage quota exceeded");
    } else {
      console.error("poke-memory: grade log write failed", err);
    }
  }
}

export function pruneGradeLog(log: GradeLog, keepDays: number, today: string): GradeLog {
  const [y, m, d] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1, d - keepDays));
  const cutoffStr = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}-${String(cutoff.getUTCDate()).padStart(2, "0")}`;
  return log.filter((e) => e.date >= cutoffStr);
}

export function computeGradeTotals(log: GradeLog): GradeTotals {
  const totals: GradeTotals = { ...EMPTY_TOTALS };
  for (const entry of log) {
    totals[entry.grade]++;
  }
  return totals;
}

/** Overwrites localStorage with the given log. Used by sync after merging. */
export function saveGradeLog(log: GradeLog): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      console.warn("poke-memory: grade log write failed — localStorage quota exceeded");
    } else {
      console.error("poke-memory: grade log write failed", err);
    }
  }
}
