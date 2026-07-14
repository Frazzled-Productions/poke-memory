import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { hashIp } from "@/lib/auth/rateLimitIp";
import { parseJsonBody } from "@/lib/api/parseJsonBody";
import type { RateLimitAction } from "@/lib/auth/rateLimitIp";

/**
 * POST /api/feedback (#1621)
 *
 * Accepts in-app bug reports and feature requests from both guest and
 * authenticated users. Writes via the service-role admin client so the
 * endpoint works regardless of RLS state on the `feedback` table.
 *
 * `user_id` is derived from the server-validated session - NEVER from the
 * request body - to prevent callers from spoofing another user's id.
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

export async function POST(request: Request) {
  // --- Env guard ---
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: "misconfigured" }, { status: 500 });
  }

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
  const category = body.category;

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

  // --- Resolve user_id from server-validated session (never from request body) ---
  let userId: string | null = null;
  // Also obtain the anonymous Supabase client for rate-limit checks.
  let rateLimitSupabase: Awaited<ReturnType<typeof createServerSupabaseClient>> | null = null;
  try {
    const supabase = await createServerSupabaseClient();
    rateLimitSupabase = supabase;
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    // Guest or session error - proceed with null user_id.
    userId = null;
  }

  // --- Per-IP rate limit: mirrors the check in lib/auth/actions.ts (F28/F32) ---
  if (rateLimitSupabase !== null) {
    try {
      const rawIp = (request.headers.get("x-forwarded-for") ?? "unknown")
        .split(",")[0]
        .trim();
      const ipHash = hashIp(rawIp);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rlAllowed, error: rlError } = await (rateLimitSupabase as any).rpc(
        "check_rate_limit",
        { p_ip_hash: ipHash, p_action: "feedback" as RateLimitAction },
      );
      if (rlAllowed === false) {
        return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
      }
      if (rlError) {
        // Rate-limit check failure is non-fatal: log and continue so the endpoint
        // stays available when the RPC is transiently unavailable (e.g. unknown
        // action branch not yet deployed). Only an explicit false blocks the request.
        console.warn("[feedback] rate-limit check error, proceeding", rlError);
      }
    } catch {
      // Unexpected throw (e.g. network error) - also non-fatal.
      console.warn("[feedback] rate-limit check failed, proceeding");
    }
  }

  // --- Insert via admin client (service-role, bypasses RLS) ---
  const admin = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { error } = await admin.from("feedback").insert({
      user_id: userId,
      category,
      message,
      page,
      app_version: appVersion,
    });

    if (error) {
      console.error("[feedback] insert error", error);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  } catch (err) {
    console.error("[feedback] unexpected error", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
