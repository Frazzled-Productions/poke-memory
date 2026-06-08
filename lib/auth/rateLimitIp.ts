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
 * Returns a 64-character lowercase hex sha256 digest of (salt + rawIp).
 * The digest format matches the CHECK constraint on rate_limit_buckets.ip_hash.
 *
 * The raw IP is never stored or logged by this function or its callers.
 */
export function hashIp(rawIp: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? "dev-salt";
  return createHash("sha256").update(salt + rawIp).digest("hex"); // 64-char hex
}
