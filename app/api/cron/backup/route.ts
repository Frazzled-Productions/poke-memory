import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/auth/bearerAuth";
import { runBackup } from "@/lib/db/backup";
import { getEnv } from "@/lib/db/env";

/**
 * POST /api/cron/backup (design D10), nightly at 02:00 UTC.
 *
 * Writes every D1 table as SQL INSERT statements to the R2 bucket bound as
 * BACKUPS (poke-memory-backups, or poke-memory-backups-preview on the
 * preview Worker) at `d1/YYYY-MM-DD.sql`, then deletes backups older than
 * 90 days. Format and restore: lib/db/backup.ts.
 *
 * Bearer CRON_SHARED_SECRET, constant time. Responds with the key, size and
 * row counts (counts only, never data).
 */
export async function POST(request: Request) {
  const env = await getEnv();
  const refused = cronGuard(request, env.CRON_SHARED_SECRET);
  if (refused) return refused;
  if (!env.BACKUPS) {
    return NextResponse.json({ ok: false, error: "misconfigured" }, { status: 503 });
  }

  try {
    const result = await runBackup(env.DB, env.BACKUPS);
    console.info(
      `[cron/backup] wrote ${result.key} (${result.bytes} bytes); pruned ${result.pruned.length} old backup(s)`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/backup] failed", err);
    return NextResponse.json({ ok: false, error: "backup_failed" }, { status: 502 });
  }
}
