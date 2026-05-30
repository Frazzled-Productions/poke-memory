import type { SupabaseClient } from "@supabase/supabase-js";

// Streak sync is best-effort: failures are surfaced as `false` (push) or `null`
// (pull) and the caller is expected to keep going. A streak miss is not a
// data-loss event the way a card-review miss is.

/**
 * The `onConflict` column list for `streak_days` upserts.
 *
 * Matches the UNIQUE constraint on streak_days: (user_id, review_date) — migration 001.
 * Exported so the onConflict-PK parity integration test can import the live
 * client constant and compare it against the DB constraint.
 */
export const STREAK_DAYS_CONFLICT_COLS = "user_id,review_date" as const;


export async function pushStreak(
  client: SupabaseClient,
  userId: string,
  dates: string[],
): Promise<boolean> {
  if (dates.length === 0) return true;
  try {
    const rows = dates.map((d) => ({ user_id: userId, review_date: d }));
    const { error } = await client
      .from("streak_days")
      .upsert(rows, {
        onConflict: STREAK_DAYS_CONFLICT_COLS,
        ignoreDuplicates: true,
      });
    return !error;
  } catch {
    return false;
  }
}

export async function pullStreak(
  client: SupabaseClient,
  userId: string,
): Promise<string[] | null> {
  try {
    const { data, error } = await client
      .from("streak_days")
      .select("review_date")
      .eq("user_id", userId);
    if (error || !data) return null;
    return (data as { review_date: string }[]).map((r) => r.review_date);
  } catch {
    return null;
  }
}

// Union-merge: streak data is monotonic. A date that appears in either side is
// kept; nothing is ever removed by sync. The merged array is deduped and sorted
// in ascending ISO-date order so consumers can rely on stable ordering.
export function mergeStreak(local: string[], cloud: string[]): string[] {
  const merged = new Set<string>([...local, ...cloud]);
  return Array.from(merged).sort();
}
