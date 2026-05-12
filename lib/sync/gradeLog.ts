import type { SupabaseClient } from "@supabase/supabase-js";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";

// Grade-log sync is best-effort. Failures are surfaced as `false` / `null`
// and the caller is expected to keep going — analytics history is auxiliary
// to card-review state.

export async function pushGradeLog(
  client: SupabaseClient,
  userId: string,
  entries: GradeLogEntry[],
): Promise<boolean> {
  if (entries.length === 0) return true;
  try {
    const rows = entries.map((e) => ({
      user_id: userId,
      occurred_at: e.occurredAt,
      entry_date: e.date,
      card_type: e.cardType,
      grade: e.grade,
    }));
    const { error } = await client
      .from("grade_log")
      .upsert(rows, {
        onConflict: "user_id,occurred_at",
        ignoreDuplicates: true,
      });
    return !error;
  } catch {
    return false;
  }
}

type CloudRow = {
  occurred_at: number;
  entry_date: string;
  card_type: GradeLogEntry["cardType"];
  grade: GradeLogEntry["grade"];
};

export async function pullGradeLog(
  client: SupabaseClient,
  userId: string,
): Promise<GradeLogEntry[] | null> {
  try {
    const { data, error } = await client
      .from("grade_log")
      .select("occurred_at,entry_date,card_type,grade")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: true });
    if (error || !data) return null;
    return (data as CloudRow[]).map((r) => ({
      occurredAt: Number(r.occurred_at),
      date: r.entry_date,
      cardType: r.card_type,
      grade: r.grade,
    }));
  } catch {
    return null;
  }
}

// Union-merge: every distinct `occurredAt` survives. If two entries share a
// timestamp they collapse to one (the local copy wins for the tiebreaker —
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
