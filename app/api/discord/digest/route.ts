import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

/**
 * POST /api/discord/digest (#1653)
 *
 * Called by the `feedback-discord-digest` pg_cron job (migration 042) weekly
 * on Mondays at 09:00 UTC. Queries the `feedback` table for the past N days
 * (default 7), groups rows by category and authenticated status, and posts
 * a summary embed to the maintainer's Discord channel.
 *
 * AUTH MODEL
 *   Bearer token via `Authorization: Bearer <CRON_SHARED_SECRET>`.
 *
 * BODY (from pg_cron job)
 *   { "window_days": 7 }
 *   window_days is clamped to 1-90 (server-side); values outside the range
 *   fall back to 7.
 *
 * QUERY CONTRACT
 *   Only SELECT id, category, user_id (for the authenticated bool only,
 *   never forwarded), created_at. NEVER select or send message.
 *
 * DISCORD WEBHOOK
 *   URL read from DISCORD_DIGEST_WEBHOOK_URL env (server-side only).
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

/** Discord embed colour for digest (blue). */
const EMBED_COLOUR_DIGEST = 0x3498db;

/** Aggregate counts by category for the digest embed. */
type CategoryStats = {
  total: number;
  authenticated: number;
  guest: number;
};

/** DB row shape for the digest query. */
type FeedbackRow = {
  id: string;
  category: string;
  user_id: string | null;
  created_at: string;
};

export async function POST(request: Request) {
  const sharedSecret = process.env.CRON_SHARED_SECRET;
  const webhookUrl = process.env.DISCORD_DIGEST_WEBHOOK_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sharedSecret || !webhookUrl || !supabaseUrl || !serviceRoleKey) {
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

  // Service-role client: reads across all users without RLS.
  const admin = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Compute the window start timestamp.
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // Query only the fields needed for the digest. NEVER select message.
  const { data, error } = await admin
    .from("feedback")
    .select("id, category, user_id, created_at")
    .gte("created_at", since);

  if (error) {
    console.error("[discord/digest] query error", error);
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 502 });
  }

  const rows = (data ?? []) as FeedbackRow[];
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
    if (row.user_id !== null) {
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

  // If no feedback this week, still post (zero-count digest is useful signal).
  let discordRes: Response;
  try {
    discordRes = await fetch(webhookUrl, {
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
