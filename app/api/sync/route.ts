import { NextResponse } from "next/server";
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

  const supabase = await createClient();
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
