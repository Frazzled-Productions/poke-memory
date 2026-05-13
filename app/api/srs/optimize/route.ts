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
  countOptimizableReviews,
  MIN_REVIEWS_FOR_OPTIMIZATION,
  OPTIMIZER_COOLDOWN_MS,
} from "@/lib/srs/optimizer";
import type { UserSettings } from "@/lib/settings/persistence";

type GradeLogCloudRow = {
  occurred_at: number;
  entry_date: string;
  card_type: GradeLogEntry["cardType"];
  grade: GradeLogEntry["grade"];
  card_id: number | null;
};

async function fetchUserSettings(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<UserSettings> | null> {
  const { data, error } = await client
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const s = (data as { settings: unknown }).settings;
  if (s && typeof s === "object") return s as Partial<UserSettings>;
  return null;
}

async function fetchGradeLog(
  client: SupabaseClient,
  userId: string,
): Promise<GradeLogEntry[] | null> {
  try {
    const { data, error } = await client
      .from("grade_log")
      .select("occurred_at,entry_date,card_type,grade,card_id")
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
      if (r.card_id !== null && r.card_id !== undefined) {
        entry.cardId = r.card_id;
      }
      return entry;
    });
  } catch {
    return null;
  }
}

/**
 * Persist the new weights into `user_settings.settings` using optimistic
 * locking on `updated_at`.
 *
 * The read-merge-write window is small in practice (the user is staring at
 * a spinner while this request is in flight, and no other surface auto-pushes
 * settings), but AutoSyncOnChange.pushSettings could in theory interleave. The
 * `.eq("updated_at", current.updated_at)` predicate makes the UPDATE no-op
 * under concurrent writes; we retry once with a fresh read on conflict, then
 * give up. A future atomic-merge RPC (jsonb `settings || patch`) would remove
 * the retry path entirely.
 */
async function persistWeights(
  client: SupabaseClient,
  userId: string,
  weights: number[],
  optimizedAt: string,
  attempt = 0,
): Promise<boolean> {
  try {
    const { data: current } = await client
      .from("user_settings")
      .select("settings, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    const existing: Partial<UserSettings> =
      current &&
      typeof (current as { settings: unknown }).settings === "object" &&
      (current as { settings: unknown }).settings !== null
        ? ((current as { settings: unknown }).settings as Partial<UserSettings>)
        : {};

    const merged: Partial<UserSettings> = {
      ...existing,
      fsrsWeights: weights,
      fsrsWeightsOptimizedAt: optimizedAt,
    };

    if (current) {
      const currentUpdatedAt = (current as { updated_at: string }).updated_at;
      const { data: updated, error } = await client
        .from("user_settings")
        .update({ settings: merged, updated_at: optimizedAt })
        .eq("user_id", userId)
        .eq("updated_at", currentUpdatedAt)
        .select("user_id")
        .maybeSingle();
      if (error) return false;
      if (!updated) {
        // Concurrent write — retry once with a fresh read.
        if (attempt >= 1) return false;
        return persistWeights(client, userId, weights, new Date().toISOString(), attempt + 1);
      }
      return true;
    }

    const { error } = await client
      .from("user_settings")
      .insert({ user_id: userId, settings: merged, updated_at: optimizedAt });
    return !error;
  } catch {
    return false;
  }
}

export async function POST(): Promise<NextResponse> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Enforce 7-day cooldown before running the CPU-bound optimizer.
  let currentSettings: Partial<UserSettings> | null;
  try {
    currentSettings = await fetchUserSettings(supabase, user.id);
  } catch {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
  const last = currentSettings?.fsrsWeightsOptimizedAt;
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
    return NextResponse.json({ error: "optimization_failed" }, { status: 500 });
  }

  // Gate on minimum review count.
  const reviewCount = countOptimizableReviews(entries);
  if (reviewCount < MIN_REVIEWS_FOR_OPTIMIZATION) {
    return NextResponse.json(
      { error: "not_enough_reviews", reviewCount },
      { status: 422 },
    );
  }

  // Build optimizer input and construct binding objects.
  const optimizerItems = gradeLogToOptimizerItems(entries);
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
    return NextResponse.json({ error: "optimization_failed" }, { status: 500 });
  }

  // Persist the new weights.
  const optimizedAt = new Date().toISOString();
  const persisted = await persistWeights(supabase, user.id, weights, optimizedAt);
  if (!persisted) {
    console.error("[/api/srs/optimize] failed to persist weights for user", user.id);
    return NextResponse.json({ error: "optimization_failed" }, { status: 500 });
  }

  return NextResponse.json({ weights, optimizedAt, reviewCount });
}
