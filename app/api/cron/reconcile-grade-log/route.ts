import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/auth/bearerAuth";
import { getEnv } from "@/lib/db/env";
import { reconcileGradeLogOrphans } from "@/lib/db/system";

/**
 * POST /api/cron/reconcile-grade-log (design D2), Sundays at 04:00 UTC.
 *
 * Runs reconcile_grade_log_orphans (migration 032, #1360) in dry-run mode,
 * as its pg_cron job did: it counts the grade_log subjects that graduated in
 * the last four days but have no card_reviews row, logs the count, and
 * inserts nothing. Going live is a separate decision (032's "LIVE
 * ACTIVATION"): reconcileGradeLogOrphans(db, { dryRun: false }).
 *
 * Bearer CRON_SHARED_SECRET, constant time.
 */
export async function POST(request: Request) {
  const env = await getEnv();
  const refused = cronGuard(request, env.CRON_SHARED_SECRET);
  if (refused) return refused;

  try {
    const result = await reconcileGradeLogOrphans(env.DB, { dryRun: true });
    console.info(`[cron/reconcile-grade-log] dry run: ${result.orphans} orphan row(s) would be inserted`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/reconcile-grade-log] failed", err);
    return NextResponse.json({ ok: false, error: "reconcile_failed" }, { status: 502 });
  }
}
