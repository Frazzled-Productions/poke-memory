import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { CloudRow } from "@/lib/sync/cloud";

type BeaconPayload = {
  cards: CloudRow[];
};

// sendBeacon delivers fire-and-forget — the browser does not expose the server
// response code to the sender. A 400 or 500 here is silently discarded by the
// browser. The Content-Type: application/json blob contract is the only
// enforcement on the wire; the explicit array guard below catches malformed
// payloads server-side.
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
    try {
      const { error } = await supabase
        .from("card_reviews")
        .upsert(batch, { onConflict: "user_id,card_type,subject_key" });
      if (error) allOk = false;
    } catch {
      allOk = false;
    }
  }

  if (!allOk) {
    return NextResponse.json({ ok: false, error: "partial_failure" }, { status: 207 });
  }
  return NextResponse.json({ ok: true });
}
