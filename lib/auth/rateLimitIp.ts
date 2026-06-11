/**
 * Per-IP rate-limit helper (#1768).
 *
 * Hashes a raw client IP with a server-side salt before it is stored in
 * public.rate_limit_buckets. The raw IP is never persisted or logged.
 *
 * The salt is read from RATE_LIMIT_SALT (server-side env var, NOT
 * NEXT_PUBLIC_). If the var is absent (local dev / CI) a hard-coded
 * dev-salt is used. This MUST be overridden in Vercel production via:
 *   openssl rand -base64 32  -> paste into RATE_LIMIT_SALT
 */

import { createHash } from "node:crypto";

/**
 * Canonical list of action strings accepted by the check_rate_limit RPC and
 * the rate_limit_buckets_action_check constraint in the DB.
 *
 * SINGLE SOURCE OF TRUTH - keeping this in sync with the DB is enforced by
 * lib/sync/integration/rate-limit.test.ts, which iterates this list and calls
 * the real RPC against a local Postgres container for each action. Adding a
 * value here without a companion migration (that teaches the function + CHECK
 * constraint) will make the integration test fail. (#1883)
 */
export const RATE_LIMIT_ACTIONS = ["signup", "signin", "feedback"] as const;

/** A value accepted by the check_rate_limit RPC. */
export type RateLimitAction = (typeof RATE_LIMIT_ACTIONS)[number];

/**
 * Returns a 64-character lowercase hex sha256 digest of (salt + rawIp).
 * The digest format matches the CHECK constraint on rate_limit_buckets.ip_hash.
 *
 * The raw IP is never stored or logged by this function or its callers.
 */
export function hashIp(rawIp: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? "dev-salt";
  return createHash("sha256").update(salt + rawIp).digest("hex"); // 64-char hex
}
