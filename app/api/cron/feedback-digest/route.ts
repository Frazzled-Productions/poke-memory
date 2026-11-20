import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/auth/bearerAuth";
import { getEnv } from "@/lib/db/env";
import { feedbackForDigest } from "@/lib/db/system";
import { sendAlertEmail } from "@/lib/alertEmail";
import { feedbackDigestAlert } from "@/lib/feedback/alerts";
import { outboundAllowed } from "@/lib/outbound";

/**
 * POST /api/cron/feedback-digest (#1653), Mondays at 09:00 UTC from the
 * Worker's Cron Trigger (lib/cron/schedule.ts; was the
 * `feedback-discord-digest` pg_cron job of migration 042, and a Discord post
 * until Fraser's ruling of 20 November 2026).
 *
 * Reads the past N days of feedback (default 7), counts rows by category and
 * signed-in against guest, and emails the counts to the company mailbox
 * through lib/alertEmail.ts. One query (feedbackForDigest): never the message
 * or user_id.
 *
 * Bearer CRON_SHARED_SECRET, constant time. Optional body
 * `{ "window_days": 7 }`, rounded and clamped to 1-90; a missing body (the
 * Cron Trigger sends none) or an unparseable one gives 7.
 *
 * Outside production nothing is sent; the counts are logged and returned.
 * Without RESEND_API_KEY the email is logged and skipped (200, sent false);
 * a refusal or network error from Resend answers 502.
 */
export async function POST(request: Request) {
  const env = await getEnv();
  const refused = cronGuard(request, env.CRON_SHARED_SECRET);
  if (refused) return refused;

  let windowDays = 7;
  try {
    const parsed = (await request.json()) as Record<string, unknown>;
    if (typeof parsed.window_days === "number") {
      windowDays = Math.max(1, Math.min(90, Math.round(parsed.window_days)));
    }
  } catch {
    // Missing or malformed body: the default window is fine.
  }

  let rows: Awaited<ReturnType<typeof feedbackForDigest>>;
  try {
    rows = await feedbackForDigest(env.DB, new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000));
  } catch (err) {
    console.error("[cron/feedback-digest] query error", err);
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 502 });
  }
  const total = rows.length;

  if (!outboundAllowed(env)) {
    console.info(`[cron/feedback-digest] would email a digest of ${total} row(s) over ${windowDays} day(s); outbound off`);
    return NextResponse.json({ ok: true, total, windowDays, sent: false });
  }

  // An empty week is still sent: a zero count is a useful signal.
  const sent = await sendAlertEmail(env, feedbackDigestAlert(windowDays, rows));
  if (!sent && env.RESEND_API_KEY) {
    return NextResponse.json({ ok: false, error: "email_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, total, windowDays, sent });
}
