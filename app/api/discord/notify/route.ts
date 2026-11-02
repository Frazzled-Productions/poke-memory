import { NextResponse } from "next/server";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/auth/bearerAuth";
import { parseJsonBody } from "@/lib/api/parseJsonBody";
import { supabaseSecretKey } from "@/lib/supabase/keys";

/**
 * POST /api/discord/notify (#1653, #1848, ops #405)
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
 *   Deletion event (migration 051, AFTER DELETE trigger): { event: "deleted", id }
 *
 * MESSAGE PREVIEW (#1848)
 *   After the forbidden-fields guard passes, this route fetches the message
 *   by id from the feedback table using the service-role client. A capped
 *   preview (≤500 chars) is added to the embed. The message is never in the
 *   inbound trigger payload and never passes through pg_net.
 *
 * DELETION WITH THE FEEDBACK (ops #405)
 *   The post is sent with `?wait=true` so Discord returns its message id,
 *   which is stored in `feedback_discord_posts` against the feedback id. When
 *   the feedback row is deleted (the 12-month purge or the account cascade),
 *   the AFTER DELETE trigger from migration 051 sends a deletion event and this
 *   route deletes the Discord message, preview included, then the stored id.
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

/** Shape of the JSON body sent by the AFTER DELETE trigger (migration 051). */
type DeletedBody = {
  event: "deleted";
  id: string;
};

/** Maximum characters in the message preview field sent to Discord. */
const MESSAGE_PREVIEW_MAX = 500;

/**
 * Fetch the feedback message by row id using the service-role client.
 * Returns the capped preview string, or null if the query fails / returns
 * no row (the embed is still useful via the deep link in that case).
 */
async function fetchMessagePreview(
  admin: AdminClient,
  feedbackId: string,
): Promise<string | null> {
  try {
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

type AdminClient = SupabaseClient;

function adminClient(supabaseUrl: string, serviceRoleKey: string): AdminClient {
  return createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The webhook URL with `extraPath` appended and `wait=true` set where asked.
 * Existing query parameters (such as `thread_id`) are kept.
 */
function webhookUrlFor(webhookUrl: string, extraPath = "", wait = false): string {
  const url = new URL(webhookUrl);
  url.pathname = url.pathname.replace(/\/$/, "") + extraPath;
  if (wait) url.searchParams.set("wait", "true");
  return url.toString();
}

/**
 * Store the Discord message id against the feedback id so the post can be
 * deleted with the feedback. Failures are logged, never fatal: the post has
 * already gone out.
 */
async function storeDiscordMessageId(
  admin: AdminClient,
  feedbackId: string,
  discordRes: Response,
): Promise<void> {
  try {
    const sent = (await discordRes.json()) as { id?: unknown };
    if (typeof sent.id !== "string" || sent.id === "") {
      console.error("[discord/notify] webhook response had no message id; post cannot be deleted later");
      return;
    }
    const { error } = await admin
      .from("feedback_discord_posts")
      .insert({ feedback_id: feedbackId, discord_message_id: sent.id });
    if (error) {
      console.error("[discord/notify] storing the Discord message id failed", error);
    }
  } catch (err) {
    console.error("[discord/notify] storing the Discord message id threw", err);
  }
}

/**
 * Delete the Discord post for a deleted feedback row, then its stored id.
 * A post Discord no longer has (404) counts as deleted. Any other failure
 * keeps the stored id and answers 502.
 */
async function deleteDiscordPost(
  admin: AdminClient,
  webhookUrl: string,
  feedbackId: string,
): Promise<NextResponse> {
  const { data, error } = await admin
    .from("feedback_discord_posts")
    .select("discord_message_id")
    .eq("feedback_id", feedbackId)
    .maybeSingle();
  if (error) {
    console.error("[discord/notify] reading the stored Discord message id failed", error);
    return NextResponse.json({ ok: false, error: "lookup_failed" }, { status: 502 });
  }
  if (!data) return NextResponse.json({ ok: true, deleted: false });

  const messageId = (data as { discord_message_id: string }).discord_message_id;
  let res: Response;
  try {
    res = await fetch(webhookUrlFor(webhookUrl, `/messages/${encodeURIComponent(messageId)}`), {
      method: "DELETE",
    });
  } catch (err) {
    console.error("[discord/notify] delete fetch failed", err);
    return NextResponse.json({ ok: false, error: "webhook_fetch_failed" }, { status: 502 });
  }
  if (!res.ok && res.status !== 404) {
    console.error("[discord/notify] webhook delete error", res.status);
    return NextResponse.json(
      { ok: false, error: "webhook_error", status: res.status },
      { status: 502 },
    );
  }

  const { error: deleteError } = await admin
    .from("feedback_discord_posts")
    .delete()
    .eq("feedback_id", feedbackId);
  if (deleteError) {
    console.error("[discord/notify] removing the stored Discord message id failed", deleteError);
  }
  return NextResponse.json({ ok: true, deleted: true });
}

/** Discord embed colour for bug reports (red). */
const EMBED_COLOUR_BUG = 0xe74c3c;

export async function POST(request: Request) {
  const sharedSecret = process.env.CRON_SHARED_SECRET;
  const webhookUrl = process.env.DISCORD_NOTIFY_WEBHOOK_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = supabaseSecretKey();

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

  const parsed = await parseJsonBody<NotifyBody>(request);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed.data;

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

  const admin = serviceRoleKey ? adminClient(supabaseUrl, serviceRoleKey) : null;

  if (rawBody.event === "deleted") {
    const { id } = body as unknown as DeletedBody;
    if (!admin) {
      console.error("[discord/notify] no Supabase key; cannot delete the Discord post");
      return NextResponse.json({ ok: false, error: "misconfigured" }, { status: 503 });
    }
    return deleteDiscordPost(admin, webhookUrl, id);
  }

  const deepLink = buildDeepLink(supabaseUrl, body.id);
  const ts = new Date(body.created_at).toISOString();

  // Fetch the message preview route-side (never via pg_net). Failures are
  // non-fatal: the embed still posts with the deep link.
  const messagePreview = admin ? await fetchMessagePreview(admin, body.id) : null;

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
    discordRes = await fetch(webhookUrlFor(webhookUrl, "", true), {
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

  if (admin) await storeDiscordMessageId(admin, body.id, discordRes);

  return NextResponse.json({ ok: true });
}
