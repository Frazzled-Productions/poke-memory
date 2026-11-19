/**
 * Per-IP rate limiting on rate_limit_buckets (Postgres migrations 041, 045):
 * the check from check_rate_limit and the 30-minute clean-up job.
 *
 * Only importable from the cron, push-send, Discord and feedback routes
 * (ESLint no-restricted-imports in eslint.config.mjs).
 */
import type { D1DatabaseLike } from "../d1";
import { run } from "./query";

export type RateLimitedAction = "signup" | "signin" | "feedback";

/** Attempts allowed per IP hash in the last 10 minutes and the last hour (045). */
export const RATE_LIMIT_CAPS: Readonly<Record<RateLimitedAction, { tenMinutes: number; hour: number }>> = {
  signup: { tenMinutes: 5, hour: 20 },
  signin: { tenMinutes: 10, hour: 40 },
  feedback: { tenMinutes: 5, hour: 20 },
};

const MINUTE_MS = 60_000;

/**
 * check_rate_limit (041, 045): true and records the attempt when the IP hash
 * is under both caps for `action`; false, recording nothing, when either cap
 * is reached. One INSERT ... SELECT, so the check and the record cannot be
 * split by another request.
 */
export async function checkRateLimit(
  db: D1DatabaseLike,
  ipHash: string,
  action: RateLimitedAction,
  now: Date = new Date(),
): Promise<boolean> {
  const caps = RATE_LIMIT_CAPS[action];
  const tenMinutesAgo = new Date(now.getTime() - 10 * MINUTE_MS).toISOString();
  const hourAgo = new Date(now.getTime() - 60 * MINUTE_MS).toISOString();
  const changes = await run(
    db,
    `INSERT INTO rate_limit_buckets (ip_hash, action, attempted_at)
     SELECT ?1, ?2, ?3
      WHERE (SELECT count(*) FROM rate_limit_buckets
              WHERE ip_hash = ?1 AND action = ?2 AND attempted_at > ?4) < ?5
        AND (SELECT count(*) FROM rate_limit_buckets
              WHERE ip_hash = ?1 AND action = ?2 AND attempted_at > ?6) < ?7`,
    ipHash,
    action,
    now.toISOString(),
    tenMinutesAgo,
    caps.tenMinutes,
    hourAgo,
    caps.hour,
  );
  return changes === 1;
}

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
