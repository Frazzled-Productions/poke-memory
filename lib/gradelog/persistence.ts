import type { Grade } from "@/lib/srs/scheduler";

export type GradeLogEntry = {
  date: string;
  grade: Grade;
  cardType: "name" | "evolution";
};

export type GradeLog = GradeLogEntry[];

export type GradeTotals = Record<Grade, number>;

const STORAGE_KEY = "poke-memory:grade-log:v1";

const EMPTY_TOTALS: GradeTotals = { 1: 0, 2: 0, 4: 0, 5: 0 };

function isGrade(v: unknown): v is Grade {
  return v === 1 || v === 2 || v === 4 || v === 5;
}

function isEntryShape(v: unknown): v is GradeLogEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.date === "string" &&
    isGrade(e.grade) &&
    (e.cardType === "name" || e.cardType === "evolution")
  );
}

export function loadGradeLog(): GradeLog {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isEntryShape)) return [];
    return parsed as GradeLog;
  } catch {
    return [];
  }
}

export function appendGradeEntry(entry: GradeLogEntry): void {
  if (typeof window === "undefined") return;
  try {
    const pruned = pruneGradeLog(loadGradeLog(), 365, entry.date);
    pruned.push(entry);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
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

