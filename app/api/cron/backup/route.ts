import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/auth/bearerAuth";
import { runBackup } from "@/lib/db/backup";
import { getEnv } from "@/lib/db/env";

/**
 * POST /api/cron/backup (design D10), nightly at 02:00 UTC.
 *
 * Writes every D1 table as gzipped SQL INSERT statements, with a manifest, to
 * the R2 bucket bound as BACKUPS (poke-memory-backups, production only) under
 * D1_BACKUP_PREFIX, then deletes backups older than 90 days. Format, the
 * monthly restore check and restoring: lib/db/backup.ts.
 *
 * Bearer CRON_SHARED_SECRET, constant time. Responds with the key, size and
 * row counts (counts only, never data).
 */
export async function POST(request: Request) {
  const env = await getEnv();
  const refused = cronGuard(request, env.CRON_SHARED_SECRET);
  if (refused) return refused;
  if (!env.BACKUPS || !env.D1_BACKUP_PREFIX) {
    return NextResponse.json({ ok: false, error: "misconfigured" }, { status: 503 });
  }

  try {
    const result = await runBackup(env.DB, env.BACKUPS, env.D1_BACKUP_PREFIX);
    console.info(
      `d1-backup: export ok, ${result.key} (${result.bytes} bytes), counts ${JSON.stringify(result.counts)}; pruned ${result.pruned.length} old backup(s)`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(`d1-backup: export FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ ok: false, error: "backup_failed" }, { status: 502 });
  }
}
