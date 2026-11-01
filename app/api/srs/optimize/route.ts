/**
 * POST /api/srs/optimize
 *
 * Runs the FSRS per-user weight optimizer (#268) server-side and persists the
 * resulting weight vector to `user_settings.settings`. Authenticated users
 * only - guests are not supported.
 *
 * Flow:
 *  1. Authenticate via session cookie.
 *  2. Check the per-IP bucket (check_rate_limit, action "optimize").
 *  3. Load the user's grade_log from Supabase.
 *  4. Build optimizer input via gradeLogToOptimizerItems.
 *  5. Gate on MIN_REVIEWS_FOR_OPTIMIZATION.
 *  6. Claim the run slot (claim_optimizer_slot, migration 050).
 *  7. Call computeParameters (native binding, Node.js only).
 *  8. Merge new weights into user_settings.settings and write back.
 *  9. Return { weights, optimizedAt, reviewCount }.
 *
 * The slot is the weekly limit on runs. `fsrsWeightsOptimizedAt` in settings is
 * what the Settings UI shows; it decides nothing here.
 */

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/requireAuth";
import { fetchAllPages } from "@/lib/sync/paginatedFetch";
import { hashIp } from "@/lib/auth/rateLimitIp";
import type { RateLimitAction } from "@/lib/auth/rateLimitIp";

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
import type {
  CheckRateLimitRpc,
  ClaimOptimizerSlotRpc,
  MergeUserSettingsRpc,
} from "@/lib/supabase/rpc-types";

/** Retry hint when the IP bucket is full: the longest check_rate_limit window. */
const IP_RETRY_AFTER_MS = 60 * 60 * 1000;

type GradeLogCloudRow = {
  occurred_at: number;
  entry_date: string;
  card_type: GradeLogEntry["cardType"];
  grade: GradeLogEntry["grade"];
  subject_key: string | null;
};

async function fetchGradeLog(
  client: SupabaseClient,
  userId: string,
): Promise<GradeLogEntry[] | null> {
  try {
    // Paginate to avoid the PostgREST 1000-row default cap. Without
    // pagination the optimiser fits permanently on only the oldest 1000
    // grades, ignoring all recent review behaviour.
    // Rows are ordered by occurred_at ascending so offset pagination is
    // safe: grade_log is append-only and new rows only appear at the tail.
    const data = await fetchAllPages<GradeLogCloudRow>((from, to) =>
      client
        .from("grade_log")
        .select("occurred_at,entry_date,card_type,grade,subject_key")
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
    // separate const) so `this` stays bound to `client` - extracting client.rpc to
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

/**
 * Extracts a safe, non-PII detail string from an unknown thrown value.
 *
 * Used for the `detail` field of `{ error: "unknown" }` and `{ error:
 * "degenerate_data" }` responses. The binding's panic messages are short
 * C-string literals with no user data; we truncate to 200 chars anyway as a
 * safety cap. Returns "internal_error" when no usable message is available.
 */
function extractSafeDetail(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return raw.slice(0, 200) || "internal_error";
}

/** A 429 in the shape the Settings UI reads, with the standard header. */
function retryLater(error: "cooldown" | "rate_limited", retryAfterMs: number): NextResponse {
  return NextResponse.json(
    { error, retryAfterMs },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}

/**
 * True only when the bucket answers an explicit no. A failed check is logged
 * and passed: the per-account slot still holds, so the route stays available
 * (same rule as app/api/feedback).
 */
async function isIpRateLimited(client: SupabaseClient, request: Request): Promise<boolean> {
  try {
    const rawIp = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const { data, error } = await (client.rpc as unknown as CheckRateLimitRpc)(
      "check_rate_limit",
      { p_ip_hash: hashIp(rawIp), p_action: "optimize" satisfies RateLimitAction },
    );
    if (error) console.warn("[/api/srs/optimize] rate-limit check error, proceeding", error);
    return data === false;
  } catch {
    console.warn("[/api/srs/optimize] rate-limit check failed, proceeding");
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    return await postHandler(request);
  } catch (err) {
    // Unhandled exceptions (e.g. an unexpected binding panic that bypasses the
    // inner try/catch, or a Vercel infrastructure error surfaced as a thrown
    // value). Return a structured { error: "unknown" } instead of an
    // unstructured 500 so the UI can surface a meaningful message.
    console.error("[/api/srs/optimize] unhandled error", err);
    return NextResponse.json(
      { error: "unknown", detail: extractSafeDetail(err) },
      { status: 500 },
    );
  }
}

async function postHandler(request: Request): Promise<NextResponse> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const auth = await requireAuth(supabase);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  if (await isIpRateLimited(supabase, request)) {
    return retryLater("rate_limited", IP_RETRY_AFTER_MS);
  }

  // Fetch grade log from Supabase.
  const entries = await fetchGradeLog(supabase, user.id);
  if (entries === null) {
    // Supabase fetch failed - the client's reviews may not have synced yet.
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

  // Claim only now: a claim spends the user's slot, so a request that cannot fit
  // yet must not reach it. One atomic statement in the database, so of any number
  // of concurrent requests one gets 0 and the rest get the time left.
  const { data: retryAfterMs, error: claimError } = await (
    supabase.rpc as unknown as ClaimOptimizerSlotRpc
  )("claim_optimizer_slot");
  if (claimError) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
  if (retryAfterMs !== 0) {
    return retryLater("cooldown", retryAfterMs ?? OPTIMIZER_COOLDOWN_MS);
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
    // Surface a truncated, non-PII detail string so the UI can show the class
    // of failure in addition to the status code.
    return NextResponse.json(
      { error: "degenerate_data", reviewCount, detail: extractSafeDetail(err) },
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
