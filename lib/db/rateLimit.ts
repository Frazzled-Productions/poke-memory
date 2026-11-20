/**
 * Per-IP throttle over rate_limit_buckets (Postgres 041 and 045, now D1).
 *
 * Same semantics as the old check_rate_limit RPC: an attempt is allowed while
 * the IP hash has fewer than the 10-minute cap AND fewer than the 1-hour cap of
 * earlier attempts for that action; an allowed attempt adds a row, a refused
 * one adds nothing. The count and the insert are one statement, so two
 * concurrent attempts cannot both slip under the cap.
 *
 * Only a salted sha256 of the IP is stored (hashIp in lib/auth/rateLimitIp.ts);
 * the raw address never reaches the database. Old rows are purged by the
 * half-hourly rate-limit clean-up job.
 */
import type { D1DatabaseLike } from "./d1";
import type { RateLimitAction } from "../auth/rateLimitIp";

/** Caps per action, as in check_rate_limit (041, 045). */
export const RATE_LIMIT_CAPS: Readonly<Record<RateLimitAction, { per10Minutes: number; perHour: number }>> = {
  signup: { per10Minutes: 5, perHour: 20 },
  signin: { per10Minutes: 10, perHour: 40 },
  feedback: { per10Minutes: 5, perHour: 20 },
};

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Records an attempt and returns true when it is within the caps; returns
 * false (recording nothing) when either cap is reached.
 */
export async function checkRateLimit(
  db: D1DatabaseLike,
  ipHash: string,
  action: RateLimitAction,
  now: Date = new Date(),
): Promise<boolean> {
  const caps = RATE_LIMIT_CAPS[action];
  if (!caps) throw new Error(`checkRateLimit: unknown action ${String(action)}`);
  const since10m = new Date(now.getTime() - TEN_MINUTES_MS).toISOString();
  const since1h = new Date(now.getTime() - ONE_HOUR_MS).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO rate_limit_buckets (ip_hash, action, attempted_at)
       SELECT ?, ?, ?
       WHERE (SELECT COUNT(*) FROM rate_limit_buckets
               WHERE ip_hash = ? AND action = ? AND attempted_at > ?) < ?
         AND (SELECT COUNT(*) FROM rate_limit_buckets
               WHERE ip_hash = ? AND action = ? AND attempted_at > ?) < ?`,
    )
    .bind(
      ipHash, action, now.toISOString(),
      ipHash, action, since10m, caps.per10Minutes,
      ipHash, action, since1h, caps.perHour,
    )
    .run();
  return result.meta.changes > 0;
}
