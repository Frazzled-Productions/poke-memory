import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Push subscription re-persist endpoint (#1858 F35).
 *
 * Called by the `pushsubscriptionchange` handler in `app/sw.ts` when the push
 * service rotates or expires the current subscription. The handler re-subscribes
 * via `PushManager.subscribe()` and POSTs the new subscription data here so the
 * server row is updated.
 *
 * Authentication: session cookie (the SW fetch is same-origin and includes
 * credentials by default). The route rejects 401 for unauthenticated callers.
 *
 * DB operations mirror `subscribeToPush` in `lib/push/subscribe.ts`:
 * delete-then-insert keeps the operation inside the SELECT/INSERT/DELETE RLS
 * policies (there is no UPDATE policy on `push_subscriptions`).
 */
export async function POST(request: Request) {
  let body: { endpoint?: unknown; p256dh?: unknown; auth?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { endpoint, p256dh, auth } = body;
  if (
    typeof endpoint !== "string" || endpoint.length === 0 ||
    typeof p256dh !== "string" || p256dh.length === 0 ||
    typeof auth !== "string" || auth.length === 0
  ) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const supabase = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Delete any existing row for this (user_id, endpoint) pair and re-insert.
  // Matching the delete-then-insert pattern from lib/push/subscribe.ts::subscribeToPush.
  const { error: deleteError } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);

  if (deleteError) {
    return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 500 });
  }

  const { error: insertError } = await supabase
    .from("push_subscriptions")
    .insert({
      user_id: user.id,
      endpoint,
      p256dh,
      auth_secret: auth,
      last_seen_at: new Date().toISOString(),
    });

  if (insertError) {
    return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
