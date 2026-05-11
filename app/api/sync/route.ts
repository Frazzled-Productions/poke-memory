import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { CloudRow } from "@/lib/sync/cloud";

type BeaconPayload = {
  cards: CloudRow[];
};

export async function POST(request: Request) {
  let payload: BeaconPayload;
  try {
    payload = (await request.json()) as BeaconPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
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

  const rows = payload.cards ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const BATCH = 200;
  const updatedAt = new Date().toISOString();
  let allOk = true;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({
      ...r,
      user_id: user.id,
      updated_at: updatedAt,
    }));
    try {
      const { error } = await supabase
        .from("card_reviews")
        .upsert(batch, { onConflict: "user_id,pokemon_id" });
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
