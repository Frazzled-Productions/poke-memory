import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/api/parseJsonBody";
import { requireAuth } from "@/lib/auth/requireAuth";
import { getDb } from "@/lib/db/env";
import { forUser } from "@/lib/db/scope";
import { isKnownPushEndpoint } from "@/lib/push/endpoints";

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
 * delete-then-insert of the (user_id, endpoint) row, through forUser
 * (lib/db/scope.ts) so both are pinned to the session user. The database
 * stamps last_seen_at on insert (migration 049's trigger).
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody<{ endpoint?: unknown; p256dh?: unknown; auth?: unknown }>(request);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed.data;

  const { endpoint, p256dh, auth } = body;
  if (
    typeof endpoint !== "string" || !isKnownPushEndpoint(endpoint) ||
    typeof p256dh !== "string" || p256dh.length === 0 ||
    typeof auth !== "string" || auth.length === 0
  ) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const authResult = await requireAuth(request, { withOkField: true });
  if (authResult instanceof NextResponse) return authResult;
  const db = forUser(await getDb(), authResult.user.id);

  // Delete any existing row for this (user_id, endpoint) pair and re-insert.
  // Matching the delete-then-insert pattern from lib/push/subscribe.ts::subscribeToPush.
  try {
    await db.delete("push_subscriptions", [{ column: "endpoint", op: "eq", value: endpoint }]);
  } catch {
    return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 500 });
  }

  try {
    await db.insert("push_subscriptions", {
      endpoint,
      p256dh,
      auth_secret: auth,
      last_seen_at: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
