import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hashIp } from "@/lib/auth/rateLimitIp";
import { parseJsonBody } from "@/lib/api/parseJsonBody";
import { requireAuth } from "@/lib/auth/requireAuth";
import { getEnv } from "@/lib/db/env";
import { checkRateLimit, discordPostStore, insertFeedback, type FeedbackCategory } from "@/lib/db/system";
import { postBugNotification } from "@/lib/discord/notify";

/**
 * POST /api/feedback (#1621)
 *
 * Accepts in-app bug reports and feature requests from both guest and
 * authenticated users. Writes through lib/db/system (a guest row has no user,
 * so it cannot go through forUser).
 *
 * `user_id` is derived from the server-validated session - NEVER from the
 * request body - to prevent callers from spoofing another user's id.
 *
 * A bug report also goes to the maintainers' Discord (#1653): the route sends
 * it itself after responding, through ctx.waitUntil, in place of the Postgres
 * trigger of migration 042 (design D3). Outside production nothing is sent.
 *
 * Input shape:
 *   { category: 'bug' | 'feature' | 'other', message: string, page?: string, appVersion?: string }
 *
 * Responses:
 *   200 { ok: true } - inserted successfully
 *   400 { ok: false, error } - invalid input
 *   429 { ok: false, error: 'rate_limited' } - too many requests from this IP
 *   500 { ok: false } - unexpected server error
 */

const VALID_CATEGORIES = new Set(["bug", "feature", "other"]);
const MESSAGE_MAX_LENGTH = 2000;
const FIELD_MAX_LENGTH = 300;

type FeedbackBody = {
  category: unknown;
  message: unknown;
  page?: unknown;
  appVersion?: unknown;
};

/** The session user's id, or null for a guest (or any session error). */
async function sessionUserId(request: Request): Promise<string | null> {
  try {
    const auth = await requireAuth(request);
    return auth instanceof NextResponse ? null : auth.user.id;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  // --- Parse body ---
  const parsed = await parseJsonBody<FeedbackBody>(request);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed.data;

  // --- Validate category ---
  if (typeof body.category !== "string" || !VALID_CATEGORIES.has(body.category)) {
    return NextResponse.json(
      { ok: false, error: "invalid_category" },
      { status: 400 },
    );
  }
  const category = body.category as FeedbackCategory;

  // --- Validate message ---
  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "missing_message" },
      { status: 400 },
    );
  }
  // Truncate server-side to guard against oversized payloads.
  const message = body.message.slice(0, MESSAGE_MAX_LENGTH);

  // --- Optional fields - cap length to prevent oversized-payload spam (F28/F32) ---
  const page =
    typeof body.page === "string" && body.page.length > 0
      ? body.page.slice(0, FIELD_MAX_LENGTH)
      : null;
  const appVersion =
    typeof body.appVersion === "string" && body.appVersion.length > 0
      ? body.appVersion.slice(0, FIELD_MAX_LENGTH)
      : null;

  const env = await getEnv();

  // --- Resolve user_id from server-validated session (never from request body) ---
  const userId = await sessionUserId(request);

  // --- Per-IP rate limit (rate_limit_buckets, migrations 041 and 045; F28/F32) ---
  try {
    // Cloudflare sets CF-Connecting-IP; X-Forwarded-For is client-settable there.
    const rawIp = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
    if (!(await checkRateLimit(env.DB, hashIp(rawIp), "feedback"))) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
  } catch (err) {
    // Rate-limit check failure is non-fatal: log and continue so the endpoint
    // stays available. Only an explicit refusal blocks the request.
    console.warn("[feedback] rate-limit check failed, proceeding", err);
  }

  // --- Insert ---
  let inserted: { id: string; created_at: string };
  try {
    inserted = await insertFeedback(env.DB, {
      user_id: userId,
      category,
      message,
      page,
      app_version: appVersion,
    });
  } catch (err) {
    console.error("[feedback] insert error", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // --- Discord bug notification, after the response (was the 042 trigger) ---
  if (category === "bug") {
    const notification = postBugNotification(env, discordPostStore(env.DB), {
      id: inserted.id,
      category,
      page,
      app_version: appVersion,
      created_at: inserted.created_at,
      authenticated: userId !== null,
    }).catch((err) => console.error("[feedback] Discord notification threw", err));
    try {
      const { ctx } = await getCloudflareContext({ async: true });
      ctx.waitUntil(notification);
    } catch (err) {
      // No Worker context (should not happen on the Worker): send inline.
      console.warn("[feedback] no ctx.waitUntil; sending the notification inline", err);
      await notification;
    }
  }

  return NextResponse.json({ ok: true });
}
