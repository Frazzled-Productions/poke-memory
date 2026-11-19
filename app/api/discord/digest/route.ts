import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth/bearerAuth";
import { getEnv } from "@/lib/db/env";
import { feedbackForDigest } from "@/lib/db/system";
import { outboundAllowed } from "@/lib/outbound";

/**
 * POST /api/discord/digest (#1653)
 *
 * Called weekly on Mondays at 09:00 UTC by the Worker's Cron Trigger
 * (lib/cron/schedule.ts; was the `feedback-discord-digest` pg_cron job of
 * migration 042). Reads the `feedback` table in D1 for the past N days
 * (default 7), groups rows by category and authenticated status, and posts a
 * summary embed to the maintainer's Discord channel.
 *
 * AUTH MODEL
 *   Bearer token via `Authorization: Bearer <CRON_SHARED_SECRET>`.
 *
 * BODY (optional)
 *   { "window_days": 7 }
 *   window_days is clamped to 1-90 (server-side); a missing body (the Cron
 *   Trigger sends none) or a value outside the range falls back to 7.
 *
 * QUERY CONTRACT
 *   One query (feedbackForDigest in lib/db/system): id, category and whether
 *   user_id is set, for every row in the window. NEVER select or send message
 *   or user_id.
 *
 * DISCORD WEBHOOK
 *   URL read from the DISCORD_DIGEST_WEBHOOK_URL Worker secret. Outside
 *   production nothing is posted; the counts are logged and returned.
 */

/** Discord embed colour for digest (blue). */
const EMBED_COLOUR_DIGEST = 0x3498db;

/** Aggregate counts by category for the digest embed. */
type CategoryStats = {
  total: number;
  authenticated: number;
  guest: number;
};

export async function POST(request: Request) {
  const env = await getEnv();
  const sharedSecret = env.CRON_SHARED_SECRET;
  const webhookUrl = env.DISCORD_DIGEST_WEBHOOK_URL;
  const sending = outboundAllowed(env);

  if (!sharedSecret || (sending && !webhookUrl)) {
    return NextResponse.json(
      { ok: false, error: "misconfigured" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!isAuthorized(authHeader, sharedSecret)) {
    return new NextResponse(null, { status: 401 });
  }

  // Parse window_days from body; clamp to [1, 90], default 7.
  let windowDays = 7;
  try {
    const parsed = (await request.json()) as Record<string, unknown>;
    if (typeof parsed.window_days === "number") {
      windowDays = Math.max(1, Math.min(90, Math.round(parsed.window_days)));
    }
  } catch {
    // Missing / malformed body - default window is fine.
  }

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  let rows: Awaited<ReturnType<typeof feedbackForDigest>>;
  try {
    rows = await feedbackForDigest(env.DB, since);
  } catch (err) {
    console.error("[discord/digest] query error", err);
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 502 });
  }
  const total = rows.length;

  // Group by category, accumulating authenticated vs guest counts.
  const byCategory = new Map<string, CategoryStats>();
  for (const row of rows) {
    const cat = row.category;
    if (!byCategory.has(cat)) {
      byCategory.set(cat, { total: 0, authenticated: 0, guest: 0 });
    }
    const stats = byCategory.get(cat)!;
    stats.total += 1;
    if (row.authenticated) {
      stats.authenticated += 1;
    } else {
      stats.guest += 1;
    }
  }

  // Build embed fields: one per category in a stable order.
  const CATEGORY_ORDER = ["bug", "feature", "other"];
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  fields.push({
    name: "Window",
    value: `Past ${windowDays} day${windowDays === 1 ? "" : "s"}`,
    inline: false,
  });

  fields.push({
    name: "Total",
    value: String(total),
    inline: true,
  });

  for (const cat of CATEGORY_ORDER) {
    const stats = byCategory.get(cat);
    if (!stats) continue;
    const label = cat.charAt(0).toUpperCase() + cat.slice(1);
    fields.push({
      name: label,
      value: `${stats.total} (${stats.authenticated} auth, ${stats.guest} guest)`,
      inline: true,
    });
  }

  const embed = {
    title: "Weekly feedback digest",
    color: EMBED_COLOUR_DIGEST,
    fields,
    footer: {
      text: "Poké Memory feedback system",
    },
    timestamp: new Date().toISOString(),
  };

  if (!sending) {
    console.info(`[discord/digest] would post a digest of ${total} row(s) over ${windowDays} day(s); outbound off`);
    return NextResponse.json({ ok: true, total, windowDays, posted: false });
  }

  // If no feedback this week, still post (zero-count digest is useful signal).
  let discordRes: Response;
  try {
    discordRes = await fetch(webhookUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.error("[discord/digest] fetch failed", err);
    return NextResponse.json({ ok: false, error: "webhook_fetch_failed" }, { status: 502 });
  }

  if (!discordRes.ok) {
    const errText = await discordRes.text().catch(() => "(unreadable)");
    console.error("[discord/digest] webhook error", discordRes.status, errText);
    return NextResponse.json(
      { ok: false, error: "webhook_error", status: discordRes.status },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, total, windowDays });
}
