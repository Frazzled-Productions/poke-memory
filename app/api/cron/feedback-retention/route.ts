import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/auth/bearerAuth";
import { getEnv } from "@/lib/db/env";
import { deleteFeedbackCreatedBefore, feedbackRetentionCutoff } from "@/lib/db/system";

/**
 * POST /api/cron/feedback-retention (design D2), daily at 03:00 UTC.
 *
 * Deletes feedback older than 12 months (was the `feedback-retention-purge`
 * pg_cron job of migration 034). Sends nothing: the bug-report emails live in
 * the company mailbox, outside the Worker's reach.
 *
 * Bearer CRON_SHARED_SECRET, constant time. Responds with the count.
 */

export async function POST(request: Request) {
  const env = await getEnv();
  const refused = cronGuard(request, env.CRON_SHARED_SECRET);
  if (refused) return refused;

  let deleted: number;
  try {
    deleted = await deleteFeedbackCreatedBefore(env.DB, feedbackRetentionCutoff(new Date()));
  } catch (err) {
    console.error("[cron/feedback-retention] delete failed", err);
    return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 502 });
  }

  console.info(`[cron/feedback-retention] deleted ${deleted} feedback row(s)`);
  return NextResponse.json({ ok: true, deleted });
}
