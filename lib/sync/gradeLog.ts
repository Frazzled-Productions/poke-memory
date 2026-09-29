import type { SupabaseClient } from "@supabase/supabase-js";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";
import { fetchAllPages } from "@/lib/sync/paginatedFetch";

// Grade-log sync is best-effort. Failures are surfaced as `false` / `null`
// and the caller is expected to keep going - analytics history is auxiliary
// to card-review state.

/**
 * The `onConflict` column list for `grade_log` upserts.
 *
 * Matches the UNIQUE constraint on grade_log: (user_id, occurred_at) - migration 006.
 * Exported so the onConflict-PK parity integration test can import the live
 * client constant and compare it against the DB constraint.
 */
export const GRADE_LOG_CONFLICT_COLS = "user_id,occurred_at" as const;


/** The `grade_log` DB row shape written by every push path. */
export type GradeLogDbRow = {
  user_id: string;
  occurred_at: number;
  entry_date: string;
  card_type: GradeLogEntry["cardType"];
  grade: GradeLogEntry["grade"];
  subject_key: string | null;
  locale: string;
  learning_step: number | null;
  step_started_at: number | null;
};

/**
 * Single source of truth for the GradeLogEntry -> `grade_log` column mapping.
 * Used by `pushGradeLog` (client upsert) and `app/api/sync/route.ts` (beacon
 * gradeLog leg, #2052) so the two paths cannot drift.
 */
export function toGradeLogDbRow(userId: string, e: GradeLogEntry): GradeLogDbRow {
  return {
    user_id: userId,
    occurred_at: e.occurredAt,
    entry_date: e.date,
    card_type: e.cardType,
    grade: e.grade,
    subject_key: e.subjectKey ?? null,
    // Migration 029 field - coalesce to "en" for pre-migration entries.
    locale: e.locale ?? "en",
    // Migration 033 fields - NULL for graduated cards and pre-migration entries.
    learning_step: e.learningStep ?? null,
    step_started_at: e.stepStartedAt ?? null,
  };
}

const VALID_CARD_TYPES: ReadonlySet<string> = new Set([
  "name",
  "evolution",
  "reverse-evolution",
  "reverse",
  "cry",
]);
const VALID_GRADES: ReadonlySet<number> = new Set([1, 2, 4, 5]);

/**
 * Boundary validator for grade-log entries arriving over the network (the
 * `/api/sync` beacon payload, #2052). Checks the fields the DB row mapping
 * depends on; the caller drops anything malformed.
 */
export function isGradeLogEntry(value: unknown): value is GradeLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.occurredAt === "number" &&
    Number.isFinite(e.occurredAt) &&
    typeof e.date === "string" &&
    typeof e.grade === "number" &&
    VALID_GRADES.has(e.grade) &&
    typeof e.cardType === "string" &&
    VALID_CARD_TYPES.has(e.cardType) &&
    // grade_log.subject_key is NOT NULL: one entry without it would fail the
    // whole batch, so it is required here (legacy pre-#462 entries are dropped
    // rather than poisoning the upsert).
    typeof e.subjectKey === "string" &&
    (e.locale === undefined || typeof e.locale === "string") &&
    (e.learningStep === undefined || e.learningStep === null || typeof e.learningStep === "number") &&
    (e.stepStartedAt === undefined || e.stepStartedAt === null || typeof e.stepStartedAt === "number")
  );
}

export async function pushGradeLog(
  client: SupabaseClient,
  userId: string,
  entries: GradeLogEntry[],
): Promise<boolean> {
  // Migration 009 extended the card_type CHECK to include 'cry' and
  // 'reverse-evolution', so all card types are now supported.
  if (entries.length === 0) return true;
  try {
    const rows = entries.map((e) => toGradeLogDbRow(userId, e));
    const { error } = await client
      .from("grade_log")
      .upsert(rows, {
        onConflict: GRADE_LOG_CONFLICT_COLS,
        ignoreDuplicates: true,
      });
    return !error;
  } catch {
    return false;
  }
}

type GradeLogCloudRow = {
  occurred_at: number;
  entry_date: string;
  card_type: GradeLogEntry["cardType"];
  grade: GradeLogEntry["grade"];
  subject_key: string | null;
  /** Migration 029 field - absent on pre-migration rows, defaults to "en". */
  locale?: string | null;
  /** Migration 033 field - NULL for graduated cards and pre-migration rows. */
  learning_step?: number | null;
  /** Migration 033 field - epoch ms; NULL for graduated cards and pre-migration rows. */
  step_started_at?: number | null;
};

export async function pullGradeLog(
  client: SupabaseClient,
  userId: string,
): Promise<GradeLogEntry[] | null> {
  try {
    // Paginate to avoid the PostgREST 1000-row default cap, which would
    // silently truncate the grade log for any user past ~10 active days.
    // Rows are ordered by occurred_at ascending so offset pagination is
    // safe: grade_log is append-only and new rows only appear at the tail.
    const data = await fetchAllPages<GradeLogCloudRow>((from, to) =>
      client
        .from("grade_log")
        .select("occurred_at,entry_date,card_type,grade,subject_key,locale,learning_step,step_started_at")
        .eq("user_id", userId)
        .order("occurred_at", { ascending: true })
        .range(from, to),
    );
    if (!data) return null;
    return data.map((r) => {
      const entry: GradeLogEntry = {
        occurredAt: Number(r.occurred_at),
        date: r.entry_date,
        cardType: r.card_type,
        grade: r.grade,
        locale: (r.locale ?? "en") as GradeLogEntry["locale"],
      };
      if (r.subject_key !== null && r.subject_key !== undefined) {
        entry.subjectKey = r.subject_key;
      }
      // Migration 033 fields - NULL on pre-migration rows (column didn't exist
      // when they were inserted); undefined/null both treated as "graduated" by
      // the scheduler. Omit the key entirely when null so legacy-shaped entries
      // are indistinguishable from new graduated entries.
      if (r.learning_step !== null && r.learning_step !== undefined) {
        entry.learningStep = r.learning_step;
      }
      if (r.step_started_at !== null && r.step_started_at !== undefined) {
        entry.stepStartedAt = r.step_started_at;
      }
      return entry;
    });
  } catch {
    return null;
  }
}

// Union-merge: every distinct `occurredAt` survives. If two entries share a
// timestamp they collapse to one (the local copy wins for the tiebreaker - 
// arbitrary but stable). Returns entries sorted by `occurredAt` ascending.
export function mergeGradeLog(
  local: GradeLogEntry[],
  cloud: GradeLogEntry[],
): GradeLogEntry[] {
  const byKey = new Map<number, GradeLogEntry>();
  for (const e of cloud) {
    byKey.set(e.occurredAt, e);
  }
  for (const e of local) {
    byKey.set(e.occurredAt, e);
  }
  return Array.from(byKey.values()).sort((a, b) => a.occurredAt - b.occurredAt);
}
