import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/auth/bearerAuth";

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
 *   Two queries: (1) SELECT id, category, created_at for all rows in the
 *   window; (2) SELECT id, category filtered by user_id IS NOT NULL (filter
 *   only - user_id never appears in the JS SELECT list). NEVER select or
 *   send message or user_id.
 *
 * DISCORD WEBHOOK
 *   URL read from DISCORD_DIGEST_WEBHOOK_URL env (server-side only).
 */

/** Discord embed colour for digest (blue). */
const EMBED_COLOUR_DIGEST = 0x3498db;

/** Aggregate counts by category for the digest embed. */
type CategoryStats = {
  total: number;
  authenticated: number;
  guest: number;
};

/** DB row shape for the all-rows digest query (user_id is never selected). */
type FeedbackRow = {
  id: string;
  category: string;
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

  // PII defence-in-depth: user_id is NEVER selected into JavaScript.
  //
  // Two queries derive the auth/guest split without touching user_id in the
  // SELECT list:
  //   1. All rows in the window (id, category, created_at) for totals.
  //   2. Authenticated rows only (user_id IS NOT NULL via .not() filter), also
  //      selecting id + category so we can cross-reference per category.
  //
  // The .not("user_id", "is", null) PostgREST filter becomes a WHERE clause;
  // user_id is never projected into JS memory.

  const [allResult, authResult] = await Promise.all([
    admin
      .from("feedback")
      .select("id, category, created_at")
      .gte("created_at", since),
    admin
      .from("feedback")
      .select("id, category")
      .gte("created_at", since)
      .not("user_id", "is", null),
  ]);

  if (allResult.error || authResult.error) {
    const err = allResult.error ?? authResult.error;
    console.error("[discord/digest] query error", err);
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 502 });
  }

  const rows = (allResult.data ?? []) as FeedbackRow[];
  const authIds = new Set((authResult.data ?? []).map((r) => (r as { id: string }).id));
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
    if (authIds.has(row.id)) {
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
