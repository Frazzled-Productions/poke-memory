/**
 * The 30-minute clean-up job for rate_limit_buckets (Postgres migration 041).
 * The per-IP check itself is checkRateLimit in lib/db/rateLimit.ts, which
 * lib/db/system re-exports for the feedback route.
 *
 * Only importable from the cron, push-send, Discord and feedback routes
 * (ESLint no-restricted-imports in eslint.config.mjs).
 */
import type { D1DatabaseLike } from "../d1";
import { run } from "./query";

const MINUTE_MS = 60_000;

/** How long a bucket row is kept (041's purge: older than 2 hours). */
export const RATE_LIMIT_RETENTION_MS = 2 * 60 * MINUTE_MS;

/** The clean-up job (041): deletes attempts older than two hours. Returns how many went. */
export async function deleteExpiredRateLimitBuckets(
  db: D1DatabaseLike,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - RATE_LIMIT_RETENTION_MS).toISOString();
  return run(db, `DELETE FROM rate_limit_buckets WHERE attempted_at < ?`, cutoff);
}
