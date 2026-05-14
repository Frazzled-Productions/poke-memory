import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { CloudRow } from "@/lib/sync/cloud";

type BeaconPayload = {
  cards: CloudRow[];
};

// Two paths reach this route:
//   1. pagehide handler in useSyncOnUnload — uses sendBeacon, which does not
//      expose the server response code to the sender. The status code is
//      therefore advisory for that path; the client trusts the browser's
//      "queued" boolean and nothing more.
//   2. visibilitychange handler in useSyncOnUnload (post-#581) — uses
//      fetch+keepalive, which *does* observe the response. The client treats
//      a non-2xx as a failure and keeps the unsynced queue intact.
//
// To make path #2 reliable each batch is retried up to BATCH_RETRIES times
// before being declared failed, so a transient Supabase blip does not turn
// into a user-visible "Sync failed" banner.
export async function POST(request: Request) {
  let payload: BeaconPayload;
  try {
    payload = (await request.json()) as BeaconPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(payload.cards)) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  // Cast to untyped SupabaseClient — Database is a stub type (unknown) in this
  // repo, which causes the typed upsert to expect never[]. The untyped client
  // matches the pattern used throughout lib/sync/cloud.ts.
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rows = payload.cards;
  if (rows.length === 0) {
    return NextResponse.json({ ok: true });
  }

  // BATCH is sized larger than the 100 reviews/day soft cap as a defensive
  // measure — guards against future limit changes without requiring code updates.
  const BATCH = 200;
  // Bounded retry to absorb transient Supabase failures. A permanent failure
  // (RLS regression, constraint violation) will still bubble up after the
  // attempts are exhausted, but with N=3 a flaky network blip on a single
  // batch is unlikely to surface to the user as a sync failure.
  const BATCH_RETRIES = 3;
  const RETRY_DELAY_MS = 100;
  const updatedAt = new Date().toISOString();
  let allOk = true;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({
      user_id: user.id,
      card_type: r.card_type,
      subject_key: r.subject_key,
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
      // Migration 007 field — coalesce absent key to null for old clients.
      hidden_since: r.hidden_since ?? null,
      // Migration 008 field — omit rather than coalesce to false: a false written
      // over an existing true would trip the one-way trigger (migration 017), and
      // omitting lets the DB column retain its current value on conflict.
      ...(r.seen_in_pasture != null ? { seen_in_pasture: r.seen_in_pasture } : {}),
      updated_at: updatedAt,
    }));
    let batchOk = false;
    for (let attempt = 0; attempt < BATCH_RETRIES; attempt++) {
      try {
        const { error } = await supabase
          .from("card_reviews")
          .upsert(batch, { onConflict: "user_id,card_type,subject_key" });
        if (!error) {
          batchOk = true;
          break;
        }
      } catch {
        // fall through to retry
      }
      if (attempt < BATCH_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    if (!batchOk) allOk = false;
  }

  if (!allOk) {
    // Use 502 so the fetch+keepalive path (visibilitychange) sees `!res.ok` and
    // surfaces a real sync-failed banner. sendBeacon (pagehide) still cannot
    // observe this — the browser only reports "queued: true" regardless.
    return NextResponse.json({ ok: false, error: "partial_failure" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
