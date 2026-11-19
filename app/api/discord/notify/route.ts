import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth/bearerAuth";
import { parseJsonBody } from "@/lib/api/parseJsonBody";
import { getEnv } from "@/lib/db/env";
import { discordPostStore } from "@/lib/db/system";
import {
  deleteBugNotification,
  postBugNotification,
  type DeleteNotificationResult,
  type FeedbackNotice,
  type NotifyResult,
} from "@/lib/discord/notify";

/**
 * POST /api/discord/notify (#1653, #1848, ops #405)
 *
 * Posts the Discord bug notification for a feedback row, or deletes it. Since
 * the move to D1 (design D3) the feedback route and the retention job call
 * the same logic (lib/discord/notify.ts) directly; this route keeps the
 * bearer-guarded entry point for a manual resend or delete.
 *
 * AUTH MODEL
 *   Bearer token via `Authorization: Bearer <CRON_SHARED_SECRET>` (a Worker
 *   secret), compared in constant time.
 *
 * PAYLOAD CONTRACT
 *   { id, category, page, app_version, created_at, authenticated }
 *   NEVER contains message or user_id; the message preview is read from D1
 *   by id. Deletion: { event: "deleted", id }.
 *
 * Outside production (DEPLOY_ENV) nothing is sent to Discord: the route reads
 * and logs what it would have sent (lib/outbound.ts).
 */

/** Shape of a deletion body. */
type DeletedBody = {
  event: "deleted";
  id: string;
};

function toResponse(result: NotifyResult | DeleteNotificationResult): NextResponse {
  if (result.ok) {
    return NextResponse.json("deleted" in result ? { ok: true, deleted: result.deleted } : { ok: true });
  }
  if (result.error === "misconfigured") {
    return NextResponse.json({ ok: false, error: "misconfigured" }, { status: 503 });
  }
  if (result.error === "webhook_error") {
    return NextResponse.json({ ok: false, error: result.error, status: result.status }, { status: 502 });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
}

export async function POST(request: Request) {
  const env = await getEnv();
  const sharedSecret = env.CRON_SHARED_SECRET;
  if (!sharedSecret) {
    return NextResponse.json({ ok: false, error: "misconfigured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (!isAuthorized(authHeader, sharedSecret)) {
    return new NextResponse(null, { status: 401 });
  }

  const parsed = await parseJsonBody<FeedbackNotice>(request);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed.data;

  // Belt-and-braces guard: the body never carries the message or the user id.
  // The preview is read from D1 by id after this check passes.
  const rawBody = body as Record<string, unknown>;
  if ("message" in rawBody || "user_id" in rawBody) {
    console.error("[discord/notify] body contained forbidden fields; refusing to forward");
    return NextResponse.json({ ok: false, error: "forbidden_fields" }, { status: 400 });
  }

  const store = discordPostStore(env.DB);

  if (rawBody.event === "deleted") {
    const { id } = body as unknown as DeletedBody;
    if (typeof id !== "string" || id === "") {
      return NextResponse.json({ ok: false, error: "missing_id" }, { status: 400 });
    }
    return toResponse(await deleteBugNotification(env, store, id));
  }

  return toResponse(await postBugNotification(env, store, body));
}
