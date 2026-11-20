import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/auth/bearerAuth";
import { getEnv } from "@/lib/db/env";
import { deleteExpiredRateLimitBuckets } from "@/lib/db/system";

/**
 * POST /api/cron/rate-limit-cleanup (design D2), every 30 minutes.
 *
 * Deletes rate_limit_buckets rows older than two hours (was the
 * `rate-limit-buckets-purge` pg_cron job of migration 041). The longest
 * window any check looks at is one hour.
 *
 * Bearer CRON_SHARED_SECRET, constant time.
 */
export async function POST(request: Request) {
  const env = await getEnv();
  const refused = cronGuard(request, env.CRON_SHARED_SECRET);
  if (refused) return refused;

  try {
    const deleted = await deleteExpiredRateLimitBuckets(env.DB);
    console.info(`[cron/rate-limit-cleanup] deleted ${deleted} bucket row(s)`);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    console.error("[cron/rate-limit-cleanup] failed", err);
    return NextResponse.json({ ok: false, error: "cleanup_failed" }, { status: 502 });
  }
}
