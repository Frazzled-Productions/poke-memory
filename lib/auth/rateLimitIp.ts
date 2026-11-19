/**
 * Per-IP rate-limit helper (#1768).
 *
 * Hashes a raw client IP with a server-side salt before it is stored in
 * rate_limit_buckets (D1; lib/db/rateLimit.ts). The raw IP is never persisted
 * or logged.
 *
 * The salt is the RATE_LIMIT_SALT Worker secret (passed in from the Worker env,
 * else read from process.env). If it is absent (local dev / CI) a hard-coded
 * dev-salt is used. Production MUST set it:
 *   openssl rand -base64 32 | wrangler secret put RATE_LIMIT_SALT
 */

import { createHash } from "node:crypto";

/**
 * Canonical list of action strings accepted by checkRateLimit
 * (lib/db/rateLimit.ts, which holds each action's caps) and the
 * rate_limit_buckets_action_check constraint in the DB. Adding a value here
 * needs a cap there and a migration widening the CHECK. (#1883)
 */
export const RATE_LIMIT_ACTIONS = ["signup", "signin", "feedback"] as const;

/** A value accepted by checkRateLimit. */
export type RateLimitAction = (typeof RATE_LIMIT_ACTIONS)[number];

/**
 * Returns a 64-character lowercase hex sha256 digest of (salt + rawIp).
 * The digest format matches the CHECK constraint on rate_limit_buckets.ip_hash.
 *
 * The raw IP is never stored or logged by this function or its callers.
 */
export function hashIp(rawIp: string, salt: string = process.env.RATE_LIMIT_SALT ?? "dev-salt"): string {
  return createHash("sha256").update(salt + rawIp).digest("hex"); // 64-char hex
}
