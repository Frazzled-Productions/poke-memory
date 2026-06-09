import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * POST /api/discord/notify (#1653)
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
 * DISCORD WEBHOOK
 *   URL read from DISCORD_NOTIFY_WEBHOOK_URL env (server-side only). The
 *   DB trigger does not know the Discord URL; it only knows the Vercel route
 *   URL. Keeping the Discord webhook URL in Vercel env means it never touches
 *   the DB or pg_net payload logs.
 */

/** Constant-time bearer comparison (mirrors push/send-daily/route.ts). */
function isAuthorized(headerValue: string | null, secret: string): boolean {
  if (!headerValue || !secret) return false;
  const expected = `Bearer ${secret}`;
  if (headerValue.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Shape of the JSON body sent by the pg_net trigger. */
type NotifyBody = {
  id: string;
  category: string;
  page: string | null;
  app_version: string | null;
  created_at: string;
  authenticated: boolean;
};

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
  const rawBody = body as Record<string, unknown>;
  if ("message" in rawBody || "user_id" in rawBody) {
    // Refuse to forward - log and return 400.
    console.error("[discord/notify] body contained forbidden fields; refusing to forward");
    return NextResponse.json({ ok: false, error: "forbidden_fields" }, { status: 400 });
  }

  const deepLink = buildDeepLink(supabaseUrl, body.id);
  const ts = new Date(body.created_at).toISOString();

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
