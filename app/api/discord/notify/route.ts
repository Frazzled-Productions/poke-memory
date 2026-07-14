import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/auth/bearerAuth";

/**
 * POST /api/discord/notify (#1653, #1848)
 *
 * Receives safe feedback metadata from the pg_net AFTER INSERT trigger on
 * the `feedback` table (via migration 042) and posts a Discord embed to
 * the maintainer's Discord webhook. Fires only for category = 'bug' rows.
 *
 * AUTH MODEL
 *   Bearer token via `Authorization: Bearer <CRON_SHARED_SECRET>`. The same
 *   secret guards the push/send-daily route; no new secret needed.
 *
 * PAYLOAD CONTRACT (from the DB trigger)
 *   { id, category, page, app_version, created_at, authenticated }
 *   NEVER contains message or user_id.
 *
 * MESSAGE PREVIEW (#1848)
 *   After the forbidden-fields guard passes, this route fetches the message
 *   by id from the feedback table using the service-role client. A capped
 *   preview (≤500 chars) is added to the embed. The message is never in the
 *   inbound trigger payload and never passes through pg_net.
 *
 * DISCORD WEBHOOK
 *   URL read from DISCORD_NOTIFY_WEBHOOK_URL env (server-side only). The
 *   DB trigger does not know the Discord URL; it only knows the Vercel route
 *   URL. Keeping the Discord webhook URL in Vercel env means it never touches
 *   the DB or pg_net payload logs.
 */

/** Shape of the JSON body sent by the pg_net trigger. */
type NotifyBody = {
  id: string;
  category: string;
  page: string | null;
  app_version: string | null;
  created_at: string;
  authenticated: boolean;
};

/** Maximum characters in the message preview field sent to Discord. */
const MESSAGE_PREVIEW_MAX = 500;

/**
 * Fetch the feedback message by row id using the service-role client.
 * Returns the capped preview string, or null if the query fails / returns
 * no row (the embed is still useful via the deep link in that case).
 */
async function fetchMessagePreview(
  supabaseUrl: string,
  serviceRoleKey: string,
  feedbackId: string,
): Promise<string | null> {
  try {
    const admin = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin
      .from("feedback")
      .select("message")
      .eq("id", feedbackId)
      .single();

    if (error || !data) {
      console.warn("[discord/notify] message fetch failed or no row", error);
      return null;
    }

    const raw = (data as { message: string }).message ?? "";
    if (raw.length > MESSAGE_PREVIEW_MAX) {
      return raw.slice(0, MESSAGE_PREVIEW_MAX) + "…";
    }
    return raw;
  } catch (err) {
    console.warn("[discord/notify] message fetch threw", err);
    return null;
  }
}

/** Supabase dashboard deep link to the feedback row for the maintainer. */
function buildDeepLink(supabaseUrl: string, feedbackId: string): string {
  // Points at the Supabase Table Editor filtered to the specific row ID.
  // This is a maintainer-only surface (requires Supabase dashboard login).
  // Uses feedback.id (random UUID) - never user_id.
  const projectRef = supabaseUrl
    .replace(/^https?:\/\//, "")
    .split(".")[0];
  return `https://supabase.com/dashboard/project/${projectRef}/editor?filter=id%3Aeq%3A${feedbackId}`;
}

/** Discord embed colour for bug reports (red). */
const EMBED_COLOUR_BUG = 0xe74c3c;

export async function POST(request: Request) {
  const sharedSecret = process.env.CRON_SHARED_SECRET;
  const webhookUrl = process.env.DISCORD_NOTIFY_WEBHOOK_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sharedSecret || !webhookUrl || !supabaseUrl) {
    return NextResponse.json(
      { ok: false, error: "misconfigured" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!isAuthorized(authHeader, sharedSecret)) {
    return new NextResponse(null, { status: 401 });
  }

  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Validate that neither message nor user_id are present in the body
  // (belt-and-braces guard - the trigger never sends them, but we assert here
  // so the route is provably safe even if the body were to change).
  // This guard checks the trigger payload only. The route fetches the message
  // separately by id using the service-role client after this check passes.
  const rawBody = body as Record<string, unknown>;
  if ("message" in rawBody || "user_id" in rawBody) {
    // Refuse to forward - log and return 400.
    console.error("[discord/notify] body contained forbidden fields; refusing to forward");
    return NextResponse.json({ ok: false, error: "forbidden_fields" }, { status: 400 });
  }

  const deepLink = buildDeepLink(supabaseUrl, body.id);
  const ts = new Date(body.created_at).toISOString();

  // Fetch the message preview route-side (never via pg_net). Failures are
  // non-fatal: the embed still posts with the deep link.
  const messagePreview = serviceRoleKey
    ? await fetchMessagePreview(supabaseUrl, serviceRoleKey, body.id)
    : null;

  const embed = {
    title: "New bug report",
    color: EMBED_COLOUR_BUG,
    fields: [
      {
        name: "Page",
        value: body.page ?? "(not provided)",
        inline: true,
      },
      {
        name: "App version",
        value: body.app_version ?? "(not provided)",
        inline: true,
      },
      {
        name: "Authenticated",
        value: body.authenticated ? "Yes" : "No (guest)",
        inline: true,
      },
      {
        name: "Timestamp",
        value: ts,
        inline: false,
      },
      ...(messagePreview !== null
        ? [
            {
              name: "Message preview",
              value: messagePreview,
              inline: false,
            },
          ]
        : []),
      {
        name: "View in Supabase",
        value: deepLink,
        inline: false,
      },
    ],
    footer: {
      text: "Poké Memory feedback system",
    },
  };

  let discordRes: Response;
  try {
    discordRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.error("[discord/notify] fetch failed", err);
    return NextResponse.json({ ok: false, error: "webhook_fetch_failed" }, { status: 502 });
  }

  if (!discordRes.ok) {
    const errText = await discordRes.text().catch(() => "(unreadable)");
    console.error("[discord/notify] webhook error", discordRes.status, errText);
    return NextResponse.json(
      { ok: false, error: "webhook_error", status: discordRes.status },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
