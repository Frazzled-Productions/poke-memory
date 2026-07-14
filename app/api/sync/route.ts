import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { parseJsonBody } from "@/lib/api/parseJsonBody";
import { requireAuth } from "@/lib/auth/requireAuth";
import type { CloudRow } from "@/lib/sync/cloud";
import { CARD_REVIEWS_CONFLICT_COLS, isStructuralError } from "@/lib/sync/cloud";

type BeaconPayload = {
  cards: CloudRow[];
};

// Two paths reach this route:
//   1. pagehide handler in useSyncOnUnload - uses sendBeacon, which does not
//      expose the server response code to the sender. The status code is
//      therefore advisory for that path; the client trusts the browser's
//      "queued" boolean and nothing more.
//   2. visibilitychange handler in useSyncOnUnload (post-#581) - uses
//      fetch+keepalive, which *does* observe the response. The client treats
//      a non-2xx as a failure and keeps the unsynced queue intact.
//
// To make path #2 reliable each batch is retried up to BATCH_RETRIES times
// before being declared failed, so a transient Supabase blip does not turn
// into a user-visible "Sync failed" banner. Structural errors (42xxx, 23505,
// 23503) break out of the retry loop immediately and return HTTP 409 (#1358).
export async function POST(request: Request) {
  const parsed = await parseJsonBody<BeaconPayload>(request);
  if (parsed instanceof NextResponse) return parsed;
  const payload = parsed.data;

  if (!Array.isArray(payload.cards)) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  // Cast to untyped SupabaseClient - Database is a stub type (unknown) in this
  // repo, which causes the typed upsert to expect never[]. The untyped client
  // matches the pattern used throughout lib/sync/cloud.ts.
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const auth = await requireAuth(supabase, { withOkField: true });
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const rows = payload.cards;
  if (rows.length === 0) {
    return NextResponse.json({ ok: true });
  }

  // BATCH is sized larger than the 100 reviews/day soft cap as a defensive
  // measure - guards against future limit changes without requiring code updates.
  const BATCH = 200;
  // Bounded retry to absorb transient Supabase failures. A permanent failure
  // (RLS regression, constraint violation) will still bubble up after the
  // attempts are exhausted, but with N=3 a flaky network blip on a single
  // batch is unlikely to surface to the user as a sync failure.
  //
  // Exception: structural errors (42xxx ON CONFLICT mismatch, 23505/23503
  // constraint violations) break out of the retry loop immediately - retrying
  // is pointless because the error always indicates a deploy/schema mismatch.
  // The route returns HTTP 409 for structural errors so the client (the
  // fetch+keepalive path) can distinguish them from transient 502 failures
  // and suppress the retry UI.
  const BATCH_RETRIES = 3;
  const RETRY_DELAY_MS = 100;
  let allOk = true;
  let structuralErrorCode: string | null = null;

  const userId = user.id;

  /** Build a single DB row from a CloudRow, ready for upsert. */
  function toDbRow(r: CloudRow) {
    return {
      user_id: userId,
      card_type: r.card_type,
      subject_key: r.subject_key,
      // Migration 029 field - coalesce absent key to "en" for pre-migration clients
      // and in-flight beacon queue entries that lack the field.
      locale: r.locale ?? "en",
      stability: r.stability,
      difficulty: r.difficulty,
      elapsed_days: r.elapsed_days,
      scheduled_days: r.scheduled_days,
      reps: r.reps,
      lapses: r.lapses,
      fsrs_state: r.fsrs_state,
      due_date: r.due_date,
      last_review: r.last_review,
      first_seen: r.first_seen,
      // Migration 007 field - coalesce absent key to null for old clients.
      hidden_since: r.hidden_since ?? null,
      // Migration 008 field - omit rather than coalesce to false: a false written
      // over an existing true would trip the one-way trigger (migration 017), and
      // omitting lets the DB column retain its current value on conflict.
      ...(r.seen_in_pasture != null ? { seen_in_pasture: r.seen_in_pasture } : {}),
      // updated_at is intentionally omitted: INSERT uses DEFAULT now(); UPDATE
      // uses the card_reviews_set_updated_at_trigger (migration 043). Sending a
      // server-clock value here (or worse, the client-clock value from the
      // beacon payload) would override the trigger and defeat the lastPullAt
      // clock-skew anchor documented in docs/sync.md (F22 / #1856).
    };
  }

  outerLoop:
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(toDbRow);
    let batchOk = false;
    for (let attempt = 0; attempt < BATCH_RETRIES; attempt++) {
      try {
        const { error } = await supabase
          .from("card_reviews")
          .upsert(batch, { onConflict: CARD_REVIEWS_CONFLICT_COLS });
        if (!error) {
          batchOk = true;
          break;
        }
        if (isStructuralError(error)) {
          // Structural errors are never transient - do not retry. Log for error
          // monitoring and break both loops to return a 409 immediately.
          console.error(
            `[sync/route] structural error on card_reviews upsert (SQLSTATE ${error.code}): ${error.message}`
          );
          structuralErrorCode = error.code;
          allOk = false;
          break outerLoop;
        }
        // 23514 = check_violation from the regression trigger. One stale row
        // in the batch aborts the entire Postgres statement, preventing 199
        // valid rows from landing. Fall back to per-row upserts so a single
        // rejected row cannot poison the batch (F23 / #1856).
        if (error.code === "23514") {
          let batchHadGoodRow = false;
          for (const row of batch) {
            try {
              const { error: rowError } = await supabase
                .from("card_reviews")
                .upsert(row, { onConflict: CARD_REVIEWS_CONFLICT_COLS });
              if (!rowError) {
                batchHadGoodRow = true;
              } else if (rowError.code !== "23514") {
                // Unexpected error on an individual row - log but continue.
                console.warn(
                  `[sync/route] per-row upsert error (SQLSTATE ${rowError.code}): ${rowError.message}`
                );
              }
              // 23514 on an individual row: silently skip (the cloud row is newer).
            } catch {
              // Best-effort: per-row network error, skip and continue.
            }
          }
          // Count the batch as ok when at least one row landed; individual
          // rejections are intentional evictions, not failures.
          if (batchHadGoodRow) batchOk = true;
          break; // per-row fallback is its own retry; exit the attempt loop.
        }
      } catch {
        // Network-level error - fall through to retry.
      }
      if (attempt < BATCH_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    if (!batchOk) allOk = false;
  }

  if (structuralErrorCode !== null) {
    // 409 Conflict: the client should NOT retry - the error means the ON CONFLICT
    // target no longer matches any unique constraint, or a constraint is violated.
    // This is distinguishable from a transient 502 so a future client version
    // can show the structural-error banner without waiting for FAILURE_THRESHOLD
    // retries. sendBeacon callers (pagehide path) cannot observe this code, but
    // the fetch+keepalive path (visibilitychange) can.
    return NextResponse.json(
      { ok: false, error: "structural_error", code: structuralErrorCode },
      { status: 409 }
    );
  }

  if (!allOk) {
    // Use 502 so the fetch+keepalive path (visibilitychange) sees `!res.ok` and
    // surfaces a real sync-failed banner. sendBeacon (pagehide) still cannot
    // observe this - the browser only reports "queued: true" regardless.
    return NextResponse.json({ ok: false, error: "partial_failure" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
