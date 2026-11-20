import { NextResponse } from "next/server";
import { sendAlertEmail } from "@/lib/alertEmail";
import { cronGuard } from "@/lib/auth/bearerAuth";
import { getEnv } from "@/lib/db/env";
import { checkGradeLogDivergence, divergenceReport, divergenceSummary } from "@/lib/db/system";

const TAG = "grade-log-divergence";

/**
 * POST /api/cron/grade-log-divergence (design D13), daily at 08:00 UTC.
 *
 * The #584 sync-break monitor, moved off GitHub so no runner reads player data
 * (owner ruling 20 November 2026). Runs the three grade_log vs card_reviews
 * queries (lib/db/system/gradeLogDivergence.ts) through the D1 binding. On
 * divergence it logs "grade-log-divergence: DIVERGED, ..." and emails the
 * report (masked user id prefixes and counts) to the company address through
 * Resend; when a query fails it logs "grade-log-divergence: FAILED: ...",
 * emails that line and answers 502. Never auto-resolves: the 4-day look-back
 * means "no longer firing" can just mean "aged out".
 *
 * Bearer CRON_SHARED_SECRET, constant time. Responds with counts only.
 */
export async function POST(request: Request) {
  const env = await getEnv();
  const refused = cronGuard(request, env.CRON_SHARED_SECRET);
  if (refused) return refused;

  let result;
  try {
    result = await checkGradeLogDivergence(env.DB);
  } catch (err) {
    const line = `${TAG}: FAILED: ${err instanceof Error ? err.message : String(err)}`;
    console.error(line);
    await sendAlertEmail(env, {
      tag: TAG,
      subject: "Poké Memory: grade_log divergence check FAILED",
      text: `${line}\n\nThe daily check could not run, so a sync break would go unseen. Details: Workers Logs, search "${TAG}".\n`,
    });
    return NextResponse.json({ ok: false, error: "check_failed" }, { status: 502 });
  }

  const diverged = result.users > 0;
  if (!diverged) {
    console.info(`${TAG}: ok, ${divergenceSummary(result)}`);
  } else {
    console.error(`${TAG}: DIVERGED, ${divergenceSummary(result)}, ${result.users} user(s) in all`);
    await sendAlertEmail(env, {
      tag: TAG,
      subject: `Poké Memory: grade_log divergence (${result.users} user${result.users === 1 ? "" : "s"})`,
      text: divergenceReport(result),
    });
  }
  return NextResponse.json({ ok: true, diverged, users: result.users });
}
