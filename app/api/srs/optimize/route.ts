/**
 * POST /api/srs/optimize
 *
 * Runs the FSRS per-user weight optimizer (#268) server-side and persists the
 * resulting weight vector to `user_settings.settings`. Authenticated users
 * only — guests are not supported.
 *
 * Flow:
 *  1. Authenticate via session cookie.
 *  2. Load the user's grade_log from Supabase.
 *  3. Build optimizer input via gradeLogToOptimizerItems.
 *  4. Gate on MIN_REVIEWS_FOR_OPTIMIZATION.
 *  5. Call computeParameters (native binding, Node.js only).
 *  6. Merge new weights into user_settings.settings and write back.
 *  7. Return { weights, optimizedAt, reviewCount }.
 */

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Native optimizer can take tens of seconds on large datasets. Default
// (300s on current Vercel plans) is plenty; setting the cap explicitly so
// a future plan-default change doesn't silently truncate the fit.
export const maxDuration = 60;

import {
  FSRSBindingItem,
  FSRSBindingReview,
  computeParameters,
} from "@open-spaced-repetition/binding";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";
import {
  gradeLogToOptimizerItems,
  MIN_REVIEWS_FOR_OPTIMIZATION,
  OPTIMIZER_COOLDOWN_MS,
} from "@/lib/srs/optimizer";
import type { UserSettings } from "@/lib/settings/persistence";
import type { MergeUserSettingsRpc } from "@/lib/supabase/rpc-types";

type GradeLogCloudRow = {
  occurred_at: number;
  entry_date: string;
  card_type: GradeLogEntry["cardType"];
  grade: GradeLogEntry["grade"];
  subject_key: string | null;
};

type UserSettingsRow = {
  settings: Partial<UserSettings>;
};

async function fetchUserSettings(
  client: SupabaseClient,
  userId: string,
): Promise<UserSettingsRow | null> {
  const { data, error } = await client
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { settings: unknown };
  const settings =
    row.settings && typeof row.settings === "object"
      ? (row.settings as Partial<UserSettings>)
      : {};
  return { settings };
}

async function fetchGradeLog(
  client: SupabaseClient,
  userId: string,
): Promise<GradeLogEntry[] | null> {
  try {
    const { data, error } = await client
      .from("grade_log")
      .select("occurred_at,entry_date,card_type,grade,subject_key")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: true });
    if (error || !data) return null;
    return (data as GradeLogCloudRow[]).map((r) => {
      const entry: GradeLogEntry = {
        occurredAt: Number(r.occurred_at),
        date: r.entry_date,
        cardType: r.card_type,
        grade: r.grade,
      };
      if (r.subject_key !== null && r.subject_key !== undefined) {
        entry.subjectKey = r.subject_key;
      }
      return entry;
    });
  } catch {
    return null;
  }
}

/**
 * Persist the new weights into `user_settings.settings` using the
 * `merge_user_settings` RPC (migration 011), which atomically merges a JSONB
 * patch via INSERT … ON CONFLICT DO UPDATE SET settings = settings || patch.
 * This eliminates the read-merge-write race window that the previous
 * optimistic-locking approach had (#392).
 */
async function persistWeights(
  client: SupabaseClient,
  userId: string,
  weights: number[],
  optimizedAt: string,
): Promise<boolean> {
  try {
    // The generated Supabase types don't yet know about `merge_user_settings`
    // (migration 011/014). Cast through `unknown` to the narrow MergeUserSettingsRpc
    // signature from rpc-types. The cast is kept on the *call expression* (not a
    // separate const) so `this` stays bound to `client` — extracting client.rpc to
    // a local const would strip the binding and SupabaseClient.rpc reads `this.rest`.
    const { error } = await (client.rpc as unknown as MergeUserSettingsRpc)(
      "merge_user_settings",
      {
        p_user_id: userId,
        p_patch: { fsrsWeights: weights, fsrsWeightsOptimizedAt: optimizedAt },
      },
    );
    return !error;
  } catch {
    return false;
  }
}

async function runOptimize(): Promise<NextResponse> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Enforce 7-day cooldown before running the CPU-bound optimizer.
  let currentSettings: UserSettingsRow | null;
  try {
    currentSettings = await fetchUserSettings(supabase, user.id);
  } catch {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
  const last = currentSettings?.settings.fsrsWeightsOptimizedAt;
  if (last) {
    const sinceMs = Date.now() - new Date(last).getTime();
    if (sinceMs < OPTIMIZER_COOLDOWN_MS) {
      const retryAfterMs = OPTIMIZER_COOLDOWN_MS - sinceMs;
      return NextResponse.json(
        { error: "cooldown", retryAfterMs },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
        },
      );
    }
  }

  // Fetch grade log from Supabase.
  const entries = await fetchGradeLog(supabase, user.id);
  if (entries === null) {
    // Supabase fetch failed — the client's reviews may not have synced yet.
    return NextResponse.json(
      { error: "reviews_unavailable" },
      { status: 503 },
    );
  }

  // Build optimizer input first so the review count reflects only fittable
  // cards (those with >= 2 reviews on distinct days). `countOptimizableReviews`
  // mirrors the same filter, but computing items here gives us the definitive
  // fittable count and avoids processing the entries twice.
  //
  // NOTE: the eligibility button on the Settings page counts the *local*
  // grade log (IDB-backed), whereas this route counts the *cloud* grade_log
  // table. A user mid-sync can therefore pass the client-side gate but fail
  // here with not_enough_reviews. The component maps that 422 to "sync first,
  // then try again", which is the correct recovery action.
  const optimizerItems = gradeLogToOptimizerItems(entries);
  const reviewCount = optimizerItems.reduce((sum, item) => sum + item.reviews.length, 0);
  if (reviewCount < MIN_REVIEWS_FOR_OPTIMIZATION) {
    return NextResponse.json(
      { error: "not_enough_reviews", reviewCount },
      { status: 422 },
    );
  }
  let weights: number[];
  try {
    const bindingItems = optimizerItems.map(
      (item) =>
        new FSRSBindingItem(
          item.reviews.map((r) => new FSRSBindingReview(r.rating, r.deltaT)),
        ),
    );
    weights = await computeParameters(bindingItems, { enableShortTerm: true });
  } catch (err) {
    console.error("[/api/srs/optimize] computeParameters failed", err);
    // The native binding throws on degenerate or insufficient data distributions.
    // Return 422 (client-fixable: keep studying) rather than a generic 500.
    return NextResponse.json(
      { error: "degenerate_data", reviewCount },
      { status: 422 },
    );
  }

  // Persist the new weights atomically via the merge_user_settings RPC.
  const optimizedAt = new Date().toISOString();
  const persisted = await persistWeights(
    supabase,
    user.id,
    weights,
    optimizedAt,
  );
  if (!persisted) {
    console.error("[/api/srs/optimize] failed to persist weights for user", user.id);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ weights, optimizedAt, reviewCount });
}

/**
 * Public entry point. Wraps {@link runOptimize} so any *unmapped* failure (an
 * unexpected throw, a transport error, a Vercel function timeout) returns a
 * structured `{ error: "unknown", detail }` 500 the UI can surface with its
 * HTTP status, instead of an opaque body the component maps to a catch-all
 * string (#1305). This cannot catch a process-level abort from the native
 * binding — that is guarded at the input layer by dropping unfittable items
 * (#1304); this wrapper covers the catchable unmapped paths. `detail` is a
 * truncated error message (already present in our logs), not user data.
 */
export async function POST(): Promise<NextResponse> {
  try {
    return await runOptimize();
  } catch (err) {
    console.error("[/api/srs/optimize] unhandled error", err);
    const detail =
      err instanceof Error ? err.message.slice(0, 200) : "internal_error";
    return NextResponse.json({ error: "unknown", detail }, { status: 500 });
  }
}
