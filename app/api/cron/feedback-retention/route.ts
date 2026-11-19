import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/auth/bearerAuth";
import { getEnv } from "@/lib/db/env";
import { deleteFeedbackCreatedBefore, discordPostStore, feedbackRetentionCutoff } from "@/lib/db/system";
import { deleteBugNotification } from "@/lib/discord/notify";

/**
 * POST /api/cron/feedback-retention (design D2), daily at 03:00 UTC.
 *
 * Deletes feedback older than 12 months (was the `feedback-retention-purge`
 * pg_cron job of migration 034), then the Discord post of every deleted bug
 * report and its stored id (was migration 051's delete trigger). A post that
 * cannot be deleted keeps its stored id and is logged; the feedback row is
 * gone either way. Outside production no Discord call is made.
 *
 * Bearer CRON_SHARED_SECRET, constant time. Responds with the counts.
 */

export async function POST(request: Request) {
  const env = await getEnv();
  const refused = cronGuard(request, env.CRON_SHARED_SECRET);
  if (refused) return refused;

  let deleted: { id: string; category: string }[];
  try {
    deleted = await deleteFeedbackCreatedBefore(env.DB, feedbackRetentionCutoff(new Date()));
  } catch (err) {
    console.error("[cron/feedback-retention] delete failed", err);
    return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 502 });
  }

  const store = discordPostStore(env.DB);
  let postsDeleted = 0;
  let postsFailed = 0;
  for (const row of deleted) {
    if (row.category !== "bug") continue;
    const result = await deleteBugNotification(env, store, row.id);
    if (!result.ok) postsFailed++;
    else if (result.deleted) postsDeleted++;
  }

  console.info(
    `[cron/feedback-retention] deleted ${deleted.length} feedback row(s), ${postsDeleted} Discord post(s); ${postsFailed} post(s) failed`,
  );
  return NextResponse.json({ ok: true, deleted: deleted.length, postsDeleted, postsFailed });
}
